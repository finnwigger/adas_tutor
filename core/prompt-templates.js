import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

// Shared between api-server.js and tests/generation-test.js.

// Bump whenever systemText/KB/coverageNote/coverageReminder change in any way
// that alters the rendered prompt text. Folded into the config hash in tests/generation-test.js.
export const PROMPT_TEMPLATE_VERSION = "v2-unified-coverage";

export const MODE_INSTRUCTIONS = {
  "pre-drive": `The student is in a PRE-DRIVE learning session.
Give a thorough, educational answer. Explain the concept, cover how it works in practice, and note any important conditions or limitations. Use a short paragraph followed by a bullet list when there are multiple distinct points. Aim for 3–8 sentences or an equivalent list — every sentence should add value, but don't pad.`,
  "in-drive": `The driver is ACTIVELY DRIVING — answers must be instantly usable.
Lead with the direct answer or first action. Quick hands-on instructions, no background context.
If a complete answer requires detail, say: "Pull over for the full answer — quick version: [one sentence summary]."`,
};

export const KNOWLEDGE_PROFILE_HEADER = {
  scores:       "Student knowledge profile (0 = Beginner, 1 = Intermediate, 2 = Expert):",
  descriptions: "Student knowledge profile (what they already know per topic):",
};

export const KNOWLEDGE_INSTRUCTIONS = {
  scores: `Tailor your response to their level:
- Beginner (0): explain from scratch, simple language, no assumed knowledge
- Intermediate (1): assume foundational knowledge, add detail and nuance
- Expert (2): concise only, skip basics, edge cases and advanced detail only
Never re-explain what the student already knows well.`,
  descriptions: `Tailor your depth and detail to address the specific gaps described above.
Do not re-explain things the student clearly already understands.
If their knowledge description reveals they know a specific sub-feature, build on it rather than repeating it.`,
};

const HEADER = "You are an ADAS (Advanced Driver Assistance Systems) tutoring assistant.";
const BODY   = `{mode_instructions}\n\n{knowledge_header}\n{knowledge}\n\n{knowledge_instructions}`;
const VARIANT_BLOCK = "{variant_instructions}";

// Identical for RAG and full-context modes; only {context}, {coverage_note},
// and {coverage_reminder} differ (see coverageNote/coverageReminder below).
const KB = `<knowledge_base>
<instructions>
{coverage_note} Ground all your answers in this material. Do not add facts not found here; if something is not covered, say so clearly.
</instructions>

{context}

<reminder>
{coverage_reminder} Answer using only information from the knowledge base above.
</reminder>
</knowledge_base>`;

// position "end" (default) places the variant instructions right before the
// knowledge base; "start" places them right after the opening line.
function systemText(position) {
  return position === "start"
    ? `${HEADER}\n${VARIANT_BLOCK}\n\n${BODY}\n\n${KB}`
    : `${HEADER}\n${BODY}\n\n${VARIANT_BLOCK}\n\n${KB}`;
}

// Used when CONTEXT_MODE=none — no retrieval, no documents.
const NO_CONTEXT_BLOCK = `<no_reference_material>
No reference documents or knowledge base have been provided for this question.
Answer using only your own trained knowledge of BMW's ADAS (Advanced Driver
Assistance Systems) features and setup — e.g. Active Cruise Control, Manual
Speed Limiter, Speed Limit Assistant, Steering Assistant, Extended Traffic Jam
Assistant, Automatic Lane Change. If you are not confident an answer reflects
BMW's actual systems and their real behaviour, say so clearly rather than
guessing.
</no_reference_material>`;

function systemTextNoContext(position) {
  return position === "start"
    ? `${HEADER}\n${VARIANT_BLOCK}\n\n${BODY}\n\n${NO_CONTEXT_BLOCK}`
    : `${HEADER}\n${BODY}\n\n${VARIANT_BLOCK}\n\n${NO_CONTEXT_BLOCK}`;
}

// Describes how much of the document set {context} represents. count is the
// retrieved-chunk count (RAG) or total doc count (full-context).
export function coverageNote(contextMode, count) {
  if (contextMode === "rag") {
    return count > 0
      ? `The following ${count} passage${count === 1 ? "" : "s"} were retrieved as the ones most relevant to the student's question — this is a relevance-filtered slice, not the complete ADAS document set.`
      : `No passages were retrieved as relevant to the student's question, so the knowledge base below is empty for this query.`;
  }
  return `The following ${count} documents are the complete ADAS reference knowledge available for this vehicle — nothing has been filtered out.`;
}

export function coverageReminder(contextMode, count) {
  if (contextMode === "rag") {
    return count > 0
      ? `You have read the ${count} retrieved passage${count === 1 ? "" : "s"} above — the slice judged most relevant to this question, not the complete document set.`
      : `No relevant passages were retrieved above — say so rather than answering from general knowledge.`;
  }
  return `You have read all ${count} ADAS reference documents above.`;
}

const templateCache = new Map();

// contextMode only affects the template text for "none" (see systemTextNoContext);
// RAG and full-context share one system prompt structure.
export function getPromptTemplate(contextMode, position = "end") {
  const noContext = contextMode === "none";
  const key = `${position}:${noContext ? "none" : "kb"}`;
  if (!templateCache.has(key)) {
    templateCache.set(key, ChatPromptTemplate.fromMessages([
      ["system", noContext ? systemTextNoContext(position) : systemText(position)],
      new MessagesPlaceholder("history"),
      ["human", "{question}"],
    ]));
  }
  return templateCache.get(key);
}

// ── Minimal baseline (no prompt engineering) ────────────────────────────────
// Strips identity, mode instructions, knowledge-profile adaptation, and every
// reliability variant. Keeps only {context} + conversation {history} + {question}.
// Test-harness only (tests/generation-test.js --minimal-prompt); never used by the live server.
export const MINIMAL_PROMPT_VERSION = "minimal-v1";

let minimalTemplate = null;
export function getMinimalPromptTemplate() {
  if (!minimalTemplate) {
    minimalTemplate = ChatPromptTemplate.fromMessages([
      ["system", "Answer the question based on the following material.\n\n{context}"],
      new MessagesPlaceholder("history"),
      ["human", "{question}"],
    ]);
  }
  return minimalTemplate;
}
