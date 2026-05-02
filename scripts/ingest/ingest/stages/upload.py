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
