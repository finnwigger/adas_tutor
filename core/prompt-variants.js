// Registry of additional reliability/grounding instruction blocks that can be
// layered onto the base system prompt, selected via the PROMPT_VARIANT env var
// (comma-separated to combine more than one, e.g. "security,refusal").
export const PROMPT_VARIANTS = {
  security: {
    label: "Foreground safety/security limitations; never overstate autonomous capability.",
    instruction: "Always surface relevant safety and security limitations, even briefly. Never overstate the system's autonomous capability or imply it can replace driver attention.",
  },
  refusal: {
    label: "Explicit instruction to admit when the documents don't cover something.",
    instruction: "If the provided documents do not cover something the student asks about, say so explicitly rather than answering from general knowledge or invented specifics.",
  },
  citation: {
    label: "Require every specific factual claim to be traceable to the source material.",
    instruction: "For every specific factual claim you make (numbers, button names, named behaviours, conditions), make sure it is directly supported by the provided source material. Do not state specifics that are not present in the source.",
  },
  "anti-sycophancy": {
    label: "Explicit instruction to correct incorrect student statements rather than validate them.",
    instruction: "If the student states something that is incorrect or unsupported by the documentation, correct them directly and clearly, even if they push back or insist they are right.",
  },
};

const DEFAULT_VARIANT = "security";

// Normalizes a comma-separated PROMPT_VARIANT spec into a stable, sorted,
// deduplicated id string (e.g. "refusal,security"). Unknown names are
// dropped; an empty/unset spec resolves to DEFAULT_VARIANT. Order-independence
// means "security,refusal" and "refusal,security" hash to the same config.
export function canonicalVariantId(spec) {
  const names = (spec || DEFAULT_VARIANT).split(",").map((s) => s.trim()).filter(Boolean);
  const known = [...new Set(names.filter((n) => n in PROMPT_VARIANTS))];
  return known.length ? known.sort().join(",") : "baseline";
}

// Resolves a PROMPT_VARIANT spec into the combined instruction text to inject
// into the system prompt. "baseline" (or no recognized variant) yields "" —
// no additional instructions beyond the base mode/knowledge framing.
export function getPromptVariantText(spec) {
  const id = canonicalVariantId(spec);
  if (id === "baseline") return "";
  return id.split(",").map((name) => PROMPT_VARIANTS[name].instruction).join("\n");
}

// Where the variant instruction block sits in the system prompt — "end" (default) or "start".
export function getVariantPosition() {
  return process.env.PROMPT_VARIANT_POSITION === "start" ? "start" : "end";
}
