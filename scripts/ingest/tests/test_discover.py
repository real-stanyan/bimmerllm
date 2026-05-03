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


def test_discover_skips_universal_and_off_topic_forums(in_memory_db, fixtures_dir: Path):
    """Critical: g80 index shares the global 'BIMMERPOST Universal Forums' section
    (off-topic, watches, sim racing, classic BMW pre-2005 etc.). Those must NOT
    end up tagged with model=['G80','G82','G83']/label=['S58'] in the forums table."""
    db.apply_schema(in_memory_db)
    g80_index = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    fetcher = FakeFetcher({"https://g80.bimmerpost.com/forums/index.php": g80_index})

    discover.run(in_memory_db, chassis_keys=["g80"], fetcher=fetcher)

    names = {r["name"] for r in in_memory_db.execute("SELECT name FROM forums").fetchall()}
    forbidden_names = {
        "BIMMERPOST Universal Forums",
        "Off-Topic Discussions Board",
        "Watches",
        "Sim Racing",
        "Classic BMW (Pre-2005 Models)",
        "Health, Fitness, Martial Arts, and Nutrition",
        "Photography/Videography",
        "General BMW News and Cars Discussion",
        "Professional Motorsport Racing Discussion (IMSA, DTM, Formula 1, Grand-AM, Indy/CART, Endurance, Other)",
    }
    leaked = forbidden_names & names
    assert not leaked, f"cross-site shared forums leaked into chassis: {leaked}"


def test_is_chassis_relevant_unit():
    """Spot-check filter rules in isolation."""
    from ingest.config import CHASSIS_MAP
    from ingest.stages.discover import is_chassis_relevant

    g80 = CHASSIS_MAP["g80"]
    g87 = CHASSIS_MAP["g87"]

    # Rule 1: category names our chassis → keep
    assert is_chassis_relevant("G80 BMW M3 and M4 General Topics", "Engine/Drivetrain", g80)

    # Rule 2: foreign chassis in category → drop
    assert not is_chassis_relevant("G42 2-Series General Topics", "Photos", g87)

    # Rule 3: chassis-relative shared category → keep
    assert is_chassis_relevant("Technical Sections", "Engine/Drivetrain", g80)
    assert is_chassis_relevant("Classifieds", "Sponsors Classifieds", g80)

    # Rule 4: name itself names our chassis (M2/G87) → keep
    assert is_chassis_relevant("", "BMW M2 G87 General Topics", g87)
    assert is_chassis_relevant("", "BMW M2 Forums 2023+ (G87)", g87)

    # Rule 5 default-deny: universal categories → drop
    assert not is_chassis_relevant("BIMMERPOST Universal Forums", "Off-Topic Discussions Board", g80)
    assert not is_chassis_relevant("BIMMERPOST Universal Forums", "Watches", g87)
    assert not is_chassis_relevant("BIMMERPOST Universal Forums", "Sim Racing", g87)

    # Edge: name is a foreign chassis → drop even if category is relative
    assert not is_chassis_relevant("Technical Sections", "BMW 2 Series Technical Topics (G42)", g87)
