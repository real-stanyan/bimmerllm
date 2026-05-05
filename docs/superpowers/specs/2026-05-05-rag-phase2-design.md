# RAG Phase 2 — Schema, Embedding, Hybrid, Eval (Design)

Date: 2026-05-05
Status: Draft (for review before implementation)
Author: Stan + Claude

## Why this exists

Phase 1 (commit `715ee76`) was a pure code pass against the existing Pinecone
schema: inline rerank, bigger LLM context, reformulate fast-path, real token
usage. It moved the needle but left the load-bearing limits in place:

- The `question` field that gets embedded is just `"{models},{engines},{title}"`
  — answer text never enters the vector space, so recall is capped by title
  similarity.
- One record per thread → 35 KB byte cap → mega-threads truncated after a few
  posts. The good answer often lives on page 7 of a 25-page thread.
- Sources have no URL, so the UI can't link back to the original post.
- One embedding model (Pinecone integrated default), no sparse, no eval set.

Phase 2 fixes the schema and retrieval substrate. This is the document that
defines what we change before we touch ingest code.

## Goals

1. Embed the actual answer text, not just titles.
2. Make sources clickable.
3. Handle CN ↔ EN cross-language retrieval natively (not via Gemini reformulate).
4. Catch BMW-specific tokens (error codes `P0171`, part numbers `11537647476`)
   that dense embeddings fumble.
5. Be able to *measure* whether each change helps.

## Non-goals

- Streaming retrieval / agentic RAG (out of scope; Phase 3 if ever).
- Multi-modal (images/PDFs).
- Replacing Gemini Flash Lite as the generation model.

## Architecture

### Schema: post-level chunks (not thread-level)

Every record is one chunk of one post.

```jsonc
{
  "_id":          "<thread_uuid>:<post_idx>:<chunk_idx>",   // stable composite
  "text":         "<chunk body>",                            // EMBEDDED FIELD
  "thread_id":    1218669,
  "thread_uuid":  "<uuid>",
  "thread_title": "N54 HPFP cold-start hesitation",
  "thread_url":   "https://f80.bimmerpost.com/forums/showthread.php?t=1218669",
  "post_idx":     0,                                          // 0 = OP, 1+ = replies
  "chassis":      "f80",
  "models":       ["F80", "F82", "F83"],
  "engines":      ["S55"],
  "series":       "3/4 Series",
  "post_date":    "2024-09-12T03:14:00Z"
}
```

**Chunking rules:**
- Split each post on paragraph boundaries (`\n\n`).
- Pack paragraphs into chunks until a 600-token soft cap (≈ 2400 chars).
- Hard cap 800 tokens; if a single paragraph exceeds it, sentence-split.
- Carry a 1-sentence overlap between adjacent chunks of the same post (helps
  retrieval continuity for code blocks / step-by-step procedures).

**Why post-level not thread-level:** a 50-reply thread averages 3 distinct
sub-topics; embedding all of them as one vector blurs the centroid. Splitting
also lets the reranker do its job (it picks the *best* chunk, not the best
title).

**Estimated record count:** 5792 threads × ~10 posts avg × ~2 chunks/post
≈ 100k–120k records (vs 8610 today, ~14×).

### Index: new index, multilingual integrated embedding

Create `bmw-datas-v2` with Pinecone integrated embedding model
**`multilingual-e5-large`** (or `llama-text-embed-v2` if benchmarks favor it).
Reasons:
- 100+ languages → CN questions hit EN answers without the Gemini reformulate
  hop on the cold path.
- 1024-dim — same magnitude as current default; cost is ~equivalent.
- Used by Pinecone's own examples for multilingual retrieval; well-trodden.

Old `bmw-datas/bimmerpost` namespace stays read-only as a fallback. Chat route
reads `BIMMERPOST_INDEX` from env so we can A/B test.

### Hybrid (dense + sparse) retrieval

Two-index pattern:
- `bmw-datas-v2` (dense, multilingual integrated embedding)
- `bmw-datas-sparse-v2` (sparse, `pinecone-sparse-english-v0`)

At query time:
```
denseHits  = denseIndex.searchRecords({topK: 30, query: searchInput})
sparseHits = sparseIndex.searchRecords({topK: 30, query: searchInput})
merged     = reciprocalRankFusion(denseHits, sparseHits)        // RRF, k=60
top20      = merged.slice(0, 20)
top5       = bgeRerankerV2M3.rerank(top20, query)
```

Sparse pulls its weight on:
- Error codes (`P0171`, `30FF`, `2EF7`)
- Part numbers (`11537647476`)
- Acronyms (`HPFP`, `JB4`, `MHD`)
- Vehicle codes (`F80`, `S55`)

These are exact-match-y; dense embeddings often cluster them with semantically
similar but factually wrong neighbors.

### URL exposure to UI

`SourceCitation` schema gets a `url` and `title` field; both are stored in
localStorage as part of message metadata. SourcesPanel renders each source as
a clickable card linking to the original bimmerpost thread.

```ts
interface SourceCitation {
  id: string;
  score: number;
  preview: string;
  url?: string;
  title?: string;
}
```

Backwards-compat: existing stored messages have `url`/`title` undefined; UI
renders them without the link (current behavior).

## Migration plan

1. **Land Phase 2 ingest code** (record builder + upload stage + new
   embedding/sparse) on a feature branch, with all changes gated behind
   `INGEST_SCHEMA_VERSION=2`. The in-flight fetch run continues using v1
   builder via the default code path.
2. **Wait for fetch to drain** (~16h, ~5722 threads remaining at ~350/h).
3. **Provision new indexes** in Pinecone (`bmw-datas-v2`,
   `bmw-datas-sparse-v2`).
4. **Run upload stage with v2 schema** against the populated sqlite. Estimated
   ~100k chunks × Pinecone integrated embed throughput; needs measurement but
   probably 2–4 hours.
5. **Eval pass** on the v2 indexes (see Eval harness below) before flipping
   chat traffic.
6. **Flip chat route** by setting `BIMMERPOST_INDEX=bmw-datas-v2` +
   `BIMMERPOST_HYBRID=true` in Vercel env, redeploy.
7. **Keep v1 namespace** for a week as rollback before deleting.

## Eval harness

Without an eval set, we can't tell whether multilingual + hybrid + chunking
actually helps or just costs us money. Build before flipping prod.

**Ground-truth set:** 30 hand-written real BMW questions (mix CN/EN, mix
chassis, mix "diagnostic / procedural / part-spec" categories), each annotated
with 2–5 known-good thread URLs from the existing forum corpus.

```jsonc
// docs/superpowers/eval/rag-eval.json
[
  {
    "query": "N54 HPFP冷启动顿挫怎么修",
    "expected_thread_ids": [1218669, 1174292, 1198529],
    "category": "diagnostic",
    "language": "cn"
  },
  ...
]
```

**Metrics:**
- `recall@5` — how often the top 5 results contain ≥1 expected thread
- `mrr@10` — mean reciprocal rank of the first expected thread within top 10
- `latency_p50` / `latency_p95` — end-to-end retrieve latency

**Runner:** `scripts/eval/run.ts` — loads eval set, hits retrieve() for each
config (v1, v2-dense-only, v2-hybrid, v2-hybrid-rerank), prints a table:

```
config                          recall@5   mrr@10   p50    p95
v1 (current prod)               0.42       0.31     180ms  420ms
v2-dense-only                   ?          ?        ?      ?
v2-hybrid                       ?          ?        ?      ?
v2-hybrid + bge-reranker        ?          ?        ?      ?
```

Phase 2 ships only if v2-hybrid+rerank beats v1 on both recall@5 and mrr@10 by
≥10pp.

## Code surface

| File / module                                    | Change |
|-------------------------------------------------|--------|
| `scripts/ingest/ingest/record.py`               | New `build_record_v2(post, chunk)` returning the chunked schema. Keep `build_record` for v1. |
| `scripts/ingest/ingest/chunk.py` *(new)*        | Paragraph + sentence chunker with overlap. |
| `scripts/ingest/ingest/stages/upload.py`        | Branch on `INGEST_SCHEMA_VERSION`. v2 path iterates posts × chunks, calls v2 record builder, upserts into v2 index. |
| `scripts/ingest/ingest/cli.py`                  | New `--schema-version` flag (default 1). |
| `lib/ai/pinecone.ts`                            | Add `bimmerpostIndexV2()` + `bimmerpostSparseV2()`. |
| `app/api/chat/route.ts`                         | Hybrid retrieve when `BIMMERPOST_HYBRID=true`: query dense + sparse → RRF merge → rerank. URL passes through to public sources. |
| `lib/conversation.ts`                           | `SourceCitation` gains optional `url`, `title`. |
| `components/chat/SourcesPanel.tsx`              | Render each source as `<a href={url}>{title}</a>` when present. |
| `scripts/eval/run.ts` *(new)*                   | Eval harness. |
| `docs/superpowers/eval/rag-eval.json` *(new)*   | 30-question ground-truth set (hand-written). |

## Risks

- **Re-ingest cost:** Pinecone integrated embedding charges per record. 100k
  records × 2 indexes (dense + sparse) is ~200k embed calls. Need to confirm
  cost ceiling before kicking off.
- **Eval set authoring:** 30 questions × 2–5 expected threads needs human
  judgment. Allow 2 hours.
- **Multilingual model regression risk:** `multilingual-e5-large` is *averaged*
  across languages; an English-monolingual user might lose a couple of points
  vs. the current setup. Eval set will catch this.
- **Sparse index quality:** `pinecone-sparse-english-v0` is English-only.
  Sparse won't help for CN queries. Acceptable: dense+rerank still works for
  CN; sparse is bonus for EN exact-match queries.
- **Index naming churn:** We now have v1 + v2 + v2-sparse. Document clearly,
  use env vars not hardcoding.

## Open questions

1. Chunking: 600-token soft cap right? Or shorter (300) for tighter retrieval?
   Decide via eval.
2. RRF vs alpha-weighted merge for hybrid? Default RRF k=60.
3. Keep old v1 namespace alive long-term, or wipe after stability confirmed?
4. URL coverage: do we backfill URLs for the existing v1 records (cheap
   metadata-only update) so v1 fallback is also clickable? Probably yes.
