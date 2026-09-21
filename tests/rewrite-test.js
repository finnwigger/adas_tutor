// ── Query-rewrite test runner ──────────────────────────────────────────────
// Scores core/query-rewrite.js against tests/rewrite-scenarios.js:
//
//   1. Trigger accuracy — needsRewrite() must fire for referential/
//      self-contained cases and stay quiet for negative controls (no LLM call
//      needed for this part).
//   2. Retrieval value — for triggering cases, retrieve with the RAW question
//      and with the REWRITTEN query and compare hit rates.
//   3. No-harm — on self-contained cases the rewrite must not lose the
//      expected doc that raw retrieval already found.
//
// Cheap by design: one temperature-0 LLM call per triggering scenario, no
// generation, no judge. Logs to logs/tests/rewrite-test_<hash>.json.
//
// Usage: npm run rag:test-rewrite
// Env:   REWRITE_TEST_MODEL (default gemini-3.1-flash-lite), RAG_K, RAG_SCORE_THRESHOLD

import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import { createHash } from "crypto";
import { needsRewrite, buildRewriteMessages, QUERY_REWRITE_VERSION } from "../core/query-rewrite.js";
import { rewriteScenarios, REWRITE_SCENARIO_VERSION } from "./rewrite-scenarios.js";
import { getChatModel, apiKeysForModel } from "../core/llm-fallback.js";
import { tokenPacket } from "../core/pricing.js";
import { getSystemSpecs } from "../core/log-specs.js";
import { JsonLogger } from "../core/logger.js";

dotenv.config();

const STORAGE_PATH = "rag/storage";
const K            = parseInt(process.env.RAG_K ?? "20");
const THRESHOLD    = parseFloat(process.env.RAG_SCORE_THRESHOLD ?? "0.50");
const MODEL        = process.env.REWRITE_TEST_MODEL ?? "gemini-3.1-flash-lite";

const CONFIG = {
  model: MODEL, k: K, threshold: THRESHOLD,
  queryRewriteVersion: QUERY_REWRITE_VERSION,
  scenarioVersion: REWRITE_SCENARIO_VERSION,
  embeddingModel: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001",
};
const CONFIG_HASH = createHash("sha256").update(JSON.stringify(CONFIG)).digest("hex").slice(0, 8);

const LOG_DIR  = "logs/tests";
const LOG_FILE = `rewrite-test_${CONFIG_HASH}.json`;

const logger = new JsonLogger({
  dir: LOG_DIR,
  filename: LOG_FILE,
  meta: {
    description: `Query-rewrite test: trigger accuracy of needsRewrite() plus raw-vs-rewritten retrieval hit rate over ${rewriteScenarios.length} scenarios (rewriter ${QUERY_REWRITE_VERSION}, scenarios ${REWRITE_SCENARIO_VERSION}). One temperature-0 call to ${MODEL} per triggering scenario; no generation, no judge.`,
    type: "rewrite-test", configHash: CONFIG_HASH, config: CONFIG, specs: getSystemSpecs(),
  },
});

async function rewriteWithKeys(question, history) {
  const keys = apiKeysForModel(MODEL);
  let lastErr;
  for (const apiKey of keys) {
    try {
      const aiMsg = await getChatModel(MODEL, { temperature: 0, apiKey })
        .invoke(buildRewriteMessages(question, history));
      const text = (typeof aiMsg.content === "string"
        ? aiMsg.content
        : aiMsg.content.map((c) => c.text ?? "").join("")).trim();
      return { text: text || question, usage: aiMsg.usage_metadata ?? null };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function hitInfo(hits, expectedDocs) {
  const best = new Map();
  for (const [doc, score] of hits) {
    const f = doc.metadata?.source ?? "unknown";
    if (!best.has(f) || score < best.get(f)) best.set(f, score);
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([f]) => f);
  const rank = ranked.findIndex((f) => expectedDocs.includes(f));
  return { hit: rank !== -1, rank: rank === -1 ? null : rank + 1, files: ranked };
}

console.log("═".repeat(64));
console.log(`Query-rewrite test  (rewriter ${QUERY_REWRITE_VERSION}, scenarios ${REWRITE_SCENARIO_VERSION})`);
console.log(`Model: ${MODEL}   K=${K}  threshold=${THRESHOLD}`);
console.log(`Config hash: ${CONFIG_HASH}  →  ${LOG_FILE}`);
console.log("═".repeat(64));

console.log("\nLoading vector store...");
const vectorStore = await HNSWLib.load(
  STORAGE_PATH,
  new GoogleGenerativeAIEmbeddings({ model: CONFIG.embeddingModel })
);
console.log("Ready.\n");

const stats = {
  triggerCorrect: 0, triggerTotal: 0,
  referential: { rawHits: 0, rewriteHits: 0, rawTop1: 0, rewriteTop1: 0, total: 0 },
  selfContained: { rawHits: 0, rewriteHits: 0, rawTop1: 0, rewriteTop1: 0, total: 0 },
  negative: { rawHits: 0, total: 0 },
};
let totalCostUsd = 0;

for (const s of rewriteScenarios) {
  const triggered = needsRewrite(s.question);
  const shouldTrigger = s.class !== "negative";
  const triggerOk = triggered === shouldTrigger;
  stats.triggerTotal++;
  if (triggerOk) stats.triggerCorrect++;

  const rawHits = (await vectorStore.similaritySearchWithScore(s.question, K))
    .filter(([, score]) => score <= THRESHOLD);
  const raw = hitInfo(rawHits, s.expectedDocs);

  let rewritten = null, rw = null, rewriteTokens = null, rewriteError = null;
  if (triggered && s.history.length > 0) {
    // A transient API failure fails THIS scenario, not the whole suite —
    // the entry is logged with the error and the run (and summary) continue.
    try {
      const { text, usage } = await rewriteWithKeys(s.question, s.history);
      rewritten = text;
      rewriteTokens = usage ? tokenPacket(MODEL, usage) : null;
      if (rewriteTokens?.costUsd != null) totalCostUsd += rewriteTokens.costUsd;
      const rwHits = (await vectorStore.similaritySearchWithScore(rewritten, K))
        .filter(([, score]) => score <= THRESHOLD);
      rw = hitInfo(rwHits, s.expectedDocs);
    } catch (e) {
      rewriteError = e.message.split("\n")[0];
      console.log(`  [rewrite call failed] ${rewriteError}`);
    }
  }

  const bucket = s.class === "referential" ? stats.referential
               : s.class === "self-contained" ? stats.selfContained : null;
  if (bucket) {
    bucket.total++;
    if (raw.hit) bucket.rawHits++;
    if (raw.rank === 1) bucket.rawTop1++;
    if ((rw ?? raw).hit) bucket.rewriteHits++;
    if ((rw ?? raw).rank === 1) bucket.rewriteTop1++;
  } else {
    stats.negative.total++;
    if (raw.hit) stats.negative.rawHits++;
  }

  const effective = rw ?? raw;
  const pass = rewriteError
    ? false
    : s.class === "negative" ? (triggerOk && raw.hit) : (triggerOk && effective.hit);

  console.log(`[${s.id}] ${s.name}`);
  console.log(`  class=${s.class}  trigger=${triggered} (expected ${shouldTrigger}) ${triggerOk ? "✓" : "✗ TRIGGER"}`);
  console.log(`  Q: "${s.question}"`);
  if (rewritten) console.log(`  ↪ rewritten: "${rewritten}"`);
  console.log(`  raw retrieval:     ${raw.hit ? `hit (rank ${raw.rank})` : "MISS"}`);
  if (rw) console.log(`  rewrite retrieval: ${rw.hit ? `hit (rank ${rw.rank})` : "MISS"}`);
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}\n`);

  logger.add({
    taskId: s.id, name: s.name, class: s.class, question: s.question,
    history: s.history, expectedDocs: s.expectedDocs,
    triggered, shouldTrigger, triggerOk,
    rewritten,
    raw:     { hit: raw.hit, rank: raw.rank, topFiles: raw.files.slice(0, 4) },
    rewrite: rw ? { hit: rw.hit, rank: rw.rank, topFiles: rw.files.slice(0, 4) } : null,
    tokens: rewriteTokens ? { rewrite: rewriteTokens } : undefined,
    ...(rewriteError ? { error: `REWRITE ERROR: ${rewriteError}` } : {}),
    status: pass ? "✓ PASS" : "✗ FAIL",
    timestamp: new Date().toISOString(),
  });
  logger.write(); // persist per scenario so a crash never loses completed entries
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const summary = {
  scenarios: rewriteScenarios.length,
  triggerAccuracy: stats.triggerCorrect / stats.triggerTotal,
  referential: {
    total: stats.referential.total,
    rawHitRate:      stats.referential.total ? stats.referential.rawHits / stats.referential.total : null,
    rewriteHitRate:  stats.referential.total ? stats.referential.rewriteHits / stats.referential.total : null,
    rawTop1Rate:     stats.referential.total ? stats.referential.rawTop1 / stats.referential.total : null,
    rewriteTop1Rate: stats.referential.total ? stats.referential.rewriteTop1 / stats.referential.total : null,
  },
  selfContainedNoHarm: {
    total: stats.selfContained.total,
    rawHitRate:      stats.selfContained.total ? stats.selfContained.rawHits / stats.selfContained.total : null,
    rewriteHitRate:  stats.selfContained.total ? stats.selfContained.rewriteHits / stats.selfContained.total : null,
    rawTop1Rate:     stats.selfContained.total ? stats.selfContained.rawTop1 / stats.selfContained.total : null,
    rewriteTop1Rate: stats.selfContained.total ? stats.selfContained.rewriteTop1 / stats.selfContained.total : null,
  },
  negativeRetrievalSanity: {
    total: stats.negative.total,
    rawHitRate: stats.negative.total ? stats.negative.rawHits / stats.negative.total : null,
  },
  totalCostUsd,
};
logger.setSummary(summary);
logger.write();

console.log("═".repeat(64));
console.log("SUMMARY");
console.log(`  Trigger accuracy:            ${pct(stats.triggerCorrect, stats.triggerTotal)} (${stats.triggerCorrect}/${stats.triggerTotal})`);
console.log(`  Referential  raw → rewrite:  hit ${pct(stats.referential.rawHits, stats.referential.total)} → ${pct(stats.referential.rewriteHits, stats.referential.total)}   top-1 ${pct(stats.referential.rawTop1, stats.referential.total)} → ${pct(stats.referential.rewriteTop1, stats.referential.total)}  (n=${stats.referential.total})`);
console.log(`  Self-contained no-harm:      hit ${pct(stats.selfContained.rawHits, stats.selfContained.total)} → ${pct(stats.selfContained.rewriteHits, stats.selfContained.total)}   top-1 ${pct(stats.selfContained.rawTop1, stats.selfContained.total)} → ${pct(stats.selfContained.rewriteTop1, stats.selfContained.total)}  (n=${stats.selfContained.total})`);
console.log(`  Negative controls retrieval: ${pct(stats.negative.rawHits, stats.negative.total)} raw hit (n=${stats.negative.total})`);
console.log(`  Total rewrite cost:          $${totalCostUsd.toFixed(6)}`);
console.log(`  Log: ${LOG_DIR}/${LOG_FILE}`);
console.log("═".repeat(64));
