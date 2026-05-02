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
