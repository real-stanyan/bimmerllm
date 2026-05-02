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
