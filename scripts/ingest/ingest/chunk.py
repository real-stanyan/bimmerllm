"""Post-level chunker for the v2 Pinecone schema.

Splits a single forum post into roughly-token-bounded chunks suitable for
embedding. Each chunk becomes its own Pinecone record with thread/post
metadata so the reranker can pick the best chunk rather than picking the
best thread title.

Sizing:
- Soft cap (default 600 tokens): pack paragraphs until the next paragraph
  would push us past this. Flush.
- Hard cap (default 800 tokens): if a single paragraph already exceeds this,
  fall back to sentence splitting and re-pack.
- Overlap (default 1 sentence): the last full sentence of chunk N is
  prepended to chunk N+1. Helps retrieval continuity for procedural answers
  ("step 1 ... step 2 ..." that would otherwise straddle a chunk boundary).

Tokenizer: by default we use a cheap chars/4 estimate (matches what AI SDK
defaults to). Production code can pass a real tokenizer (tiktoken, etc.) via
the `estimator` argument.
"""
from __future__ import annotations

import re
from typing import Callable, Iterable

DEFAULT_SOFT_TOKENS = 600
DEFAULT_HARD_TOKENS = 800
DEFAULT_OVERLAP_SENTENCES = 1

_QUOTE_HEAD_RE = re.compile(
    r"^(originally\s+posted\s+by[^\n]*\n.*?\n\n)",
    re.IGNORECASE | re.DOTALL,
)
# Sentence boundary: . ! ? (and CJK 。！？) followed by whitespace or end.
# We keep the punctuation with the sentence so re-joining stays faithful.
_SENT_RE = re.compile(r"(?<=[.!?。！？])\s+|\n+")


def _default_estimator(s: str) -> int:
    return max(1, len(s) // 4)


def _strip_quoted_head(text: str) -> str:
    """Drop a single 'Originally Posted by X' parent-quote block at the start.

    vBulletin formats quoted-reply blocks as a header line plus the parent
    body, separated from the actual reply by a blank line. Greedy match would
    eat the real reply; we anchor to the first blank line and stop there.
    """
    return _QUOTE_HEAD_RE.sub("", text, count=1).lstrip()


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENT_RE.split(text) if p and p.strip()]
    return parts


def _pack(
    units: Iterable[str],
    soft: int,
    hard: int,
    overlap: int,
    estimator: Callable[[str], int],
    sep: str,
) -> list[str]:
    """Greedy packer that flushes at the soft cap. Each unit must individually
    fit within the hard cap; callers handle that by sentence-splitting first.
    `sep` is the separator placed between packed units when joining."""
    chunks: list[str] = []
    current: list[str] = []
    current_tok = 0
    for unit in units:
        u_tok = estimator(unit)
        if u_tok > hard and not current:
            # Single oversized unit — caller should have split it. Emit alone.
            chunks.append(unit)
            current = []
            current_tok = 0
            continue
        # Would adding this unit exceed the soft cap?
        if current and current_tok + u_tok > soft:
            chunks.append(sep.join(current))
            # Carry overlap: the last `overlap` sentences from the just-flushed
            # chunk seed the next one. Sentence split on the flushed text.
            if overlap > 0:
                tail_sents = _split_sentences(chunks[-1])[-overlap:]
                if tail_sents:
                    seed = " ".join(tail_sents)
                    current = [seed]
                    current_tok = estimator(seed)
                    if current_tok + u_tok > soft and overlap > 0:
                        # Overlap itself is too big; drop it rather than blow
                        # past the cap.
                        current = []
                        current_tok = 0
                else:
                    current = []
                    current_tok = 0
            else:
                current = []
                current_tok = 0
        current.append(unit)
        current_tok += u_tok
    if current:
        chunks.append(sep.join(current))
    return chunks


def chunk_post(
    text: str,
    *,
    soft_tokens: int = DEFAULT_SOFT_TOKENS,
    hard_tokens: int = DEFAULT_HARD_TOKENS,
    overlap_sentences: int = DEFAULT_OVERLAP_SENTENCES,
    strip_quotes: bool = True,
    estimator: Callable[[str], int] | None = None,
) -> list[str]:
    """Return a list of chunk strings for the given post body.

    Empty/whitespace-only input yields []. A short post that fits in one chunk
    yields [text]. Longer posts are paragraph-packed; paragraphs that
    individually exceed the hard cap are sentence-split and re-packed.
    """
    if not text or not text.strip():
        return []
    est = estimator or _default_estimator
    if strip_quotes:
        text = _strip_quoted_head(text)
        if not text.strip():
            return []

    paras = _split_paragraphs(text)
    if not paras:
        return []

    # Expand any paragraph that's individually too big into its own sentences.
    expanded: list[str] = []
    para_sep = "\n\n"
    for p in paras:
        if est(p) <= hard_tokens:
            expanded.append(p)
            continue
        sents = _split_sentences(p)
        if not sents:
            expanded.append(p)
            continue
        # Pack sentences for this oversized paragraph at the same caps.
        sub_chunks = _pack(
            sents,
            soft=soft_tokens,
            hard=hard_tokens,
            overlap=0,           # overlap is handled at the outer level only
            estimator=est,
            sep=" ",
        )
        expanded.extend(sub_chunks)

    return _pack(
        expanded,
        soft=soft_tokens,
        hard=hard_tokens,
        overlap=overlap_sentences,
        estimator=est,
        sep=para_sep,
    )
