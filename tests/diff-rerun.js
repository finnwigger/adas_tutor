// Compares two logs by taskId and reports only entries whose verdict
// (status, and whether any hallucination was flagged) differs. Score deltas
// are printed for changed entries but don't by themselves count as a change.
//
//   node tests/diff-rerun.js <old-log> <new-log> [--out <manifest.json>]

import fs from "fs";

const args = process.argv.slice(2);
const [oldPath, newPath] = args.filter((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

if (!oldPath || !newPath) {
  console.error("Usage: node tests/diff-rerun.js <old-log> <new-log> [--out <manifest.json>]");
  process.exit(1);
}

function load(path) {
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
  const byId = new Map();
  for (const e of data.entries ?? []) byId.set(e.taskId, e);
  return byId;
}

function signature(e) {
  return {
    status: e.status,
    helpfulness: e.judgment?.helpfulness,
    groundedness: e.judgment?.groundedness,
    safety: e.judgment?.safety,
    calibration: e.judgment?.calibration,
    hallucinations: [...(e.judgment?.hallucinations ?? [])].sort(),
  };
}

// A verdict is the status label plus whether any hallucination was flagged
// (not the specific hallucination text).
function verdict(sig) {
  return { status: sig.status, flagged: sig.hallucinations.length > 0 };
}

function verdictEqual(a, b) {
  const va = verdict(a), vb = verdict(b);
  return va.status === vb.status && va.flagged === vb.flagged;
}

const oldEntries = load(oldPath);
const newEntries = load(newPath);

const changed = [];
const unchanged = [];
const missingInNew = [];

for (const [taskId, oldE] of oldEntries) {
  const newE = newEntries.get(taskId);
  if (!newE) {
    missingInNew.push(taskId);
    continue;
  }
  const oldSig = signature(oldE);
  const newSig = signature(newE);
  if (verdictEqual(oldSig, newSig)) {
    unchanged.push(taskId);
  } else {
    changed.push({ taskId, name: oldE.name, old: oldSig, new: newSig });
  }
}

console.log(`Compared ${oldEntries.size} contaminated entries against ${newPath}`);
console.log(`  same verdict (no spot-check needed): ${unchanged.length}`);
console.log(`  verdict changed (needs spot-check):  ${changed.length}`);
if (missingInNew.length) console.log(`  missing in new log (needs spot-check):  ${missingInNew.length}`);
console.log();

for (const c of changed) {
  console.log(`CHANGED  ${c.taskId}  ${c.name ?? ""}`);
  console.log(`  old: ${c.old.status}  H${c.old.helpfulness} G${c.old.groundedness} S${c.old.safety} C${c.old.calibration}  halluc=${c.old.hallucinations.length}`);
  console.log(`  new: ${c.new.status}  H${c.new.helpfulness} G${c.new.groundedness} S${c.new.safety} C${c.new.calibration}  halluc=${c.new.hallucinations.length}`);
}
if (missingInNew.length) {
  console.log(`\nMISSING FROM NEW LOG (rerun didn't cover these taskIds):`);
  for (const id of missingInNew) console.log(`  ${id}`);
}

if (outPath) {
  const manifest = {
    oldLog: oldPath,
    newLog: newPath,
    generatedAt: new Date().toISOString(),
    needsSpotCheck: [...changed.map((c) => c.taskId), ...missingInNew],
    unchanged,
  };
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote manifest to ${outPath}`);
}
