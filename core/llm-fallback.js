import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

// Chat models tried in order, most capable first, falling back to the next
// model on quota exhaustion (429).
//   gemini-3.5-flash        5 RPM  / 250K TPM /  20 RPD
//   gemini-3.1-flash-lite  15 RPM  / 250K TPM / 500 RPD
//   gemini-3-flash-preview  5 RPM  / 250K TPM /  20 RPD
//   gemini-2.5-flash        5 RPM  / 250K TPM /  20 RPD
//   gemini-2.5-flash-lite  10 RPM  / 250K TPM /  20 RPD
export const MODEL_CHAIN = (process.env.LLM_MODEL_CHAIN ?? process.env.LLM_MODEL ?? [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
].join(",")).split(",").map((m) => m.trim()).filter(Boolean);

export function isQuotaError(err) {
  const msg = String(err?.message ?? err);
  // 429/503: Gemini rate-limit/overload. 402: DeepSeek's "Insufficient Balance" response.
  return /\b429\b/.test(msg) || /\b503\b/.test(msg) || /\b402\b/.test(msg);
}

// Gemini API keys, tried in order for each model before moving to the next model.
export const API_KEYS = [process.env.GOOGLE_API_KEY, process.env.GOOGLE_API_KEY_SECONDARY]
  .filter(Boolean);

// Key order for live serving (api-server.js): secondary (free-tier) first, primary (billed) second.
const liveKeys = [process.env.GOOGLE_API_KEY_SECONDARY, process.env.GOOGLE_API_KEY].filter(Boolean);
export const LIVE_API_KEYS = liveKeys.length ? liveKeys : [undefined];

// DeepSeek models are routed through ChatOpenAI against DeepSeek's OpenAI-compatible endpoint.
export function isDeepSeekModel(model) {
  return model.startsWith("deepseek-");
}

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

// Groq-hosted models are routed through ChatOpenAI against Groq's OpenAI-compatible
// endpoint. Model names are prefixed "groq/" in config (e.g. "groq/llama-3.1-8b-instant");
// the prefix is stripped before the API call.
export function isGroqModel(model) {
  return model.startsWith("groq/");
}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// DeepSeek and Groq models each use a single key (DEEPSEEK_API_KEY / GROQ_API_KEY).
export function apiKeysForModel(model) {
  if (isDeepSeekModel(model) || isGroqModel(model)) return [undefined];
  return API_KEYS.length ? API_KEYS : [undefined];
}

const chatModels = new Map();

export function getChatModel(model, opts = {}) {
  const { apiKey, ...rest } = opts;
  const key = `${model}:${rest.temperature ?? ""}:${apiKey ?? "default"}`;
  if (!chatModels.has(key)) {
    const instance = isDeepSeekModel(model)
      ? new ChatOpenAI({
          model, ...rest,
          apiKey: process.env.DEEPSEEK_API_KEY,
          configuration: { baseURL: DEEPSEEK_BASE_URL },
        })
      : isGroqModel(model)
      ? new ChatOpenAI({
          model: model.slice("groq/".length), ...rest,
          apiKey: process.env.GROQ_API_KEY,
          configuration: { baseURL: GROQ_BASE_URL },
        })
      : new ChatGoogleGenerativeAI({ model, ...rest, ...(apiKey ? { apiKey } : {}) });
    chatModels.set(key, instance);
  }
  return chatModels.get(key);
}

// Pairs each model in the chain with each key to try, in order — e.g. for
// LIVE_API_KEYS [free, paid] and models [A, B]: (A,free) (A,paid) (B,free)
// (B,paid). Both fallback functions below exhaust a model's keys before
// moving to the next model.
function flattenAttempts(apiKeys) {
  return MODEL_CHAIN.flatMap((model) => apiKeys.map((apiKey) => ({ model, apiKey })));
}

function describeAttempt({ model, apiKey }, apiKeys) {
  return apiKeys.length > 1 ? `${model} (key ${apiKeys.indexOf(apiKey) + 1}/${apiKeys.length})` : model;
}

// Runs a non-streaming LLM call, trying each (model, key) pair in turn.
// onUsage(model, usage_metadata) is called when the successful call returns token counts.
// apiKeys defaults to [undefined] — the SDK's default key (GOOGLE_API_KEY via env).
export async function withModelFallback(invokeForModel, label = "llm", onUsage, apiKeys = [undefined]) {
  const attempts = flattenAttempts(apiKeys);
  for (let i = 0; i < attempts.length; i++) {
    const { model, apiKey } = attempts[i];
    try {
      const result = await invokeForModel(model, apiKey);
      if (result?.usage_metadata) onUsage?.(model, result.usage_metadata);
      return result;
    } catch (err) {
      const isLast = i === attempts.length - 1;
      if (isLast || !isQuotaError(err)) throw err;
      console.log(`  [fallback] ${label} — ${describeAttempt(attempts[i], apiKeys)} quota exhausted, switching to ${describeAttempt(attempts[i + 1], apiKeys)}`);
    }
  }
}

// Extract the text content from a streamed chunk (string or AIMessageChunk).
function extractText(chunk) {
  if (typeof chunk === "string") return chunk;
  if (typeof chunk?.content === "string") return chunk.content;
  if (Array.isArray(chunk?.content)) {
    return chunk.content.map((c) => (typeof c === "string" ? c : (c?.text ?? ""))).join("");
  }
  return "";
}

// Streams a chain's response, trying each (model, key) pair in turn (see flattenAttempts).
// getChain(model, apiKey) builds the runnable for that pair; it must not include
// StringOutputParser — raw AIMessageChunks are expected.
// Fallback only triggers if a model fails before yielding its first chunk.
// apiKeys defaults to [undefined] — the SDK's default key (GOOGLE_API_KEY via env).
// Callbacks:
//   onModel(model)           — called when the first model chunk arrives
//   onUsage(usage_metadata)  — called at stream end if usage data is available
//   onFirstChunk()           — called on the first text chunk
export async function* streamWithFallback(getChain, params, label = "stream", onModel, onUsage, onFirstChunk, apiKeys = [undefined]) {
  const attempts = flattenAttempts(apiKeys);
  for (let i = 0; i < attempts.length; i++) {
    const { model, apiKey } = attempts[i];
    try {
      const iterator = (await getChain(model, apiKey).stream(params))[Symbol.asyncIterator]();
      const first = await iterator.next();
      onModel?.(model);

      let firstTextSent = false;
      let lastUsage = null;

      if (!first.done && first.value != null) {
        const text = extractText(first.value);
        if (text) {
          if (!firstTextSent) { onFirstChunk?.(); firstTextSent = true; }
          yield text;
        }
        if (first.value?.usage_metadata) lastUsage = first.value.usage_metadata;
      }

      while (true) {
        const { value, done } = await iterator.next();
        if (done) break;
        const text = extractText(value);
        if (text) {
          if (!firstTextSent) { onFirstChunk?.(); firstTextSent = true; }
          yield text;
        }
        if (value?.usage_metadata) lastUsage = value.usage_metadata;
      }

      if (lastUsage) onUsage?.(lastUsage);
      return;
    } catch (err) {
      const isLast = i === attempts.length - 1;
      if (isLast || !isQuotaError(err)) throw err;
      console.log(`  [fallback] ${label} — ${describeAttempt(attempts[i], apiKeys)} quota exhausted, switching to ${describeAttempt(attempts[i + 1], apiKeys)}`);
    }
  }
}
