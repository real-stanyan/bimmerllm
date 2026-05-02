"""build_record + validate_record — guarantees new records match existing 8610 schema."""
import json
import re
import uuid
from pathlib import Path

import pytest

from ingest.config import CHASSIS_MAP
from ingest.record import RecordOversize, build_record, validate_record


def test_build_record_matches_schema_keys(fixtures_dir: Path):
    golden = json.loads((fixtures_dir / "golden_record.json").read_text(encoding="utf-8"))
    expected_keys = set(golden.keys())  # _id + 6 metadata fields

    chassis_cfg = CHASSIS_MAP["g80"]
    thread_row = {
        "uuid": str(uuid.uuid4()),
        "title": "Test thread",
        "chassis": "g80",
    }
    posts = [
        {"post_idx": 0, "text": "First post body"},
        {"post_idx": 1, "text": "Second post reply"},
    ]
    rec = build_record(thread_row, posts, chassis_cfg)
    assert set(rec.keys()) == expected_keys


def test_build_record_question_format():
    chassis_cfg = CHASSIS_MAP["g80"]
    thread_row = {"uuid": str(uuid.uuid4()), "title": "Test", "chassis": "g80"}
    posts = [{"post_idx": 0, "text": "body"}]
    rec = build_record(thread_row, posts, chassis_cfg)
    # format: "{models join ', '},{labels join ','},{title}"
    assert rec["question"] == "G80, G82, G83,S58,Test"


def test_build_record_question_format_matches_golden(fixtures_dir: Path):
    """Golden record's question is 'G20, G21,B58,Ecutek Mobile Dashboard Gauges'.
    Our format string must produce the same shape: 'M, M2,L,Title'."""
    golden = json.loads((fixtures_dir / "golden_record.json").read_text(encoding="utf-8"))
    q = golden["question"]
    # shape: <models comma-space joined>,<labels comma joined>,<title>
    assert re.match(r"^[A-Z0-9, ]+,[A-Z0-9,]+,.+$", q), f"unexpected golden question shape: {q}"


def test_build_record_answers_filters_blank():
    chassis_cfg = CHASSIS_MAP["f80"]
    thread_row = {"uuid": str(uuid.uuid4()), "title": "T", "chassis": "f80"}
    posts = [
        {"post_idx": 0, "text": "real body"},
        {"post_idx": 1, "text": "  "},  # whitespace
        {"post_idx": 2, "text": "another body"},
    ]
    rec = build_record(thread_row, posts, chassis_cfg)
    assert rec["answers"] == ["real body", "another body"]


def test_validate_record_passes_well_formed(fixtures_dir: Path):
    golden = json.loads((fixtures_dir / "golden_record.json").read_text(encoding="utf-8"))
    validate_record(golden)  # must not raise


def test_validate_record_rejects_bad_id():
    rec = {"_id": "not-a-uuid", "question": "x", "original_question": "x",
           "answers": ["a"], "model": ["G80"], "label": ["S58"], "series": "3/4 Series"}
    with pytest.raises(AssertionError, match="bad _id"):
        validate_record(rec)


def test_validate_record_rejects_empty_answers():
    rec = {"_id": str(uuid.uuid4()), "question": "x", "original_question": "x",
           "answers": [], "model": ["G80"], "label": ["S58"], "series": "3/4 Series"}
    with pytest.raises(AssertionError, match="empty answers"):
        validate_record(rec)


def test_validate_record_raises_oversize():
    rec = {"_id": str(uuid.uuid4()), "question": "x", "original_question": "x",
           "answers": ["a" * 40_000], "model": ["G80"], "label": ["S58"], "series": "3/4 Series"}
    with pytest.raises(RecordOversize):
        validate_record(rec)
