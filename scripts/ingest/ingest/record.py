"""Record assembly + validation. The Pinecone schema is load-bearing —
every field name + type must match the existing 8610 records."""
from __future__ import annotations

import re
from typing import Any

from .config import PINECONE_METADATA_BUDGET_BYTES


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class RecordOversize(Exception):
    def __init__(self, record_id: str, size: int):
        super().__init__(f"record {record_id} payload {size}B exceeds {PINECONE_METADATA_BUDGET_BYTES}B")
        self.record_id = record_id
        self.size = size


def build_record(thread_row: dict, posts: list[dict], chassis_cfg: dict) -> dict[str, Any]:
    """Assemble a Pinecone record matching the existing 8610-record schema.

    Format reverse-engineered from a real golden record:
      _id               = thread.uuid (UUIDv4 string)
      question          = '{models comma-space joined},{labels comma joined},{title}'
                          e.g. "G20, G21,B58,Ecutek Mobile Dashboard Gauges"
      original_question = title raw
      answers           = [post_text for post in thread, OP first, blanks dropped]
      model             = chassis_cfg["models"]   (list of chassis codes)
      label             = chassis_cfg["engines"]  (list of engine codes)
      series            = chassis_cfg["series"]   (string)
    """
    title = (thread_row.get("title") or "").strip()
    models = list(chassis_cfg["models"])
    engines = list(chassis_cfg["engines"])
    question = f"{', '.join(models)},{','.join(engines)},{title}"

    answers = [p["text"].strip() for p in posts if p.get("text") and p["text"].strip()]

    return {
        "_id":               thread_row["uuid"],
        "question":          question,
        "original_question": title,
        "answers":           answers,
        "model":             models,
        "label":             engines,
        "series":            chassis_cfg["series"],
    }


def validate_record(rec: dict[str, Any]) -> None:
    """Hard-fail on schema deviations before sending to Pinecone."""
    assert isinstance(rec.get("_id"), str) and _UUID_RE.match(rec["_id"]), f"bad _id: {rec.get('_id')!r}"
    assert isinstance(rec.get("question"), str) and rec["question"], "empty question"
    assert isinstance(rec.get("original_question"), str), "bad original_question"
    assert isinstance(rec.get("answers"), list) and rec["answers"], "empty answers"
    assert all(isinstance(a, str) for a in rec["answers"]), "non-string answer"
    assert isinstance(rec.get("model"), list) and all(isinstance(m, str) for m in rec["model"]), "bad model"
    assert isinstance(rec.get("label"), list) and all(isinstance(l, str) for l in rec["label"]), "bad label"
    assert isinstance(rec.get("series"), str) and rec["series"], "empty series"

    payload_estimate = sum(len(s.encode("utf-8")) for s in rec["answers"])
    if payload_estimate > PINECONE_METADATA_BUDGET_BYTES:
        raise RecordOversize(rec["_id"], payload_estimate)


def truncate_answers_to_budget(rec: dict[str, Any]) -> int:
    """Shrink rec['answers'] to fit PINECONE_METADATA_BUDGET_BYTES.
    First drops trailing answers; if a single oversized OP remains, byte-slices its text.
    Returns final byte size. Caller is responsible for marking truncated_at in sqlite.

    Critical: slicing must be by encoded byte length (not char length) — Chinese,
    Japanese, Korean characters are 3 bytes/char in UTF-8. Naive char-slicing can
    leave a record up to 3× the budget, which trips Pinecone's 40KB hard limit
    and causes a fatal 4xx for the whole batch.
    """
    answers = rec["answers"]
    while len(answers) > 1:
        size = sum(len(s.encode("utf-8")) for s in answers)
        if size <= PINECONE_METADATA_BUDGET_BYTES:
            return size
        answers.pop()
    if answers and len(answers[0].encode("utf-8")) > PINECONE_METADATA_BUDGET_BYTES:
        suffix = "...[truncated]"
        suffix_bytes = len(suffix.encode("utf-8"))
        budget = PINECONE_METADATA_BUDGET_BYTES - suffix_bytes
        encoded = answers[0].encode("utf-8")[:budget]
        # decode with errors='ignore' to drop a partial multi-byte char at the cut
        answers[0] = encoded.decode("utf-8", errors="ignore") + suffix
    return sum(len(s.encode("utf-8")) for s in answers)
