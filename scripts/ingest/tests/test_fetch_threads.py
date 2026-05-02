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
