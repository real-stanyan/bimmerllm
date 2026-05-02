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
