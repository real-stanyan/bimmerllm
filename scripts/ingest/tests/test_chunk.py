"""Tests for the v2 post chunker.

Token-budget tests use a deterministic estimator (chars/4 by default) so tests
remain fast and reproducible without depending on a real tokenizer. The actual
chunker accepts an estimator override, which is what production code wires
to a tiktoken-based count.
"""
from __future__ import annotations

from ingest.chunk import chunk_post, DEFAULT_SOFT_TOKENS, DEFAULT_HARD_TOKENS


def _toks(s: str) -> int:
    """Cheap estimator used in tests — 1 token per 4 chars, matches default."""
    return max(1, len(s) // 4)


def test_short_post_yields_single_chunk():
    text = "I had the same issue on my F80. Replaced HPFP at 80k miles, fixed."
    chunks = chunk_post(text)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_empty_or_whitespace_post_yields_no_chunks():
    assert chunk_post("") == []
    assert chunk_post("   \n\n  \n") == []


def test_packs_paragraphs_until_soft_cap():
    # Five 600-char paragraphs (~150 tok each). Soft cap 600 means each chunk
    # gets ~4 paragraphs at the most before flushing.
    paras = [("word " * 120).strip() for _ in range(5)]
    text = "\n\n".join(paras)
    chunks = chunk_post(text, soft_tokens=600)
    assert len(chunks) >= 2  # had to split
    for c in chunks:
        # Token estimate must respect the soft cap unless a single paragraph
        # is itself bigger than the soft cap (none are here).
        assert _toks(c) <= 700  # soft cap + small slop for overlap


def test_oversized_paragraph_falls_back_to_sentence_split():
    # One paragraph that exceeds the hard cap forces sentence-level splitting.
    long_para = (". ".join([f"Sentence number {i}" for i in range(200)])) + "."
    chunks = chunk_post(long_para, soft_tokens=100, hard_tokens=200)
    assert len(chunks) >= 2
    for c in chunks:
        assert _toks(c) <= 250  # under hard cap with slop


def test_overlap_carries_last_sentence_between_chunks():
    paras = [
        "Para A start. Para A mid. Para A end.",
        "Para B start. Para B mid. Para B end.",
        "Para C start. Para C mid. Para C end.",
    ]
    text = "\n\n".join(paras)
    # Force splitting after every paragraph
    chunks = chunk_post(text, soft_tokens=12, hard_tokens=24, overlap_sentences=1)
    assert len(chunks) >= 2
    # Some adjacent pair shares the last sentence of one with the next.
    found_overlap = False
    for prev, cur in zip(chunks, chunks[1:]):
        last_prev_sentence = prev.rstrip(".!?").rsplit(".", 1)[-1].strip()
        if last_prev_sentence and last_prev_sentence in cur:
            found_overlap = True
            break
    assert found_overlap, f"no overlap found in {chunks!r}"


def test_overlap_zero_disables_carryover():
    paras = ["A1. A2. A3.", "B1. B2. B3.", "C1. C2. C3."]
    text = "\n\n".join(paras)
    chunks = chunk_post(text, soft_tokens=8, hard_tokens=16, overlap_sentences=0)
    # Adjacent chunks should not share the trailing sentence verbatim.
    for prev, cur in zip(chunks, chunks[1:]):
        prev_tail = prev.rsplit(".", 2)[-2].strip() if "." in prev else ""
        if prev_tail:
            assert not cur.startswith(prev_tail), f"unexpected overlap: prev={prev!r} cur={cur!r}"


def test_strips_leading_quoted_block():
    """vBulletin posts often start with a quoted parent post; we want to keep
    the OP's actual reply, not the quote."""
    text = (
        "Originally Posted by F80M3:\n"
        "Some random parent rambling that's not from this poster.\n\n"
        "I think the real cause is the HPFP. Mine failed at 75k."
    )
    chunks = chunk_post(text, strip_quotes=True)
    assert len(chunks) >= 1
    joined = " ".join(chunks)
    assert "F80M3" not in joined
    assert "HPFP" in joined


def test_keeps_quoted_block_when_strip_quotes_false():
    text = (
        "Originally Posted by F80M3:\n"
        "Some random parent rambling.\n\n"
        "I think the real cause is the HPFP."
    )
    chunks = chunk_post(text, strip_quotes=False)
    assert any("F80M3" in c for c in chunks)


def test_default_caps_match_module_constants():
    # Sanity: the module-level defaults haven't drifted from what the spec
    # documents (600 soft / 800 hard). If these change, update the spec doc.
    assert DEFAULT_SOFT_TOKENS == 600
    assert DEFAULT_HARD_TOKENS == 800


def test_uses_custom_estimator():
    """Production wires this to tiktoken; tests prove the override path runs."""
    calls: list[str] = []

    def fake_estimator(s: str) -> int:
        calls.append(s)
        return 1  # always tiny → never split

    text = "Para A.\n\nPara B.\n\nPara C."
    chunks = chunk_post(text, soft_tokens=10, hard_tokens=20, estimator=fake_estimator)
    assert len(chunks) == 1  # estimator says everything is tiny
    assert len(calls) > 0
