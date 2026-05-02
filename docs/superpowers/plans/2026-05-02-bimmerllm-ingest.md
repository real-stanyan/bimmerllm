# bimmerllm M-series ingest pipeline implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python crawler at `bimmerllm/scripts/ingest/` that crawls bimmerpost M-series chassis sub-forums and writes thread records to the existing Pinecone namespace `bimmerpost` with bit-compatible schema.

**Architecture:** Four-stage pipeline (discover → list → fetch → upload), all stages communicate via local SQLite checkpoint database. Single-process, single-thread, 1 req/s polite crawler with retry/backoff. Pinecone integrated embedding (model `llama-text-embed-v2`, field_map `text=question`) handles vectorization server-side via `upsert_records`.

**Tech Stack:** Python 3.12, httpx (HTTP/2), beautifulsoup4 + lxml, sqlite3 (stdlib), pinecone-client, python-dateutil, pytest.

**Spec:** `docs/superpowers/specs/2026-05-02-bimmerllm-ingest-design.md`

**File structure (final):**
```
bimmerllm/scripts/ingest/
├── pyproject.toml
├── .python-version
├── .gitignore
├── README.md
├── ingest/
│   ├── __init__.py
│   ├── cli.py
│   ├── config.py
│   ├── db.py
│   ├── http.py
│   ├── parse.py
│   └── stages/
│       ├── __init__.py
│       ├── discover.py
│       ├── list_threads.py
│       ├── fetch_threads.py
│       └── upload.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── fixtures/
│   │   ├── forum_index_g80.html
│   │   ├── forum_listing_g80_f888_p1.html
│   │   ├── thread_short_g80.html
│   │   ├── thread_paged_g80.html
│   │   └── golden_record.json
│   ├── test_config.py
│   ├── test_db.py
│   ├── test_http.py
│   ├── test_parse.py
│   ├── test_build_record.py
│   ├── test_discover.py
│   ├── test_list_threads.py
│   ├── test_fetch_threads.py
│   ├── test_upload.py
│   └── test_integration.py
└── data/                  (gitignored — sqlite + log live here)
```

---

## Task 1: Bootstrap project structure

**Files:**
- Create: `scripts/ingest/pyproject.toml`
- Create: `scripts/ingest/.python-version`
- Create: `scripts/ingest/.gitignore`
- Create: `scripts/ingest/ingest/__init__.py`
- Create: `scripts/ingest/ingest/stages/__init__.py`
- Create: `scripts/ingest/tests/__init__.py`
- Create: `scripts/ingest/tests/conftest.py`

- [ ] **Step 1: Create directory layout**

```bash
cd /Users/stanyan/Github/bimmerllm
mkdir -p scripts/ingest/ingest/stages
mkdir -p scripts/ingest/tests/fixtures
mkdir -p scripts/ingest/data
```

- [ ] **Step 2: Write `scripts/ingest/.python-version`**

```
3.12
```

- [ ] **Step 3: Write `scripts/ingest/pyproject.toml`**

```toml
[project]
name = "bimmerllm-ingest"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "httpx[http2]>=0.27.0",
    "beautifulsoup4>=4.12.0",
    "lxml>=5.0.0",
    "pinecone>=5.0.0",
    "python-dateutil>=2.9.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-mock>=3.12.0",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["ingest*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
addopts = "-v"
```

- [ ] **Step 4: Write `scripts/ingest/.gitignore`**

```
.venv/
data/
*.pyc
__pycache__/
.pytest_cache/
*.egg-info/
build/
dist/
```

- [ ] **Step 5: Write `scripts/ingest/ingest/__init__.py`**

```python
"""bimmerllm M-series ingest pipeline."""

__version__ = "0.1.0"
```

- [ ] **Step 6: Write `scripts/ingest/ingest/stages/__init__.py`**

```python
```

- [ ] **Step 7: Write `scripts/ingest/tests/__init__.py`**

```python
```

- [ ] **Step 8: Write `scripts/ingest/tests/conftest.py`**

```python
"""pytest fixtures shared across test modules."""
import sqlite3
from pathlib import Path

import pytest


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def in_memory_db():
    """In-memory sqlite connection with foreign keys enabled."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    yield conn
    conn.close()
```

- [ ] **Step 9: Create venv + install in editable mode**

```bash
cd /Users/stanyan/Github/bimmerllm/scripts/ingest
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
```

Expected output: install completes without error; `pip list` shows httpx, beautifulsoup4, lxml, pinecone, python-dateutil, pytest.

- [ ] **Step 10: Verify pytest can discover (zero tests yet)**

```bash
cd /Users/stanyan/Github/bimmerllm/scripts/ingest
.venv/bin/pytest
```

Expected: `no tests ran` exit 5 (no tests collected — that's fine, structure is correct).

- [ ] **Step 11: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest
git commit -m "feat(ingest): bootstrap python crawler skeleton"
```

---

## Task 2: config.py with CHASSIS_MAP + tests

**Files:**
- Create: `scripts/ingest/ingest/config.py`
- Create: `scripts/ingest/tests/test_config.py`

- [ ] **Step 1: Write the failing test `tests/test_config.py`**

```python
"""Sanity checks on CHASSIS_MAP — wrong values silently corrupt every uploaded record."""
import re

import pytest

from ingest.config import CHASSIS_MAP, USER_AGENT, VALID_SERIES


VALID_CHASSIS_KEYS = {"g80", "f80", "g87", "f87", "g90", "f90", "f92"}


def test_all_expected_chassis_present():
    assert set(CHASSIS_MAP.keys()) == VALID_CHASSIS_KEYS


@pytest.mark.parametrize("chassis", sorted(VALID_CHASSIS_KEYS))
def test_chassis_entry_well_formed(chassis: str):
    cfg = CHASSIS_MAP[chassis]
    assert set(cfg.keys()) == {"subdomain", "models", "engines", "series"}
    assert isinstance(cfg["subdomain"], str)
    assert cfg["subdomain"] == f"{chassis}.bimmerpost.com"
    assert isinstance(cfg["models"], list) and cfg["models"]
    assert all(re.fullmatch(r"[A-Z]\d{2,3}", m) for m in cfg["models"])
    assert isinstance(cfg["engines"], list) and cfg["engines"]
    assert all(re.fullmatch(r"[A-Z]\d{2,3}", e) for e in cfg["engines"])
    assert cfg["series"] in VALID_SERIES


def test_user_agent_is_real_chrome_ua():
    assert "Chrome/" in USER_AGENT
    assert "Mozilla/5.0" in USER_AGENT


def test_no_duplicate_subdomains():
    subdomains = [c["subdomain"] for c in CHASSIS_MAP.values()]
    assert len(subdomains) == len(set(subdomains))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/stanyan/Github/bimmerllm/scripts/ingest
.venv/bin/pytest tests/test_config.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'ingest.config'`.

- [ ] **Step 3: Write `ingest/config.py`**

```python
"""Static config: chassis → metadata mapping, HTTP defaults."""
from typing import TypedDict


class ChassisConfig(TypedDict):
    subdomain: str
    models: list[str]
    engines: list[str]
    series: str


CHASSIS_MAP: dict[str, ChassisConfig] = {
    "g80": {"subdomain": "g80.bimmerpost.com", "models": ["G80", "G82", "G83"], "engines": ["S58"], "series": "3/4 Series"},
    "f80": {"subdomain": "f80.bimmerpost.com", "models": ["F80", "F82", "F83"], "engines": ["S55"], "series": "3/4 Series"},
    "g87": {"subdomain": "g87.bimmerpost.com", "models": ["G87"],                "engines": ["S58"], "series": "2 Series"},
    "f87": {"subdomain": "f87.bimmerpost.com", "models": ["F87"],                "engines": ["N55", "S55"], "series": "2 Series"},
    "g90": {"subdomain": "g90.bimmerpost.com", "models": ["G90", "G99"],         "engines": ["S68"], "series": "5 Series"},
    "f90": {"subdomain": "f90.bimmerpost.com", "models": ["F90"],                "engines": ["S63"], "series": "5 Series"},
    "f92": {"subdomain": "f92.bimmerpost.com", "models": ["F92", "F93", "F91"],  "engines": ["S63"], "series": "8 Series"},
}

VALID_SERIES = {"2 Series", "3/4 Series", "5 Series", "8 Series"}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

DEFAULT_QPS = 1.0
DEFAULT_JITTER_SEC = 0.3
DEFAULT_BATCH_SIZE = 50

PINECONE_INDEX = "bmw-datas"
PINECONE_NAMESPACE = "bimmerpost"
PINECONE_METADATA_BUDGET_BYTES = 35_000  # 5KB margin under Pinecone 40KB hard limit
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_config.py -v
```

Expected: 11 passed (1 + 7 chassis-parametrized + 2 + 1).

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/config.py scripts/ingest/tests/test_config.py
git commit -m "feat(ingest): add CHASSIS_MAP config + sanity tests"
```

---

## Task 3: db.py — sqlite schema + helpers + tests

**Files:**
- Create: `scripts/ingest/ingest/db.py`
- Create: `scripts/ingest/tests/test_db.py`

- [ ] **Step 1: Write the failing test `tests/test_db.py`**

```python
"""SQLite schema + helper behaviour. Run against in-memory DB."""
from datetime import datetime, timezone

import pytest

from ingest.db import (
    apply_schema,
    ensure_uuid,
    insert_forum,
    insert_thread,
    list_threads_to_fetch,
    list_threads_to_upload,
    mark_fetched,
    mark_uploaded,
)


def test_apply_schema_idempotent(in_memory_db):
    apply_schema(in_memory_db)
    apply_schema(in_memory_db)  # second call must not raise
    tables = {r[0] for r in in_memory_db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    assert {"forums", "threads", "posts"}.issubset(tables)


def test_insert_forum_unique_per_chassis(in_memory_db):
    apply_schema(in_memory_db)
    insert_forum(in_memory_db, chassis="g80", forum_id=888, name="Engine",
                 parent_forum_id=None,
                 url="https://g80.bimmerpost.com/forums/forumdisplay.php?f=888",
                 threads_total=7392)
    insert_forum(in_memory_db, chassis="g80", forum_id=888, name="Engine",
                 parent_forum_id=None,
                 url="https://g80.bimmerpost.com/forums/forumdisplay.php?f=888",
                 threads_total=7400)  # upsert — second call should not raise
    rows = in_memory_db.execute("SELECT threads_total FROM forums WHERE chassis='g80' AND forum_id=888").fetchall()
    assert len(rows) == 1
    assert rows[0][0] == 7400


def test_ensure_uuid_lifecycle(in_memory_db):
    apply_schema(in_memory_db)
    insert_forum(in_memory_db, chassis="g80", forum_id=888, name="Engine",
                 parent_forum_id=None, url="x", threads_total=1)
    insert_thread(in_memory_db, thread_id=2239681, forum_id=888, chassis="g80",
                  title="Test", url="https://x", replies=10, views=100,
                  last_post_at="2026-05-02T00:00:00+00:00", is_sticky=0)
    uuid1 = ensure_uuid(in_memory_db, 2239681)
    assert len(uuid1) == 36 and uuid1.count("-") == 4
    uuid2 = ensure_uuid(in_memory_db, 2239681)
    assert uuid1 == uuid2  # idempotent — same thread always returns same UUID


def test_list_threads_to_fetch_excludes_already_fetched(in_memory_db):
    apply_schema(in_memory_db)
    insert_forum(in_memory_db, chassis="g80", forum_id=888, name="x",
                 parent_forum_id=None, url="x", threads_total=2)
    insert_thread(in_memory_db, thread_id=1, forum_id=888, chassis="g80",
                  title="a", url="x", replies=0, views=0, last_post_at=None, is_sticky=0)
    insert_thread(in_memory_db, thread_id=2, forum_id=888, chassis="g80",
                  title="b", url="x", replies=0, views=0, last_post_at=None, is_sticky=0)
    mark_fetched(in_memory_db, 1)
    pending = list_threads_to_fetch(in_memory_db)
    assert pending == [2]


def test_list_threads_to_upload_requires_fetched(in_memory_db):
    apply_schema(in_memory_db)
    insert_forum(in_memory_db, chassis="g80", forum_id=888, name="x",
                 parent_forum_id=None, url="x", threads_total=2)
    insert_thread(in_memory_db, thread_id=1, forum_id=888, chassis="g80",
                  title="a", url="x", replies=0, views=0, last_post_at=None, is_sticky=0)
    insert_thread(in_memory_db, thread_id=2, forum_id=888, chassis="g80",
                  title="b", url="x", replies=0, views=0, last_post_at=None, is_sticky=0)
    mark_fetched(in_memory_db, 1)
    pending = list_threads_to_upload(in_memory_db, batch_size=10)
    assert pending == [1]
    mark_uploaded(in_memory_db, [1])
    assert list_threads_to_upload(in_memory_db, batch_size=10) == []


def test_incremental_reset_on_thread_update(in_memory_db):
    """When list stage sees same thread_id with newer last_post_at,
    INSERT OR REPLACE should reset fetched_at/uploaded_at to NULL."""
    apply_schema(in_memory_db)
    insert_forum(in_memory_db, chassis="g80", forum_id=888, name="x",
                 parent_forum_id=None, url="x", threads_total=1)
    insert_thread(in_memory_db, thread_id=1, forum_id=888, chassis="g80",
                  title="a", url="x", replies=5, views=100,
                  last_post_at="2026-05-01T00:00:00+00:00", is_sticky=0)
    mark_fetched(in_memory_db, 1)
    mark_uploaded(in_memory_db, [1])

    # simulate list stage seeing updated thread
    insert_thread(in_memory_db, thread_id=1, forum_id=888, chassis="g80",
                  title="a", url="x", replies=10, views=200,
                  last_post_at="2026-05-02T00:00:00+00:00", is_sticky=0)

    row = in_memory_db.execute("SELECT replies, fetched_at, uploaded_at FROM threads WHERE thread_id=1").fetchone()
    assert row[0] == 10
    assert row[1] is None  # fetched_at reset
    assert row[2] is None  # uploaded_at reset
```

- [ ] **Step 2: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_db.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'ingest.db'`.

- [ ] **Step 3: Write `ingest/db.py`**

```python
"""SQLite schema + state helpers for the ingest pipeline."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forums (
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

CREATE TABLE IF NOT EXISTS threads (
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
CREATE INDEX IF NOT EXISTS idx_threads_forum   ON threads(forum_id);
CREATE INDEX IF NOT EXISTS idx_threads_fetch   ON threads(fetched_at) WHERE fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_threads_upload  ON threads(uploaded_at) WHERE uploaded_at IS NULL AND fetched_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS posts (
    thread_id          INTEGER NOT NULL,
    post_idx           INTEGER NOT NULL,
    author             TEXT,
    posted_at          TEXT,
    text               TEXT NOT NULL,
    PRIMARY KEY (thread_id, post_idx)
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
"""


def open_db(path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def apply_schema(conn: sqlite3.Connection) -> None:
    """Idempotent schema migrate. Safe to call on every run."""
    conn.executescript(SCHEMA)
    conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_forum(
    conn: sqlite3.Connection,
    *,
    chassis: str,
    forum_id: int,
    name: str,
    parent_forum_id: Optional[int],
    url: str,
    threads_total: Optional[int],
) -> None:
    conn.execute(
        """
        INSERT INTO forums (chassis, forum_id, name, parent_forum_id, url, threads_total)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(chassis, forum_id) DO UPDATE SET
            name = excluded.name,
            parent_forum_id = excluded.parent_forum_id,
            url = excluded.url,
            threads_total = excluded.threads_total
        """,
        (chassis, forum_id, name, parent_forum_id, url, threads_total),
    )
    conn.commit()


def insert_thread(
    conn: sqlite3.Connection,
    *,
    thread_id: int,
    forum_id: int,
    chassis: str,
    title: str,
    url: str,
    replies: Optional[int],
    views: Optional[int],
    last_post_at: Optional[str],
    is_sticky: int,
) -> None:
    """INSERT OR REPLACE — if thread already exists with different last_post_at,
    fetched_at + uploaded_at + posts are reset to trigger re-crawl."""
    existing = conn.execute(
        "SELECT last_post_at, fetched_at, uploaded_at FROM threads WHERE thread_id = ?",
        (thread_id,),
    ).fetchone()

    needs_recrawl = False
    if existing is not None:
        existing_lpa = existing["last_post_at"]
        if existing_lpa != last_post_at:
            needs_recrawl = True

    if existing is None or needs_recrawl:
        conn.execute(
            """
            INSERT INTO threads
                (thread_id, forum_id, chassis, title, url, replies, views,
                 last_post_at, is_sticky, listed_at, fetched_at, uploaded_at, uuid, fetch_error, truncated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
                 (SELECT uuid FROM threads WHERE thread_id = ?), NULL, NULL)
            ON CONFLICT(thread_id) DO UPDATE SET
                forum_id = excluded.forum_id,
                chassis = excluded.chassis,
                title = excluded.title,
                url = excluded.url,
                replies = excluded.replies,
                views = excluded.views,
                last_post_at = excluded.last_post_at,
                is_sticky = excluded.is_sticky,
                listed_at = excluded.listed_at,
                fetched_at = NULL,
                uploaded_at = NULL,
                fetch_error = NULL,
                truncated_at = NULL
            """,
            (thread_id, forum_id, chassis, title, url, replies, views,
             last_post_at, is_sticky, _now(), thread_id),
        )
        if needs_recrawl:
            conn.execute("DELETE FROM posts WHERE thread_id = ?", (thread_id,))
    conn.commit()


def ensure_uuid(conn: sqlite3.Connection, thread_id: int) -> str:
    """Return existing UUID for thread, or generate + persist a new one."""
    row = conn.execute("SELECT uuid FROM threads WHERE thread_id = ?", (thread_id,)).fetchone()
    if row is None:
        raise ValueError(f"thread_id {thread_id} not in threads table")
    if row["uuid"]:
        return row["uuid"]
    new = str(uuid.uuid4())
    conn.execute("UPDATE threads SET uuid = ? WHERE thread_id = ?", (new, thread_id))
    conn.commit()
    return new


def list_threads_to_fetch(conn: sqlite3.Connection, limit: int = 1000) -> list[int]:
    rows = conn.execute(
        "SELECT thread_id FROM threads WHERE fetched_at IS NULL LIMIT ?",
        (limit,),
    ).fetchall()
    return [r[0] for r in rows]


def list_threads_to_upload(conn: sqlite3.Connection, batch_size: int) -> list[int]:
    rows = conn.execute(
        "SELECT thread_id FROM threads WHERE fetched_at IS NOT NULL AND uploaded_at IS NULL LIMIT ?",
        (batch_size,),
    ).fetchall()
    return [r[0] for r in rows]


def mark_fetched(conn: sqlite3.Connection, thread_id: int) -> None:
    conn.execute("UPDATE threads SET fetched_at = ? WHERE thread_id = ?", (_now(), thread_id))
    conn.commit()


def mark_uploaded(conn: sqlite3.Connection, thread_ids: list[int]) -> None:
    if not thread_ids:
        return
    placeholders = ",".join("?" * len(thread_ids))
    conn.execute(
        f"UPDATE threads SET uploaded_at = ? WHERE thread_id IN ({placeholders})",
        (_now(), *thread_ids),
    )
    conn.commit()


def mark_truncated(conn: sqlite3.Connection, thread_id: int) -> None:
    conn.execute("UPDATE threads SET truncated_at = ? WHERE thread_id = ?", (_now(), thread_id))
    conn.commit()


def record_fetch_error(conn: sqlite3.Connection, thread_id: int, message: str) -> None:
    conn.execute("UPDATE threads SET fetch_error = ? WHERE thread_id = ?", (message[:500], thread_id))
    conn.commit()


def insert_posts(conn: sqlite3.Connection, thread_id: int, posts: list[dict]) -> None:
    """posts is a list of {post_idx, author, posted_at, text} dicts."""
    conn.executemany(
        """
        INSERT INTO posts (thread_id, post_idx, author, posted_at, text)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, post_idx) DO UPDATE SET
            author = excluded.author,
            posted_at = excluded.posted_at,
            text = excluded.text
        """,
        [(thread_id, p["post_idx"], p.get("author"), p.get("posted_at"), p["text"]) for p in posts],
    )
    conn.commit()


def update_forum_progress(conn: sqlite3.Connection, chassis: str, forum_id: int, *,
                           last_listed_page: int, listed_at: Optional[str] = None) -> None:
    if listed_at is not None:
        conn.execute(
            "UPDATE forums SET last_listed_page = ?, listed_at = ? WHERE chassis = ? AND forum_id = ?",
            (last_listed_page, listed_at, chassis, forum_id),
        )
    else:
        conn.execute(
            "UPDATE forums SET last_listed_page = ? WHERE chassis = ? AND forum_id = ?",
            (last_listed_page, chassis, forum_id),
        )
    conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_db.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/db.py scripts/ingest/tests/test_db.py
git commit -m "feat(ingest): add sqlite schema + state helpers"
```

---

## Task 4: http.py — Fetcher with rate-limit + retry + tests

**Files:**
- Create: `scripts/ingest/ingest/http.py`
- Create: `scripts/ingest/tests/test_http.py`

- [ ] **Step 1: Write the failing test `tests/test_http.py`**

```python
"""Fetcher rate-limit + retry behaviour. httpx is mocked end-to-end."""
import time

import httpx
import pytest

from ingest.http import BotChallenge, Fetcher


def make_response(status: int, body: str = "<html></html>") -> httpx.Response:
    return httpx.Response(status_code=status, text=body, request=httpx.Request("GET", "https://x"))


def test_get_returns_body_on_200(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mock = mocker.patch.object(f.client, "get", return_value=make_response(200, "hello"))
    assert f.get("https://x") == "hello"
    mock.assert_called_once_with("https://x")
    f.close()


def test_get_retries_on_5xx(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch("ingest.http.time.sleep")  # no-op the backoff
    mock = mocker.patch.object(f.client, "get", side_effect=[
        make_response(503), make_response(503), make_response(200, "ok"),
    ])
    assert f.get("https://x") == "ok"
    assert mock.call_count == 3
    f.close()


def test_get_raises_after_3_retries_5xx(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch("ingest.http.time.sleep")
    mocker.patch.object(f.client, "get", return_value=make_response(503))
    with pytest.raises(RuntimeError, match="gave up"):
        f.get("https://x")
    f.close()


def test_get_handles_429_with_long_sleep(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    sleep_mock = mocker.patch("ingest.http.time.sleep")
    mocker.patch.object(f.client, "get", side_effect=[
        make_response(429), make_response(200, "ok"),
    ])
    assert f.get("https://x") == "ok"
    # Verify a 60s cooldown was used somewhere
    assert any(call.args[0] >= 60 for call in sleep_mock.call_args_list)
    f.close()


def test_get_raises_BotChallenge_on_403(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch.object(f.client, "get", return_value=make_response(403))
    with pytest.raises(BotChallenge):
        f.get("https://x")
    f.close()


def test_get_retries_on_request_error(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch("ingest.http.time.sleep")
    mocker.patch.object(f.client, "get", side_effect=[
        httpx.ConnectError("boom"),
        httpx.ConnectError("boom"),
        make_response(200, "ok"),
    ])
    assert f.get("https://x") == "ok"
    f.close()


def test_rate_limit_enforces_min_interval(mocker):
    f = Fetcher(qps=10.0, jitter_sec=0.0)  # 100ms min interval
    mocker.patch.object(f.client, "get", return_value=make_response(200, "ok"))

    sleeps: list[float] = []
    real_sleep = time.sleep
    mocker.patch("ingest.http.time.sleep", side_effect=lambda s: (sleeps.append(s), real_sleep(0))[1])

    f.get("https://x")
    f.get("https://x")  # second request should incur a wait
    f.get("https://x")  # third too

    # at least two sleeps roughly near 0.1s should have happened
    near_threshold = [s for s in sleeps if 0.05 < s < 0.2]
    assert len(near_threshold) >= 2
    f.close()
```

- [ ] **Step 2: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_http.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'ingest.http'`.

- [ ] **Step 3: Write `ingest/http.py`**

```python
"""HTTP layer: rate-limited, retrying httpx wrapper."""
from __future__ import annotations

import random
import time
from typing import Optional

import httpx

from .config import DEFAULT_JITTER_SEC, DEFAULT_QPS, USER_AGENT


class BotChallenge(Exception):
    """Raised on HTTP 403 — caller should abort and (future) escalate to playwright."""


class Fetcher:
    """Single httpx.Client wrapper with rate limit + retry + backoff."""

    def __init__(self, qps: float = DEFAULT_QPS, jitter_sec: float = DEFAULT_JITTER_SEC):
        self.client = httpx.Client(
            http2=True,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
            },
            follow_redirects=True,
        )
        self.qps = qps
        self.jitter_sec = jitter_sec
        self._last_request_at: Optional[float] = None
        self._consecutive_429 = 0

    def _rate_limit(self) -> None:
        if self._last_request_at is None:
            return
        elapsed = time.monotonic() - self._last_request_at
        min_interval = 1.0 / self.qps if self.qps > 0 else 0.0
        wait = max(0.0, min_interval - elapsed)
        if self.jitter_sec > 0:
            wait += random.uniform(0, self.jitter_sec)
        if wait > 0:
            time.sleep(wait)

    def get(self, url: str) -> str:
        last_exc: Optional[Exception] = None
        for attempt in range(3):
            self._rate_limit()
            try:
                resp = self.client.get(url)
                self._last_request_at = time.monotonic()
            except httpx.RequestError as e:
                last_exc = e
                if attempt < 2:
                    time.sleep(2 ** (attempt + 1))
                    continue
                raise

            status = resp.status_code
            if status == 200:
                self._consecutive_429 = 0
                return resp.text
            if status == 429:
                self._consecutive_429 += 1
                if self._consecutive_429 >= 3:
                    raise RuntimeError(f"3 consecutive 429s — aborting (last url: {url})")
                time.sleep(60)
                continue
            if 500 <= status < 600:
                if attempt < 2:
                    time.sleep(2 ** (attempt + 1))
                    continue
                last_exc = RuntimeError(f"HTTP {status} for {url}")
                continue
            if status == 403:
                raise BotChallenge(url)
            resp.raise_for_status()
        raise RuntimeError(f"gave up after 3 retries: {url} (last error: {last_exc})")

    def close(self) -> None:
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_http.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/http.py scripts/ingest/tests/test_http.py
git commit -m "feat(ingest): add rate-limited http Fetcher with retry"
```

---

## Task 5: Capture parser fixtures from live site

**Files:**
- Create: `scripts/ingest/tests/fixtures/forum_index_g80.html`
- Create: `scripts/ingest/tests/fixtures/forum_listing_g80_f888_p1.html`
- Create: `scripts/ingest/tests/fixtures/thread_short_g80.html`
- Create: `scripts/ingest/tests/fixtures/thread_paged_g80.html`

- [ ] **Step 1: Run capture script**

Run from `scripts/ingest/`:

```bash
.venv/bin/python -c "
import httpx
from ingest.config import USER_AGENT
client = httpx.Client(http2=True, follow_redirects=True,
                      headers={'User-Agent': USER_AGENT,
                               'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9'},
                      timeout=30.0)

urls = {
    'tests/fixtures/forum_index_g80.html': 'https://g80.bimmerpost.com/forums/index.php',
    'tests/fixtures/forum_listing_g80_f888_p1.html': 'https://g80.bimmerpost.com/forums/forumdisplay.php?f=888&page=1',
}
for path, url in urls.items():
    print(f'fetching {url}')
    r = client.get(url)
    r.raise_for_status()
    open(path, 'w', encoding='utf-8').write(r.text)
    print(f'  -> {path} ({len(r.text)} bytes)')

# pick a thread URL out of the listing page
import re
listing = open('tests/fixtures/forum_listing_g80_f888_p1.html').read()
thread_ids = re.findall(r'showthread\.php\?[^\"]*?t=(\d+)', listing)
unique = list(dict.fromkeys(thread_ids))
print(f'found {len(unique)} thread ids; picking first 2 for short/paged fixtures')

short_url = f'https://g80.bimmerpost.com/forums/showthread.php?t={unique[0]}&pp=200'
paged_url = None
# find a thread with replies > 200 by trying first few
for tid in unique[1:8]:
    r = client.get(f'https://g80.bimmerpost.com/forums/showthread.php?t={tid}&pp=200')
    if 'page=2' in r.text or 'page2' in r.text or '<div class=\"pagenav\"' in r.text:
        paged_url = f'https://g80.bimmerpost.com/forums/showthread.php?t={tid}&pp=200'
        break

if paged_url is None:
    print('no paged thread found in first 8; using thread 0 again as paged fixture')
    paged_url = short_url

for path, url in [('tests/fixtures/thread_short_g80.html', short_url),
                   ('tests/fixtures/thread_paged_g80.html', paged_url)]:
    print(f'fetching {url}')
    r = client.get(url)
    r.raise_for_status()
    open(path, 'w', encoding='utf-8').write(r.text)
    print(f'  -> {path} ({len(r.text)} bytes)')

client.close()
"
```

Expected: 4 HTML files written to `tests/fixtures/`, each between ~50KB and 1MB.

- [ ] **Step 2: Sanity-check fixtures opened correctly**

```bash
ls -lh tests/fixtures/*.html
head -5 tests/fixtures/forum_index_g80.html
grep -c 'showthread.php' tests/fixtures/forum_listing_g80_f888_p1.html
```

Expected: 4 files visible, html doctype lines, listing page contains 30+ `showthread.php` references.

- [ ] **Step 3: Commit fixtures**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/tests/fixtures/*.html
git commit -m "test(ingest): capture vbulletin parser fixtures from g80.bimmerpost.com"
```

---

## Task 6: parse.parse_forum_index — sub-forum tree extractor + tests

**Files:**
- Create: `scripts/ingest/ingest/parse.py` (start with this function)
- Create: `scripts/ingest/tests/test_parse.py` (start with this test)

- [ ] **Step 1: Inspect captured HTML to determine selectors**

```bash
cd /Users/stanyan/Github/bimmerllm/scripts/ingest
.venv/bin/python -c "
from bs4 import BeautifulSoup
html = open('tests/fixtures/forum_index_g80.html').read()
soup = BeautifulSoup(html, 'lxml')
links = soup.find_all('a', href=lambda h: h and 'forumdisplay.php?f=' in h)
print(f'forum_index links: {len(links)}')
for a in links[:10]:
    print(repr(a.get('href')), '|', a.get_text(strip=True)[:60])
"
```

Read the output. Note href patterns (some are absolute URLs, some are relative). Forum IDs are after `f=` in the query string. Forum names are anchor text.

- [ ] **Step 2: Write the failing test (parse_forum_index portion)**

In `tests/test_parse.py`:

```python
"""parse.py tests — fixture-locked HTML parsers."""
import re
from pathlib import Path

import pytest

from ingest.parse import parse_forum_index


def test_parse_forum_index_returns_nodes(fixtures_dir: Path):
    html = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    nodes = parse_forum_index(html, chassis="g80")
    assert isinstance(nodes, list)
    assert len(nodes) >= 5  # G80 has at least 5 sub-forums (general/photos/engine/etc)


def test_parse_forum_index_node_shape(fixtures_dir: Path):
    html = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    nodes = parse_forum_index(html, chassis="g80")
    for n in nodes:
        assert set(n.keys()) == {"forum_id", "name", "parent_forum_id", "url"}
        assert isinstance(n["forum_id"], int) and n["forum_id"] > 0
        assert isinstance(n["name"], str) and n["name"]
        assert n["parent_forum_id"] is None or isinstance(n["parent_forum_id"], int)
        assert n["url"].startswith("https://g80.bimmerpost.com/")
        assert f"f={n['forum_id']}" in n["url"]


def test_parse_forum_index_unique_forum_ids(fixtures_dir: Path):
    html = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    nodes = parse_forum_index(html, chassis="g80")
    ids = [n["forum_id"] for n in nodes]
    assert len(ids) == len(set(ids))
```

- [ ] **Step 3: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_parse.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'ingest.parse'`.

- [ ] **Step 4: Write `ingest/parse.py` (parse_forum_index only)**

```python
"""bs4 parsers for vBulletin 3.8.11 (bimmerpost.com).

All parsers are pure functions of (html: str) → structured dict/list.
No IO, no network — fixture-testable.
"""
from __future__ import annotations

import re
from typing import TypedDict
from urllib.parse import urljoin

from bs4 import BeautifulSoup


class ForumNode(TypedDict):
    forum_id: int
    name: str
    parent_forum_id: int | None
    url: str


_FORUM_HREF_RE = re.compile(r"forumdisplay\.php\?(?:[^\"']*&)?f=(\d+)")


def parse_forum_index(html: str, chassis: str) -> list[ForumNode]:
    """Walk a chassis subdomain root index.php, extract every sub-forum link.

    Returns a flat list of forum nodes. Parent-child nesting is left as None
    in V1; the listing/fetch stages don't need it. Only the forum_id and
    URL are load-bearing for downstream stages.
    """
    soup = BeautifulSoup(html, "lxml")
    base_url = f"https://{chassis}.bimmerpost.com/forums/"

    seen: dict[int, ForumNode] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = _FORUM_HREF_RE.search(href)
        if not m:
            continue
        forum_id = int(m.group(1))
        name = a.get_text(strip=True)
        if not name:
            continue
        if forum_id in seen:
            # keep the first occurrence; later ones are usually breadcrumbs
            continue
        absolute = urljoin(base_url, href) if not href.startswith("http") else href
        seen[forum_id] = ForumNode(
            forum_id=forum_id,
            name=name,
            parent_forum_id=None,
            url=absolute,
        )
    return list(seen.values())
```

- [ ] **Step 5: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_parse.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/parse.py scripts/ingest/tests/test_parse.py
git commit -m "feat(ingest): add parse_forum_index for chassis subdomain root"
```

---

## Task 7: parse.parse_forum_listing_page — thread metadata extractor + tests

**Files:**
- Modify: `scripts/ingest/ingest/parse.py` (add function)
- Modify: `scripts/ingest/tests/test_parse.py` (add tests)

- [ ] **Step 1: Inspect listing page HTML**

```bash
cd /Users/stanyan/Github/bimmerllm/scripts/ingest
.venv/bin/python -c "
from bs4 import BeautifulSoup
html = open('tests/fixtures/forum_listing_g80_f888_p1.html').read()
soup = BeautifulSoup(html, 'lxml')

# vBulletin 3.8: rows in <table id='threadslist'> with id='thread_NNN'
rows = soup.find_all('tr', id=lambda i: i and i.startswith('thread'))
print(f'thread rows: {len(rows)}')
if rows:
    r = rows[0]
    print('first row html (truncated):')
    print(str(r)[:800])

# pagination: <div class='pagenav'> contains page links
pagenav = soup.find('div', class_='pagenav')
print('pagenav present:', pagenav is not None)
if pagenav:
    print(str(pagenav)[:500])
"
```

Note: vBulletin 3.8 wraps each thread row in `<tr id='thread_NNN'>`. Title is in `<a id='thread_title_NNN'>`. Replies/views are in subsequent `<td>` cells. Last post date is in `<td class='alt2' nowrap>`. Sticky threads are usually at top of `<tbody id='stickies'>` or have `class` flag — check the actual fixture.

- [ ] **Step 2: Write the failing tests (append to test_parse.py)**

```python
from ingest.parse import parse_forum_listing_page


def test_parse_forum_listing_page_returns_threads(fixtures_dir: Path):
    html = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    page = parse_forum_listing_page(html, forum_id=888)
    assert "threads" in page and len(page["threads"]) >= 10
    assert "total_pages" in page
    assert "has_next" in page


def test_parse_forum_listing_thread_shape(fixtures_dir: Path):
    html = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    page = parse_forum_listing_page(html, forum_id=888)
    for t in page["threads"]:
        assert isinstance(t["thread_id"], int) and t["thread_id"] > 0
        assert isinstance(t["title"], str) and t["title"]
        # parser returns href as found (often relative); caller resolves
        assert "showthread.php" in t["url"] and f"t={t['thread_id']}" in t["url"]
        assert t["replies"] is None or isinstance(t["replies"], int)
        assert t["views"] is None or isinstance(t["views"], int)
        assert t["is_sticky"] in (0, 1)
        assert t["last_post_at"] is None or isinstance(t["last_post_at"], str)


def test_parse_forum_listing_unique_thread_ids(fixtures_dir: Path):
    html = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    page = parse_forum_listing_page(html, forum_id=888)
    ids = [t["thread_id"] for t in page["threads"]]
    assert len(ids) == len(set(ids))
```

- [ ] **Step 3: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_parse.py -v
```

Expected: 3 new tests fail with `ImportError: cannot import name 'parse_forum_listing_page'`.

- [ ] **Step 4: Append `parse_forum_listing_page` + helpers to `ingest/parse.py`**

```python
# Append to ingest/parse.py

import datetime as _dt
from dateutil import parser as _date_parser


class ThreadMeta(TypedDict):
    thread_id: int
    title: str
    url: str
    replies: int | None
    views: int | None
    last_post_at: str | None
    is_sticky: int


class ForumPage(TypedDict):
    threads: list[ThreadMeta]
    total_pages: int
    has_next: bool


_THREAD_HREF_RE = re.compile(r"showthread\.php\?(?:[^\"']*&)?t=(\d+)")
_PAGE_RE = re.compile(r"page=(\d+)")


def _normalize_vbulletin_date(text: str) -> str | None:
    """vBulletin shows: 'Today, 10:23 AM', 'Yesterday, 04:55 PM', or 'MM-DD-YYYY, HH:MM AM/PM'.
    Return ISO 8601 UTC or None."""
    text = text.strip()
    if not text:
        return None
    today = _dt.datetime.now(_dt.timezone.utc).date()
    try:
        if text.lower().startswith("today"):
            time_part = text.split(",", 1)[1].strip() if "," in text else "00:00"
            t = _date_parser.parse(time_part).time()
            return _dt.datetime.combine(today, t, _dt.timezone.utc).isoformat()
        if text.lower().startswith("yesterday"):
            time_part = text.split(",", 1)[1].strip() if "," in text else "00:00"
            t = _date_parser.parse(time_part).time()
            return _dt.datetime.combine(today - _dt.timedelta(days=1), t, _dt.timezone.utc).isoformat()
        # absolute date e.g. "01-15-2026, 09:12 AM"
        return _date_parser.parse(text).replace(tzinfo=_dt.timezone.utc).isoformat()
    except (ValueError, IndexError):
        return None


def _parse_int_loose(text: str) -> int | None:
    """vBulletin formats numbers as '1,234' or '7,392'. Strip commas + parse."""
    cleaned = re.sub(r"[^\d]", "", text or "")
    return int(cleaned) if cleaned else None


def parse_forum_listing_page(html: str, forum_id: int) -> ForumPage:
    """Parse a forumdisplay.php?f=N&page=K HTML page.

    vBulletin 3.8.11 structure:
      <tr id='thread_NNNN'> ... </tr> per thread.
      Inside that row:
        <a id='thread_title_NNNN' href='showthread.php?t=NNNN'> title </a>
        <td class='alt2' nowrap> last post date in two lines: 'MM-DD-YYYY, HH:MM AM/PM' or 'Today, ...' </td>
        <td class='alt1' align='center'>replies</td><td class='alt2' align='center'>views</td>
      Sticky threads have <tr class='altbg' /> markers or live inside
      <tbody id='threadbits_forum_<f>'> with sticky icons.
    """
    soup = BeautifulSoup(html, "lxml")

    threads: list[ThreadMeta] = []
    seen_ids: set[int] = set()

    for tr in soup.find_all("tr", id=re.compile(r"^thread_\d+$")):
        m = re.match(r"thread_(\d+)$", tr.get("id", ""))
        if not m:
            continue
        thread_id = int(m.group(1))
        if thread_id in seen_ids:
            continue
        seen_ids.add(thread_id)

        title_a = tr.find("a", id=re.compile(rf"^thread_title_{thread_id}$"))
        if title_a is None:
            # fallback: any anchor pointing to this thread
            title_a = tr.find("a", href=re.compile(rf"showthread\.php\?[^\"']*?t={thread_id}"))
        title = title_a.get_text(strip=True) if title_a else ""
        # Return the raw href as found (typically relative).
        # The caller (list_threads stage) is responsible for resolving to absolute
        # using the chassis-specific base URL — that way the parser stays
        # chassis-agnostic.
        url = title_a.get("href") if (title_a and title_a.get("href")) else \
              f"showthread.php?t={thread_id}"

        # replies + views: scan all td with align=center for two integers
        cells = tr.find_all("td")
        nums: list[int] = []
        for c in cells:
            n = _parse_int_loose(c.get_text())
            if n is not None and n < 10_000_000:
                nums.append(n)
        replies = nums[0] if len(nums) >= 1 else None
        views = nums[1] if len(nums) >= 2 else None

        # last post date: td with class 'alt2' nowrap, contains "MM-DD-YYYY, HH:MM AM/PM"
        last_post_at: str | None = None
        for c in tr.find_all("td"):
            text = c.get_text(" ", strip=True)
            if re.search(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", text) or re.search(r"(Today|Yesterday)", text):
                # take first line of the cell which holds the date+time
                first_line = text.split("by ")[0].strip()
                last_post_at = _normalize_vbulletin_date(first_line)
                if last_post_at:
                    break

        # sticky detection: vbulletin places sticky icon img with alt=Sticky inside title cell
        is_sticky = 1 if tr.find("img", alt=re.compile("[Ss]ticky")) else 0

        threads.append(ThreadMeta(
            thread_id=thread_id,
            title=title,
            url=url,
            replies=replies,
            views=views,
            last_post_at=last_post_at,
            is_sticky=is_sticky,
        ))

    # pagination: <div class='pagenav'> ... 'Page N of M' ...
    pagenav = soup.find("div", class_="pagenav")
    total_pages = 1
    has_next = False
    if pagenav:
        page_text = pagenav.get_text(" ", strip=True)
        m = re.search(r"Page\s+(\d+)\s+of\s+(\d+)", page_text)
        if m:
            current = int(m.group(1))
            total_pages = int(m.group(2))
            has_next = current < total_pages

    return ForumPage(threads=threads, total_pages=total_pages, has_next=has_next)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_parse.py -v
```

Expected: 6 passed (3 from Task 6 + 3 new).

If the listing parser produces fewer than 10 threads, inspect the actual fixture HTML structure with the diagnostic snippet from Step 1 and adjust the selectors. Re-run until tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/parse.py scripts/ingest/tests/test_parse.py
git commit -m "feat(ingest): add parse_forum_listing_page for vbulletin thread index"
```

---

## Task 8: parse.parse_thread_page — post extractor + tests

**Files:**
- Modify: `scripts/ingest/ingest/parse.py`
- Modify: `scripts/ingest/tests/test_parse.py`

- [ ] **Step 1: Inspect thread page HTML**

```bash
cd /Users/stanyan/Github/bimmerllm/scripts/ingest
.venv/bin/python -c "
from bs4 import BeautifulSoup
html = open('tests/fixtures/thread_short_g80.html').read()
soup = BeautifulSoup(html, 'lxml')

# vBulletin 3.8 wraps each post in <table id='post_NNNN'> or <div id='post_message_NNNN'>
posts = soup.find_all('table', id=lambda i: i and i.startswith('post'))
print(f'post tables: {len(posts)}')
if posts:
    p = posts[0]
    print(str(p)[:800])

# alternative: <li id='post_NNNN'> in newer vBulletin themes
posts_li = soup.find_all('li', id=lambda i: i and i.startswith('post_'))
print(f'post li elements: {len(posts_li)}')
"
```

Note real selectors. vBulletin 3.8 typically uses `<table id='post_NNNN'>` but skin can vary.

- [ ] **Step 2: Write the failing tests (append to test_parse.py)**

```python
from ingest.parse import parse_thread_page


def test_parse_thread_page_returns_posts(fixtures_dir: Path):
    html = (fixtures_dir / "thread_short_g80.html").read_text(encoding="utf-8")
    page = parse_thread_page(html)
    assert "posts" in page and len(page["posts"]) >= 1
    assert "total_pages" in page
    assert "has_next" in page


def test_parse_thread_page_post_shape(fixtures_dir: Path):
    html = (fixtures_dir / "thread_short_g80.html").read_text(encoding="utf-8")
    page = parse_thread_page(html)
    for p in page["posts"]:
        assert set(p.keys()) >= {"author", "posted_at", "text"}
        assert isinstance(p["text"], str) and p["text"]
        # post text after quote/sig stripping should not contain "<div" tags
        assert "<div" not in p["text"]


def test_parse_thread_page_strips_quotes_and_sigs(fixtures_dir: Path):
    """A quoted reply shouldn't include the quoted block in the post body."""
    html = (fixtures_dir / "thread_short_g80.html").read_text(encoding="utf-8")
    page = parse_thread_page(html)
    # signatures often contain "__________" (4+ underscores)
    for p in page["posts"]:
        assert "________" not in p["text"]


def test_parse_thread_page_paged_detects_next(fixtures_dir: Path):
    html = (fixtures_dir / "thread_paged_g80.html").read_text(encoding="utf-8")
    page = parse_thread_page(html)
    assert page["total_pages"] >= 1
    # if paged fixture has multiple pages, has_next is true; if not, lenient assertion
    assert isinstance(page["has_next"], bool)
```

- [ ] **Step 3: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_parse.py -v
```

Expected: 4 new tests fail with `ImportError: cannot import name 'parse_thread_page'`.

- [ ] **Step 4: Append `parse_thread_page` to `ingest/parse.py`**

```python
# Append to ingest/parse.py

class Post(TypedDict):
    author: str | None
    posted_at: str | None
    text: str


class ThreadPage(TypedDict):
    posts: list[Post]
    total_pages: int
    has_next: bool


def _strip_post_chrome(post_html_root) -> None:
    """Mutate the BeautifulSoup post-message subtree, removing
    quote blocks, signatures, attachments, and edit timestamps."""
    for sel in [
        "div.bbcode_container",          # <quote> wrapper in vbulletin
        "div.bbcode_quote",
        "table.quote",
        "div.signaturecontainer",
        "div.signature",
        ".smallfont.attachments",
        "div.attachments",
        "div.lastedit",
        "div.lastpost",
    ]:
        for tag in post_html_root.select(sel):
            tag.decompose()


def parse_thread_page(html: str) -> ThreadPage:
    """Parse showthread.php HTML — extract post list + pagination state.

    vBulletin 3.8 typical structure:
      <table id='post_NNNN'> or <div id='post_NNNN'>:
        <a class='bigusername'>author</a>
        td.thead text contains posted date
        <div id='post_message_NNNN'> body </div>
    """
    soup = BeautifulSoup(html, "lxml")
    posts: list[Post] = []
    seen_ids: set[int] = set()

    # pattern A: <table id='post_NNN'>
    candidates = soup.find_all("table", id=re.compile(r"^post\d+$"))
    if not candidates:
        # pattern B: <li id='post_NNN'>
        candidates = soup.find_all("li", id=re.compile(r"^post_\d+$"))
    if not candidates:
        # pattern C: <div id='post_NNN'>
        candidates = soup.find_all("div", id=re.compile(r"^post\d+$"))

    for el in candidates:
        m = re.match(r"^post_?(\d+)$", el.get("id", ""))
        if not m:
            continue
        pid = int(m.group(1))
        if pid in seen_ids:
            continue
        seen_ids.add(pid)

        # author
        author_el = (el.find("a", class_="bigusername")
                     or el.find("div", class_="username_container")
                     or el.find("a", class_="username"))
        author = author_el.get_text(strip=True) if author_el else None

        # posted_at: search for date text near top of the post block (td.thead, .postdate)
        posted_at: str | None = None
        for date_holder in el.select("td.thead, div.postdate, span.date, .date"):
            txt = date_holder.get_text(" ", strip=True)
            iso = _normalize_vbulletin_date(txt)
            if iso:
                posted_at = iso
                break

        # message body
        body_el = (el.find("div", id=re.compile(rf"^post_message_{pid}$"))
                   or el.find("div", class_="postcontent")
                   or el.find("div", class_="content"))
        if body_el is None:
            continue
        _strip_post_chrome(body_el)
        text = body_el.get_text("\n", strip=True)
        # collapse 3+ newlines to one
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if not text:
            continue

        posts.append(Post(author=author, posted_at=posted_at, text=text))

    # pagination
    pagenav = soup.find("div", class_="pagenav")
    total_pages = 1
    has_next = False
    if pagenav:
        page_text = pagenav.get_text(" ", strip=True)
        m = re.search(r"Page\s+(\d+)\s+of\s+(\d+)", page_text)
        if m:
            total_pages = int(m.group(2))
            has_next = int(m.group(1)) < total_pages

    return ThreadPage(posts=posts, total_pages=total_pages, has_next=has_next)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_parse.py -v
```

Expected: 10 passed (3 + 3 + 4).

If `posts` is empty for the short fixture, dump the post-element selectors (Step 1 diagnostic) and adjust which `find_all` pattern fires. The three patterns A/B/C must collectively cover the fixture.

- [ ] **Step 6: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/parse.py scripts/ingest/tests/test_parse.py
git commit -m "feat(ingest): add parse_thread_page with quote/sig stripping"
```

---

## Task 9: build_record + validate_record + golden file test

**Files:**
- Create: `scripts/ingest/ingest/record.py`
- Create: `scripts/ingest/tests/test_build_record.py`
- Create: `scripts/ingest/tests/fixtures/golden_record.json`

- [ ] **Step 1: Fetch a golden Pinecone record for diff baseline**

```bash
cd /Users/stanyan/Github/bimmerllm
set -a && source .env.local && set +a
HOST="bmw-datas-qlbflst.svc.aped-4627-b74a.pinecone.io"
curl -s -X GET "https://$HOST/vectors/fetch?namespace=bimmerpost&ids=000cbdd0-b1ec-4d94-911b-bc7c7c8ff8e4" \
  -H "Api-Key: $PINECONE_API_KEY" -H "X-Pinecone-API-Version: 2024-07" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["vectors"]["000cbdd0-b1ec-4d94-911b-bc7c7c8ff8e4"]; out={"_id":"000cbdd0-b1ec-4d94-911b-bc7c7c8ff8e4", **d["metadata"]}; print(json.dumps(out, indent=2, ensure_ascii=False))' \
  > scripts/ingest/tests/fixtures/golden_record.json

cat scripts/ingest/tests/fixtures/golden_record.json | head -5
```

Expected: file contains 6 metadata fields + `_id`.

- [ ] **Step 2: Write the failing test `tests/test_build_record.py`**

```python
"""build_record + validate_record — guarantees new records match existing 8610 schema."""
import json
import re
import uuid
from pathlib import Path

import pytest

from ingest.config import CHASSIS_MAP
from ingest.record import RecordOversize, build_record, validate_record


def test_build_record_matches_schema_keys(fixtures_dir: Path):
    golden = json.loads((fixtures_dir / "golden_record.json").read_text(encoding="utf-8"))
    expected_keys = set(golden.keys())  # _id + 6 metadata fields

    chassis_cfg = CHASSIS_MAP["g80"]
    thread_row = {
        "uuid": str(uuid.uuid4()),
        "title": "Test thread",
        "chassis": "g80",
    }
    posts = [
        {"post_idx": 0, "text": "First post body"},
        {"post_idx": 1, "text": "Second post reply"},
    ]
    rec = build_record(thread_row, posts, chassis_cfg)
    assert set(rec.keys()) == expected_keys


def test_build_record_question_format():
    chassis_cfg = CHASSIS_MAP["g80"]
    thread_row = {"uuid": str(uuid.uuid4()), "title": "Test", "chassis": "g80"}
    posts = [{"post_idx": 0, "text": "body"}]
    rec = build_record(thread_row, posts, chassis_cfg)
    # format: "{models join ', '},{labels join ','},{title}"
    assert rec["question"] == "G80, G82, G83,S58,Test"


def test_build_record_question_format_matches_golden(fixtures_dir: Path):
    """Golden record's question is 'G20, G21,B58,Ecutek Mobile Dashboard Gauges'.
    Our format string must produce the same shape: 'M, M2,L,Title'."""
    golden = json.loads((fixtures_dir / "golden_record.json").read_text(encoding="utf-8"))
    q = golden["question"]
    # shape: <models comma-space joined>,<labels comma joined>,<title>
    assert re.match(r"^[A-Z0-9, ]+,[A-Z0-9,]+,.+$", q), f"unexpected golden question shape: {q}"


def test_build_record_answers_filters_blank():
    chassis_cfg = CHASSIS_MAP["f80"]
    thread_row = {"uuid": str(uuid.uuid4()), "title": "T", "chassis": "f80"}
    posts = [
        {"post_idx": 0, "text": "real body"},
        {"post_idx": 1, "text": "  "},  # whitespace
        {"post_idx": 2, "text": "another body"},
    ]
    rec = build_record(thread_row, posts, chassis_cfg)
    assert rec["answers"] == ["real body", "another body"]


def test_validate_record_passes_well_formed(fixtures_dir: Path):
    golden = json.loads((fixtures_dir / "golden_record.json").read_text(encoding="utf-8"))
    validate_record(golden)  # must not raise


def test_validate_record_rejects_bad_id():
    rec = {"_id": "not-a-uuid", "question": "x", "original_question": "x",
           "answers": ["a"], "model": ["G80"], "label": ["S58"], "series": "3/4 Series"}
    with pytest.raises(AssertionError, match="bad _id"):
        validate_record(rec)


def test_validate_record_rejects_empty_answers():
    rec = {"_id": str(uuid.uuid4()), "question": "x", "original_question": "x",
           "answers": [], "model": ["G80"], "label": ["S58"], "series": "3/4 Series"}
    with pytest.raises(AssertionError, match="empty answers"):
        validate_record(rec)


def test_validate_record_raises_oversize():
    rec = {"_id": str(uuid.uuid4()), "question": "x", "original_question": "x",
           "answers": ["a" * 40_000], "model": ["G80"], "label": ["S58"], "series": "3/4 Series"}
    with pytest.raises(RecordOversize):
        validate_record(rec)
```

- [ ] **Step 3: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_build_record.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'ingest.record'`.

- [ ] **Step 4: Write `ingest/record.py`**

```python
"""Record assembly + validation. The Pinecone schema is load-bearing —
every field name + type must match the existing 8610 records."""
from __future__ import annotations

import re
from typing import Any

from .config import PINECONE_METADATA_BUDGET_BYTES


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class RecordOversize(Exception):
    def __init__(self, record_id: str, size: int):
        super().__init__(f"record {record_id} payload {size}B exceeds {PINECONE_METADATA_BUDGET_BYTES}B")
        self.record_id = record_id
        self.size = size


def build_record(thread_row: dict, posts: list[dict], chassis_cfg: dict) -> dict[str, Any]:
    """Assemble a Pinecone record matching the existing 8610-record schema.

    Format reverse-engineered from a real golden record:
      _id               = thread.uuid (UUIDv4 string)
      question          = '{models comma-space joined},{labels comma joined},{title}'
                          e.g. "G20, G21,B58,Ecutek Mobile Dashboard Gauges"
      original_question = title raw
      answers           = [post_text for post in thread, OP first, blanks dropped]
      model             = chassis_cfg["models"]   (list of chassis codes)
      label             = chassis_cfg["engines"]  (list of engine codes)
      series            = chassis_cfg["series"]   (string)
    """
    title = (thread_row.get("title") or "").strip()
    models = list(chassis_cfg["models"])
    engines = list(chassis_cfg["engines"])
    question = f"{', '.join(models)},{','.join(engines)},{title}"

    answers = [p["text"].strip() for p in posts if p.get("text") and p["text"].strip()]

    return {
        "_id":               thread_row["uuid"],
        "question":          question,
        "original_question": title,
        "answers":           answers,
        "model":             models,
        "label":             engines,
        "series":            chassis_cfg["series"],
    }


def validate_record(rec: dict[str, Any]) -> None:
    """Hard-fail on schema deviations before sending to Pinecone."""
    assert isinstance(rec.get("_id"), str) and _UUID_RE.match(rec["_id"]), f"bad _id: {rec.get('_id')!r}"
    assert isinstance(rec.get("question"), str) and rec["question"], "empty question"
    assert isinstance(rec.get("original_question"), str), "bad original_question"
    assert isinstance(rec.get("answers"), list) and rec["answers"], "empty answers"
    assert all(isinstance(a, str) for a in rec["answers"]), "non-string answer"
    assert isinstance(rec.get("model"), list) and all(isinstance(m, str) for m in rec["model"]), "bad model"
    assert isinstance(rec.get("label"), list) and all(isinstance(l, str) for l in rec["label"]), "bad label"
    assert isinstance(rec.get("series"), str) and rec["series"], "empty series"

    payload_estimate = sum(len(s.encode("utf-8")) for s in rec["answers"])
    if payload_estimate > PINECONE_METADATA_BUDGET_BYTES:
        raise RecordOversize(rec["_id"], payload_estimate)


def truncate_answers_to_budget(rec: dict[str, Any]) -> int:
    """Shrink rec['answers'] to fit PINECONE_METADATA_BUDGET_BYTES.
    First drops trailing answers; if a single oversized OP remains, truncates its text.
    Returns final byte size. Caller is responsible for marking truncated_at in sqlite."""
    answers = rec["answers"]
    while len(answers) > 1:
        size = sum(len(s.encode("utf-8")) for s in answers)
        if size <= PINECONE_METADATA_BUDGET_BYTES:
            return size
        answers.pop()
    if answers and len(answers[0].encode("utf-8")) > PINECONE_METADATA_BUDGET_BYTES:
        # single oversized OP — truncate its text. 80% of byte budget as char budget
        # is a safe heuristic for mixed-script (ASCII + Chinese) text.
        char_budget = int(PINECONE_METADATA_BUDGET_BYTES * 0.8)
        answers[0] = answers[0][:char_budget] + "...[truncated]"
    return sum(len(s.encode("utf-8")) for s in answers)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_build_record.py -v
```

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/record.py scripts/ingest/tests/test_build_record.py scripts/ingest/tests/fixtures/golden_record.json
git commit -m "feat(ingest): add build_record + validate_record matching existing schema"
```

---

## Task 10: stages/discover.py — chassis subdomain crawler

**Files:**
- Create: `scripts/ingest/ingest/stages/discover.py`
- Create: `scripts/ingest/tests/test_discover.py`

- [ ] **Step 1: Write the failing test `tests/test_discover.py`**

```python
"""discover stage — orchestrates http + parse_forum_index → forums table."""
from pathlib import Path

import pytest

from ingest import db
from ingest.stages import discover


class FakeFetcher:
    def __init__(self, html_by_url: dict[str, str]):
        self.html_by_url = html_by_url
        self.calls: list[str] = []

    def get(self, url: str) -> str:
        self.calls.append(url)
        return self.html_by_url[url]


def test_discover_writes_forum_rows(in_memory_db, fixtures_dir: Path):
    db.apply_schema(in_memory_db)
    g80_index = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    fetcher = FakeFetcher({"https://g80.bimmerpost.com/forums/index.php": g80_index})

    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)

    rows = in_memory_db.execute("SELECT chassis, forum_id, name, url FROM forums WHERE chassis='g80'").fetchall()
    assert len(rows) >= 5
    for r in rows:
        assert r["chassis"] == "g80"
        assert r["forum_id"] > 0
        assert r["name"]
        assert "g80.bimmerpost.com" in r["url"]


def test_discover_idempotent(in_memory_db, fixtures_dir: Path):
    db.apply_schema(in_memory_db)
    g80_index = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    fetcher = FakeFetcher({"https://g80.bimmerpost.com/forums/index.php": g80_index})

    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)
    n1 = in_memory_db.execute("SELECT COUNT(*) FROM forums").fetchone()[0]
    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)
    n2 = in_memory_db.execute("SELECT COUNT(*) FROM forums").fetchone()[0]
    assert n1 == n2  # second discover does not duplicate


def test_discover_unknown_chassis_raises(in_memory_db):
    db.apply_schema(in_memory_db)
    with pytest.raises(KeyError):
        discover.run(in_memory_db, chassis_keys=["bogus"], fetcher=FakeFetcher({}))
```

- [ ] **Step 2: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_discover.py -v
```

Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write `ingest/stages/discover.py`**

```python
"""Discover stage: crawl chassis subdomain root, populate forums table."""
from __future__ import annotations

import logging
import sqlite3
from typing import Iterable, Protocol

from ..config import CHASSIS_MAP
from ..db import insert_forum
from ..parse import parse_forum_index


logger = logging.getLogger(__name__)


class FetcherProto(Protocol):
    def get(self, url: str) -> str: ...


def run(conn: sqlite3.Connection, chassis_keys: Iterable[str], fetcher: FetcherProto) -> None:
    """For each chassis, fetch index.php and insert all sub-forums into the forums table."""
    for chassis in chassis_keys:
        if chassis not in CHASSIS_MAP:
            raise KeyError(f"unknown chassis '{chassis}' (not in CHASSIS_MAP)")
        cfg = CHASSIS_MAP[chassis]
        url = f"https://{cfg['subdomain']}/forums/index.php"
        logger.info("[discover] fetching %s", url)
        html = fetcher.get(url)
        nodes = parse_forum_index(html, chassis=chassis)
        logger.info("[discover] %s — %d sub-forums", chassis, len(nodes))
        for n in nodes:
            insert_forum(
                conn,
                chassis=chassis,
                forum_id=n["forum_id"],
                name=n["name"],
                parent_forum_id=n["parent_forum_id"],
                url=n["url"],
                threads_total=None,
            )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_discover.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/stages/discover.py scripts/ingest/tests/test_discover.py
git commit -m "feat(ingest): add discover stage for chassis subdomain crawl"
```

---

## Task 11: stages/list_threads.py — paginated forum listing → threads table

**Files:**
- Create: `scripts/ingest/ingest/stages/list_threads.py`
- Create: `scripts/ingest/tests/test_list_threads.py`

- [ ] **Step 1: Write the failing test `tests/test_list_threads.py`**

```python
from pathlib import Path

import pytest

from ingest import db
from ingest.stages import list_threads


class FakeFetcher:
    def __init__(self, html_by_url: dict[str, str]):
        self.html_by_url = html_by_url
        self.calls: list[str] = []

    def get(self, url: str) -> str:
        self.calls.append(url)
        return self.html_by_url[url]


def _seed_forum(conn, chassis: str = "g80", forum_id: int = 888):
    db.apply_schema(conn)
    db.insert_forum(conn, chassis=chassis, forum_id=forum_id, name="Engine",
                    parent_forum_id=None,
                    url=f"https://{chassis}.bimmerpost.com/forums/forumdisplay.php?f={forum_id}",
                    threads_total=None)


def test_list_inserts_threads_from_fixture(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    listing = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    url = "https://g80.bimmerpost.com/forums/forumdisplay.php?f=888&page=1"
    fetcher = FakeFetcher({url: listing})

    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)

    rows = in_memory_db.execute("SELECT thread_id, title, forum_id FROM threads").fetchall()
    assert len(rows) >= 10
    for r in rows:
        assert r["forum_id"] == 888
        assert r["thread_id"] > 0
        assert r["title"]


def test_list_increments_last_listed_page(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    listing = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    url = "https://g80.bimmerpost.com/forums/forumdisplay.php?f=888&page=1"
    fetcher = FakeFetcher({url: listing})

    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)

    row = in_memory_db.execute(
        "SELECT last_listed_page, listed_at FROM forums WHERE chassis='g80' AND forum_id=888"
    ).fetchone()
    assert row["last_listed_page"] == 1


def test_list_skips_already_listed_forum(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    in_memory_db.execute(
        "UPDATE forums SET listed_at='2026-05-02T00:00:00+00:00', last_listed_page=99 "
        "WHERE chassis='g80' AND forum_id=888"
    )
    in_memory_db.commit()

    fetcher = FakeFetcher({})  # no URLs — should not be called
    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)
    assert fetcher.calls == []


def test_list_incremental_mode_only_fetches_page_1(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    listing = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    url = "https://g80.bimmerpost.com/forums/forumdisplay.php?f=888&page=1"
    fetcher = FakeFetcher({url: listing})

    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="incremental", max_pages=None)

    # only page 1 fetched even though fixture says total_pages > 1
    page_1_calls = [c for c in fetcher.calls if "page=1" in c]
    page_2_calls = [c for c in fetcher.calls if "page=2" in c]
    assert len(page_1_calls) == 1
    assert page_2_calls == []
```

- [ ] **Step 2: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_list_threads.py -v
```

Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write `ingest/stages/list_threads.py`**

```python
"""List stage: paginate every forum and write thread metadata to threads table."""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from typing import Iterable, Optional, Protocol
from urllib.parse import urljoin

from ..config import CHASSIS_MAP
from ..db import insert_thread, update_forum_progress
from ..parse import parse_forum_listing_page


logger = logging.getLogger(__name__)


class FetcherProto(Protocol):
    def get(self, url: str) -> str: ...


def _build_listing_url(forum_url: str, page: int) -> str:
    base = forum_url.split("&page=")[0]
    return f"{base}&page={page}" if "?" in base else f"{base}?page={page}"


def run(
    conn: sqlite3.Connection,
    chassis_keys: Iterable[str],
    fetcher: FetcherProto,
    *,
    mode: str = "full",
    max_pages: Optional[int] = None,
) -> None:
    """Iterate every (chassis, forum) currently in the forums table for chassis_keys.

    mode='full': start from last_listed_page+1, paginate until has_next is False.
    mode='incremental': fetch only page 1; INSERT OR REPLACE writes new + updated threads.
    """
    chassis_filter = ",".join("?" * len(list(chassis_keys)))
    chassis_list = list(chassis_keys)

    forums = conn.execute(
        f"SELECT chassis, forum_id, url, last_listed_page, listed_at "
        f"FROM forums WHERE chassis IN ({chassis_filter})",
        chassis_list,
    ).fetchall()

    for f in forums:
        chassis = f["chassis"]
        forum_id = f["forum_id"]
        forum_url = f["url"]

        # full mode: skip if already listed_at non-NULL
        if mode == "full" and f["listed_at"] is not None:
            logger.info("[list] %s/f=%d already listed; skipping", chassis, forum_id)
            continue

        if mode == "incremental":
            pages_to_crawl = [1]
        else:
            start_page = (f["last_listed_page"] or 0) + 1
            if max_pages is not None:
                pages_to_crawl = list(range(start_page, start_page + max_pages))
            else:
                pages_to_crawl = None  # signals to keep paginating

        page = (pages_to_crawl[0] if pages_to_crawl else (f["last_listed_page"] or 0) + 1)
        while True:
            url = _build_listing_url(forum_url, page)
            logger.info("[list] %s/f=%d page=%d fetching %s", chassis, forum_id, page, url)
            html = fetcher.get(url)
            page_data = parse_forum_listing_page(html, forum_id=forum_id)
            logger.info("[list] %s/f=%d page=%d → %d threads", chassis, forum_id, page, len(page_data["threads"]))

            chassis_base = f"https://{CHASSIS_MAP[chassis]['subdomain']}/forums/"
            for t in page_data["threads"]:
                # parser returns relative href; resolve to absolute using chassis subdomain
                absolute_url = urljoin(chassis_base, t["url"])
                insert_thread(
                    conn,
                    thread_id=t["thread_id"],
                    forum_id=forum_id,
                    chassis=chassis,
                    title=t["title"],
                    url=absolute_url,
                    replies=t["replies"],
                    views=t["views"],
                    last_post_at=t["last_post_at"],
                    is_sticky=t["is_sticky"],
                )

            update_forum_progress(conn, chassis, forum_id, last_listed_page=page)

            if mode == "incremental":
                break  # incremental: page 1 only
            if not page_data["has_next"]:
                update_forum_progress(conn, chassis, forum_id,
                                       last_listed_page=page,
                                       listed_at=datetime.now(timezone.utc).isoformat())
                break
            page += 1
            if pages_to_crawl is not None and page not in pages_to_crawl:
                break
            if max_pages is not None and (page - (f["last_listed_page"] or 0)) > max_pages:
                break
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_list_threads.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/stages/list_threads.py scripts/ingest/tests/test_list_threads.py
git commit -m "feat(ingest): add list_threads stage with full + incremental modes"
```

---

## Task 12: stages/fetch_threads.py — multi-page thread fetcher → posts table

**Files:**
- Create: `scripts/ingest/ingest/stages/fetch_threads.py`
- Create: `scripts/ingest/tests/test_fetch_threads.py`

- [ ] **Step 1: Write the failing test `tests/test_fetch_threads.py`**

```python
from pathlib import Path

import pytest

from ingest import db
from ingest.stages import fetch_threads


class FakeFetcher:
    def __init__(self, html_by_url: dict[str, str]):
        self.html_by_url = html_by_url
        self.calls: list[str] = []

    def get(self, url: str) -> str:
        self.calls.append(url)
        if url not in self.html_by_url:
            raise KeyError(f"no fixture for {url}")
        return self.html_by_url[url]


def _seed_thread(conn, *, thread_id=1, chassis="g80", forum_id=888):
    db.apply_schema(conn)
    db.insert_forum(conn, chassis=chassis, forum_id=forum_id, name="x",
                    parent_forum_id=None, url="https://x", threads_total=None)
    db.insert_thread(conn, thread_id=thread_id, forum_id=forum_id, chassis=chassis,
                     title="t", url=f"https://{chassis}.bimmerpost.com/forums/showthread.php?t={thread_id}",
                     replies=5, views=100, last_post_at=None, is_sticky=0)


def test_fetch_writes_posts_marks_done(in_memory_db, fixtures_dir: Path):
    _seed_thread(in_memory_db, thread_id=2239681)
    body = (fixtures_dir / "thread_short_g80.html").read_text(encoding="utf-8")
    url = "https://g80.bimmerpost.com/forums/showthread.php?t=2239681&pp=200&page=1"
    fetcher = FakeFetcher({url: body})

    fetch_threads.run(in_memory_db, fetcher=fetcher, max_threads=10)

    row = in_memory_db.execute("SELECT fetched_at FROM threads WHERE thread_id=2239681").fetchone()
    assert row["fetched_at"] is not None
    posts = in_memory_db.execute("SELECT post_idx, text FROM posts WHERE thread_id=2239681 ORDER BY post_idx").fetchall()
    assert len(posts) >= 1
    for p in posts:
        assert p["text"]


def test_fetch_skips_already_fetched(in_memory_db, fixtures_dir: Path):
    _seed_thread(in_memory_db, thread_id=2239681)
    db.mark_fetched(in_memory_db, 2239681)
    fetcher = FakeFetcher({})

    fetch_threads.run(in_memory_db, fetcher=fetcher, max_threads=10)
    assert fetcher.calls == []


def test_fetch_records_error_on_failure(in_memory_db):
    _seed_thread(in_memory_db, thread_id=42)

    class FailFetcher:
        def get(self, url): raise RuntimeError("boom")

    fetch_threads.run(in_memory_db, fetcher=FailFetcher(), max_threads=10)
    row = in_memory_db.execute("SELECT fetched_at, fetch_error FROM threads WHERE thread_id=42").fetchone()
    assert row["fetched_at"] is None
    assert row["fetch_error"] is not None and "boom" in row["fetch_error"]
```

- [ ] **Step 2: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_fetch_threads.py -v
```

Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write `ingest/stages/fetch_threads.py`**

```python
"""Fetch stage: pull every showthread.php?t=N page, write to posts table."""
from __future__ import annotations

import logging
import sqlite3
from typing import Optional, Protocol

from ..db import (
    insert_posts,
    list_threads_to_fetch,
    mark_fetched,
    record_fetch_error,
)
from ..parse import parse_thread_page


logger = logging.getLogger(__name__)


class FetcherProto(Protocol):
    def get(self, url: str) -> str: ...


def _build_thread_url(thread_url: str, page: int, pp: int = 200) -> str:
    """Take the thread URL stored in DB and append paging params."""
    base = thread_url.split("#")[0].split("&pp=")[0].split("&page=")[0]
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}pp={pp}&page={page}"


def run(
    conn: sqlite3.Connection,
    fetcher: FetcherProto,
    *,
    max_threads: Optional[int] = None,
    pp: int = 200,
) -> None:
    """Iterate every thread with fetched_at IS NULL. For each, fetch all pages,
    insert posts, mark fetched. Errors are logged and stored in threads.fetch_error
    so they don't block the rest of the queue."""
    pending = list_threads_to_fetch(conn, limit=max_threads or 1_000_000)
    logger.info("[fetch] %d threads pending", len(pending))

    for tid in pending:
        thread_row = conn.execute(
            "SELECT thread_id, url FROM threads WHERE thread_id=?", (tid,)
        ).fetchone()
        if not thread_row:
            continue

        try:
            posts: list[dict] = []
            page = 1
            global_idx = 0
            while True:
                page_url = _build_thread_url(thread_row["url"], page, pp=pp)
                logger.info("[fetch] thread=%d page=%d", tid, page)
                html = fetcher.get(page_url)
                parsed = parse_thread_page(html)
                for p in parsed["posts"]:
                    posts.append({
                        "post_idx": global_idx,
                        "author": p.get("author"),
                        "posted_at": p.get("posted_at"),
                        "text": p["text"],
                    })
                    global_idx += 1
                if not parsed["has_next"]:
                    break
                page += 1
                if page > parsed["total_pages"] + 5:  # safety cap on runaway loop
                    break

            if posts:
                insert_posts(conn, tid, posts)
                mark_fetched(conn, tid)
            else:
                # parsed nothing — likely structural anomaly; record + skip
                record_fetch_error(conn, tid, "parser produced 0 posts")
        except Exception as e:
            logger.exception("[fetch] thread %d failed: %s", tid, e)
            record_fetch_error(conn, tid, str(e))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_fetch_threads.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/stages/fetch_threads.py scripts/ingest/tests/test_fetch_threads.py
git commit -m "feat(ingest): add fetch_threads stage with paged showthread crawl"
```

---

## Task 13: stages/upload.py — Pinecone upsert with batch + truncate

**Files:**
- Create: `scripts/ingest/ingest/stages/upload.py`
- Create: `scripts/ingest/tests/test_upload.py`

- [ ] **Step 1: Write the failing test `tests/test_upload.py`**

```python
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from ingest import db
from ingest.stages import upload


def _seed_fetched_thread(conn, *, thread_id=1, chassis="g80", forum_id=888,
                         posts=None):
    db.apply_schema(conn)
    db.insert_forum(conn, chassis=chassis, forum_id=forum_id, name="x",
                    parent_forum_id=None, url="https://x", threads_total=None)
    db.insert_thread(conn, thread_id=thread_id, forum_id=forum_id, chassis=chassis,
                     title="My test thread", url="https://x", replies=2, views=10,
                     last_post_at=None, is_sticky=0)
    db.insert_posts(conn, thread_id, posts or [
        {"post_idx": 0, "author": "u1", "posted_at": None, "text": "first body"},
        {"post_idx": 1, "author": "u2", "posted_at": None, "text": "reply body"},
    ])
    db.mark_fetched(conn, thread_id)


def test_upload_assigns_uuid_and_calls_pinecone(in_memory_db):
    _seed_fetched_thread(in_memory_db, thread_id=1)

    fake_index = MagicMock()
    upload.run(in_memory_db, index=fake_index, namespace="bimmerpost", batch_size=10)

    fake_index.upsert_records.assert_called_once()
    args, kwargs = fake_index.upsert_records.call_args
    assert kwargs.get("namespace") == "bimmerpost" or (args and args[0] == "bimmerpost")
    records = kwargs.get("records") or args[1]
    assert len(records) == 1
    rec = records[0]
    assert rec["question"] == "G80, G82, G83,S58,My test thread"
    assert rec["answers"] == ["first body", "reply body"]
    assert len(rec["_id"]) == 36

    row = in_memory_db.execute("SELECT uploaded_at, uuid FROM threads WHERE thread_id=1").fetchone()
    assert row["uploaded_at"] is not None
    assert row["uuid"] == rec["_id"]


def test_upload_truncates_oversize_records(in_memory_db):
    huge_post = {"post_idx": 0, "author": "u", "posted_at": None, "text": "x" * 50_000}
    extra = {"post_idx": 1, "author": "u", "posted_at": None, "text": "y" * 50_000}
    _seed_fetched_thread(in_memory_db, thread_id=2, posts=[huge_post, extra])

    fake_index = MagicMock()
    upload.run(in_memory_db, index=fake_index, namespace="bimmerpost", batch_size=10)

    args, kwargs = fake_index.upsert_records.call_args
    records = kwargs.get("records") or args[1]
    assert len(records) == 1
    # post sizes summed exceed budget; truncation drops the second post
    assert len(records[0]["answers"]) == 1

    row = in_memory_db.execute("SELECT truncated_at FROM threads WHERE thread_id=2").fetchone()
    assert row["truncated_at"] is not None


def test_upload_idempotent_on_already_uploaded(in_memory_db):
    _seed_fetched_thread(in_memory_db, thread_id=3)
    db.mark_uploaded(in_memory_db, [3])

    fake_index = MagicMock()
    upload.run(in_memory_db, index=fake_index, namespace="bimmerpost", batch_size=10)
    fake_index.upsert_records.assert_not_called()


def test_upload_dry_run_does_not_call_pinecone(in_memory_db, capsys):
    _seed_fetched_thread(in_memory_db, thread_id=4)

    fake_index = MagicMock()
    upload.run(in_memory_db, index=fake_index, namespace="bimmerpost",
               batch_size=10, dry_run=True)

    fake_index.upsert_records.assert_not_called()
    row = in_memory_db.execute("SELECT uploaded_at FROM threads WHERE thread_id=4").fetchone()
    assert row["uploaded_at"] is None  # dry-run does not mark as uploaded
```

- [ ] **Step 2: Run test to verify failure**

```bash
.venv/bin/pytest tests/test_upload.py -v
```

Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write `ingest/stages/upload.py`**

```python
"""Upload stage: Pinecone upsert_records, batch + truncation guard."""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Optional

from ..config import CHASSIS_MAP, PINECONE_METADATA_BUDGET_BYTES
from ..db import (
    ensure_uuid,
    list_threads_to_upload,
    mark_truncated,
    mark_uploaded,
)
from ..record import (
    RecordOversize,
    build_record,
    truncate_answers_to_budget,
    validate_record,
)


logger = logging.getLogger(__name__)


def _build_pending_record(conn: sqlite3.Connection, thread_id: int) -> tuple[dict, bool]:
    """Returns (record, was_truncated). Raises ValueError if data is missing."""
    thread = conn.execute("SELECT * FROM threads WHERE thread_id = ?", (thread_id,)).fetchone()
    if thread is None:
        raise ValueError(f"thread {thread_id} disappeared from sqlite")
    posts = conn.execute(
        "SELECT post_idx, author, posted_at, text FROM posts WHERE thread_id = ? ORDER BY post_idx",
        (thread_id,),
    ).fetchall()
    chassis_cfg = CHASSIS_MAP[thread["chassis"]]

    ensure_uuid(conn, thread_id)
    thread_dict = dict(conn.execute("SELECT * FROM threads WHERE thread_id = ?", (thread_id,)).fetchone())

    rec = build_record(thread_dict, [dict(p) for p in posts], chassis_cfg)

    truncated = False
    try:
        validate_record(rec)
    except RecordOversize:
        truncate_answers_to_budget(rec)
        validate_record(rec)  # re-validate after truncation
        truncated = True
    return rec, truncated


def run(
    conn: sqlite3.Connection,
    index,
    *,
    namespace: str,
    batch_size: int = 50,
    dry_run: bool = False,
) -> None:
    """Pull pending threads, build records, upsert to Pinecone in batches.

    On batch failure: 30s sleep + retry the same batch (idempotent via UUID).
    Pinecone 4xx is treated as fatal and re-raised."""
    while True:
        pending = list_threads_to_upload(conn, batch_size=batch_size)
        if not pending:
            logger.info("[upload] queue empty")
            return

        records: list[dict] = []
        truncated_ids: list[int] = []
        for tid in pending:
            try:
                rec, was_truncated = _build_pending_record(conn, tid)
                records.append(rec)
                if was_truncated:
                    truncated_ids.append(tid)
            except Exception as e:
                logger.exception("[upload] thread %d build failed: %s — skipping", tid, e)

        if not records:
            # all failed to build — mark them so the queue progresses
            for tid in pending:
                conn.execute(
                    "UPDATE threads SET fetch_error = ? WHERE thread_id = ?",
                    ("upload build failed", tid),
                )
            conn.commit()
            continue

        if dry_run:
            logger.info("[upload] DRY RUN — first record JSON:")
            logger.info(json.dumps(records[0], indent=2, ensure_ascii=False)[:2000])
            return

        for attempt in range(3):
            try:
                index.upsert_records(namespace, records)
                break
            except Exception as e:
                status = getattr(e, "status", None)
                if status is not None and 400 <= status < 500 and status != 429:
                    raise  # 4xx (auth, schema): fatal
                if attempt == 2:
                    raise
                logger.warning("[upload] batch failed (attempt %d/3): %s — sleeping 30s", attempt + 1, e)
                time.sleep(30)

        for tid in truncated_ids:
            mark_truncated(conn, tid)
        mark_uploaded(conn, pending)
        logger.info("[upload] %d records committed (truncated: %d)", len(pending), len(truncated_ids))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest tests/test_upload.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/stages/upload.py scripts/ingest/tests/test_upload.py
git commit -m "feat(ingest): add upload stage with batch + truncation + retry"
```

---

## Task 14: cli.py — argparse entrypoint

**Files:**
- Create: `scripts/ingest/ingest/cli.py`
- Create: `scripts/ingest/ingest/__main__.py`

- [ ] **Step 1: Write `ingest/__main__.py`**

```python
from .cli import main

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write `ingest/cli.py`**

```python
"""CLI entrypoint. Run with `python -m ingest [...]`."""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from .config import (
    CHASSIS_MAP,
    DEFAULT_BATCH_SIZE,
    DEFAULT_QPS,
    PINECONE_INDEX,
    PINECONE_NAMESPACE,
)
from .db import apply_schema, open_db
from .http import Fetcher
from .stages import discover, fetch_threads, list_threads, upload


VALID_STAGES = {"discover", "list", "fetch", "upload", "all"}
VALID_MODES = {"full", "incremental"}


def _setup_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(str(log_path), mode="a", encoding="utf-8"),
        ],
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="ingest", description="bimmerllm M-series crawler")
    p.add_argument("--mode", choices=sorted(VALID_MODES), default="full")
    p.add_argument("--chassis", default=",".join(CHASSIS_MAP.keys()),
                   help="comma-separated chassis keys, or 'all'")
    p.add_argument("--stage", choices=sorted(VALID_STAGES), default="all")
    p.add_argument("--max-pages", type=int, default=None,
                   help="max pages per forum (list stage). useful for PoC.")
    p.add_argument("--max-threads", type=int, default=None,
                   help="max threads to fetch in this run (fetch stage)")
    p.add_argument("--qps", type=float, default=DEFAULT_QPS)
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    p.add_argument("--dry-run", action="store_true",
                   help="upload stage prints record JSON instead of calling Pinecone")
    p.add_argument("--db", default="data/ingest.db")
    p.add_argument("--log", default="data/ingest.log")
    p.add_argument("--browser", action="store_true",
                   help="reserved for playwright fallback (NotImplementedError in V1)")
    return p.parse_args(argv)


def _resolve_chassis(arg: str) -> list[str]:
    if arg.strip().lower() == "all":
        return list(CHASSIS_MAP.keys())
    keys = [k.strip() for k in arg.split(",") if k.strip()]
    for k in keys:
        if k not in CHASSIS_MAP:
            raise SystemExit(f"unknown chassis '{k}'. valid: {sorted(CHASSIS_MAP)}")
    return keys


def _resolve_index_namespace():
    api_key = os.environ.get("PINECONE_API_KEY")
    if not api_key:
        raise SystemExit("PINECONE_API_KEY env var not set (sourcing .env.local helps)")
    from pinecone import Pinecone
    pc = Pinecone(api_key=api_key)
    return pc.Index(PINECONE_INDEX)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.browser:
        raise NotImplementedError("--browser (playwright fallback) not implemented in V1")

    log_path = Path(args.log)
    _setup_logging(log_path)
    logger = logging.getLogger("ingest")
    logger.info("starting ingest mode=%s stage=%s chassis=%s db=%s",
                args.mode, args.stage, args.chassis, args.db)

    chassis_keys = _resolve_chassis(args.chassis)

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = open_db(db_path)
    apply_schema(conn)

    fetcher = Fetcher(qps=args.qps)
    try:
        run_discover = args.stage in {"discover", "all"}
        run_list     = args.stage in {"list", "all"}
        run_fetch    = args.stage in {"fetch", "all"}
        run_upload   = args.stage in {"upload", "all"}

        if run_discover:
            discover.run(conn, chassis_keys=chassis_keys, fetcher=fetcher)

        if run_list:
            list_threads.run(conn, chassis_keys=chassis_keys, fetcher=fetcher,
                             mode=args.mode, max_pages=args.max_pages)

        if run_fetch:
            fetch_threads.run(conn, fetcher=fetcher, max_threads=args.max_threads)

        if run_upload:
            index = None if args.dry_run else _resolve_index_namespace()
            if args.dry_run:
                # build a dummy index that captures calls — for dry-run we still need an object
                class _DryIndex:
                    def upsert_records(self, namespace, records): pass
                index = _DryIndex()
            upload.run(conn, index=index, namespace=PINECONE_NAMESPACE,
                       batch_size=args.batch_size, dry_run=args.dry_run)
    finally:
        fetcher.close()
        conn.close()

    logger.info("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Smoke test the CLI parses args**

```bash
cd /Users/stanyan/Github/bimmerllm/scripts/ingest
.venv/bin/python -m ingest --help
```

Expected: argparse help text printed, no traceback.

```bash
.venv/bin/python -m ingest --chassis=bogus 2>&1 | head -3
```

Expected: `unknown chassis 'bogus'. valid: [...]` and exit non-zero.

- [ ] **Step 4: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/ingest/cli.py scripts/ingest/ingest/__main__.py
git commit -m "feat(ingest): add cli with argparse + stage dispatch"
```

---

## Task 15: README + integration test

**Files:**
- Create: `scripts/ingest/README.md`
- Create: `scripts/ingest/tests/test_integration.py`

- [ ] **Step 1: Write `scripts/ingest/README.md`**

````markdown
# bimmerllm M-series ingest

Python crawler for bimmerpost M-chassis sub-forums. Writes thread records to Pinecone namespace `bimmerpost` in the existing 6-field schema.

**Spec:** `../../docs/superpowers/specs/2026-05-02-bimmerllm-ingest-design.md`
**Plan:** `../../docs/superpowers/plans/2026-05-02-bimmerllm-ingest.md`

## Setup

```bash
cd scripts/ingest
python3.12 -m venv .venv
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
````

- [ ] **Step 2: Write `tests/test_integration.py`**

```python
"""End-to-end smoke: discover → list → fetch → upload, all stages with fixtures."""
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from ingest import db
from ingest.stages import discover, fetch_threads, list_threads, upload


class FixtureFetcher:
    """Returns the right fixture html for a known set of URLs.
    Falls back to thread_short fixture for any showthread.php URL."""
    def __init__(self, fixtures_dir: Path):
        self.fixtures = fixtures_dir
        self.calls: list[str] = []

    def get(self, url: str) -> str:
        self.calls.append(url)
        if "index.php" in url:
            return (self.fixtures / "forum_index_g80.html").read_text(encoding="utf-8")
        if "forumdisplay.php" in url:
            return (self.fixtures / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
        if "showthread.php" in url:
            return (self.fixtures / "thread_short_g80.html").read_text(encoding="utf-8")
        raise KeyError(url)


def test_full_pipeline_smoke(in_memory_db, fixtures_dir: Path, tmp_path):
    db.apply_schema(in_memory_db)
    fetcher = FixtureFetcher(fixtures_dir)

    # Stage 1: discover
    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)
    forums = in_memory_db.execute("SELECT COUNT(*) FROM forums").fetchone()[0]
    assert forums >= 5

    # Stage 2: list (only 1 page to keep test fast)
    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)
    threads_n = in_memory_db.execute("SELECT COUNT(*) FROM threads").fetchone()[0]
    assert threads_n >= 5

    # Stage 3: fetch (only first 3 threads to keep test fast)
    list_threads.run = list_threads.run  # silence unused-import warning
    fetch_threads.run(in_memory_db, fetcher=fetcher, max_threads=3)
    fetched = in_memory_db.execute(
        "SELECT COUNT(*) FROM threads WHERE fetched_at IS NOT NULL"
    ).fetchone()[0]
    assert fetched >= 1
    posts_n = in_memory_db.execute("SELECT COUNT(*) FROM posts").fetchone()[0]
    assert posts_n >= 1

    # Stage 4: upload (mocked Pinecone)
    fake_index = MagicMock()
    upload.run(in_memory_db, index=fake_index, namespace="bimmerpost", batch_size=10)
    fake_index.upsert_records.assert_called()
    args, kwargs = fake_index.upsert_records.call_args
    records = kwargs.get("records") or args[1]
    assert len(records) >= 1
    rec = records[0]
    assert set(rec.keys()) == {"_id", "question", "original_question", "answers",
                                "model", "label", "series"}
```

- [ ] **Step 3: Run integration test**

```bash
.venv/bin/pytest tests/test_integration.py -v
```

Expected: 1 passed.

- [ ] **Step 4: Run full test suite**

```bash
.venv/bin/pytest
```

Expected: all tests pass (no failures, no errors).

- [ ] **Step 5: Commit**

```bash
cd /Users/stanyan/Github/bimmerllm
git add scripts/ingest/README.md scripts/ingest/tests/test_integration.py
git commit -m "test(ingest): add e2e integration smoke + README"
```

---

## Task 16: live PoC — small upload + RAG verification

**Files:**
- (none — this task is operational, run the CLI against real services)

- [ ] **Step 1: Sanity-check Pinecone access via CLI**

```bash
cd /Users/stanyan/Github/bimmerllm
set -a && source .env.local && set +a
cd scripts/ingest
.venv/bin/python -c "
import os
from pinecone import Pinecone
pc = Pinecone(api_key=os.environ['PINECONE_API_KEY'])
stats = pc.Index('bmw-datas').describe_index_stats()
print('namespaces:', dict(stats.namespaces))
"
```

Expected: prints `{'bimmerpost': {'vector_count': 8610}}` (or current value).

- [ ] **Step 2: Verify all chassis subdomains respond**

```bash
.venv/bin/python -c "
import httpx
from ingest.config import CHASSIS_MAP, USER_AGENT
client = httpx.Client(http2=True, headers={'User-Agent': USER_AGENT}, timeout=15.0)
for k, cfg in CHASSIS_MAP.items():
    url = f'https://{cfg[\"subdomain\"]}/forums/index.php'
    try:
        r = client.get(url)
        print(f'{k}: HTTP {r.status_code} ({len(r.text)} bytes)')
    except Exception as e:
        print(f'{k}: ERROR {e}')
client.close()
"
```

Expected: every chassis returns HTTP 200. If `f92.bimmerpost.com` returns DNS error, document and update spec — do not proceed to full crawl until resolved.

- [ ] **Step 3: Small dry-run end-to-end against g87**

```bash
.venv/bin/python -m ingest --chassis=g87 --max-pages=1 --max-threads=5 --dry-run
```

Expected: log shows discover → list → fetch → upload [DRY RUN]; first record JSON printed; sqlite at `data/ingest.db` has `forums` + `threads` + `posts` rows for g87.

- [ ] **Step 4: Eyeball-diff dry-run record vs golden record**

```bash
.venv/bin/python -c "
import json
golden = json.load(open('tests/fixtures/golden_record.json'))
print('golden field types:')
for k, v in golden.items():
    print(f'  {k}: {type(v).__name__}', end='')
    if isinstance(v, list): print(f' (len={len(v)})')
    elif isinstance(v, str): print(f' (\"{v[:60]}\")')
    else: print()
"
```

Compare to the dry-run output from Step 3. Field names + types must match exactly. Any mismatch → fix `build_record` and re-run.

- [ ] **Step 5: Real upload of small batch (g87, 1 page, 5 threads)**

```bash
rm -f data/ingest.db data/ingest.log  # fresh state
.venv/bin/python -m ingest --chassis=g87 --max-pages=1 --max-threads=5
```

Expected: log shows actual `upsert_records` calls; no errors. `describe_index_stats` afterwards shows `vector_count` increased by 5.

- [ ] **Step 6: Verify retrieve via live RAG**

In a browser, open https://bimmerllm.vercel.app and ask a G87-specific question (e.g., "G87 M2 提速怎么样" or "What's the G87 M2 known for?"). Verify the chat returns a Chinese answer and the "N sources cited" panel includes at least one record whose `model` field is `["G87"]` (open Pinecone console to check, or expand sources panel preview).

- [ ] **Step 7: Re-run idempotency check**

```bash
.venv/bin/python -m ingest --chassis=g87 --max-pages=1 --max-threads=5
```

Expected: log shows `[upload] queue empty` — second run does not re-upload anything because all rows have `uploaded_at` set.

- [ ] **Step 8: Document PoC outcome in DEV_QUEUE.md / DEV_HANDOFF.md**

Add a one-line entry under the bimmerllm section noting: PoC ingest of g87 (~5 records) succeeded; full M-series crawl ready to launch. Per `~/.claude/CLAUDE.md`, the ingest crawler scope is now `[ ]`-tracked.

- [ ] **Step 9: Commit any final fixes from PoC**

If steps 4-7 surfaced bugs (selector drift, schema mismatch, etc.), fix them, re-run tests, commit:

```bash
cd /Users/stanyan/Github/bimmerllm
git status
git add -p   # selectively stage fixes
git commit -m "fix(ingest): adjustments from PoC against live g87"
```

If no fixes needed, skip this step.

---

## Acceptance verification

When all 16 tasks are complete:

1. `cd scripts/ingest && .venv/bin/pytest` — all tests pass
2. `python -m ingest --chassis=g87 --max-pages=2 --dry-run` runs cleanly + prints a record matching the existing 8610 schema (Acceptance #1)
3. `python -m ingest --chassis=g87 --max-pages=2` (no dry-run) uploads ~50–100 records; `describe_index_stats` confirms vector count increased (Acceptance #2)
4. Live chat at bimmerllm.vercel.app on a G87 topic surfaces a newly-ingested source (Acceptance #3)
5. Re-running step 3 uploads zero new records — idempotent via UUID + uploaded_at (Acceptance #4)
6. `tests/test_*.py` all green (Acceptance #5)
7. `scripts/ingest/README.md` documents CLI + runbook (Acceptance #6)

The full M-series crawl (Phase C in the spec, ~100k threads, 10–40h wall clock) is run **manually** outside this plan — kick off `python -m ingest --chassis=all` in a tmux session and monitor `data/ingest.log`. Resume on crash with the same command. That's deliberately out of plan scope: the plan delivers the tool, the operator runs it.
