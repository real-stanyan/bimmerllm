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
    chassis_list = list(chassis_keys)
    chassis_filter = ",".join("?" * len(chassis_list))

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
            try:
                html = fetcher.get(url)
                page_data = parse_forum_listing_page(html, forum_id=forum_id)
            except Exception as page_err:
                # transient fetch / parse failure on a single page — log + advance to
                # next forum so the run doesn't die. last_listed_page already
                # checkpoints prior progress; this forum will be retried next run.
                logger.exception("[list] %s/f=%d page=%d failed: %s — skipping forum",
                                 chassis, forum_id, page, page_err)
                break
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
