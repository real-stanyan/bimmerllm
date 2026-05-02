"""parse.py tests — fixture-locked HTML parsers."""
import re
from pathlib import Path

import pytest

from ingest.parse import parse_forum_index, parse_forum_listing_page


def test_parse_forum_index_returns_nodes(fixtures_dir: Path):
    html = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    nodes = parse_forum_index(html, chassis="g80")
    assert isinstance(nodes, list)
    assert len(nodes) >= 5  # G80 has at least 5 sub-forums (general/photos/engine/etc)


def test_parse_forum_index_node_shape(fixtures_dir: Path):
    html = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    nodes = parse_forum_index(html, chassis="g80")
    for n in nodes:
        assert set(n.keys()) == {"forum_id", "name", "parent_forum_id", "url"}
        assert isinstance(n["forum_id"], int) and n["forum_id"] > 0
        assert isinstance(n["name"], str) and n["name"]
        assert n["parent_forum_id"] is None or isinstance(n["parent_forum_id"], int)
        assert n["url"].startswith("https://g80.bimmerpost.com/")
        assert f"f={n['forum_id']}" in n["url"]


def test_parse_forum_index_unique_forum_ids(fixtures_dir: Path):
    html = (fixtures_dir / "forum_index_g80.html").read_text(encoding="utf-8")
    nodes = parse_forum_index(html, chassis="g80")
    ids = [n["forum_id"] for n in nodes]
    assert len(ids) == len(set(ids))


def test_parse_forum_listing_page_returns_threads(fixtures_dir: Path):
    html = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    page = parse_forum_listing_page(html, forum_id=888)
    assert "threads" in page and len(page["threads"]) >= 10
    assert "total_pages" in page
    assert "has_next" in page


def test_parse_forum_listing_thread_shape(fixtures_dir: Path):
    html = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    page = parse_forum_listing_page(html, forum_id=888)
    for t in page["threads"]:
        assert isinstance(t["thread_id"], int) and t["thread_id"] > 0
        assert isinstance(t["title"], str) and t["title"]
        # parser returns href as found (often relative); caller resolves
        assert "showthread.php" in t["url"] and f"t={t['thread_id']}" in t["url"]
        assert t["replies"] is None or isinstance(t["replies"], int)
        assert t["views"] is None or isinstance(t["views"], int)
        assert t["is_sticky"] in (0, 1)
        assert t["last_post_at"] is None or isinstance(t["last_post_at"], str)


def test_parse_forum_listing_unique_thread_ids(fixtures_dir: Path):
    html = (fixtures_dir / "forum_listing_g80_f888_p1.html").read_text(encoding="utf-8")
    page = parse_forum_listing_page(html, forum_id=888)
    ids = [t["thread_id"] for t in page["threads"]]
    assert len(ids) == len(set(ids))
