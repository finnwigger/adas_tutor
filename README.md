# ADAS Tutor

A chat-based tutor for Advanced Driver Assistance Systems (ACC, speed limiter/assistant, steering assistant, traffic jam assistant, automatic lane change). Answers are grounded via retrieval-augmented generation (RAG) over a small document set, streamed from Gemini, and tailored to a per-user, per-topic knowledge profile that updates as you chat.

## Quick start

```bash
npm install
cp .env.example .env        # set GOOGLE_API_KEY
npm run rag:embed           # builds the vector store rag/storage/
npm start                   # http://localhost:3000
```

See `.env.example` for all configurable options (retrieval `K`/threshold, model fallback chain, chunk size, chat/knowledge modes, etc.).

## How it works

On each question the server:
1. Retrieves relevant chunks from the vector store (rewriting short/referential follow-ups into self-contained queries first),
2. Streams a Gemini answer grounded in that context, in either `pre-drive` (thorough) or `in-drive` (brief, action-first) style,
3. Updates the user's per-topic knowledge profile from the exchange.

Alternative context modes (`CONTEXT_MODE` in `.env`) can feed the model the full document set instead of retrieving — useful as a baseline — see `core/full-context.js`.

## Layout

- `api-server.js`, `app-config.js` — Express server and runtime config
- `core/` — LLM calls + fallback, prompt assembly, query rewriting, logging, pricing
- `public/` — vanilla-JS frontend
- `rag/` — source docs (`rag/docs/`), embedding script, vector store (gitignored, `npm run rag:embed`)
- `users/` — per-user knowledge profiles (gitignored, live app state)
- `tests/`, `rag/tests/` — test suites (below)

## Testing

- `npm run rag:test-scenarios` — retrieval-only checks against the vector store, no LLM calls
- `npm run rag:test-generation` / `rag:test-generation-all` — end-to-end generation quality, scored by an LLM judge on helpfulness/groundedness/safety/calibration
- `npm run rag:test-rewrite` — scores the query-rewrite step in isolation
- `npm run rag:human-review` / `rag:review-server` — spot-check judge scores by hand

Logs go to `logs/` (gitignored). See `tests/generation-test.js` and `rag/tests/run.js` for details.

## License

MIT — see [LICENSE](LICENSE).
