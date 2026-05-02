# bimmerllm M-series ingest

Python crawler for bimmerpost M-chassis sub-forums. Writes thread records to Pinecone namespace `bimmerpost` in the existing 6-field schema.

**Spec:** `../../docs/superpowers/specs/2026-05-02-bimmerllm-ingest-design.md`
**Plan:** `../../docs/superpowers/plans/2026-05-02-bimmerllm-ingest.md`

## Setup

```bash
cd scripts/ingest
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Env vars

The crawler reads `PINECONE_API_KEY` from the environment. Source the project's `.env.local`:

```bash
set -a && source ../../.env.local && set +a
```

## CLI

```bash
# 1. PoC: discover + list 2 pages of g87 + dry-run upload
python -m ingest --chassis=g87 --max-pages=2 --dry-run

# 2. Real PoC: same scope, but really upload
python -m ingest --chassis=g87 --max-pages=2

# 3. Full M-series crawl (10–40h wall clock at qps=1)
nohup python -m ingest --chassis=all > data/ingest.log 2>&1 &

# 4. Resume after crash
python -m ingest --chassis=all   # same flag — sqlite drives resume

# 5. Incremental update (re-runs list page 1 + new/updated threads only)
python -m ingest --chassis=all --mode=incremental
```

### Flags

| flag | default | meaning |
|---|---|---|
| `--mode` | `full` | `full` (resume from sqlite) or `incremental` (page-1-only list re-scan) |
| `--chassis` | all | comma list `g80,f80,...` or `all` |
| `--stage` | `all` | `discover` / `list` / `fetch` / `upload` / `all` |
| `--max-pages` | none | cap pages per forum during list stage (PoC) |
| `--max-threads` | none | cap threads in fetch stage |
| `--qps` | `1.0` | global request rate |
| `--batch-size` | `50` | upload batch size |
| `--dry-run` | off | upload prints record JSON instead of calling Pinecone |
| `--db` | `data/ingest.db` | sqlite path |
| `--log` | `data/ingest.log` | log path |

## Sqlite tables

- `forums(chassis, forum_id, ...)` — discovered sub-forums per chassis
- `threads(thread_id, ..., uuid, fetched_at, uploaded_at, truncated_at)` — thread state machine
- `posts(thread_id, post_idx, ...)` — extracted post bodies

## Tests

```bash
.venv/bin/pytest                                   # full suite
.venv/bin/pytest tests/test_integration.py -v      # end-to-end with mocked Pinecone
```

## Runbook & acceptance criteria

See `../../docs/superpowers/specs/2026-05-02-bimmerllm-ingest-design.md` sections "Deployment runbook" and "Acceptance criteria".
