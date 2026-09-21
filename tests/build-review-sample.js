// Builds a stratified human-review sample file from all current-version
// generation-test / trap-test logs, for use with tests/review-server.js:
//
//   node tests/build-review-sample.js [--name batch1] [--passes-per-log 3] [--seed 42]
//   node tests/review-server.js logs/tests/review-sample_batch1.json --blind
//
// Strata:
//   flagged — every judged entry with >=1 hallucination flag, across all logs.
//   pass    — N random judged passes per log (seeded, reproducible).
//
// Retrieval-degenerate entries are excluded by default (--keep-unrewritten-
// history to include them): a RAG history follow-up whose question is
// referential (needsRewrite) but was generated with query rewrite OFF.
//
// Entries are copied verbatim but get a unique taskId "<configHash>:<taskId>",
// plus sourceLog/sourceHash/stratum fields. The deck is shuffled so strata are
// interleaved. Labels land in this file; compute agreement from its
// summary.humanReview after review. --inherit-labels <file,...> carries over
// human labels from prior sample files by taskId.

import fs from "fs";
import path from "path";
import { PROMPT_TEMPLATE_VERSION } from "../core/prompt-templates.js";
import { needsRewrite } from "../core/query-rewrite.js";
import { computeHumanAgreement } from "./human-agreement.js";

const LOG_DIR = "logs/tests";
const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
};

const NAME           = argValue("--name", "batch1");
const PASSES_PER_LOG = parseInt(argValue("--passes-per-log", "3"));
const SEED           = parseInt(argValue("--seed", "42"));
// --exclude <existing sample file>: skip entries already sampled there (by
// prefixed taskId), so later batches contain only new material.
const EXCLUDE = argValue("--exclude", null);
const excludeIds = new Set(
  EXCLUDE ? JSON.parse(fs.readFileSync(EXCLUDE, "utf8")).entries.map((e) => e.taskId) : []
);

// Disables the retrieval-degenerate exclusion (see header). Default OFF.
const KEEP_DEGENERATE = args.includes("--keep-unrewritten-history");

// --inherit-labels <file,file,...>: carry over humanLabel from prior sample
// files, keyed by prefixed taskId, onto matching entries in the new sample.
const INHERIT = argValue("--inherit-labels", null);
const inheritedLabels = new Map();
if (INHERIT) {
  for (const file of INHERIT.split(",").map((s) => s.trim()).filter(Boolean)) {
    const prior = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const e of prior.entries ?? []) {
      if (e.humanLabel) inheritedLabels.set(e.taskId, e.humanLabel);
    }
  }
}

// A "retrieval-degenerate" entry: a RAG history follow-up whose question is
// referential (needsRewrite) but was generated with query rewrite OFF.
function isRewriteDegenerate(e, rewriteOn) {
  return e.contextMode === "rag" && e.hasHistory === true && !rewriteOn && needsRewrite(e.question);
}

// Deterministic PRNG (mulberry32) so the sample is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

const files = fs.readdirSync(LOG_DIR)
  .filter((f) => /^(generation-test|trap-test)_[0-9a-f]+\.json$/.test(f))
  .sort();

const flagged = [];
const passes = [];
const sources = [];
let totalDegenerateExcluded = 0;

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(LOG_DIR, file), "utf8"));
  if (data.meta?.config?.promptTemplateVersion !== PROMPT_TEMPLATE_VERSION) continue;
  const hash = data.meta?.configHash ?? file.replace(/^.*_|\.json$/g, "");
  // queryRewrite is logged as a version string when on, false/undefined when
  // off (older logs predate the field entirely — also treated as off).
  const rewriteOn = !!(data.meta?.specs?.generationTest?.queryRewrite);

  let judged = (data.entries ?? []).filter(
    (e) => e.judgment && !excludeIds.has(`${hash}:${e.taskId}`)
  );

  let degenerateInLog = 0;
  if (!KEEP_DEGENERATE) {
    judged = judged.filter((e) => {
      const degen = isRewriteDegenerate(e, rewriteOn);
      if (degen) degenerateInLog++;
      return !degen;
    });
    totalDegenerateExcluded += degenerateInLog;
  }

  const wrap = (e, stratum) => ({
    ...e,
    taskId: `${hash}:${e.taskId}`,
    sourceLog: file,
    sourceHash: hash,
    stratum,
  });

  const logFlagged = judged.filter((e) => (e.judgment.hallucinations?.length ?? 0) > 0);
  flagged.push(...logFlagged.map((e) => wrap(e, "flagged")));

  const logPasses = judged.filter((e) => (e.judgment.hallucinations?.length ?? 0) === 0);
  // Seeded sample without replacement
  const pool = [...logPasses];
  for (let i = 0; i < PASSES_PER_LOG && pool.length; i++) {
    const idx = Math.floor(rand() * pool.length);
    passes.push(wrap(pool.splice(idx, 1)[0], "pass"));
  }

  sources.push({ file, hash, rewriteOn, judged: judged.length, flagged: logFlagged.length, degenerateExcluded: degenerateInLog });
}

// Shuffle the combined deck (seeded) so strata are interleaved.
const entries = [...flagged, ...passes];
for (let i = entries.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [entries[i], entries[j]] = [entries[j], entries[i]];
}

// Carry over human labels from prior sample files (--inherit-labels), by prefixed taskId.
let inheritedCount = 0;
if (inheritedLabels.size) {
  for (const e of entries) {
    const label = inheritedLabels.get(e.taskId);
    if (label) { e.humanLabel = label; inheritedCount++; }
  }
}

const outPath = path.join(LOG_DIR, `review-sample_${NAME}.json`);
if (fs.existsSync(outPath)) {
  console.error(`${outPath} already exists — it may contain human labels. Delete it manually or pick a different --name.`);
  process.exit(1);
}

const out = {
  meta: {
    type: "review-sample",
    name: NAME,
    createdAt: new Date().toISOString(),
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    seed: SEED,
    passesPerLog: PASSES_PER_LOG,
    excludeRewriteDegenerate: !KEEP_DEGENERATE,
    degenerateExcluded: totalDegenerateExcluded,
    inheritedLabelsFrom: INHERIT ? INHERIT.split(",").map((s) => s.trim()).filter(Boolean) : null,
    inheritedLabels: inheritedCount,
    strata: { flagged: flagged.length, pass: passes.length },
    sources,
  },
  entries,
};
// Seed the aggregate agreement block from any inherited labels so review-server
// picks up where the prior batch left off instead of reporting from zero.
if (inheritedCount) out.summary = { humanReview: computeHumanAgreement(entries) };

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`Sample written: ${outPath}`);
console.log(`  flagged (all, across ${sources.length} logs): ${flagged.length}`);
console.log(`  random passes (${PASSES_PER_LOG}/log, seed ${SEED}): ${passes.length}`);
if (!KEEP_DEGENERATE) console.log(`  excluded (retrieval-degenerate, rewrite-off history follow-ups): ${totalDegenerateExcluded}`);
if (inheritedCount)   console.log(`  inherited human labels from prior batches: ${inheritedCount}`);
console.log(`  total to review: ${entries.length}${inheritedCount ? ` (${entries.length - inheritedCount} still unlabeled)` : ""}`);
console.log(`\nReview with:\n  node tests/review-server.js ${outPath} --blind --reviewer <name>`);
