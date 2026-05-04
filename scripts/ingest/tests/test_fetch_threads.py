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


def test_fetch_caps_pages_per_thread_and_marks_truncated(in_memory_db):
    """A mega-thread with 50 pages should be truncated at max_pages_per_thread
    and flagged via threads.truncated_at."""
    _seed_thread(in_memory_db, thread_id=999)

    # synthetic vbulletin page that ALWAYS shows has_next=True (Page X of 50)
    def _page_html(page_num: int) -> str:
        return f"""<html><body>
          <table id='post{1000 + page_num * 10}'>
            <a class='bigusername'>user{page_num}</a>
            <div id='post_message_{1000 + page_num * 10}'>body of page {page_num}</div>
          </table>
          <div class='pagenav'>Page {page_num} of 50</div>
        </body></html>"""

    class PagedFetcher:
        def __init__(self): self.calls: list[str] = []
        def get(self, url):
            self.calls.append(url)
            import re
            m = re.search(r"page=(\d+)", url)
            return _page_html(int(m.group(1)) if m else 1)

    fetcher = PagedFetcher()
    fetch_threads.run(in_memory_db, fetcher=fetcher, max_threads=1, max_pages_per_thread=3)

    row = in_memory_db.execute(
        "SELECT fetched_at, truncated_at FROM threads WHERE thread_id=999"
    ).fetchone()
    assert row["fetched_at"] is not None     # we did persist what we got
    assert row["truncated_at"] is not None   # but flagged it as truncated

    # exactly 3 pages should have been fetched (cap), not 50
    assert len(fetcher.calls) == 3, f"expected 3 page fetches, got {len(fetcher.calls)}"


def test_fetch_no_truncation_when_thread_fits_under_cap(in_memory_db):
    """A normal-length thread (1-2 pages) should NOT be marked truncated."""
    _seed_thread(in_memory_db, thread_id=500)

    short_html = """<html><body>
      <table id='post5001'>
        <a class='bigusername'>alice</a>
        <div id='post_message_5001'>only post</div>
      </table>
      <div class='pagenav'>Page 1 of 1</div>
    </body></html>"""

    class SinglePageFetcher:
        def __init__(self): self.calls: list[str] = []
        def get(self, url):
            self.calls.append(url)
            return short_html

    fetcher = SinglePageFetcher()
    fetch_threads.run(in_memory_db, fetcher=fetcher, max_threads=1, max_pages_per_thread=10)

    row = in_memory_db.execute(
        "SELECT fetched_at, truncated_at FROM threads WHERE thread_id=500"
    ).fetchone()
    assert row["fetched_at"] is not None
    assert row["truncated_at"] is None       # natural completion, not truncated
