from pathlib import Path

import pytest

from ingest import db
from ingest.stages import list_threads


class FakeFetcher:
    def __init__(self, html_by_url: dict[str, str]):
        self.html_by_url = html_by_url
        self.calls: list[str] = []

    def get(self, url: str) -> str:
        self.calls.append(url)
        return self.html_by_url[url]


def _seed_forum(conn, chassis: str = "g80", forum_id: int = 888):
    db.apply_schema(conn)
    db.insert_forum(conn, chassis=chassis, forum_id=forum_id, name="Engine",
                    parent_forum_id=None,
                    url=f"https://{chassis}.bimmerpost.com/forums/forumdisplay.php?f={forum_id}",
                    threads_total=None)


def test_list_inserts_threads_from_fixture(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    listing = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    url = "https://g80.bimmerpost.com/forums/forumdisplay.php?f=888&page=1"
    fetcher = FakeFetcher({url: listing})

    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)

    rows = in_memory_db.execute("SELECT thread_id, title, forum_id FROM threads").fetchall()
    assert len(rows) >= 10
    for r in rows:
        assert r["forum_id"] == 888
        assert r["thread_id"] > 0
        assert r["title"]


def test_list_increments_last_listed_page(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    listing = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    url = "https://g80.bimmerpost.com/forums/forumdisplay.php?f=888&page=1"
    fetcher = FakeFetcher({url: listing})

    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)

    row = in_memory_db.execute(
        "SELECT last_listed_page, listed_at FROM forums WHERE chassis='g80' AND forum_id=888"
    ).fetchone()
    assert row["last_listed_page"] == 1


def test_list_skips_already_listed_forum(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    in_memory_db.execute(
        "UPDATE forums SET listed_at='2026-05-02T00:00:00+00:00', last_listed_page=99 "
        "WHERE chassis='g80' AND forum_id=888"
    )
    in_memory_db.commit()

    fetcher = FakeFetcher({})  # no URLs — should not be called
    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="full", max_pages=1)
    assert fetcher.calls == []


def test_list_incremental_mode_only_fetches_page_1(in_memory_db, fixtures_dir: Path):
    _seed_forum(in_memory_db)
    listing = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    url = "https://g80.bimmerpost.com/forums/forumdisplay.php?f=888&page=1"
    fetcher = FakeFetcher({url: listing})

    list_threads.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher,
                     mode="incremental", max_pages=None)

    # only page 1 fetched even though fixture says total_pages > 1
    page_1_calls = [c for c in fetcher.calls if "page=1" in c]
    page_2_calls = [c for c in fetcher.calls if "page=2" in c]
    assert len(page_1_calls) == 1
    assert page_2_calls == []
