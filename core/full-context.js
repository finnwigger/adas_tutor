import fs from "fs";
import path from "path";

const DOCS_DIR = "rag/docs";

// Maps doc filename stems to topic keywords used for relevance-ordering in full-ordered mode.
// More specific multi-word phrases are preferred over single words to reduce false positives.
const FILE_KEYWORDS = {
  "Active_Cruise_Control_Knowledge_Base": [
    "active cruise", "cruise control", "acc", "following distance",
  ],
  "Manual_Speed_Limiter_Knowledge_Base": [
    "manual speed limiter", "speed limiter", "limiter",
  ],
  "Speed_Limit_Assistant_Knowledge_Base": [
    "speed limit assistant", "speed limit", "sign",
  ],
  "automatic_lane_change_assistant": [
    "automatic lane change", "lane change", "alc",
  ],
  "extended_traffic_jam_assistant": [
    "traffic jam assistant", "traffic jam", "tja",
  ],
  "lane_change_active_guidance": [
    "active guidance", "lane change", "alc", "guided",
  ],
  "steering_assistant": [
    "steering assistant", "lane keeping", "lane keep", "steering",
  ],
};

// Only these stems are treated as valid knowledge-base docs; any other file
// in DOCS_DIR is ignored.
const EXPECTED_STEMS = new Set(Object.keys(FILE_KEYWORDS));

// Loaded only when injectDistractor is true; otherwise ignored.
// Bump this version string whenever the distractor doc's content changes.
const DISTRACTOR_DIR = "rag/docs-distractor";
export const DISTRACTOR_DOC_VERSION = "general-vehicle-ref-v1";

function readDistractorDocs() {
  if (!fs.existsSync(DISTRACTOR_DIR)) return [];
  return fs.readdirSync(DISTRACTOR_DIR)
    .filter((f) => /\.(txt|md)$/.test(f))
    .sort()
    .map((filename) => ({
      filename,
      stem: path.basename(filename, path.extname(filename)),
      content: fs.readFileSync(path.join(DISTRACTOR_DIR, filename), "utf-8").trim(),
    }));
}

let cachedDocs = null;

function readDocs() {
  if (cachedDocs) return cachedDocs;

  const files = fs.readdirSync(DOCS_DIR)
    .filter((f) => /\.(txt|md)$/.test(f))
    .filter((f) => EXPECTED_STEMS.has(path.basename(f, path.extname(f))))
    .sort();

  const missing = [...EXPECTED_STEMS].filter(
    (stem) => !files.some((f) => path.basename(f, path.extname(f)) === stem)
  );
  if (missing.length) {
    throw new Error(`full-context: expected doc(s) missing from ${DOCS_DIR}: ${missing.join(", ")}`);
  }

  cachedDocs = files.map((filename) => ({
    filename,
    stem: path.basename(filename, path.extname(filename)),
    content: fs.readFileSync(path.join(DOCS_DIR, filename), "utf-8").trim(),
  }));

  return cachedDocs;
}

function relevanceScore(stem, questionLower) {
  const keywords = FILE_KEYWORDS[stem] ?? [];
  // Longer/more-specific phrases score higher; sum up all matches
  return keywords.reduce((score, kw) => score + (questionLower.includes(kw) ? kw.split(" ").length : 0), 0);
}

function formatDocs(docs) {
  return docs
    .map((doc, i) =>
      `<document index="${i + 1}" filename="${doc.filename}">\n${doc.content}\n</document>`
    )
    .join("\n\n");
}

/**
 * Returns the formatted knowledge-base context string and metadata.
 *
 * mode "full-fixed"   → all docs in stable alphabetical order (reproducible)
 * mode "full-ordered" → most question-relevant docs first (exploits primacy effect)
 */
export function buildFullContext(question, mode, { injectDistractor = false } = {}) {
  const docs = injectDistractor ? [...readDocs(), ...readDistractorDocs()] : readDocs();
  let ordered;

  if (mode === "full-ordered") {
    const q = question.toLowerCase();
    const scored = docs.map((doc) => ({ doc, score: relevanceScore(doc.stem, q) }));
    // Highest score first; ties keep original alphabetical order (stable sort)
    scored.sort((a, b) => b.score - a.score);
    ordered = scored.map((s) => s.doc);
  } else {
    ordered = docs; // already sorted alphabetically by readDocs()
  }

  return {
    context:    formatDocs(ordered),
    docCount:   ordered.length,
    docOrder:   ordered.map((d) => d.filename),
    totalChars: ordered.reduce((sum, d) => sum + d.content.length, 0),
  };
}

// Returns the raw docs array, with the same injectDistractor behavior as buildFullContext.
export function getAllDocs({ injectDistractor = false } = {}) {
  return injectDistractor ? [...readDocs(), ...readDistractorDocs()] : readDocs();
}
