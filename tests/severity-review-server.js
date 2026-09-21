// Browser-based human verification of the AI-assisted severity-coding first
// pass (thesis Section 6, sec:results-severity) — same job pattern as
// tests/review-server.js, but for a different question: not "does the judge
// agree with a human", but "does the author agree with Claude's proposed
// S0/S1/S2 tier (or confirm/reject call) for each judge-flagged claim".
//
// Usage:
//   node tests/severity-review-server.js [--port N] [--reviewer NAME]
//
// Reads/writes logs/tests/severity-review-queue.json in place. Progress is
// saved after every submitted label, so it's safe to stop and resume.

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
}

const PORT     = parseInt(argValue("--port", "3200")) || 3200;
const REVIEWER = argValue("--reviewer", process.env.USER || process.env.USERNAME || "anonymous");
const QUEUE_PATH = path.join(__dirname, "..", "logs", "tests", "severity-review-queue.json");

if (!fs.existsSync(QUEUE_PATH)) {
  console.error(`Queue file not found: ${QUEUE_PATH}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));

function save() {
  data.meta.lastUpdatedAt = new Date().toISOString();
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(data, null, 2));
}

function publicEntry(e) {
  return {
    taskId: e.taskId,
    suite: e.suite,
    category: e.category,
    name: e.name,
    mode: e.mode,
    question: e.question,
    response: e.response,
    context: e.context,
    retrieved: e.retrieved,
    docOrder: e.docOrder,
    judgeHallucinations: e.judgeHallucinations,
    priorHumanLabel: e.priorHumanLabel,
    reviewType: e.reviewType,
    claudeProposedTier: e.claudeProposedTier,
    claudeReasoning: e.claudeReasoning,
    claudeProposedDirection: e.claudeProposedDirection ?? null,
    claudeDirectionReasoning: e.claudeDirectionReasoning ?? null,
    finalSeverity: e.finalSeverity ?? null,
  };
}

const app = express();
app.use(express.json());

app.get("/api/session", (_req, res) => {
  const reviewed = data.entries.filter((e) => e.finalSeverity).length;
  const agreed = data.entries.filter((e) => e.finalSeverity && e.finalSeverity.tier === e.claudeProposedTier).length;
  res.json({
    reviewer: REVIEWER,
    total: data.entries.length,
    reviewed,
    agreed,
    entries: data.entries.map(publicEntry),
  });
});

const VALID_TIERS = ["S0", "S1", "S2", "REJECT"];
const VALID_DIRECTIONS = ["misuse", "disuse", "neutral"];

app.post("/api/label/:taskId", (req, res) => {
  const entry = data.entries.find((e) => e.taskId === req.params.taskId);
  if (!entry) return res.status(404).json({ error: "Unknown taskId" });

  const { tier, direction, note, reviewer } = req.body ?? {};
  if (!VALID_TIERS.includes(tier)) {
    return res.status(400).json({ error: `tier must be one of ${VALID_TIERS.join(", ")}` });
  }
  // Direction only applies to confirmed S2 (Section sec:severity-direction) --
  // it's the misuse/disuse/neutral split, and it's meaningless for S0/S1/REJECT.
  if (tier === "S2" && !VALID_DIRECTIONS.includes(direction)) {
    return res.status(400).json({ error: `direction is required for S2 and must be one of ${VALID_DIRECTIONS.join(", ")}` });
  }

  entry.finalSeverity = {
    tier,
    direction: tier === "S2" ? direction : null,
    note: (note ?? "").trim(),
    agreedWithClaude: tier === entry.claudeProposedTier,
    agreedWithClaudeDirection: tier === "S2" ? direction === entry.claudeProposedDirection : null,
    reviewer: reviewer || REVIEWER,
    timestamp: new Date().toISOString(),
  };

  save();
  const reviewed = data.entries.filter((e) => e.finalSeverity).length;
  const agreed = data.entries.filter((e) => e.finalSeverity && e.finalSeverity.tier === e.claudeProposedTier).length;
  res.json({ finalSeverity: entry.finalSeverity, reviewed, agreed, total: data.entries.length });
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "severity-review.html")));

app.listen(PORT, () => {
  const reviewed = data.entries.filter((e) => e.finalSeverity).length;
  console.log(`Severity-coding review server`);
  console.log(`Reviewer: ${REVIEWER}`);
  console.log(`${data.entries.length} entries queued (${data.entries.length - reviewed} not yet reviewed: ${data.meta.tierOnly} tier-only, ${data.meta.full} full).`);
  console.log(`\n  Open  http://localhost:${PORT}\n`);
  console.log("Each submitted label is saved immediately — Ctrl+C to stop, resume any time.");
});
