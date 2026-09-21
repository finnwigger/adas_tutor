// Terminal human spot-check for the LLM judge. Reads an existing
// generation-test log, walks a (optionally random) sample of judged entries
// without a humanLabel yet, prompts for helpfulness/groundedness/safety/
// calibration/hallucination scores, and writes the result back into the same
// log file under entry.humanLabel plus an aggregate summary.humanReview block.
//
// Usage:
//   node tests/human-review.js <log-file> [--sample N] [--reviewer NAME] [--category NAME]
//
// Safe to interrupt and resume: only entries without a humanLabel are queued,
// and progress is saved after every entry (not just at the end).

import fs from "fs";
import readline from "readline";
import { computeHumanAgreement } from "./human-agreement.js";

const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
}

const FLAGS_WITH_VALUE = ["--sample", "--reviewer", "--category"];
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (FLAGS_WITH_VALUE.includes(args[i])) { i++; continue; }
  positional.push(args[i]);
}
const logPath = positional[0];

if (!logPath) {
  console.error("Usage: node tests/human-review.js <log-file> [--sample N] [--reviewer NAME] [--category NAME]");
  process.exit(1);
}
if (!fs.existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(1);
}

const SAMPLE   = parseInt(argValue("--sample", "0")) || 0;
const REVIEWER = argValue("--reviewer", process.env.USER || process.env.USERNAME || "anonymous");
const CATEGORY = argValue("--category", null);

const data = JSON.parse(fs.readFileSync(logPath, "utf-8"));

let candidates = data.entries.filter((e) => e.judgment && !e.humanLabel);
if (CATEGORY) candidates = candidates.filter((e) => e.category === CATEGORY);

if (SAMPLE > 0 && candidates.length > SAMPLE) {
  // Partial Fisher-Yates shuffle, then take the last SAMPLE elements — an
  // unbiased random sample without replacement.
  const pool = [...candidates];
  for (let i = pool.length - 1; i > pool.length - 1 - SAMPLE && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  candidates = pool.slice(pool.length - SAMPLE);
}

if (candidates.length === 0) {
  console.log("Nothing to review — every judged entry already has a humanLabel (or none match the filter).");
  process.exit(0);
}

function save() {
  data.meta.lastUpdatedAt = new Date().toISOString();
  data.summary.humanReview = computeHumanAgreement(data.entries);
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
}

function parseScore(input) {
  const n = parseInt(input);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

// Plain rl.question() chains drop input under piped (non-TTY) stdin: Node can
// emit several buffered 'line' events synchronously before the next
// question's listener is attached, and the listener is `once` so any line
// emitted before it's attached is lost. Queueing every line as it arrives
// (regardless of whether anything is currently asking) avoids the race for
// both piped input (used in tests) and a real interactive terminal.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lineQueue = [];
const lineWaiters = [];
let stdinClosed = false;

rl.on("line", (line) => {
  if (lineWaiters.length) lineWaiters.shift()(line);
  else lineQueue.push(line);
});
rl.on("close", () => {
  stdinClosed = true;
  while (lineWaiters.length) lineWaiters.shift()("q"); // treat EOF like "quit and save"
});

function ask(question) {
  process.stdout.write(question);
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  if (stdinClosed) return Promise.resolve("q");
  return new Promise((resolve) => lineWaiters.push(resolve));
}

console.log(`${candidates.length} entr${candidates.length === 1 ? "y" : "ies"} queued for review. Reviewer: ${REVIEWER}`);
console.log(`At each entry: enter helpfulness (1-5), groundedness (1-5), safety (1-5), calibration (1-5), then hallucinations (semicolon-separated, blank = none).`);
console.log(`Type "s" to skip an entry, "q" at any prompt to save and quit.\n`);

(async () => {
  let reviewed = 0;

  for (const entry of candidates) {
    console.log("──────────────────────────────────────────────────────────");
    console.log(`#${entry.taskId}  ${entry.name}  [${entry.category ?? "uncategorized"}]`);
    console.log(`Q: "${entry.question}"`);
    if (entry.note) console.log(`Note: ${entry.note}`);
    console.log(`\nResponse:\n${entry.response}\n`);
    const judgeSafety      = entry.judgment.safety      != null ? `  safety=${entry.judgment.safety}/5` : "";
    const judgeCalibration = entry.judgment.calibration != null ? `  calibration=${entry.judgment.calibration}/5` : "";
    console.log(`Judge: helpfulness=${entry.judgment.helpfulness}/5  groundedness=${entry.judgment.groundedness}/5${judgeSafety}${judgeCalibration}  hallucinations=${entry.judgment.hallucinations?.length ? entry.judgment.hallucinations.join("; ") : "none"}`);
    console.log(`Judge summary: ${entry.judgment.summary}\n`);

    async function askScore(label) {
      let score = null, skip = false;
      while (score === null && !skip) {
        const ans = await ask(`Your ${label} score (1-5, s=skip, q=quit): `);
        if (ans === "q") { rl.close(); save(); console.log(`\nSaved ${reviewed} new label(s) to ${logPath}`); return { quit: true }; }
        if (ans === "s") { skip = true; break; }
        score = parseScore(ans);
        if (score === null) console.log("  Enter an integer 1-5.");
      }
      return { score, skipped: skip };
    }

    const helpfulnessResult = await askScore("helpfulness");
    if (helpfulnessResult.quit) return;
    if (helpfulnessResult.skipped) { console.log("Skipped.\n"); continue; }

    const groundednessResult = await askScore("groundedness");
    if (groundednessResult.quit) return;
    if (groundednessResult.skipped) { console.log("Skipped.\n"); continue; }

    const safetyResult = await askScore("safety");
    if (safetyResult.quit) return;
    if (safetyResult.skipped) { console.log("Skipped.\n"); continue; }

    const calibrationResult = await askScore("calibration");
    if (calibrationResult.quit) return;
    if (calibrationResult.skipped) { console.log("Skipped.\n"); continue; }

    const hallucinationsRaw = await ask("Hallucinations you noticed (semicolon-separated, blank = none, q=quit): ");
    if (hallucinationsRaw === "q") { rl.close(); save(); console.log(`\nSaved ${reviewed} new label(s) to ${logPath}`); return; }
    const hallucinations = hallucinationsRaw.split(";").map((s) => s.trim()).filter(Boolean);

    entry.humanLabel = {
      helpfulness: helpfulnessResult.score,
      groundedness: groundednessResult.score,
      safety: safetyResult.score,
      calibration: calibrationResult.score,
      hallucinations,
      reviewer: REVIEWER,
      timestamp: new Date().toISOString(),
    };
    reviewed++;
    save(); // persist after every entry, not just at the end
    console.log("Recorded.\n");
  }

  rl.close();
  console.log(`Reviewed ${reviewed}/${candidates.length} entries this session.`);
  console.log(`Agreement so far:`, data.summary.humanReview);
})();
