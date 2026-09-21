import { MODEL_CHAIN } from "./llm-fallback.js";
import { KNOWLEDGE_MODE, CONTEXT_MODE } from "../app-config.js";
import { canonicalVariantId, getVariantPosition } from "./prompt-variants.js";

export function getSystemSpecs() {
  return {
    contextMode: CONTEXT_MODE,
    rag: {
      k:              parseInt(process.env.RAG_K                ?? "20"),
      scoreThreshold: parseFloat(process.env.RAG_SCORE_THRESHOLD ?? "0.50"),
      chunkSize:      parseInt(process.env.RAG_CHUNK_SIZE    ?? "1000"),
      chunkOverlap:   parseInt(process.env.RAG_CHUNK_OVERLAP ?? "200"),
    },
    llm: {
      modelChain:  MODEL_CHAIN,
      temperature: parseFloat(process.env.LLM_TEMPERATURE ?? "0.7"),
    },
    embeddingModel: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001",
    knowledgeMode: KNOWLEDGE_MODE,
    promptVariant: canonicalVariantId(process.env.PROMPT_VARIANT),
    promptVariantPosition: getVariantPosition(),
    tts: {
      voice: process.env.GOOGLE_TTS_VOICE ?? "en-US-Neural2-D",
    },
  };
}

// One-line plain-English summary of the active config, meant to sit at the
// top of a log file so its conditions are readable without parsing `specs`.
export function describeSpecs(specs) {
  const { contextMode, rag, llm, knowledgeMode, promptVariant, promptVariantPosition } = specs;
  const modelPart = `Model chain: ${llm.modelChain.join(" -> ")} (temperature ${llm.temperature}).`;
  const contextPart = contextMode === "rag"
    ? `RAG mode: retrieves up to K=${rag.k} chunks, keeping only those within distance <= ${rag.scoreThreshold}, from docs chunked at ${rag.chunkSize}/${rag.chunkOverlap} chars (size/overlap).`
    : contextMode === "none"
    ? `none mode: no documents or retrieval — model answers from pretrained knowledge only.`
    : `${contextMode} mode: all docs are placed in the prompt every turn, no retrieval.`;
  return `${contextPart} ${modelPart} Knowledge mode: ${knowledgeMode}. Prompt variant: ${promptVariant} (instructions placed at ${promptVariantPosition} of system prompt).`;
}
