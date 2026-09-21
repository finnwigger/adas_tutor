// Gemini API pricing table (USD per 1 million tokens), verified against
// ai.google.dev/gemini-api/docs/pricing on 2026-07-06 (paid tier, standard
// inference, text tokens). Models not listed here return null cost (tokens
// are still tracked).
const PRICE_TABLE = {
  "gemini-3.5-flash":       { inputPer1M: 1.50,   outputPer1M: 9.00  },
  "gemini-3.1-flash-lite":  { inputPer1M: 0.25,   outputPer1M: 1.50  },
  "gemini-3-flash":         { inputPer1M: 0.50,   outputPer1M: 3.00  },
  "gemini-3-flash-preview": { inputPer1M: 0.50,   outputPer1M: 3.00  },
  "gemini-2.5-flash":       { inputPer1M: 0.30,   outputPer1M: 1.00  },
  "gemini-2.5-flash-lite":  { inputPer1M: 0.10,   outputPer1M: 0.40  },
  "gemini-2.0-flash":       { inputPer1M: 0.10,   outputPer1M: 0.40  },
  "gemini-2.0-flash-lite":  { inputPer1M: 0.075,  outputPer1M: 0.30  },
  "gemini-1.5-flash":       { inputPer1M: 0.075,  outputPer1M: 0.30  },
  "gemini-1.5-flash-8b":    { inputPer1M: 0.0375, outputPer1M: 0.15  },
  "gemini-1.0-pro":         { inputPer1M: 0.50,   outputPer1M: 1.50  },

  // DeepSeek pricing (USD per 1M tokens, cache-miss rate), verified against
  // api-docs.deepseek.com on 2026-07-07. `deepseek-chat`/`deepseek-reasoner`
  // map to deepseek-v4-flash. Cache-hit input discount not modeled.
  "deepseek-chat":          { inputPer1M: 0.14,   outputPer1M: 0.28  },
  "deepseek-reasoner":      { inputPer1M: 0.14,   outputPer1M: 0.28  },
  "deepseek-v4-flash":      { inputPer1M: 0.14,   outputPer1M: 0.28  },

  // Groq-hosted model pricing (USD per 1M tokens), verified against
  // console.groq.com/docs/models on 2026-07-09.
  "groq/llama-3.1-8b-instant":   { inputPer1M: 0.05, outputPer1M: 0.08 },
  "groq/llama-3.3-70b-versatile":{ inputPer1M: 0.59, outputPer1M: 0.79 },
};

export function estimateCost(model, inputTokens, outputTokens) {
  const price = PRICE_TABLE[model];
  if (!price || inputTokens == null || outputTokens == null) return null;
  return (inputTokens * price.inputPer1M + outputTokens * price.outputPer1M) / 1_000_000;
}

// Build a token/cost packet from API usage_metadata.
// exact=true when counts come from usage_metadata; false when estimated from char count.
export function tokenPacket(model, usage, exact = true) {
  const input  = usage?.input_tokens  ?? null;
  const output = usage?.output_tokens ?? null;
  return {
    input,
    output,
    exact,
    costUsd: estimateCost(model, input, output),
  };
}

// Rough token estimate from raw character count (English text ≈ 3.5 chars/token).
export function estimateTokensFromChars(chars) {
  return Math.round(chars / 3.5);
}
