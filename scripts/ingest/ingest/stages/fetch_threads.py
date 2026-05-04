"""Fetch stage: pull every showthread.php?t=N page, write to posts table."""
from __future__ import annotations

import logging
import sqlite3
from typing import Optional, Protocol

from ..db import (
    insert_posts,
    list_threads_to_fetch,
    mark_fetched,
    mark_truncated,
    record_fetch_error,
)
from ..parse import parse_thread_page


logger = logging.getLogger(__name__)

DEFAULT_MAX_PAGES_PER_THREAD = 5


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
    max_pages_per_thread: int = DEFAULT_MAX_PAGES_PER_THREAD,
    pp: int = 200,
) -> None:
    """Iterate every thread with fetched_at IS NULL. For each, fetch up to
    max_pages_per_thread pages, insert posts, mark fetched. Errors are logged
    and stored in threads.fetch_error so they don't block the rest of the queue.

    Why a per-thread page cap: bimmerpost has 'mega-threads' (M2 reservation
    trackers, order forums, year-end deal threads) with 200+ pages of low-density
    chatter that would otherwise pin a single fetch slot for 20+ minutes and
    blow Pinecone's 40KB metadata budget. Capping at 5 pages × pp=200 = ~1000
    replies covers 99% of useful content; mega-threads are flagged via
    truncated_at so the audit trail records that we cut them short.

    If a later page fails after we already collected posts from earlier pages,
    we persist the partial fetch (mark_fetched) rather than discarding it.
    """
    pending = list_threads_to_fetch(conn, limit=max_threads or 1_000_000)
    logger.info("[fetch] %d threads pending (max %d pages/thread, pp=%d)",
                len(pending), max_pages_per_thread, pp)

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
            hit_cap = False
            while True:
                try:
                    page_url = _build_thread_url(thread_row["url"], page, pp=pp)
                    logger.info("[fetch] thread=%d page=%d", tid, page)
                    html = fetcher.get(page_url)
                    parsed = parse_thread_page(html)
                except Exception as page_err:
                    if posts:
                        logger.warning(
                            "[fetch] thread=%d page=%d failed but %d posts collected: %s",
                            tid, page, len(posts), page_err,
                        )
                        break
                    raise

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
                if page >= max_pages_per_thread:
                    # mega-thread cap hit; stop here and record truncation in audit trail
                    logger.info(
                        "[fetch] thread=%d cap hit at page=%d/%d total_pages=%d — truncating",
                        tid, page, max_pages_per_thread, parsed["total_pages"],
                    )
                    hit_cap = True
                    break
                page += 1
                if page > parsed["total_pages"] + 5:  # safety cap on runaway loop
                    break

            if posts:
                insert_posts(conn, tid, posts)
                mark_fetched(conn, tid)
                if hit_cap:
                    mark_truncated(conn, tid)
            else:
                record_fetch_error(conn, tid, "parser produced 0 posts")
        except Exception as e:
            logger.exception("[fetch] thread %d failed: %s", tid, e)
            record_fetch_error(conn, tid, str(e))
