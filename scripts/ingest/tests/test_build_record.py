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


def test_truncate_answers_handles_multibyte_unicode():
    """Critical: Chinese / Japanese / Korean text is 3 bytes/char in UTF-8.
    Char-based slicing leaves a record 3× over budget. Must byte-slice."""
    from ingest.record import truncate_answers_to_budget
    from ingest.config import PINECONE_METADATA_BUDGET_BYTES

    # 30000 Chinese chars = 90000 bytes — way over the 35K budget
    rec = {"_id": str(uuid.uuid4()), "question": "x", "original_question": "x",
           "answers": ["汉字" * 15_000], "model": ["G80"], "label": ["S58"], "series": "3/4 Series"}
    final_size = truncate_answers_to_budget(rec)
    # final size must be at or below budget — not 2-3x over
    assert final_size <= PINECONE_METADATA_BUDGET_BYTES, \
        f"truncate failed: {final_size}B > {PINECONE_METADATA_BUDGET_BYTES}B budget"

    # validate_record should now pass on the truncated record
    validate_record(rec)


def test_truncate_answers_drops_trailing_then_keeps_one():
    """Drop trailing answers first; only byte-slice if single OP still oversized."""
    from ingest.record import truncate_answers_to_budget
    from ingest.config import PINECONE_METADATA_BUDGET_BYTES

    rec = {"_id": str(uuid.uuid4()), "question": "x", "original_question": "x",
           "answers": ["a" * 20_000, "b" * 20_000], "model": ["G80"],
           "label": ["S58"], "series": "3/4 Series"}
    final_size = truncate_answers_to_budget(rec)
    assert len(rec["answers"]) == 1
    assert final_size == 20_000 <= PINECONE_METADATA_BUDGET_BYTES


# ============================================================
# v2 schema (post-level chunked) — Phase 2
# ============================================================

import uuid as _uuid
from ingest.record import build_record_v2, validate_record_v2


def _v2_thread():
    return {
        "thread_id": 1218669,
        "uuid": str(_uuid.uuid4()),
        "title": "N54 HPFP cold-start hesitation",
        "chassis": "f80",
        "url": "https://f80.bimmerpost.com/forums/showthread.php?t=1218669",
    }


def test_v2_record_has_expected_fields():
    chassis_cfg = CHASSIS_MAP["f80"]
    rec = build_record_v2(
        _v2_thread(),
        post={"post_idx": 0, "posted_at": "2024-09-12T03:14:00Z"},
        chunk_idx=0,
        chunk_text="The HPFP started failing around 75k miles.",
        chassis_cfg=chassis_cfg,
    )
    assert set(rec.keys()) >= {
        "_id", "text",
        "thread_id", "thread_uuid", "thread_title", "thread_url",
        "post_idx", "chunk_idx",
        "chassis", "models", "engines", "series",
    }


def test_v2_id_is_composite_uuid_post_chunk():
    chassis_cfg = CHASSIS_MAP["f80"]
    th = _v2_thread()
    rec = build_record_v2(
        th,
        post={"post_idx": 3, "posted_at": None},
        chunk_idx=2,
        chunk_text="body",
        chassis_cfg=chassis_cfg,
    )
    assert rec["_id"] == f"{th['uuid']}:3:2"


def test_v2_text_is_the_embedded_field():
    """v2 embeds `text` (the chunk body), not a synthetic 'question' string."""
    chassis_cfg = CHASSIS_MAP["g80"]
    rec = build_record_v2(
        _v2_thread(),
        post={"post_idx": 0, "posted_at": None},
        chunk_idx=0,
        chunk_text="Replaced HPFP at 80k. Fixed cold-start hesitation.",
        chassis_cfg=chassis_cfg,
    )
    assert rec["text"] == "Replaced HPFP at 80k. Fixed cold-start hesitation."
    assert "question" not in rec  # explicitly NOT v1 shape


def test_v2_metadata_carries_chassis_and_url():
    chassis_cfg = CHASSIS_MAP["f80"]
    th = _v2_thread()
    rec = build_record_v2(
        th,
        post={"post_idx": 0, "posted_at": None},
        chunk_idx=0,
        chunk_text="body",
        chassis_cfg=chassis_cfg,
    )
    assert rec["chassis"] == "f80"
    assert rec["models"] == ["F80", "F82", "F83"]
    assert rec["engines"] == ["S55"]
    assert rec["series"] == "3/4 Series"
    assert rec["thread_url"] == th["url"]
    assert rec["thread_title"] == th["title"]


def test_v2_validate_passes_on_well_formed_record():
    chassis_cfg = CHASSIS_MAP["g87"]
    rec = build_record_v2(
        _v2_thread(),
        post={"post_idx": 0, "posted_at": None},
        chunk_idx=0,
        chunk_text="hello world",
        chassis_cfg=chassis_cfg,
    )
    validate_record_v2(rec)  # should not raise


def test_v2_validate_rejects_empty_text():
    chassis_cfg = CHASSIS_MAP["g87"]
    rec = build_record_v2(
        _v2_thread(),
        post={"post_idx": 0, "posted_at": None},
        chunk_idx=0,
        chunk_text="hello",
        chassis_cfg=chassis_cfg,
    )
    rec["text"] = ""
    with pytest.raises(AssertionError):
        validate_record_v2(rec)


def test_v2_validate_rejects_bad_id_shape():
    chassis_cfg = CHASSIS_MAP["g87"]
    rec = build_record_v2(
        _v2_thread(),
        post={"post_idx": 0, "posted_at": None},
        chunk_idx=0,
        chunk_text="hi",
        chassis_cfg=chassis_cfg,
    )
    rec["_id"] = "not-a-composite-id"
    with pytest.raises(AssertionError):
        validate_record_v2(rec)
