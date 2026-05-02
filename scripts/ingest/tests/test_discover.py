"""discover stage — orchestrates http + parse_forum_index → forums table."""
from pathlib import Path

import pytest

from ingest import db
from ingest.stages import discover


class FakeFetcher:
    def __init__(self, html_by_url: dict[str, str]):
        self.html_by_url = html_by_url
        self.calls: list[str] = []

    def get(self, url: str) -> str:
        self.calls.append(url)
        return self.html_by_url[url]


def test_discover_writes_forum_rows(in_memory_db, fixtures_dir: Path):
    db.apply_schema(in_memory_db)
    g80_index = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    fetcher = FakeFetcher({"https://g80.bimmerpost.com/forums/index.php": g80_index})

    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)

    rows = in_memory_db.execute("SELECT chassis, forum_id, name, url FROM forums WHERE chassis='g80'").fetchall()
    assert len(rows) >= 5
    for r in rows:
        assert r["chassis"] == "g80"
        assert r["forum_id"] > 0
        assert r["name"]
        assert "g80.bimmerpost.com" in r["url"]


def test_discover_idempotent(in_memory_db, fixtures_dir: Path):
    db.apply_schema(in_memory_db)
    g80_index = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    fetcher = FakeFetcher({"https://g80.bimmerpost.com/forums/index.php": g80_index})

    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)
    n1 = in_memory_db.execute("SELECT COUNT(*) FROM forums").fetchone()[0]
    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)
    n2 = in_memory_db.execute("SELECT COUNT(*) FROM forums").fetchone()[0]
    assert n1 == n2  # second discover does not duplicate


def test_discover_unknown_chassis_raises(in_memory_db):
    db.apply_schema(in_memory_db)
    with pytest.raises(KeyError):
        discover.run(in_memory_db, chassis_keys=["bogus"], fetcher=FakeFetcher({}))
