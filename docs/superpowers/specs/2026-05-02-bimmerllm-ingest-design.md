# bimmerllm ingest pipeline — M-series chassis crawler

**Date**: 2026-05-02
**Author**: stanyan + Claude
**Status**: spec for V1 implementation

## Problem

Pinecone index `bmw-datas` namespace `bimmerpost` already holds 8610 thread-level records ingested from bimmerpost forums by an earlier pipeline. That pipeline's source code was lost on another machine. We need to crawl additional content into the same namespace, starting with the M-series chassis sub-forums on bimmerpost.com, while keeping every output record bit-compatible with the existing schema so the live RAG path (`app/api/chat/route.ts`) needs zero changes.

## Goals

1. Crawl all M-series chassis sub-forums on bimmerpost (subdomain-per-chassis structure) and ingest every thread (any topic) into Pinecone namespace `bimmerpost`.
2. Output records that match the existing schema exactly (6 metadata fields, UUIDv4 ids, integrated embedding via `field_map.text="question"`).
3. Be re-runnable: incremental mode picks up new threads + reply updates without re-uploading unchanged threads.
4. Be crash-safe: any kill/restart resumes from sqlite checkpoint with no data loss and no duplicate records.

## Non-goals

- Filtering threads by type (announcements vs Q&A vs DIY). All threads ingested.
- Deduping against the existing 8610 records. They use opaque UUIDv4 ids with no thread URL traceback. New crawl uses fresh UUIDs; small overlap is accepted.
- Deleting or migrating the existing 8610 records.
- Crawling non-M chassis (G20, F30, E90, etc.) — out of scope for this run.
- Cron / scheduled execution. Crawler is run manually; incremental mode exists but is invoked by hand.
- Browser automation (playwright) for V1. The crawler is built for vBulletin static HTML; if a future site change introduces a bot wall, a `BotChallenge` exception is raised and the user upgrades the run mode.

## Existing Pinecone schema (ground truth)

Confirmed by API probe of `bmw-datas` index on 2026-05-02:

```
index:    bmw-datas
host:     bmw-datas-qlbflst.svc.aped-4627-b74a.pinecone.io
spec:     serverless aws us-east-1
metric:   cosine, dimension 1024
embed:    integrated, model llama-text-embed-v2
field_map: { text: "question" }
write:    input_type=passage, truncate=END
read:     input_type=query, truncate=END
namespace: bimmerpost (8610 vectors)
```

Per-record schema (sampled from 3 real records):

| field | type | example | notes |
|---|---|---|---|
| `_id` | string (UUIDv4) | `0002a14e-39aa-45d4-a5ab-e1b0ca832ee1` | no thread-URL reverse lookup |
| `question` | string | `"G20, G21,B58,Ecutek Mobile Dashboard Gauges"` | embedding source. format: `"{models},{labels},{title}"` where models join `, ` and labels join `,` |
| `original_question` | string | `"Ecutek Mobile Dashboard Gauges"` | thread title, raw |
| `answers` | string[] | `["Hi I have a 2020 M340i...", ...]` | one entry per post in the thread; OP first |
| `model` | string[] | `["G20", "G21"]` | chassis codes |
| `label` | string[] | `["B58"]` | engine codes |
| `series` | string | `"3/4 Series"` | chassis category |

The new crawler MUST output records matching this shape exactly. Field names, types, and the `question` formatting are load-bearing.

## bimmerpost site structure (verified 2026-05-02)

- vBulletin 3.8.11, no Cloudflare challenge wall
- Each chassis is its own subdomain: `g80.bimmerpost.com`, `f80.bimmerpost.com`, `g87.bimmerpost.com`, `f87.bimmerpost.com`, `g90.bimmerpost.com`, `f90.bimmerpost.com`, `f92.bimmerpost.com`
- Each chassis subdomain has a tree of sub-forums (General / Photos / Engine / Suspension / Wheels / Cosmetic / Coding / Maintenance / Track / Tuning / etc.)
- Forum URL: `forumdisplay.php?f=NNN` with pagination `&page=K`
- Thread URL: `showthread.php?t=NNNNNNNN` with multi-page reply listing `&pp=200&page=K`
- G80 "M3/M4 General" alone has 7,392 threads / 225,183 posts as of 2026-05-02. All seven chassis combined: ~100k–500k threads expected.

## Brainstorm decisions (recorded so we don't re-litigate)

| # | question | answer | reason |
|---|---|---|---|
| Q1 | scope | F80 + G80 M3, F82 + G82 M4, F87 + G87 M2, F90 + G90 M5, F92 + F93 M8, plus F8X/G8X tuning | active production-line + mainline. Skip X*M / Z*M / Classic (E30/E36/E46) M as long-tail. |
| Q2 | thread filter | none — crawl everything | matches existing 8610 strategy. retrieve topK=5 already filters via embedding similarity. |
| Q3 | dedup vs existing 8610 | accept small overlap. new records use fresh UUIDv4. | existing UUIDs have no URL backref; precise dedup is impossible. small overlap impacts topK diversity marginally. |
| Q4 | stack + location | Python + `bimmerllm/scripts/ingest/` (independent venv) | crawler longevity, HTML parsing, crash recovery are Python's home turf. independent venv = zero dep collision with Node main project. |
| Q5 | one-shot vs cron | one-shot full run + CLI `--mode=incremental` interface; no automation | YAGNI. incremental code path exists for future cron, not run on a schedule. |

## Architecture

```
bimmerllm/scripts/ingest/
├── pyproject.toml
├── .python-version             # 3.12
├── README.md
├── ingest/
│   ├── __init__.py
│   ├── cli.py                  # argparse entrypoint
│   ├── config.py               # CHASSIS_MAP, USER_AGENT, RATE_LIMIT_QPS, etc.
│   ├── http.py                 # httpx.Client wrapper: rate limit, retry, backoff
│   ├── db.py                   # sqlite open + schema migrate + helpers
│   ├── parse.py                # bs4 parsers: forum_index, forum_listing_page, thread_page
│   └── stages/
│       ├── __init__.py
│       ├── discover.py         # crawl chassis subdomain root → forums table
│       ├── list_threads.py     # crawl forumdisplay pages → threads table
│       ├── fetch_threads.py    # crawl showthread pages → posts table
│       └── upload.py           # build Pinecone records → upsert_records
└── tests/
    ├── fixtures/               # real HTML snapshots for parser tests
    │   ├── forum_index_g80.html
    │   ├── forum_listing_g80_f888_p1.html
    │   ├── thread_short_g80.html
    │   └── thread_paged_g80.html
    ├── test_parse.py
    ├── test_db.py
    ├── test_config.py
    └── test_build_record.py
```

`data/ingest.db` and `data/ingest.log` live alongside (gitignored).

### Module boundaries

- `http.py` knows nothing about bimmerpost — only HTTP semantics (rate-limit, retry, headers).
- `parse.py` is pure: `(html: str) → dict`. No IO, no network. Easy to fixture-test.
- `db.py` only owns sqlite schema + queries. No HTTP, no Pinecone.
- `stages/*` orchestrate `http → parse → db`.
- `upload.py` is the only module that imports `pinecone`.

This isolation matters because the crawler will run for hours; tight modules are easier to fail-loudly when bimmerpost changes its HTML, and easier to swap (e.g., adding playwright fallback) without bleed-through.

## Data flow

```
config.CHASSIS_MAP
    │ for each chassis
    ▼
discover.py:
    httpx GET https://{subdomain}/forums/index.php
        ↓ parse.parse_forum_index
    INSERT INTO forums
    │
    ▼
list_threads.py:
    for each forum row in sqlite where listed_at IS NULL or mode=incremental:
        for page = (last_listed_page+1) .. ∞:
            httpx GET https://{subdomain}/forums/forumdisplay.php?f={id}&page={page}
                ↓ parse.parse_forum_listing_page
            INSERT INTO threads (INSERT OR REPLACE on existing thread_id)
            UPDATE forums.last_listed_page
            STOP if last page (no "next") or (incremental && all on this page have last_post_at < sqlite_max)
        UPDATE forums.listed_at = now
    │
    ▼
fetch_threads.py:
    SELECT thread_id FROM threads WHERE fetched_at IS NULL
    for each thread:
        for page = 1..∞:
            httpx GET https://{subdomain}/forums/showthread.php?t={id}&pp=200&page={page}
                ↓ parse.parse_thread_page
            INSERT INTO posts (post_idx assigned globally across pages)
            STOP if last page
        UPDATE threads.fetched_at = now
    │
    ▼
upload.py:
    SELECT thread_id FROM threads WHERE fetched_at IS NOT NULL AND uploaded_at IS NULL
    batch by --batch-size (default 50):
        for each:
            ensure_uuid(thread_id)  # UPDATE threads.uuid if NULL, return existing otherwise
            posts = SELECT * FROM posts WHERE thread_id=? ORDER BY post_idx
            record = build_record(thread, posts, CHASSIS_MAP[chassis])
            validate_record(record)
        index.upsert_records(namespace="bimmerpost", records=batch)
        UPDATE threads.uploaded_at = now WHERE thread_id IN batch
```

## SQLite schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE forums (
  chassis            TEXT NOT NULL,
  forum_id           INTEGER NOT NULL,
  name               TEXT NOT NULL,
  parent_forum_id    INTEGER,
  url                TEXT NOT NULL,
  threads_total      INTEGER,
  listed_at          TEXT,
  last_listed_page   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chassis, forum_id)
);

CREATE TABLE threads (
  thread_id          INTEGER PRIMARY KEY,
  forum_id           INTEGER NOT NULL,
  chassis            TEXT NOT NULL,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  replies            INTEGER,
  views              INTEGER,
  last_post_at       TEXT,
  is_sticky          INTEGER NOT NULL DEFAULT 0,
  listed_at          TEXT NOT NULL,
  fetched_at         TEXT,
  uploaded_at        TEXT,
  uuid               TEXT,
  fetch_error        TEXT,
  truncated_at       TEXT
);
CREATE INDEX idx_threads_forum   ON threads(forum_id);
CREATE INDEX idx_threads_fetch   ON threads(fetched_at) WHERE fetched_at IS NULL;
CREATE INDEX idx_threads_upload  ON threads(uploaded_at) WHERE uploaded_at IS NULL AND fetched_at IS NOT NULL;

CREATE TABLE posts (
  thread_id          INTEGER NOT NULL,
  post_idx           INTEGER NOT NULL,
  author             TEXT,
  posted_at          TEXT,
  text               TEXT NOT NULL,
  PRIMARY KEY (thread_id, post_idx)
);
CREATE INDEX idx_posts_thread ON posts(thread_id);
```

## CHASSIS_MAP (config)

```python
CHASSIS_MAP = {
    "g80": {"subdomain": "g80.bimmerpost.com", "models": ["G80", "G82", "G83"], "engines": ["S58"], "series": "3/4 Series"},
    "f80": {"subdomain": "f80.bimmerpost.com", "models": ["F80", "F82", "F83"], "engines": ["S55"], "series": "3/4 Series"},
    "g87": {"subdomain": "g87.bimmerpost.com", "models": ["G87"],                "engines": ["S58"], "series": "2 Series"},
    "f87": {"subdomain": "f87.bimmerpost.com", "models": ["F87"],                "engines": ["N55", "S55"], "series": "2 Series"},
    "g90": {"subdomain": "g90.bimmerpost.com", "models": ["G90", "G99"],         "engines": ["S68"], "series": "5 Series"},
    "f90": {"subdomain": "f90.bimmerpost.com", "models": ["F90"],                "engines": ["S63"], "series": "5 Series"},
    "f92": {"subdomain": "f92.bimmerpost.com", "models": ["F92", "F93", "F91"],  "engines": ["S63"], "series": "8 Series"},
}
```

`F8X tuning` and `G8X tuning` are sub-forums under `f80` and `g80` chassis subdomains respectively; the `discover` stage finds them automatically and `list_threads` ingests them under the parent chassis. No separate config entry needed.

If `discover` finds a forum and the chassis-level subdomain is unknown to `CHASSIS_MAP`, that's a hard error — fail loud rather than silently tag with wrong metadata.

## record assembly

```python
def build_record(thread_row: dict, posts: list[dict], chassis_cfg: dict) -> dict:
    title = thread_row["title"].strip()
    models = chassis_cfg["models"]
    engines = chassis_cfg["engines"]

    # matches existing 8610 sample format exactly:
    # models join with ", " (comma + space)
    # then ","  then engines join with ","  then ","  then title
    question = f"{', '.join(models)},{','.join(engines)},{title}"

    answers = [p["text"] for p in posts if p["text"].strip()]

    return {
        "_id":               thread_row["uuid"],
        "question":          question,
        "original_question": title,
        "answers":           answers,
        "model":             list(models),
        "label":             list(engines),
        "series":            chassis_cfg["series"],
    }


def validate_record(r: dict) -> None:
    """Hard-fails on schema deviations before sending to Pinecone."""
    assert isinstance(r.get("_id"), str) and len(r["_id"]) == 36, f"bad _id: {r.get('_id')!r}"
    assert isinstance(r.get("question"), str) and r["question"], "empty question"
    assert isinstance(r.get("original_question"), str) and r["original_question"], "empty original_question"
    assert isinstance(r.get("answers"), list) and r["answers"], "empty answers"
    assert all(isinstance(a, str) for a in r["answers"]), "non-string answer"
    assert isinstance(r.get("model"), list) and all(isinstance(m, str) for m in r["model"]), "bad model"
    assert isinstance(r.get("label"), list) and all(isinstance(l, str) for l in r["label"]), "bad label"
    assert isinstance(r.get("series"), str) and r["series"], "empty series"

    # metadata size guard (Pinecone hard limit 40KB per record)
    payload_estimate = sum(len(s.encode("utf-8")) for s in r["answers"])
    if payload_estimate > 35_000:  # 5KB margin
        # caller is responsible for truncation
        raise RecordOversize(r["_id"], payload_estimate)
```

When `RecordOversize` is raised the caller in `upload.py` truncates `answers` from the tail (keeping OP first post + first N replies until under threshold), marks `threads.truncated_at = now`, then re-validates and uploads.

## UUID lifecycle

- `threads.uuid` is the single source of truth.
- First upload: `ensure_uuid(thread_id)` generates `uuid.uuid4()` and `UPDATE threads SET uuid=?` before record assembly. If the UPDATE rolls back due to crash, the next run regenerates a fresh UUID — safe because the previous attempt never reached Pinecone.
- Subsequent uploads of the same thread: `ensure_uuid` returns the existing UUID; Pinecone `upsert_records` overwrites. Idempotent.
- Existing 8610 records' UUIDs are not in this sqlite. We can't reconcile. Accept overlap (Q3 decision).

## HTTP layer

- Single `httpx.Client(http2=True)` shared by all stages
- Default rate limit: 1.0 req/s + 0–300ms jitter
- Real Chrome User-Agent header, no Googlebot impersonation
- Retry policy:
  - `httpx.RequestError` (network) → 3 attempts with exp backoff 2s/4s/8s, then mark `fetch_error` and continue
  - HTTP 429 → sleep 60s and retry once; 3 consecutive 429s on a stage → abort that stage with non-zero exit
  - HTTP 5xx → 3 attempts with exp backoff
  - HTTP 403 → raise `BotChallenge(url)` → CLI prints "engage --browser" hint and exits stage (V1 has no `--browser` implementation; the hint is forward-looking)
- `--qps` CLI flag overrides default

## Parser specifics (to be filled by implementer with real-HTML reconnaissance)

`parse.py` exports three functions:

```python
def parse_forum_index(html: str, chassis: str) -> list[ForumNode]:
    """Walks the chassis subdomain's forums/index.php to extract sub-forum tree.
    Returns list of {forum_id, name, parent_forum_id, url} dicts.
    Implementation: bs4 finds all 'a[href*=forumdisplay.php?f=]' and walks the table
    structure to determine parent-child nesting from indentation/CSS class.
    Saves snapshot HTML to tests/fixtures/forum_index_{chassis}.html on first run."""

def parse_forum_listing_page(html: str, forum_id: int) -> ForumPage:
    """Parses forumdisplay.php?f=N&page=K. Returns:
        {threads: [{thread_id, title, url, replies, views, last_post_at, is_sticky}, ...],
         total_pages: int, has_next: bool}
    Implementation: vBulletin 3.8 uses tr.threadbit / tr.deadbit rows;
    sticky threads in a separate top section flagged via .sticky CSS class."""

def parse_thread_page(html: str) -> ThreadPage:
    """Parses showthread.php?t=N&pp=200&page=K. Returns:
        {posts: [{author, posted_at, text}, ...], total_pages: int, has_next: bool}
    Implementation: each .postcontainer or .postbit_legacy is one post.
    Text extraction: get_text('\\n', strip=True) on .post_message after .decompose()-ing
    .quote_container, .signature, .attachments to drop quote bloat & sigs."""
```

Real CSS selectors are determined by the implementer via view-source on g80.bimmerpost.com, captured as fixtures, and locked with assertions in `tests/test_parse.py`.

vBulletin date normalization handles three formats:
- `Today, HH:MM AM/PM` → today's date in UTC + given time
- `Yesterday, HH:MM AM/PM` → today − 1 in UTC + given time
- `MM-DD-YYYY, HH:MM AM/PM` → parse via `dateutil.parser`

If a date can't be parsed, fall back to the current run timestamp and log a WARNING. Never crash a 100k-thread run on a single date format anomaly.

## CLI

```
python -m ingest [--mode=full|incremental]
                 [--chassis=g80,f80,...]
                 [--stage=discover|list|fetch|upload|all]
                 [--max-pages=N]
                 [--qps=1.0]
                 [--batch-size=50]
                 [--dry-run]
                 [--db=data/ingest.db]
                 [--log=data/ingest.log]
                 [--browser]   # reserved for playwright fallback, V1 raises NotImplementedError
```

`--mode=full` (default) reads sqlite state and continues where left off — skipping completed forums and already-fetched / already-uploaded threads. First run of a fresh sqlite and resume-after-crash use the same flag; the difference is just whether sqlite has prior state.

`--mode=incremental` is a list-stage-only modifier: in `list_threads.py`, it fetches only page 1 of each forum and stops scanning a forum once it sees a thread whose `last_post_at <= max(threads.last_post_at WHERE forum_id=?)`. New + updated threads get `INSERT OR REPLACE` and have `fetched_at = NULL` re-set, triggering re-fetch + re-upload. The `fetch` and `upload` stages always behave identically across modes — they only operate on rows where `fetched_at IS NULL` / `uploaded_at IS NULL`, so they skip completed work in either mode.

## Error handling matrix

| error | scope | action |
|---|---|---|
| `httpx.RequestError` | single request | 3 retries exp backoff, then mark `fetch_error` + continue |
| HTTP 429 | single request | 60s sleep + 1 retry; 3 consecutive on stage → abort stage |
| HTTP 5xx | single request | 3 retries exp backoff |
| HTTP 403 | single request | raise `BotChallenge`; abort stage with hint |
| parse exception | single page/thread | log WARNING, mark `fetch_error`, skip; 5 consecutive in same stage → abort stage |
| `RecordOversize` | single record | truncate `answers` from tail, mark `truncated_at`, re-validate, upload |
| Pinecone 4xx | upload batch | raise (auth or schema bug — fix and rerun) |
| Pinecone 5xx / 429 | upload batch | sleep 30s + retry the same batch; idempotent via UUID |
| sqlite IntegrityError | any | raise (programmer error — bug in stage code) |
| KeyboardInterrupt | any | clean shutdown: flush sqlite, close httpx, exit 130 |

## Testing strategy

**fixture-based unit tests** (mandatory before V1 ship):
- `tests/fixtures/forum_index_g80.html` — captured 2026-05-02
- `tests/fixtures/forum_listing_g80_f888_p1.html` — Engine/Drivetrain page 1
- `tests/fixtures/thread_short_g80.html` — single-page thread (~10 replies)
- `tests/fixtures/thread_paged_g80.html` — multi-page thread (200+ replies)
- `test_parse.py`: assert thread_id count, field non-emptiness, date normalization for all three formats, UTF-8 handling
- `test_db.py`: schema migrate idempotency, `ensure_uuid` lifecycle, incremental-mode short-circuit
- `test_config.py`: `CHASSIS_MAP` keys all valid, subdomains resolve to TLD format, series ∈ {"2 Series", "3/4 Series", "5 Series", "8 Series"}
- `test_build_record.py`: golden-file diff against one real existing record (fetched live via Pinecone API and stored at `tests/fixtures/golden_record.json`); assert all 6 fields present and types match.

**integration test (single command)**:
```
python -m ingest --chassis=g87 --max-pages=2 --dry-run
```
Should run all four stages with sqlite + mocked-from-fixture httpx responses, dump first record JSON to stdout. CI-runnable; no Pinecone calls.

**Out of scope for V1 testing**:
- Pinecone client behaviour (trust SDK)
- Real-network end-to-end (manual PoC)
- Concurrency stress tests (single-threaded by design)

## Deployment runbook

**Phase A — bootstrap (~2h)**
1. `cd scripts/ingest && python3.12 -m venv .venv && source .venv/bin/activate`
2. `pyproject.toml` + `pip install -e .`
3. Implement modules in order: `config.py`, `db.py`, `http.py`, `parse.py`, then four stage modules
4. Capture fixture HTML, write `test_parse.py`, run pytest
5. `python -m ingest --chassis=g87 --stage=discover` — must produce a non-empty `forums` table for g87
6. `python -m ingest --chassis=g87 --stage=list --max-pages=2` — must populate `threads` table

**Phase B — schema sanity (~30 min)**
7. `python -m ingest --chassis=g87 --max-pages=2 --dry-run` — must print one record JSON to stdout
8. Eyeball-diff against one of the existing 8610 records (fetched via curl as in this spec's introduction)
9. Real upload of first batch: `python -m ingest --chassis=g87 --max-pages=2` (no `--dry-run`); ~50–100 records uploaded
10. Live RAG smoke: in `bimmerllm.vercel.app` chat, ask a G87-specific question that newly-ingested threads would answer; confirm sources cited

**Phase C — full crawl (~10–40 hours wall clock, depending on `--qps`)**
11. `nohup python -m ingest --mode=full --chassis=g80,f80,g87,f87,g90,f90,f92 > data/ingest.log 2>&1 &`
12. `tail -f data/ingest.log` to monitor; watch `SELECT chassis, COUNT(*) FROM threads GROUP BY chassis` periodically
13. On crash: re-run the same command — sqlite state drives resume.

**Phase D — verify (~30 min)**
14. `SELECT chassis, COUNT(*) AS threads, SUM(CASE WHEN uploaded_at IS NOT NULL THEN 1 ELSE 0 END) AS uploaded FROM threads GROUP BY chassis`
15. Pinecone API: `describe_index_stats` namespace `bimmerpost` should jump from 8610 to 100k+ (number depends on actual thread count)
16. Run 5 M-series RAG queries through `bimmerllm.vercel.app` chat; confirm sources contain newly-ingested threads (e.g., search topic touchpoints like "F80 burning oil", "G80 fuel economy", "F87 LCI N55 vs S55")

**Phase E — incremental (manual, future)**
- `python -m ingest --mode=incremental --chassis=g80,f80,g87,f87,g90,f90,f92` — re-runs list+fetch+upload only on new or updated threads
- No automation in V1

## Acceptance criteria

V1 is done when:
1. `python -m ingest --chassis=g87 --max-pages=2 --dry-run` runs cleanly and prints one record matching the existing 8610 schema.
2. `python -m ingest --chassis=g87 --max-pages=2` (no dry-run) uploads ~50–100 records to Pinecone namespace `bimmerpost`; `describe_index_stats` confirms vectorCount increased.
3. A live chat query against bimmerllm.vercel.app on a G87-specific topic returns sources including at least one newly-ingested record.
4. Re-running step 2 without changes uploads zero new records (idempotency check via uploaded_at).
5. All `test_parse.py`, `test_db.py`, `test_config.py`, `test_build_record.py` green.
6. README in `scripts/ingest/README.md` documents CLI, env vars, runbook.

V1 is **not** required to:
- Complete the full M-series crawl (that's Phase C, manual / time-consuming)
- Implement playwright fallback
- Implement automated cron

## Risks

- **Subdomain assumption broken**: if F92 doesn't have a `f92.bimmerpost.com` subdomain (M8 may share an F1X chassis subdomain), `discover` fails on connection error → user verifies + updates `CHASSIS_MAP`. Implementer should hit each subdomain manually before running full ingest.
- **CSS class drift**: vBulletin 3.8 has been frozen for years, but a forum admin theme tweak could break parsers. Mitigation: fixture-locked tests + parse error → fail-fast on 5 consecutive errors.
- **Long-thread metadata overflow**: Pinecone 40KB metadata limit. Mitigation: `RecordOversize` tail-truncation + `truncated_at` audit column. Acceptable lossy fallback for V1.
- **Stale UUID on partial-upload crash**: if `ensure_uuid` writes UUID but Pinecone upsert fails, sqlite has UUID + Pinecone has nothing. Next retry uses same UUID — idempotent, no leak. Verified in design.
- **Existing 8610 overlap**: small overlap accepted per Q3. If retrieve quality degrades noticeably, escalate to namespace migration (out of V1 scope).

## Out of scope

- Re-ingesting non-M chassis (G20, F30, etc.)
- Migrating the existing 8610 records
- Multi-tenant / multi-user crawler runs
- Web UI for monitoring (sqlite + log file is enough)
- Cron / launchd scheduling
- playwright real implementation
- Cross-thread linking / hierarchy retention beyond chassis grouping
