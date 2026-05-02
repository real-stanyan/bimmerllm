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
    so they don't block the rest of the queue.

    If a later page fails after we already collected posts from earlier pages,
    we persist the partial fetch (mark_fetched) rather than discarding it —
    truncated posts are better than no posts.
    """
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
                try:
                    page_url = _build_thread_url(thread_row["url"], page, pp=pp)
                    logger.info("[fetch] thread=%d page=%d", tid, page)
                    html = fetcher.get(page_url)
                    parsed = parse_thread_page(html)
                except Exception as page_err:
                    if posts:
                        # got at least some posts from earlier pages — persist what we have
                        logger.warning(
                            "[fetch] thread=%d page=%d failed but %d posts collected: %s",
                            tid, page, len(posts), page_err,
                        )
                        break
                    raise  # re-raise to outer try

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
