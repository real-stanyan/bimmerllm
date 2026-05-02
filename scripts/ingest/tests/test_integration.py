"""End-to-end smoke: discover → list → fetch → upload, all stages with fixtures."""
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from ingest import db
from ingest.stages import discover, fetch_threads, list_threads, upload


class FixtureFetcher:
    """Returns the right fixture html for a known set of URLs.
    Falls back to thread_short fixture for any showthread.php URL."""
    def __init__(self, fixtures_dir: Path):
        self.fixtures = fixtures_dir
        self.calls: list[str] = []

    def get(self, url: str) -> str:
        self.calls.append(url)
        if "index.php" in url:
            return (self.fixtures / "forum_index_g80.html").read_text(encoding="utf-8")
        if "forumdisplay.php" in url:
            return (self.fixtures / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
        if "showthread.php" in url:
            return (self.fixtures / "thread_short_g80.html").read_text(encoding="utf-8")
        raise KeyError(url)


def test_full_pipeline_smoke(in_memory_db, fixtures_dir: Path, tmp_path):
    db.apply_schema(in_memory_db)
    fetcher = FixtureFetcher(fixtures_dir)

    # Stage 1: discover
    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)
    forums = in_memory_db.execute("SELECT COUNT(*) FROM forums").fetchone()[0]
    assert forums >= 5

    # Stage 2: list (only 1 page to keep test fast)
    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)
    threads_n = in_memory_db.execute("SELECT COUNT(*) FROM threads").fetchone()[0]
    assert threads_n >= 5

    # Stage 3: fetch (only first 3 threads to keep test fast)
    list_threads.run = list_threads.run  # silence unused-import warning
    fetch_threads.run(in_memory_db, fetcher=fetcher, max_threads=3)
    fetched = in_memory_db.execute(
        "SELECT COUNT(*) FROM threads WHERE fetched_at IS NOT NULL"
    ).fetchone()[0]
    assert fetched >= 1
    posts_n = in_memory_db.execute("SELECT COUNT(*) FROM posts").fetchone()[0]
    assert posts_n >= 1

    # Stage 4: upload (mocked Pinecone)
    fake_index = MagicMock()
    upload.run(in_memory_db, index=fake_index, namespace="bimmerpost", batch_size=10)
    fake_index.upsert_records.assert_called()
    args, kwargs = fake_index.upsert_records.call_args
    records = kwargs.get("records") or args[1]
    assert len(records) >= 1
    rec = records[0]
    assert set(rec.keys()) == {"_id", "question", "original_question", "answers",
                                "model", "label", "series"}
