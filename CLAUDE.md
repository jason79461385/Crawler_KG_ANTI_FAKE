# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — runs frontend (Vite) and backend (Express via tsx) together with `concurrently`. Vite proxies `/api/*` to `http://localhost:8787`.
- `npm run dev:client` / `npm run dev:server` — run the two halves independently.
- `npm run server` — backend only (same as `dev:server`).
- `npm run build` — `tsc -b` then `vite build`. There is no test suite and no linter configured.
- `npm run preview` — preview the built frontend.

The backend kicks off `crawlLiveSources()` once at startup (server/index.ts:73), so the dev server makes outbound HTTP calls to PTT and Google News on boot.

## Architecture

This is a Taiwanese anti-scam demo with a React 19 + Vite 7 frontend and an Express 5 + tsx backend. The backend runs on port 8787 and is proxied through Vite during development.

### Data flow (single-process, in-memory by default)

1. `server/sources/{ptt,googleNews}.ts` fetch HTML/RSS, parse with `cheerio` / `fast-xml-parser`, and normalize entries into `DemoPost` shape (id, source, board, title, content, url, publishedAt, scamType, entities).
2. `server/lib/scamEngine.ts` is the orchestrator. It owns the in-memory `crawlState`, the `embeddingCache`, and exports every behavior the API surfaces: `crawlLiveSources`, `getSnapshot`, `getFeed`, `getGraph`, `analyzeMessage`, `verifySiteUrl`. If a source fails, `safeRun` swaps in the matching fallback from `server/data/demoPosts.ts` and flags `live: false` — the system never throws out of a crawl.
3. `analyzeMessage` is a hybrid scorer: rule-based keyword/entity overlap **plus** optional embedding cosine similarity (weight `*42` in the score). It then optionally calls an LLM to generate the alert; if the LLM is not configured or returns nothing usable, it falls back to the deterministic `buildAlert`.
4. The knowledge graph is built two ways. `buildKnowledgeGraph` produces an in-memory graph from current posts (top 8 nodes by weight). If Neo4j is configured and reachable, `getGraph` prefers `getGraphFromNeo4j`; `crawlLiveSources` syncs posts to Neo4j after each crawl via `syncPostsToNeo4j` (which does a `MATCH (n) DETACH DELETE n` first — full replace, not incremental).

### Optional integrations (controlled by env vars)

All three are independently optional and gated by `is*Configured()` checks. The system degrades gracefully if any are missing.

- **Neo4j** (`NEO4J_URI`, `NEO4J_USER`/`NEO4J_USERNAME`, `NEO4J_PASS`/`NEO4J_PASSWORD`, `NEO4J_DATABASE`) — see `server/lib/neo4j.ts`. On any error, `handleNeo4jFailure` flips `neo4jAvailable` off and the engine silently falls back to the in-memory graph; it does not retry until process restart.
- **LLM alert generation** (`WORKER_API_URL`, `WORKER_MODEL_NAME`, `WORKER_API_KEY`) — OpenAI-compatible `chat/completions` endpoint, called with `response_format: json_object`.
- **Embeddings** (`EMBEDDING_API_URL`, `EMBEDDING_MODEL_NAME`, `EMBEDDING_API_KEY`) — OpenAI-compatible `embeddings` endpoint. Vectors are cached per-post id in `embeddingCache` and warmed at the end of every crawl.

`buildApiRequest` in `server/lib/llm.ts` supports either Bearer token auth or HTTP Basic auth embedded in the URL (`https://user:pass@host/...`).

### State model

There is **no database for posts**. `crawlState` lives in memory; restarting the server resets to `createDemoState()` (which seeds from `demoPosts.ts`). Persistence to Neo4j only stores the graph projection, not raw post content used by `analyzeMessage` — that always reads from in-memory `crawlState`.

### Frontend

Single-page React app (`src/App.tsx` + `src/components/KnowledgeGraphPanel.tsx`) styled with Tailwind 4 (via `@tailwindcss/vite`) and rendering the KG with `vis-network`. All data comes from the `/api/*` endpoints; there is no client-side routing.

## Conventions

- The codebase is bilingual: code and identifiers in English, user-facing strings (alerts, summaries, scam-type labels) in Traditional Chinese. Preserve this split when editing.
- ESM throughout (`"type": "module"`). The backend runs via `node --import tsx` — no compile step for dev.
- Risk scoring constants (the `*24`, `*14`, `*42` weights in `analyzeMessage`, the `>=70 / >=40` thresholds, the `cap = 96/98`) are tuned by hand. If you change one, scan for the others — they are coupled.
