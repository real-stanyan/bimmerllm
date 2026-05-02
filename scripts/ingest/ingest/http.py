"""HTTP layer: rate-limited, retrying httpx wrapper."""
from __future__ import annotations

import random
import time
from typing import Optional

import httpx

from .config import DEFAULT_JITTER_SEC, DEFAULT_QPS, USER_AGENT


class BotChallenge(Exception):
    """Raised on HTTP 403 — caller should abort and (future) escalate to playwright."""


class Fetcher:
    """Single httpx.Client wrapper with rate limit + retry + backoff."""

    def __init__(self, qps: float = DEFAULT_QPS, jitter_sec: float = DEFAULT_JITTER_SEC):
        self.client = httpx.Client(
            http2=True,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
            },
            follow_redirects=True,
        )
        self.qps = qps
        self.jitter_sec = jitter_sec
        self._last_request_at: Optional[float] = None
        self._consecutive_429 = 0

    def _rate_limit(self) -> None:
        if self._last_request_at is None:
            return
        elapsed = time.monotonic() - self._last_request_at
        min_interval = 1.0 / self.qps if self.qps > 0 else 0.0
        wait = max(0.0, min_interval - elapsed)
        if self.jitter_sec > 0:
            wait += random.uniform(0, self.jitter_sec)
        if wait > 0:
            time.sleep(wait)

    def get(self, url: str) -> str:
        last_exc: Optional[Exception] = None
        for attempt in range(3):
            self._rate_limit()
            try:
                resp = self.client.get(url)
                self._last_request_at = time.monotonic()
            except httpx.RequestError as e:
                last_exc = e
                if attempt < 2:
                    time.sleep(2 ** (attempt + 1))
                    continue
                raise

            status = resp.status_code
            if status == 200:
                self._consecutive_429 = 0
                return resp.text
            if status == 429:
                self._consecutive_429 += 1
                if self._consecutive_429 >= 3:
                    raise RuntimeError(f"3 consecutive 429s — aborting (last url: {url})")
                time.sleep(60)
                continue
            if 500 <= status < 600:
                if attempt < 2:
                    time.sleep(2 ** (attempt + 1))
                    continue
                last_exc = RuntimeError(f"HTTP {status} for {url}")
                continue
            if status == 403:
                raise BotChallenge(url)
            resp.raise_for_status()
        raise RuntimeError(f"gave up after 3 retries: {url} (last error: {last_exc})")

    def close(self) -> None:
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
