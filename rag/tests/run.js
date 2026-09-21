import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import { scenarios } from "./scenarios.js";
import { getSystemSpecs, describeSpecs } from "../../core/log-specs.js";
import { JsonLogger, buildLogFilename } from "../../core/logger.js";
import { passageLabel } from "../../core/passage-label.js";

dotenv.config();

const STORAGE_PATH = "rag/storage";
const K = parseInt(process.env.RAG_K ?? "20");
const THRESHOLD = parseFloat(process.env.RAG_SCORE_THRESHOLD ?? "0.50");

const LOG_DIR = "logs/tests";
const specs = getSystemSpecs();
const logger = new JsonLogger({
  dir: LOG_DIR,
  filename: buildLogFilename("retrieval-test"),
  meta: {
    description: `${describeSpecs(specs)} Retrieval-only test (no LLM calls) over ${scenarios.length} scenarios.`,
    type: "retrieval-test", scenarioCount: scenarios.length, specs,
  },
});

const W = 64;
const LINE  = "─".repeat(W);
const DLINE = "═".repeat(W);

function pad(str, n) {
  return str.length >= n ? str : str + " ".repeat(n - str.length);
}

// Collapse duplicate filenames, keeping the lowest (best) distance score per
// file along with the label of the passage that scored it.
function dedupeByFile(hits) {
  const map = new Map();
  for (const [doc, score] of hits) {
    const file = doc.metadata?.source ?? "unknown";
    if (!map.has(file) || score < map.get(file).score) {
      map.set(file, { score, passage: passageLabel(doc) });
    }
  }
  return [...map.entries()]
    .map(([file, { score, passage }]) => [file, score, passage])
    .sort((a, b) => a[1] - b[1]);
}

// 1-based rank of the first expected doc in the ranked (shortest-distance-first)
// result list, or null if none of the expected docs were retrieved.
function rankOfFirstExpected(deduped, expectedDocs) {
  for (let rank = 0; rank < deduped.length; rank++) {
    if (expectedDocs.includes(deduped[rank][0])) return rank + 1;
  }
  return null;
}

console.log(DLINE);
console.log(`RAG scenario test runner`);
console.log(`K=${K}  threshold=${THRESHOLD}  scenarios=${scenarios.length}`);
console.log(DLINE);
console.log();

console.log("Loading vector store...");
const vectorStore = await HNSWLib.load(
  STORAGE_PATH,
  new GoogleGenerativeAIEmbeddings({ model: "gemini-embedding-001" })
);
console.log("Ready.\n");

let passed = 0, failed = 0;
let topResultIsExpectedCount = 0;
let reciprocalRankSum = 0;
let scenariosWithExpectations = 0;

for (let i = 0; i < scenarios.length; i++) {
  const s = scenarios[i];
  const expectedDocs = s.expectedDocs ?? [];

  const raw = await vectorStore.similaritySearchWithScore(s.question, K);
  const hits = raw.filter(([, score]) => score <= THRESHOLD);
  const deduped = dedupeByFile(hits);
  const retrievedFiles = new Set(deduped.map(([f]) => f));

  const missing = expectedDocs.filter(f => !retrievedFiles.has(f));
  const allExpectedFound = missing.length === 0;
  const statusLabel = allExpectedFound ? "✓ PASS" : "✗ FAIL";
  if (allExpectedFound) passed++; else failed++;

  // Ranking metrics — only meaningful for scenarios that declare expected docs.
  const expectedRank = expectedDocs.length ? rankOfFirstExpected(deduped, expectedDocs) : null;
  const topResultIsExpected = expectedDocs.length > 0 && deduped.length > 0
    ? expectedDocs.includes(deduped[0][0])
    : null;

  if (expectedDocs.length) {
    scenariosWithExpectations++;
    if (topResultIsExpected) topResultIsExpectedCount++;
    reciprocalRankSum += expectedRank ? 1 / expectedRank : 0;
  }

  logger.add({
    name: s.name,
    question: s.question,
    history: s.history,
    note: s.note ?? null,
    expectedDocs,
    retrieved: deduped.map(([file, score, passage]) => ({
      file,
      passage,
      distance: score,
      expected: expectedDocs.includes(file),
    })),
    missingExpectedDocs: missing,
    topResultIsExpected,
    expectedDocRank: expectedRank,
    status: statusLabel,
  });

  console.log(LINE);
  console.log(`[${i + 1}/${scenarios.length}] ${pad(s.name, W - 14)}  ${statusLabel}`);
  console.log();
  console.log(`  Q: "${s.question}"`);

  if (s.history.length > 0) {
    console.log(`  History: ${s.history.length} turn(s) shown below (NOT sent to vector store)`);
    for (const m of s.history) {
      const role = m.role === "human" ? "User" : "Tutor";
      const snippet = m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
      console.log(`    ${role}: ${snippet}`);
    }
  }

  if (s.note) console.log(`  Note: ${s.note}`);

  console.log();
  if (deduped.length === 0) {
    console.log("  Retrieved: (none — all chunks above threshold)");
  } else {
    console.log(`  Retrieved (${deduped.length} unique file(s), ${hits.length} chunk(s) within threshold=${THRESHOLD}):`);
    for (const [file, score, passage] of deduped) {
      const isExpected = expectedDocs.includes(file);
      const marker = isExpected ? "  ✓" : "   ";
      const label = passage ? `${file} — ${passage}` : file;
      console.log(`  ${marker} dist=${score.toFixed(4)}  ${label}`);
    }
  }

  if (missing.length > 0) {
    console.log();
    console.log("  Expected but not retrieved:");
    for (const f of missing) console.log(`      ✗ ${f}`);
  }

  if (expectedDocs.length) {
    console.log();
    console.log(`  Top result is expected doc: ${topResultIsExpected ? "yes" : "no"}    Expected doc rank: ${expectedRank ?? "not retrieved"}`);
  }

  console.log();
}

const hitRate = scenarios.length ? passed / scenarios.length : null;
const topResultAccuracy = scenariosWithExpectations
  ? topResultIsExpectedCount / scenariosWithExpectations
  : null;
const meanReciprocalRank = scenariosWithExpectations
  ? reciprocalRankSum / scenariosWithExpectations
  : null;

console.log(DLINE);
console.log("Summary");
console.log(DLINE);
console.log(`  Scenarios:               ${passed} passed, ${failed} failed   (hit rate ${hitRate !== null ? (hitRate * 100).toFixed(1) + "%" : "n/a"})`);
console.log(`  Top result is expected:  ${topResultIsExpectedCount}/${scenariosWithExpectations}   (${topResultAccuracy !== null ? (topResultAccuracy * 100).toFixed(1) + "%" : "n/a"})`);
console.log(`  Mean reciprocal rank:    ${meanReciprocalRank !== null ? meanReciprocalRank.toFixed(3) : "n/a"}`);
console.log();
if (failed > 0) {
  console.log("Some scenarios failed — expected docs were not retrieved within threshold.");
  console.log("Consider lowering RAG_SCORE_THRESHOLD or reviewing chunk size/overlap in embed-docs.js.");
}

logger.setSummary({
  total: scenarios.length,
  passed,
  failed,
  hitRate,
  scenariosWithExpectations,
  topResultIsExpectedCount,
  topResultAccuracy,
  meanReciprocalRank,
});
const logPath = logger.write();
console.log(`\nLog written to ${logPath}`);
