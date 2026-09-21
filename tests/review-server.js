// Browser-based human spot-check for the LLM judge, showing the grounding
// source material next to the response. Serves a side-by-side review page and
// writes each humanLabel back into the same generation-test log file (plus
// the aggregate summary.humanReview block).
//
// Usage:
//   node tests/review-server.js <log-file> [--port N] [--reviewer NAME] [--category NAME] [--ids 65,102]
//
// Then open the printed URL. Progress is saved to the log file after every
// submitted label.
//
// Source text per entry comes from entry.context; older logs that predate
// this field will show "(no source text logged)".

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeHumanAgreement } from "./human-agreement.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
}

const FLAGS_WITH_VALUE = ["--port", "--reviewer", "--category", "--ids"];
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (FLAGS_WITH_VALUE.includes(args[i])) { i++; continue; }
  positional.push(args[i]);
}
const logPath = positional[0];

if (!logPath) {
  console.error("Usage: node tests/review-server.js <log-file> [--port N] [--reviewer NAME] [--category NAME] [--ids 65,102]");
  process.exit(1);
}
if (!fs.existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(1);
}

const PORT     = parseInt(argValue("--port", "3100")) || 3100;
const REVIEWER = argValue("--reviewer", process.env.USER || process.env.USERNAME || "anonymous");
const CATEGORY = argValue("--category", null);
// Hides the judge's scores/hallucination list from the reviewer UI (labels are
// still stored next to the judgment in the log).
const BLIND    = args.includes("--blind");
// Restricts review to specific scenario ids (comma-separated), matching the
// taskId's numeric prefix before "-rN".
const idsArg = argValue("--ids", null);
const ONLY_IDS = idsArg
  ? new Set(idsArg.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

const data = JSON.parse(fs.readFileSync(logPath, "utf-8"));

function save() {
  data.meta = data.meta ?? {};
  data.meta.lastUpdatedAt = new Date().toISOString();
  data.summary = data.summary ?? {};
  data.summary.humanReview = computeHumanAgreement(data.entries);
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
}

// Only judged entries are reviewable; honour the optional category/ids filter.
function reviewableEntries() {
  let entries = data.entries.filter((e) => e.judgment);
  if (CATEGORY) entries = entries.filter((e) => e.category === CATEGORY);
  if (ONLY_IDS) entries = entries.filter((e) => ONLY_IDS.has(String(e.taskId).split("-r")[0]));
  return entries;
}

// Trim each entry to just what the page renders — the full prompt/token blocks
// are large and the page doesn't need them.
function publicEntry(e) {
  return {
    taskId:       e.taskId,
    name:         e.name,
    category:     e.category ?? null,
    question:     e.question,
    note:         e.note ?? null,
    mode:         e.mode ?? null,
    contextMode:  e.contextMode ?? null,
    response:     e.response,
    context:      e.context ?? null,
    retrieved:    e.retrieved ?? null,   // RAG mode: [{ file, passage, distance }]
    docOrder:     e.docOrder ?? null,    // full-context modes
    judgment:     BLIND ? null : e.judgment,
    humanLabel:   e.humanLabel ?? null,
  };
}

const app = express();
app.use(express.json());

app.get("/api/session", (_req, res) => {
  res.json({
    logPath,
    reviewer: REVIEWER,
    category: CATEGORY,
    // Blind mode also hides the running agreement numbers.
    summary: BLIND ? null : (data.summary?.humanReview ?? null),
    entries: reviewableEntries().map(publicEntry),
  });
});

function parseScore(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

app.post("/api/label/:taskId", (req, res) => {
  const entry = data.entries.find((e) => String(e.taskId) === String(req.params.taskId));
  if (!entry) return res.status(404).json({ error: "Unknown taskId" });

  const { helpfulness, groundedness, safety, calibration, hallucinations, reviewer } = req.body ?? {};
  const scores = {
    helpfulness:  parseScore(helpfulness),
    groundedness: parseScore(groundedness),
    safety:       parseScore(safety),
    calibration:  parseScore(calibration),
  };
  const bad = Object.entries(scores).filter(([, v]) => v === null).map(([k]) => k);
  if (bad.length) return res.status(400).json({ error: `Each score must be an integer 1-5: ${bad.join(", ")}` });

  entry.humanLabel = {
    ...scores,
    hallucinations: Array.isArray(hallucinations)
      ? hallucinations.map((s) => String(s).trim()).filter(Boolean)
      : String(hallucinations ?? "").split(";").map((s) => s.trim()).filter(Boolean),
    reviewer: reviewer || REVIEWER,
    timestamp: new Date().toISOString(),
  };

  save(); // persist after every label, not just at the end
  res.json({ humanLabel: entry.humanLabel, summary: BLIND ? null : data.summary.humanReview });
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "review.html")));

app.listen(PORT, () => {
  const reviewable = reviewableEntries();
  const remaining = reviewable.filter((e) => !e.humanLabel).length;
  console.log(`Human review server for ${logPath}`);
  console.log(`Reviewer: ${REVIEWER}${CATEGORY ? `   Category: ${CATEGORY}` : ""}`);
  console.log(`${reviewable.length} judged entr${reviewable.length === 1 ? "y" : "ies"} (${remaining} not yet reviewed).`);
  console.log(`\n  Open  http://localhost:${PORT}\n`);
  console.log("Each submitted label is saved to the log immediately — Ctrl+C to stop.");
});
