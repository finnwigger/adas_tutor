// ── Application configuration ──────────────────────────────────────────────

// KNOWLEDGE_MODE controls how student knowledge is tracked and displayed.
//
//   "scores"       — Three tiers per topic: 0 = Beginner, 1 = Intermediate, 2 = Expert.
//                    Sidebar shows a progress bar per topic.
//
//   "descriptions" — Free-text summary of what the student knows per topic.
//                    More nuanced: captures specific sub-features and gaps.
//                    Sidebar shows a sentence per topic instead of a bar.
//
export const KNOWLEDGE_MODE = process.env.KNOWLEDGE_MODE
// CONTEXT_MODE controls how ADAS knowledge is provided to the model.
//
//   "rag"          — Similarity-search retrieval; only the most relevant chunks are sent.
//                    Lower token cost, faster per-query. Requires the vector store to exist.
//
//   "full-fixed"   — All docs sent verbatim in alphabetical order every turn.
//                    Deterministic; useful as a reproducible baseline for comparison.
//
//   "full-ordered" — All docs sent, but most question-relevant docs appear first.
//                    Exploits LLM primacy bias; order varies per question.
//
//   "none"         — No retrieval, no documents. The model answers from its
//                    own trained knowledge only, told it's about BMW's ADAS systems.
//
export const CONTEXT_MODE = process.env.CONTEXT_MODE ?? "rag";
