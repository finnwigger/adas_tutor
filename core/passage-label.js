// Human-readable label for a retrieved chunk, used in context tags and logs so
// it's clear which passage within a document matched — not just which file.
// Markdown-section chunks carry a `section` heading from embed-docs.js; chunks
// that fell back to character splitting (oversized sections or non-Markdown
// docs) carry a `loc.lines` range instead.
export function passageLabel(doc) {
  if (doc.metadata?.section) return doc.metadata.section;
  const lines = doc.metadata?.loc?.lines;
  if (lines) return `lines ${lines.from}-${lines.to}`;
  return null;
}