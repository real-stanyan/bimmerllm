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
from ..chunk import chunk_post
from ..record import (
    RecordOversize,
    build_record,
    build_record_v2,
    truncate_answers_to_budget,
    validate_record,
    validate_record_v2,
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


def _build_pending_records_v2(conn: sqlite3.Connection, thread_id: int) -> list[dict]:
    """v2 schema: yield one record per chunk per post. Empty/whitespace posts
    contribute zero records. Returns [] for fully empty threads (caller should
    still mark them uploaded so the queue progresses)."""
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

    records: list[dict] = []
    for post in posts:
        post_dict = dict(post)
        chunks = chunk_post(post_dict.get("text") or "")
        for chunk_idx, chunk_text in enumerate(chunks):
            rec = build_record_v2(thread_dict, post_dict, chunk_idx, chunk_text, chassis_cfg)
            try:
                validate_record_v2(rec)
            except RecordOversize:
                # A single chunk exceeded the byte budget — extremely unusual
                # at 600-token caps but we still want to fail loud rather than
                # silently truncate and lie about coverage.
                raise
            records.append(rec)
    return records


def _upsert_with_retry(index, namespace: str, records: list[dict], label: str) -> None:
    """3-attempt upsert with 30s backoff. Pinecone 4xx (auth/schema) is fatal."""
    for attempt in range(3):
        try:
            index.upsert_records(namespace, records)
            return
        except Exception as e:
            status = getattr(e, "status", None)
            if status is not None and 400 <= status < 500 and status != 429:
                raise
            if attempt == 2:
                raise
            logger.warning(
                "[upload:%s] batch failed (attempt %d/3): %s — sleeping 30s",
                label, attempt + 1, e,
            )
            time.sleep(30)


def run(
    conn: sqlite3.Connection,
    index,
    *,
    namespace: str,
    batch_size: int = 50,
    dry_run: bool = False,
    schema_version: int = 1,
    extra_targets: Optional[list[tuple[object, str]]] = None,
) -> None:
    """Pull pending threads, build records, upsert to Pinecone in batches.

    schema_version=1 (default): one record per thread, v1 schema.
    schema_version=2: one record per chunk per post, v2 schema. A thread can
    fan out into many records; we still mark the *thread* uploaded as a unit.

    extra_targets: list of (index, namespace) pairs to ALSO receive each
    batch. Used for the v2 dual-write to dense + sparse indexes — both get
    the same records and embed them with their own integrated model. A
    thread is marked uploaded only after the primary AND every extra target
    succeed; if any target raises, the queue stays at the same position so
    the next run retries.

    On batch failure: 30s sleep + retry the same batch (idempotent via UUID).
    Pinecone 4xx is treated as fatal and re-raised."""
    if schema_version not in (1, 2):
        raise ValueError(f"unknown schema_version: {schema_version}")

    while True:
        pending = list_threads_to_upload(conn, batch_size=batch_size)
        if not pending:
            logger.info("[upload] queue empty")
            return

        records: list[dict] = []
        truncated_ids: list[int] = []
        completed_thread_ids: list[int] = []
        for tid in pending:
            try:
                if schema_version == 1:
                    rec, was_truncated = _build_pending_record(conn, tid)
                    records.append(rec)
                    if was_truncated:
                        truncated_ids.append(tid)
                else:
                    chunk_records = _build_pending_records_v2(conn, tid)
                    records.extend(chunk_records)
                completed_thread_ids.append(tid)
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

        _upsert_with_retry(index, namespace, records, label="primary")
        for extra_index, extra_ns in (extra_targets or []):
            _upsert_with_retry(extra_index, extra_ns, records, label="extra")

        for tid in truncated_ids:
            mark_truncated(conn, tid)
        # Mark only the threads that actually contributed at least one record
        # (or v1: all pending). v2 with all-blank-post threads still gets
        # marked here because the build_records call succeeded with [] for
        # them, and we don't want them to spin in the queue.
        mark_uploaded(conn, completed_thread_ids)
        logger.info(
            "[upload] %d records committed across %d threads (truncated: %d, schema=v%d)",
            len(records), len(completed_thread_ids), len(truncated_ids), schema_version,
        )
