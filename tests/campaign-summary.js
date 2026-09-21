// Reads every logs/tests/generation-test_*.json (one file per config hash)
// and prints one comparison table.
//
// Usage:
//   node tests/campaign-summary.js               # every log, oldest config version last
//   node tests/campaign-summary.js --current-only  # hide logs from a superseded PROMPT_TEMPLATE_VERSION

import fs from "fs";
import path from "path";
import { REGRESSION_SCENARIO_IDS } from "../core/regression-set.js";
import { PROMPT_TEMPLATE_VERSION } from "../core/prompt-templates.js";
import { estimateCost } from "../core/pricing.js";

const LOG_DIR = "logs/tests";
const CURRENT_ONLY = process.argv.includes("--current-only");

// Operational campaign logs plus the adversarial trap suite's (trap-test_*,
// generation-test --traps) — reported as two separate tables below, never one.
const files = fs.existsSync(LOG_DIR)
  ? fs.readdirSync(LOG_DIR).filter((f) => /^(generation-test|trap-test)_[0-9a-f]+\.json$/.test(f))
  : [];

const rows = [];
for (const file of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(LOG_DIR, file), "utf8"));
  } catch {
    continue; // skip unreadable/partial files rather than crash the whole report
  }

  const cfg     = data.meta?.config ?? {};
  const entries = data.entries ?? [];
  const version = cfg.promptTemplateVersion ?? "pre-unification";

  if (CURRENT_ONLY && version !== PROMPT_TEMPLATE_VERSION) continue;

  // Regression-subset rate, recomputed from entries directly rather than the
  // file's own top-level summary.
  //
  // taskIds are "<scenarioId>-r<repeatIndex>" strings (e.g. "3-r0"), while
  // REGRESSION_SCENARIO_IDS are numbers — strip the "-rN" suffix and coerce
  // to Number before comparing.
  const regressionIds = new Set(REGRESSION_SCENARIO_IDS.map(Number));
  const scenarioIdOf = (taskId) => Number(String(taskId).replace(/-r\d+$/, ""));
  const regressionEntries = entries.filter((e) => regressionIds.has(scenarioIdOf(e.taskId)));
  const regressionHallucinated = regressionEntries.filter((e) => (e.judgment?.hallucinations?.length ?? 0) > 0).length;

  // With --repeats N there are N entries per scenario, so entries.length and
  // summary.totalScenarios are reported separately rather than compared directly.
  const scenariosDone = new Set(entries.map((e) => scenarioIdOf(e.taskId))).size;

  // Recomputes cost from stored token counts at current pricing (core/pricing.js);
  // falls back to the entry's stored costUsd when token data is missing.
  let costUsd = 0;
  for (const e of entries) {
    const parts = [
      [e.generationModel, e.tokens?.generate],
      [e.judgeModel,      e.tokens?.judge],
      [e.generationModel, e.tokens?.rewrite],
    ];
    let entryCost = 0, any = false;
    for (const [model, t] of parts) {
      const c = t ? estimateCost(model, t.input, t.output) : null;
      if (c != null) { entryCost += c; any = true; }
    }
    costUsd += any ? entryCost : (e.costUsd?.total ?? 0);
  }

  rows.push({
    suite:         file.startsWith("trap-test_") ? "trap" : "operational",
    hash:          data.meta?.configHash ?? file.replace(/^(generation-test|trap-test)_|\.json$/g, ""),
    version,
    contextMode:   cfg.contextMode ?? "?",
    variant:       cfg.promptVariant ?? "?",
    position:      cfg.promptVariantPosition ?? "?",
    k:             cfg.k ?? "",
    entries:       entries.length,
    scenariosDone,
    total:         data.summary?.totalScenarios ?? "?",
    passRate:      data.summary?.passRate,
    hallucRate:    data.summary?.hallucinationRate,
    regressionN:   regressionEntries.length,
    regressionHallucRate: regressionEntries.length ? regressionHallucinated / regressionEntries.length : null,
    costUsd,
  });
}

// Current prompt-template version first (the only directly comparable
// group), then group by context mode and variant within each version.
rows.sort((a, b) => {
  if (a.version !== b.version) return a.version === PROMPT_TEMPLATE_VERSION ? -1 : 1;
  return (a.contextMode + a.variant + a.position).localeCompare(b.contextMode + b.variant + b.position);
});

const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const usd = (x) => (x == null ? "—" : `$${x.toFixed(4)}`);

const cols = [
  ["hash",        10],
  ["version",     17],
  ["contextMode", 12],
  ["variant",     20],
  ["position",    8],
  ["scenarios",   9],
  ["entries",     7],
  ["passRate",    9],
  ["hallucRate",  11],
  ["regression",  16],
  ["costUsd",     9],
];

function row(r) {
  return [
    r.hash,
    r.version === PROMPT_TEMPLATE_VERSION ? r.version : `${r.version} (STALE)`,
    r.contextMode,
    r.variant,
    r.position,
    `${r.scenariosDone}/${r.total}`,
    r.entries,
    pct(r.passRate),
    pct(r.hallucRate),
    r.regressionN ? `${pct(r.regressionHallucRate)} (n=${r.regressionN})` : "—",
    usd(r.costUsd),
  ];
}

function printTable(dataRows) {
  const header = cols.map(([name]) => name);
  const widths = cols.map(([, w]) => w);
  const print = (cells) => console.log(cells.map((c, i) => String(c).padEnd(widths[i])).join(" │ "));
  print(header);
  console.log(widths.map((w) => "─".repeat(w)).join("─┼─"));
  for (const r of dataRows) print(row(r));
}

if (!rows.length) {
  console.log("No generation-test logs found in logs/tests/.");
  process.exit(0);
}

const operationalRows = rows.filter((r) => r.suite === "operational");
const trapRows        = rows.filter((r) => r.suite === "trap");

console.log(`Current prompt template version: ${PROMPT_TEMPLATE_VERSION}`);
console.log(`Regression set (${REGRESSION_SCENARIO_IDS.length} ids): ${REGRESSION_SCENARIO_IDS.join(", ")}`);
console.log();
printTable(operationalRows);

if (trapRows.length) {
  console.log(`\nTrap suite (adversarial 100-scenario set, query rewrite on — separate namespace, not comparable to the table above):`);
  console.log();
  printTable(trapRows);
}

const stale = rows.filter((r) => r.version !== PROMPT_TEMPLATE_VERSION).length;
if (stale && !CURRENT_ONLY) {
  console.log(`\n${stale} log(s) marked (STALE) were generated under a different prompt template version`);
  console.log(`and are not comparable to current runs. Pass --current-only to hide them.`);
}
