// Must be the first import: core/llm-fallback.js reads process.env.LLM_MODEL_CHAIN
// at module-load time, and ESM evaluates imports in source order before any of
// this file's own code runs — a later `dotenv.config()` call would be too late.
import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { KNOWLEDGE_MODE, CONTEXT_MODE } from "./app-config.js";
import { getChatModel, withModelFallback, streamWithFallback, LIVE_API_KEYS } from "./core/llm-fallback.js";
import { getSystemSpecs, describeSpecs } from "./core/log-specs.js";
import { JsonLogger, buildLogFilename } from "./core/logger.js";
import { tokenPacket, estimateCost, estimateTokensFromChars } from "./core/pricing.js";
import { buildFullContext } from "./core/full-context.js";
import { passageLabel } from "./core/passage-label.js";
import { getPromptVariantText, canonicalVariantId, getVariantPosition } from "./core/prompt-variants.js";
import { getPromptTemplate, MODE_INSTRUCTIONS, KNOWLEDGE_PROFILE_HEADER, KNOWLEDGE_INSTRUCTIONS, coverageNote, coverageReminder } from "./core/prompt-templates.js";
import { needsRewrite, buildRewriteMessages } from "./core/query-rewrite.js";
import {
  loadUser, saveUser, knowledgeSummary,
  applyScoreUpdates, applyNoteUpdates,
  isValidUserName,
  TOPICS, LEVEL_LABELS,
} from "./users/user-profiles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// 5mb: /api/stt posts base64-encoded mic recordings (~60KB per 15s of
// webm-opus; the cap leaves ample headroom without allowing huge bodies).
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const STORAGE_PATH = "rag/storage";
const K           = parseInt(process.env.RAG_K                ?? "20");
const THRESHOLD   = parseFloat(process.env.RAG_SCORE_THRESHOLD ?? "0.5");
const TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE     ?? "0.7");

// Additional reliability/grounding instructions layered onto the base prompt — see core/prompt-variants.js.
const PROMPT_VARIANT        = canonicalVariantId(process.env.PROMPT_VARIANT);
const VARIANT_INSTRUCTIONS  = getPromptVariantText(PROMPT_VARIANT);
const VARIANT_POSITION      = getVariantPosition();

// ── Load knowledge source at startup ──────────────────────────────────────

let vectorStore = null;

if (CONTEXT_MODE === "rag") {
  console.log("Loading vector store...");
  vectorStore = await HNSWLib.load(
    STORAGE_PATH,
    new GoogleGenerativeAIEmbeddings({ model: "gemini-embedding-001" })
  );
} else if (CONTEXT_MODE === "none") {
  console.log("Ungrounded mode (none) — no documents, no retrieval.");
} else {
  // Pre-warm the doc cache for full-context modes
  buildFullContext("", CONTEXT_MODE);
  console.log(`Full-context mode (${CONTEXT_MODE}) — docs loaded from rag/docs/.`);
}
console.log("Ready.");

// ── Chat mode / knowledge / prompt templates ────────────────────────────────
// MODE_INSTRUCTIONS, KNOWLEDGE_PROFILE_HEADER, KNOWLEDGE_INSTRUCTIONS, and the
// two prompt templates live in core/prompt-templates.js, shared with tests/generation-test.js.

function getActiveTemplate() {
  return getPromptTemplate(CONTEXT_MODE, VARIANT_POSITION);
}

// ── Tutor chain (no StringOutputParser — we extract text in streamWithFallback
//    so usage_metadata flows through the final AIMessageChunk) ──────────────

const tutorChains = new Map();

function getTutorChain(model, apiKey) {
  const key = `${model}:${apiKey ?? "default"}`;
  if (!tutorChains.has(key)) {
    tutorChains.set(key, getActiveTemplate().pipe(getChatModel(model, { temperature: TEMPERATURE, apiKey })));
  }
  return tutorChains.get(key);
}

// ── Knowledge update: numeric scores ──────────────────────────────────────

const SCORER_SYSTEM_SCORES = `You evaluate ADAS tutoring exchanges and update student knowledge scores.
Topic keys:
${Object.entries(TOPICS).map(([k, v]) => `  ${k}: ${v}`).join("\n")}

Scores use a 3-tier scale: 0 = Beginner, 1 = Intermediate, 2 = Expert.
Return ONLY valid JSON mapping topic keys to integer scores (0, 1, or 2) for topics meaningfully covered.
Output {} if nothing was discussed.`;

async function runScoreUpdate(profile, question, answer, onUsage) {
  const current = Object.entries(profile.knowledge)
    .map(([k, v]) => `  ${k}: ${v}/2 (${LEVEL_LABELS[v] ?? LEVEL_LABELS[0]})`)
    .join("\n");
  const msg = `Current scores:\n${current}\n\nExchange:\nStudent: ${question}\nTutor: ${answer}\n\nReturn JSON only.`;
  try {
    const result = await withModelFallback(
      (model, apiKey) => getChatModel(model, { temperature: 0, apiKey }).invoke([
        { role: "system", content: SCORER_SYSTEM_SCORES },
        { role: "human", content: msg },
      ]),
      "score-update",
      onUsage,
      LIVE_API_KEYS
    );
    const match = result.content.match(/\{[\s\S]*\}/);
    if (match) applyScoreUpdates(profile, JSON.parse(match[0]));
  } catch {
    // non-fatal
  }
}

// ── Knowledge update: free-text descriptions ───────────────────────────────

const SCORER_SYSTEM_DESCRIPTIONS = `You evaluate ADAS tutoring exchanges and update student knowledge descriptions.
Topic keys:
${Object.entries(TOPICS).map(([k, v]) => `  ${k}: ${v}`).join("\n")}

For each topic meaningfully covered in the exchange, write a single, short sentence describing what the student now knows — capture specific features or settings they understand and any gaps that were revealed.
Return ONLY valid JSON mapping topic keys to description strings.
Output {} if nothing was discussed.`;

async function runDescriptionUpdate(profile, question, answer, onUsage) {
  const current = Object.entries(TOPICS)
    .map(([k, label]) => {
      const note = profile.knowledgeNotes?.[k];
      return `  ${k} (${label}): ${note || "no knowledge recorded yet"}`;
    })
    .join("\n");
  const msg = `Current knowledge:\n${current}\n\nExchange:\nStudent: ${question}\nTutor: ${answer}\n\nReturn JSON only.`;
  try {
    const result = await withModelFallback(
      (model, apiKey) => getChatModel(model, { temperature: 0, apiKey }).invoke([
        { role: "system", content: SCORER_SYSTEM_DESCRIPTIONS },
        { role: "human", content: msg },
      ]),
      "description-update",
      onUsage,
      LIVE_API_KEYS
    );
    const match = result.content.match(/\{[\s\S]*\}/);
    if (match) applyNoteUpdates(profile, JSON.parse(match[0]));
  } catch {
    // non-fatal
  }
}

async function runKnowledgeUpdate(profile, question, answer, onUsage) {
  if (KNOWLEDGE_MODE === "descriptions") {
    await runDescriptionUpdate(profile, question, answer, onUsage);
  } else {
    await runScoreUpdate(profile, question, answer, onUsage);
  }
}

// ── RAG: query rewrite + context carryover ─────────────────────────────────
// Trigger heuristic + rewrite prompt live in core/query-rewrite.js, shared
// with the test suites so live and test behaviour can't drift.

const lastHitsCache = new Map();

async function rewriteQuery(question, history, onUsage) {
  const result = await withModelFallback(
    (model, apiKey) => getChatModel(model, { temperature: 0, apiKey }).invoke(
      buildRewriteMessages(question, history)
    ),
    "query-rewrite",
    onUsage,
    LIVE_API_KEYS
  );
  return result.content.trim() || question;
}

// ── Session logging ────────────────────────────────────────────────────────

const SESSION_LOG_DIR = "logs/sessions";
const sessionLoggers = new Map();

function getSessionLogger(sessionId, username) {
  if (!sessionLoggers.has(sessionId)) {
    const specs = getSystemSpecs();
    sessionLoggers.set(sessionId, new JsonLogger({
      dir: SESSION_LOG_DIR,
      filename: buildLogFilename("session", `${username}_${sessionId.slice(0, 8)}`),
      meta: {
        description: `${describeSpecs(specs)} Chat session log for user "${username}".`,
        type: "session", username, sessionId, contextMode: CONTEXT_MODE, specs,
      },
    }));
  }
  return sessionLoggers.get(sessionId);
}

function logSessionTurn(sessionLogger, turn) {
  sessionLogger.add(turn);

  const entries = sessionLogger.entries;
  const turnCount = entries.length;
  const turnsWithHits = entries.filter((t) => t.retrieved?.length > 0).length;
  const modeUsage = {};
  const modelUsage = {};

  let totalInputTokens = 0, totalOutputTokens = 0, totalCostUsd = 0;
  let tokenTurns = 0;

  for (const t of entries) {
    modeUsage[t.mode] = (modeUsage[t.mode] ?? 0) + 1;
    if (t.model) modelUsage[t.model] = (modelUsage[t.model] ?? 0) + 1;
    if (t.tokens?.chat?.input != null) {
      totalInputTokens  += t.tokens.chat.input;
      totalOutputTokens += t.tokens.chat.output ?? 0;
      tokenTurns++;
    }
    if (t.costUsd?.total != null) totalCostUsd += t.costUsd.total;
  }

  sessionLogger.setSummary({
    turnCount,
    contextMode: CONTEXT_MODE,
    retrievalHitRate: CONTEXT_MODE === "rag" ? (turnCount ? turnsWithHits / turnCount : null) : null,
    avgChunksRetrieved: CONTEXT_MODE === "rag" && turnCount
      ? entries.reduce((sum, t) => sum + (t.retrieved?.length ?? 0), 0) / turnCount
      : null,
    modeUsage,
    modelUsage,
    tokens: tokenTurns > 0 ? {
      avgChatInput:  Math.round(totalInputTokens  / tokenTurns),
      avgChatOutput: Math.round(totalOutputTokens / tokenTurns),
      totalInput:    totalInputTokens,
      totalOutput:   totalOutputTokens,
    } : undefined,
    totalCostUsd: tokenTurns > 0 ? totalCostUsd : undefined,
  });
  sessionLogger.write();
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get("/api/config", (_req, res) => {
  res.json({ knowledgeMode: KNOWLEDGE_MODE, contextMode: CONTEXT_MODE });
});

app.get("/api/users", (_req, res) => {
  const dir = "users";
  if (!fs.existsSync(dir)) return res.json([]);
  res.json(
    fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
  );
});

app.get("/api/user/:name", (req, res) => {
  if (!isValidUserName(req.params.name)) return res.status(400).json({ error: "invalid user name" });
  res.json(loadUser(req.params.name));
});

app.post("/api/user/:name/scores", (req, res) => {
  if (!isValidUserName(req.params.name)) return res.status(400).json({ error: "invalid user name" });
  const profile = loadUser(req.params.name);
  for (const [topic, value] of Object.entries(req.body.scores ?? {})) {
    if (topic in profile.knowledge) {
      profile.knowledge[topic] = Math.min(2, Math.max(0, Math.round(Number(value))));
    }
  }
  for (const [topic, note] of Object.entries(req.body.notes ?? {})) {
    if (topic in profile.knowledgeNotes) {
      profile.knowledgeNotes[topic] = String(note);
    }
  }
  saveUser(profile);
  res.json(profile);
});

app.post("/api/chat", async (req, res) => {
  const { username, question, mode = "pre-drive", history: clientHistory = [], sessionId } = req.body;

  // Validate before flushing SSE headers or building the session-log filename
  // (both derive paths from username) so a bad name gets a clean 400, not a
  // 500 mid-stream or a traversal into logs/.
  if (!isValidUserName(username)) return res.status(400).json({ error: "invalid user name" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const sessionLogger = sessionId ? getSessionLogger(sessionId, username) : null;

  try {
    const profile = loadUser(username);
    const knowledgeBefore = JSON.parse(JSON.stringify(
      KNOWLEDGE_MODE === "descriptions" ? profile.knowledgeNotes : profile.knowledge
    ));

    // ── Build context (RAG or full-context) ───────────────────────────────

    let context, docOrder, docCount;
    let hits = [], usedCachedHits = false;
    let retrievalQuery = question, rewroteQuery = false;

    // Token usage collectors
    let rewriteUsageModel = null, rewriteUsage = null;

    if (CONTEXT_MODE === "rag") {
      if (needsRewrite(question) && clientHistory.length > 0) {
        try {
          retrievalQuery = await rewriteQuery(
            question, clientHistory,
            (model, usage) => { rewriteUsageModel = model; rewriteUsage = usage; }
          );
          rewroteQuery = retrievalQuery !== question;
        } catch {
          // non-fatal
        }
      }

      const raw = await vectorStore.similaritySearchWithScore(retrievalQuery, K);
      hits = raw.filter(([, s]) => s <= THRESHOLD);

      if (!hits.length) {
        const cached = lastHitsCache.get(username);
        if (cached?.length) { hits = cached; usedCachedHits = true; }
      } else {
        lastHitsCache.set(username, hits);
      }

      context = hits.length
        ? hits.map(([doc, s]) => {
            const src   = doc.metadata?.source ?? "unknown";
            const label = passageLabel(doc);
            const tag   = label ? `${src} — ${label}` : src;
            return `[${tag}] (distance: ${s.toFixed(4)})\n${doc.pageContent}`;
          }).join("\n\n---\n\n")
        : "No relevant context retrieved.";
    } else if (CONTEXT_MODE === "none") {
      // No retrieval, no documents; the no-context prompt template
      // (core/prompt-templates.js) doesn't reference {context}, so this is left unused.
    } else {
      ({ context, docOrder, docCount } = buildFullContext(question, CONTEXT_MODE));
    }

    // ── Build prompt params ───────────────────────────────────────────────

    const history = clientHistory.map((m) =>
      m.role === "human" ? new HumanMessage(m.content) : new AIMessage(m.content)
    );

    const coverageCount = CONTEXT_MODE === "rag" ? hits.length : CONTEXT_MODE === "none" ? null : docCount;

    const promptParams = {
      context,
      history,
      question,
      knowledge:              knowledgeSummary(profile),
      knowledge_header:       KNOWLEDGE_PROFILE_HEADER[KNOWLEDGE_MODE] ?? KNOWLEDGE_PROFILE_HEADER.scores,
      knowledge_instructions: KNOWLEDGE_INSTRUCTIONS[KNOWLEDGE_MODE]   ?? KNOWLEDGE_INSTRUCTIONS.scores,
      mode_instructions:      MODE_INSTRUCTIONS[mode] ?? MODE_INSTRUCTIONS["pre-drive"],
      variant_instructions:   VARIANT_INSTRUCTIONS,
      coverage_note:          coverageNote(CONTEXT_MODE, coverageCount),
      coverage_reminder:      coverageReminder(CONTEXT_MODE, coverageCount),
    };

    // Render the exact prompt for logging (only system message; history and question are structured)
    const renderedMessages = await getActiveTemplate().formatMessages(promptParams);
    const systemPromptText = renderedMessages[0]?.content ?? "";

    // ── Stream response with latency + usage tracking ─────────────────────

    const startMs = Date.now();
    let firstChunkMs = null;
    let modelUsed = null;
    let chatUsage = null;

    const stream = streamWithFallback(
      getTutorChain,
      promptParams,
      "chat",
      (model) => { modelUsed = model; },
      (usage) => { chatUsage = usage; },
      ()     => { firstChunkMs = Date.now() - startMs; },
      LIVE_API_KEYS
    );

    let reply = "";
    for await (const chunk of stream) {
      reply += chunk;
      send({ chunk });
    }
    const totalMs = Date.now() - startMs;

    send({ text_done: true });

    // ── Knowledge update ──────────────────────────────────────────────────

    let knUpdateUsageModel = null, knUpdateUsage = null;

    const scoreTimeout = new Promise((r) => setTimeout(r, 8000));
    await Promise.race([
      runKnowledgeUpdate(
        profile, question, reply,
        (model, usage) => { knUpdateUsageModel = model; knUpdateUsage = usage; }
      ),
      scoreTimeout,
    ]);
    saveUser(profile);

    // ── Tokens + cost ─────────────────────────────────────────────────────

    // Chat: use exact usage_metadata if available, else estimate from chars
    let chatTokens;
    if (chatUsage) {
      chatTokens = tokenPacket(modelUsed, chatUsage, true);
    } else {
      const promptChars = renderedMessages.reduce((s, m) =>
        s + (typeof m.content === "string" ? m.content.length : 0), 0);
      chatTokens = tokenPacket(modelUsed, {
        input_tokens:  estimateTokensFromChars(promptChars),
        output_tokens: estimateTokensFromChars(reply.length),
      }, false);
    }

    const rewriteTokens = rewriteUsage
      ? tokenPacket(rewriteUsageModel, rewriteUsage, true)
      : null;

    const knUpdateTokens = knUpdateUsage
      ? tokenPacket(knUpdateUsageModel, knUpdateUsage, true)
      : null;

    const totalCost = [chatTokens, rewriteTokens, knUpdateTokens]
      .reduce((sum, t) => (t?.costUsd != null ? sum + t.costUsd : sum), 0) || null;

    // ── Session logging ───────────────────────────────────────────────────

    if (sessionLogger) {
      const knowledgeAfter = KNOWLEDGE_MODE === "descriptions" ? profile.knowledgeNotes : profile.knowledge;
      const knowledgeChanges = {};
      for (const topic of Object.keys(knowledgeBefore)) {
        if (knowledgeBefore[topic] !== knowledgeAfter[topic]) {
          knowledgeChanges[topic] = { from: knowledgeBefore[topic], to: knowledgeAfter[topic] };
        }
      }

      logSessionTurn(sessionLogger, {
        timestamp: new Date().toISOString(),
        mode,
        contextMode: CONTEXT_MODE,
        question,

        // Prompt (system message rendered verbatim for prompt-engineering analysis)
        systemPrompt: systemPromptText,

        // Context info
        ...(CONTEXT_MODE === "rag"
          ? {
              retrievalQuery:  rewroteQuery ? retrievalQuery : null,
              retrieved:       hits.map(([doc, s]) => ({
                file:     doc.metadata?.source ?? "unknown",
                passage:  passageLabel(doc),
                distance: s,
              })),
              usedCachedHits,
            }
          : { docOrder, docCount }
        ),

        answer:   reply,
        model:    modelUsed,

        // Latency
        latencyMs: { firstChunk: firstChunkMs, total: totalMs },

        // Token counts and cost
        tokens: {
          chat:            chatTokens,
          rewrite:         rewriteTokens,
          knowledgeUpdate: knUpdateTokens,
        },
        costUsd: {
          chat:            chatTokens?.costUsd   ?? null,
          rewrite:         rewriteTokens?.costUsd ?? null,
          knowledgeUpdate: knUpdateTokens?.costUsd ?? null,
          total:           totalCost,
        },

        knowledgeChanges,
      });
    }

    send({ done: true, profile });
    res.end();
  } catch (e) {
    send({ error: e.message.split("\n")[0] });
    res.end();
  }
});

app.post("/api/tts", async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "No text" });

  const clean = text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim()
    .slice(0, 4800);

  const voice  = process.env.GOOGLE_TTS_VOICE  ?? "en-US-Neural2-D";
  const apiKey = process.env.GOOGLE_TTS_API_KEY ?? process.env.GOOGLE_API_KEY;

  try {
    const ttsRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: clean },
          voice: { languageCode: "en-US", name: voice },
          audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
        }),
      }
    );

    if (!ttsRes.ok) {
      const err = await ttsRes.json();
      return res.status(502).json({ error: err.error?.message ?? "TTS failed" });
    }

    const { audioContent } = await ttsRes.json();
    const audio = Buffer.from(audioContent, "base64");
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audio);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Transcribes a base64-encoded webm/opus recording from the frontend's MediaRecorder.
const STT_MODEL = "gemini-3.1-flash-lite";

app.post("/api/stt", async (req, res) => {
  const { audio, mimeType = "audio/webm" } = req.body;
  if (!audio) return res.status(400).json({ error: "No audio" });
  if (audio.length > 4_000_000) return res.status(413).json({ error: "Recording too long" });

  try {
    const sttRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${STT_MODEL}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Transcribe the spoken audio verbatim. Reply with only the transcribed text — no commentary, no quotes. If there is no intelligible speech, reply with an empty string." },
              { inline_data: { mime_type: mimeType, data: audio } },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      }
    );

    if (!sttRes.ok) {
      const err = await sttRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message ?? "Transcription failed" });
    }

    const data = await sttRes.json();
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "").join("").trim();
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`ADAS Assistant → http://localhost:${PORT}`));
