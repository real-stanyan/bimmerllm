"""parse.py tests — fixture-locked HTML parsers."""
import re
from pathlib import Path

import pytest

from ingest.parse import parse_forum_index


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
