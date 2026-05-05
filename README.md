# bimmerllm

BMW knowledge RAG chat — pulls answers from the bimmerpost forum corpus
(indexed in Pinecone), rewrites the user's question into an English search
query when needed, retrieves + reranks the top sources, then streams a
Gemini answer that cites them inline.

The reply mirrors the user's input language (Chinese question → Chinese
reply, English → English).

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn (new-york) |
| Chat SDK | AI SDK v6 (`ai`, `@ai-sdk/react`) with `useChat` + `streamText` |
| Generation | Gemini 2.5 Flash Lite via `@ai-sdk/google` |
| Reformulate | LangChain Gemini (`@langchain/google-genai`) |
| Vector store | Pinecone v6, dense (`bmw-datas` v1, `bmw-datas-v2`) + sparse (`bmw-datas-sparse-v2`) |
| Rerank | BGE reranker-v2-m3 (multilingual, via Pinecone integrated rerank or Inference API) |
| Tracing | LangSmith |
| Ingest | Python 4-stage pipeline in `scripts/ingest/` |
| Eval | TS harness in `scripts/eval/` against `docs/superpowers/eval/rag-eval.json` |

## Architecture

```
┌────────────────┐   POST /api/chat   ┌──────────────────────────────────┐
│  ChatPage UI   │ ─────────────────▶ │  app/api/chat/route.ts           │
│  (useChat)     │ ◀───── stream ──── │                                  │
└────────────────┘                    │  1. extractText(latest msg)      │
                                      │  2. reformulate (skip if EN+0    │
                                      │     history; LangChain Gemini)   │
                                      │  3. retrieve(query, config)      │
                                      │     ├── v1: dense + rerank       │
                                      │     ├── v2-dense: dense + rerank │
                                      │     └── v2-hybrid: dense+sparse  │
                                      │        → RRF merge → BGE rerank  │
                                      │  4. assemble system prompt with  │
                                      │     [Source N] blocks            │
                                      │  5. streamText (Gemini Flash)    │
                                      │     emits data-sources part 1st, │
                                      │     then text, then data-usage   │
                                      └──────────────────────────────────┘
```

Sources arrive in the message stream as a `data-sources` part **before**
the LLM starts generating, so the UI shows the source list immediately
while the answer streams in. A `data-usage` part lands at the end with
real token counts.

The system prompt asks the model to cite each claim with `[N]` markers
referencing the 1-indexed source list. The frontend rewrites those
tokens into footnote-style anchors (`#cite-N`); clicking one opens
SourcesPanel and scrolls the matching entry into view.

## Quickstart

```bash
# Install deps (no --legacy-peer-deps needed)
npm install

# Drop env vars into .env.local:
#   GEMINI_API_KEY=...
#   PINECONE_API_KEY=...
#   LANGSMITH_API_KEY=...        (optional, for tracing)
#   LANGSMITH_TRACING=true       (optional)
#   LANGSMITH_PROJECT=bimmerllm  (optional)

# Run the dev server
npm run dev   # http://localhost:3000
```

### Optional v2 / hybrid retrieval

The chat route reads `BIMMERPOST_USE_V2` and `BIMMERPOST_HYBRID` envs:

```bash
# Use the post-chunked v2 corpus (requires bmw-datas-v2 index to exist):
BIMMERPOST_USE_V2=true

# Add hybrid (dense + sparse with RRF merge + standalone rerank):
BIMMERPOST_HYBRID=true
```

End users can also flip the strategy per-request from Settings → Retrieval
without touching env. That setting wins over the env default.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest run |
| `npm run eval:rag` | RAG eval harness (recall@5 / mrr@10 vs ground truth) |

## Ingest pipeline

Python pipeline that crawls bimmerpost, parses vBulletin HTML, and upserts
records into Pinecone. Lives in `scripts/ingest/` with its own venv.

Stages: **discover** (forum trees) → **list** (thread listings) →
**fetch** (per-thread posts) → **upload** (Pinecone upsert).

Each stage is independently resumable via the local sqlite state DB at
`data/ingest.db`.

```bash
cd scripts/ingest
python -m venv .venv
.venv/bin/pip install -e ".[dev]"

# Optional: enable Scrapling stealth fallback for 403 BotChallenge
.venv/bin/pip install -e ".[stealth]"
.venv/bin/scrapling install   # Playwright Chromium

# Run all stages with current schema (v1, thread-level records)
.venv/bin/python -m ingest --stage=all

# Or v2 (post-chunked schema), dual-write to dense + sparse in one pass:
.venv/bin/python -m ingest --stage=upload --schema-version=2 \
  --pinecone-index=bmw-datas-v2 \
  --pinecone-sparse-index=bmw-datas-sparse-v2 \
  --pinecone-namespace=bimmerpost
```

CLI flags: `--chassis` (comma list or `all`), `--mode {full,incremental}`,
`--max-pages`, `--max-threads`, `--max-pages-per-thread`, `--qps`,
`--dry-run`, `--stealth`. See `python -m ingest --help`.

## Eval

The harness runs each retrieve config against `docs/superpowers/eval/rag-eval.json`
and prints recall@5 / mrr@10 / latency.

```bash
npm run eval:rag                              # all configs
npm run eval:rag -- --configs=v1,v2-hybrid    # subset
npm run eval:rag -- --top-k=20                # widen the rank window
```

Phase 2 ships only when v2-hybrid beats v1 by ≥10pp on both recall@5
and mrr@10. The harness prints that delta line at the end so the gate
is visible.

To author the ground-truth set, edit `docs/superpowers/eval/rag-eval.json`
and populate `expected_thread_ids` for each question. v2 hits carry
`thread_id` natively; v1 hits expose UUIDs which the harness translates
via the local ingest sqlite (`scripts/ingest/data/ingest.db`).

## Project layout

```
app/
  api/chat/route.ts      ← RAG handler (reformulate → retrieve → stream)
  page.tsx + library/page.tsx + settings/page.tsx
  layout.tsx + globals.css
components/
  chat/                  ← ChatPage, Topbar, Thread, AssistantBlock, SourcesPanel, ...
  settings/              ← AppearanceSection, PreferencesSection, ...
  sidebar/ + ui/         ← shadcn primitives, retheme'd
hooks/useDisplayMessages.ts
lib/
  ai/google.ts + ai/pinecone.ts
  chat-bridge.ts         ← stored-shape ↔ AI SDK shape
  citations.ts           ← inline [N] → #cite-N rewrite + click handling
  conversation.ts        ← localStorage schema + migration
  preferences.ts         ← user prefs (units / citations / autoModel / retrievalConfig)
  sources.ts             ← parseSourcesAnnotation + extractSourcesFromMessage + extractUsageFromMessage
  theme.ts
scripts/
  ingest/                ← Python 4-stage pipeline (own venv)
  eval/run.ts            ← TS harness, recall@5 / mrr@10
docs/superpowers/
  specs/                 ← RAG Phase 2 design + adjacent specs
  plans/                 ← implementation plans
  eval/rag-eval.json     ← ground-truth question set
```

## Deployment

Hosted on Vercel. Connect the repo, set the env vars listed above
(`GEMINI_API_KEY`, `PINECONE_API_KEY`, optional LangSmith). Toggle
`BIMMERPOST_USE_V2` / `BIMMERPOST_HYBRID` from the Vercel dashboard
without redeploying.

## Memory & docs

`.claude/CLAUDE.md` carries the project-specific conventions for the
agent that maintains this repo (RAG flow notes, deviations from spec,
known gotchas). Update it alongside any architecture change.
