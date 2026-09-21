// Shared query-rewrite logic for RAG retrieval — used by api-server.js and
// tests/generation-test.js / tests/rewrite-test.js. Turns a follow-up question
// into a self-contained question using recent conversation turns. The LLM
// invocation itself stays at the call sites; this module owns the decision
// logic and the exact prompt.

// Bump whenever the trigger heuristic or rewrite prompt changes; folded into the rewrite-test config hash.
export const QUERY_REWRITE_VERSION = "v1";

// Heuristic: short questions and questions with referring pronouns are
// unlikely to stand alone as retrieval queries.
export function needsRewrite(question) {
  const words = question.trim().split(/\s+/);
  if (words.length < 8) return true;
  return /\b(it|that|this|those|they|them|its|their)\b/i.test(question);
}

// Builds the exact chat messages for the rewrite call from the follow-up and
// the last `turns` conversation turns.
export function buildRewriteMessages(question, history, turns = 4) {
  const recent = history.slice(-turns);
  const historyText = recent
    .map((m) => `${m.role === "human" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "Rewrite the student's follow-up question as a single self-contained question that can be understood without prior context. Return only the rewritten question, nothing else.",
    },
    {
      role: "human",
      content: `Conversation:\n${historyText}\n\nFollow-up: ${question}`,
    },
  ];
}
