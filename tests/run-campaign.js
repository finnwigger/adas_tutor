// Runs the full reliability test plan (docs/testing-procedure.md) one
// configuration after another: each configuration is a single invocation of
// tests/generation-test.js with a specific env override (context mode,
// prompt variant, RAG_K, generation model).
//
// Usage:
//   node tests/run-campaign.js                # run Phase R, then stop (see gate below)
//   node tests/run-campaign.js --list         # print the plan, run nothing
//   node tests/run-campaign.js --start C-k20  # skip ahead to a specific id
//   node tests/run-campaign.js --no-gate      # don't stop after Phase R
//
// Env overrides (optional — sensible defaults are derived from LLM_MODEL_CHAIN):
//   CAMPAIGN_GEN_MODEL          single model used for generation in phases A-C
//   CAMPAIGN_JUDGE_MODEL        single model used for judging in all phases
//   CAMPAIGN_MODEL_COMPARISON   comma-separated models swept in phase D
//   CAMPAIGN_REPEATS            repeats per scenario for phases R/A/B/C (default 3;
//                               not applied to phase D)
//
// Phase R re-tests REGRESSION_SCENARIO_IDS across every prompt variant. By
// default the campaign stops after Phase R; pass --no-gate to run straight
// through.

// Must be the first import: core/llm-fallback.js reads process.env.LLM_MODEL_CHAIN
// at module-load time, and ESM evaluates imports in source order before any of
// this file's own code runs — a later `dotenv.config()` call would be too late.
import "dotenv/config";
import { spawnSync } from "child_process";
import { MODEL_CHAIN } from "../core/llm-fallback.js";
import { REGRESSION_SCENARIO_IDS } from "../core/regression-set.js";

const QUOTA_EXIT_CODE = 75; // must match tests/generation-test.js

const GEN_MODEL   = process.env.CAMPAIGN_GEN_MODEL   || MODEL_CHAIN[0];
const JUDGE_MODEL = process.env.CAMPAIGN_JUDGE_MODEL || "deepseek-chat";
const REPEATS     = parseInt(process.env.CAMPAIGN_REPEATS) || 3;
const COMPARISON_MODELS = process.env.CAMPAIGN_MODEL_COMPARISON
  ? process.env.CAMPAIGN_MODEL_COMPARISON.split(",").map((m) => m.trim()).filter(Boolean)
  : MODEL_CHAIN.filter((m) => m !== GEN_MODEL && m !== JUDGE_MODEL).slice(0, 2);
const K_DEFAULT = process.env.RAG_K || "20";

function baseEnv(overrides) {
  const env = {
    PROMPT_VARIANT_POSITION: "end",
    RAG_K: K_DEFAULT,
    GEN_TEST_MODEL_CHAIN: GEN_MODEL,
    JUDGE_MODEL_CHAIN: JUDGE_MODEL,
    ...overrides,
  };
  // RAG-mode configs default to query rewrite ON, matching production.
  // Full-context configs skip the flag (rewriting is a no-op without retrieval).
  if (env.CONTEXT_MODE === "rag" && env.GEN_TEST_QUERY_REWRITE === undefined) {
    env.GEN_TEST_QUERY_REWRITE = "1";
  }
  return env;
}

const CONTEXT_MODES      = ["rag", "full-fixed", "full-ordered", "none"];
const ABLATION_VARIANTS  = ["baseline", "security", "refusal", "citation", "anti-sycophancy"];
const K_SWEEP             = ["10", "20", "57"];

// Repeats apply to phases R/A/B/C only, not phase D. Each repeat gets its
// own taskId/contentHash, so a phase R config and its corresponding full
// phase config share one log file and repeat count.
function repeatArgs(extra = []) {
  return [...extra, "--repeats", String(REPEATS)];
}

const CONFIGURATIONS = [];

// Phase R — regression check. RAG mode only, every ablation variant plus
// the position-ablation pair, restricted to REGRESSION_SCENARIO_IDS.
for (const variant of ABLATION_VARIANTS) {
  CONFIGURATIONS.push({
    id: `R-${variant}`,
    phase: "R",
    description: `Regression check: do the ${REGRESSION_SCENARIO_IDS.length} previously-hallucinating RAG scenarios still hallucinate under the unified prompt, variant "${variant}"?`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: variant }),
    args: repeatArgs(["--ids", REGRESSION_SCENARIO_IDS.join(",")]),
  });
}
CONFIGURATIONS.push({
  id: "R-position-start",
  phase: "R",
  description: `Regression check, position ablation: combined variant at the START of the system prompt.`,
  env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security,refusal,anti-sycophancy", PROMPT_VARIANT_POSITION: "start" }),
  args: repeatArgs(["--ids", REGRESSION_SCENARIO_IDS.join(",")]),
});
CONFIGURATIONS.push({
  id: "R-position-end",
  phase: "R",
  description: `Regression check, position ablation: same combined variant at the END (original position).`,
  env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security,refusal,anti-sycophancy", PROMPT_VARIANT_POSITION: "end" }),
  args: repeatArgs(["--ids", REGRESSION_SCENARIO_IDS.join(",")]),
});

// Phase A — context-mode comparison. Prompt variant fixed to "security".
for (const contextMode of CONTEXT_MODES) {
  CONFIGURATIONS.push({
    id: `A-${contextMode}`,
    phase: "A",
    description: `Context-mode comparison: ${contextMode}, prompt variant "security", model ${GEN_MODEL}.`,
    env: baseEnv({ CONTEXT_MODE: contextMode, PROMPT_VARIANT: "security" }),
    args: repeatArgs(),
  });
}

// Phase B — prompt-variant ablation, RAG mode, fixed K and model.
for (const variant of ABLATION_VARIANTS) {
  CONFIGURATIONS.push({
    id: `B-${variant}`,
    phase: "B",
    description: `Prompt-variant ablation: "${variant}", RAG mode, model ${GEN_MODEL}.`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: variant }),
    args: repeatArgs(),
  });
}

// Phase B (continued) — same combined wording, different prompt position.
CONFIGURATIONS.push({
  id: "B-position-start",
  phase: "B",
  description: `Prompt-variant position: "security,refusal,anti-sycophancy" at the START of the system prompt (primacy-bias position).`,
  env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security,refusal,anti-sycophancy", PROMPT_VARIANT_POSITION: "start" }),
  args: repeatArgs(),
});
CONFIGURATIONS.push({
  id: "B-position-end",
  phase: "B",
  description: `Same combined variant as B-position-start, but at the END (original position) — isolates position's effect from B-position-start.`,
  env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security,refusal,anti-sycophancy", PROMPT_VARIANT_POSITION: "end" }),
  args: repeatArgs(),
});

// Phase C — retrieval-size sensitivity. Prompt variant fixed to "baseline".
for (const k of K_SWEEP) {
  CONFIGURATIONS.push({
    id: `C-k${k}`,
    phase: "C",
    description: `Retrieval-size sensitivity: RAG_K=${k}, prompt variant "baseline", model ${GEN_MODEL}.`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "baseline", RAG_K: k }),
    args: repeatArgs(),
  });
}

// Phase D — generation-model comparison. RAG mode, "security" variant,
// fixed K; only the generation model varies. Judge stays fixed.
for (const model of COMPARISON_MODELS) {
  CONFIGURATIONS.push({
    id: `D-${model}`,
    phase: "D",
    description: `Generation-model comparison: ${model} vs Phase A's ${GEN_MODEL} baseline, RAG mode, "security" variant.`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security", GEN_TEST_MODEL_CHAIN: model }),
  });
}

// Phase M — minimal-prompt ablation, RAG mode, same pinned config as
// production. Run on both the operational and trap scenario sets.
// PROMPT_VARIANT=baseline is set for hash legibility only — the minimal
// template never reads variant_instructions.
CONFIGURATIONS.push({
  id: "M-minimal",
  phase: "M",
  description: `Minimal-prompt ablation: rag/K=20/${GEN_MODEL}, no scaffolding beyond material+question — tests whether prompt engineering adds measurable reliability beyond retrieval + model.`,
  env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "baseline" }),
  args: repeatArgs(["--minimal-prompt"]),
});
CONFIGURATIONS.push({
  id: "M-minimal-traps",
  phase: "M",
  description: `Minimal-prompt ablation under adversarial load (trap suite), same config as M-minimal.`,
  env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "baseline" }),
  args: repeatArgs(["--minimal-prompt", "--traps"]),
});

// Phase V — trap-v2: false-refusal + safety-circumvention
// (tests/trap-v2-scenarios.js). Run against security, refusal, and baseline
// variants. `node tests/run-campaign.js --start V-security --no-gate`.
const TRAP_V2_VARIANTS = [
  ["V-security", "security"],
  ["V-refusal", "refusal"],
  ["V-baseline", "baseline"],
];
const TRAP_V2_CONFIGURATIONS = [
  ...TRAP_V2_VARIANTS.map(([id, variant]) => ({
    id,
    phase: "V",
    description: `Trap-v2 (false-refusal + safety-circumvention): rag, prompt variant "${variant}", model ${GEN_MODEL}, query rewrite on.`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: variant, GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps", "--trap-v2"]),
  })),
  {
    id: "V-none",
    phase: "V",
    description: `Trap-v2 (false-refusal + safety-circumvention): ungrounded baseline (no retrieval, no documents), prompt variant "security", model ${GEN_MODEL} — does having no source material to lean on change the false-refusal / safety-circumvention profile?`,
    env: baseEnv({ CONTEXT_MODE: "none", PROMPT_VARIANT: "security" }),
    args: repeatArgs(["--traps", "--trap-v2"]),
  },
];

// Phase G — Groq floor/bad-model check. Single model via Groq's free tier
// (GROQ_API_KEY — core/llm-fallback.js isGroqModel routing):
// llama-3.1-8b-instant, run against both trap suites.
const GROQ_MODELS = [
  ["llama8b", "groq/llama-3.1-8b-instant"],
];
const GROQ_CONFIGURATIONS = GROQ_MODELS.flatMap(([id, model]) => [
  {
    id: `G-${id}-traps`,
    phase: "G",
    description: `Groq floor/bad-model check: rag, security variant, ${model}, trap-v1 (hallucination/grounding).`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security", GEN_TEST_MODEL_CHAIN: model, GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps"]),
  },
  {
    id: `G-${id}-trapv2`,
    phase: "G",
    description: `Groq floor/bad-model check: rag, security variant, ${model}, trap-v2 (false-refusal/safety-circumvention).`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security", GEN_TEST_MODEL_CHAIN: model, GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps", "--trap-v2"]),
  },
]);

// Phase T — adversarial trap suite (tests/trap-scenarios.js, run via
// generation-test --traps), separate trap-test_* log namespace, query
// rewrite enabled. Selected with `node tests/run-campaign.js --traps`.
const TRAP_VARIANTS = [
  ["T-baseline", "baseline"],
  ["T-security", "security"],
  ["T-refusal", "refusal"],
  ["T-combined", "security,refusal,anti-sycophancy"],
];
const TRAP_CONFIGURATIONS = [
  ...TRAP_VARIANTS.map(([id, variant]) => ({
    id,
    phase: "T",
    description: `Trap suite: rag, prompt variant "${variant}", model ${GEN_MODEL}, query rewrite on.`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: variant, GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps"]),
  })),
  {
    id: "T-full-ordered",
    phase: "T",
    description: `Trap suite: full-ordered context, prompt variant "security", model ${GEN_MODEL} — do absence/cross-system traps hit full context less?`,
    env: baseEnv({ CONTEXT_MODE: "full-ordered", PROMPT_VARIANT: "security", GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps"]),
  },
  {
    id: "T-full-fixed",
    phase: "T",
    description: `Trap suite: full-fixed context, prompt variant "security", model ${GEN_MODEL} — completes the context-strategy comparison against T-full-ordered under adversarial pressure.`,
    env: baseEnv({ CONTEXT_MODE: "full-fixed", PROMPT_VARIANT: "security", GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps"]),
  },
  {
    id: "T-none",
    phase: "T",
    description: `Trap suite: ungrounded baseline (no retrieval, no documents), prompt variant "security", model ${GEN_MODEL} — how much worse does the operational-tier grounding gap (§A-none) get under adversarial pressure specifically?`,
    env: baseEnv({ CONTEXT_MODE: "none", PROMPT_VARIANT: "security", GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps"]),
  },
  {
    id: "T-gemini-3.5-flash",
    phase: "T",
    description: `Trap suite: rag, prompt variant "security", gemini-3.5-flash — does model capability dominate prompt engineering under adversarial load?`,
    env: baseEnv({ CONTEXT_MODE: "rag", PROMPT_VARIANT: "security", GEN_TEST_MODEL_CHAIN: "gemini-3.5-flash", GEN_TEST_QUERY_REWRITE: "1" }),
    args: repeatArgs(["--traps"]),
  },
];

// ── CLI ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// --traps swaps the plan to Phase T. --trap-v2 (with --traps) swaps to
// Phase V instead. --groq swaps to Phase G (not composable with the other two).
if (args.includes("--groq")) {
  CONFIGURATIONS.length = 0;
  CONFIGURATIONS.push(...GROQ_CONFIGURATIONS);
} else if (args.includes("--traps")) {
  CONFIGURATIONS.length = 0;
  CONFIGURATIONS.push(...(args.includes("--trap-v2") ? TRAP_V2_CONFIGURATIONS : TRAP_CONFIGURATIONS));
}
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
}

if (args.includes("--list")) {
  console.log(`Campaign plan — ${CONFIGURATIONS.length} configuration(s):\n`);
  for (const c of CONFIGURATIONS) {
    console.log(`[${c.phase}] ${c.id}`);
    console.log(`    ${c.description}`);
    console.log(`    env: ${Object.entries(c.env).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    if (c.args?.length) console.log(`    args: ${c.args.join(" ")}`);
  }
  process.exit(0);
}

const NO_GATE = args.includes("--no-gate");

let startIdx = 0;
const startId = argValue("--start", null);
if (startId) {
  startIdx = CONFIGURATIONS.findIndex((c) => c.id === startId);
  if (startIdx === -1) {
    console.error(`Unknown config id: ${startId} (use --list to see valid ids)`);
    process.exit(1);
  }
}

console.log("════════════════════════════════════════════════════════════════════");
console.log(`ADAS reliability test campaign — ${CONFIGURATIONS.length - startIdx}/${CONFIGURATIONS.length} configuration(s) to attempt`);
console.log(`Generation model: ${GEN_MODEL}    Judge model: ${JUDGE_MODEL}`);
console.log(`Phase D comparison models: ${COMPARISON_MODELS.join(", ") || "(none — set CAMPAIGN_MODEL_COMPARISON)"}`);
console.log("Already-complete configurations resume near-instantly (no API calls); an");
console.log("incomplete one continues from its next un-logged scenario.");
console.log("════════════════════════════════════════════════════════════════════\n");

for (let i = startIdx; i < CONFIGURATIONS.length; i++) {
  const config = CONFIGURATIONS[i];
  console.log("────────────────────────────────────────────────────────────────────");
  console.log(`[${i + 1}/${CONFIGURATIONS.length}] ${config.id}  (Phase ${config.phase})`);
  console.log(config.description);
  console.log("────────────────────────────────────────────────────────────────────\n");

  const result = spawnSync("node", ["tests/generation-test.js", ...(config.args ?? [])], {
    env: { ...process.env, ...config.env },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`\nFailed to launch generation-test.js: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status === QUOTA_EXIT_CODE) {
    console.log(`\nQuota exhausted during "${config.id}". Campaign paused here.`);
    console.log(`Rerun "npm run rag:test-campaign" later — earlier configurations finish`);
    console.log(`almost instantly on re-check, and "${config.id}" resumes from its next`);
    console.log(`un-logged scenario.`);
    process.exit(QUOTA_EXIT_CODE);
  }

  if (result.status !== 0) {
    console.log(`\n"${config.id}" exited with code ${result.status} — not a quota issue.`);
    console.log(`Stopping the campaign here for investigation.`);
    process.exit(result.status ?? 1);
  }

  console.log(`\n[${config.id}] complete.\n`);

  // Stops after the last Phase R config unless --no-gate, a --start past
  // Phase R, or there's no next configuration.
  const next = CONFIGURATIONS[i + 1];
  if (!NO_GATE && config.phase === "R" && next && next.phase !== "R") {
    console.log("════════════════════════════════════════════════════════════════════");
    console.log("Phase R (regression check) complete.");
    console.log("════════════════════════════════════════════════════════════════════");
    console.log("Review the hallucination flags printed above for each variant against");
    console.log(`the ${REGRESSION_SCENARIO_IDS.length} previously-hallucinating scenarios (ids: ${REGRESSION_SCENARIO_IDS.join(", ")}).`);
    console.log("Remember this is an adversarial, non-random subset — good for \"did the");
    console.log("fix work on the known failures\", not a substitute for the full-size");
    console.log("Phase A/B comparison (docs/reliability-testing.md §6 on sample size).");
    console.log();
    console.log("If a variant looks clean on this subset, continue with e.g.:");
    console.log("  node tests/run-campaign.js --start A-rag      # full RAG vs full-context comparison");
    console.log("  node tests/run-campaign.js --start B-<variant>  # fill in that variant's full 150-scenario run");
    console.log("Or rerun Phase R itself after adjusting prompt wording.");
    console.log("Pass --no-gate to skip this stop in future invocations.");
    process.exit(0);
  }
}

console.log("════════════════════════════════════════════════════════════════════");
console.log("All campaign configurations complete.");
console.log("════════════════════════════════════════════════════════════════════");
