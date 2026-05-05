"""HTTP layer: rate-limited, retrying httpx wrapper.

Designed to crawl bimmerpost (vBulletin 3.8) for 100k+ requests without
triggering rate-limit / IP ban. Defaults err on the side of polite-and-slow:
0.5 qps + 0–2s jitter, periodic heartbeat breaks, automatic cool-down on
clusters of transient errors, and on-the-fly client rebuild when httpx's
connection pool gets stuck.
"""
from __future__ import annotations

import logging
import random
import time
from typing import Optional

import httpx

from .config import (
    COOLDOWN_AFTER_N_ERRORS,
    COOLDOWN_SECONDS,
    DEFAULT_JITTER_SEC,
    DEFAULT_QPS,
    HEARTBEAT_BREAK_EVERY_N,
    HEARTBEAT_BREAK_SECONDS,
    LONG_COOLDOWN_SECONDS,
    USER_AGENT,
)


logger = logging.getLogger(__name__)


class BotChallenge(Exception):
    """Raised on HTTP 403. If a Fetcher has stealth_fallback configured, this is
    caught internally and the URL is re-fetched via the fallback (Scrapling
    StealthyFetcher) before propagating to the caller."""


class StealthFetcher:
    """Lazy-loaded Scrapling StealthyFetcher wrapper, used as 403 fallback.

    Scrapling pulls Playwright Chromium (~300MB) and is slow to spin up, so we
    do not import or initialise anything until the first 403 actually fires.
    Tests stub `_load_impl` to keep unit tests independent of the optional dep.
    """

    def __init__(self, *, headless: bool = True, network_idle: bool = True):
        self.headless = headless
        self.network_idle = network_idle
        self._impl = None

    def _load_impl(self):
        from scrapling.fetchers import StealthyFetcher
        return StealthyFetcher

    def get(self, url: str) -> str:
        if self._impl is None:
            self._impl = self._load_impl()
        page = self._impl.fetch(
            url,
            headless=self.headless,
            network_idle=self.network_idle,
        )
        if page.status != 200:
            raise RuntimeError(
                f"stealth fallback got HTTP {page.status} for {url}"
            )
        return page.body.decode(getattr(page, "encoding", None) or "utf-8",
                                errors="replace")


def _build_client() -> httpx.Client:
    return httpx.Client(
        http2=False,                    # HTTP/1.1 looks more like a browser to vBulletin
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        },
        follow_redirects=True,
    )


class Fetcher:
    """Polite httpx.Client wrapper with rate limit + retry + backoff + cool-down.

    Behaviour summary:
      - 1/qps + uniform(0, jitter_sec) between every request
      - 200 → return body, reset error counters, advance success counter
      - 429 → cool-down sleep (5min, then 30min, then raise)
      - 5xx / network error → exp backoff up to 3 retries
      - Repeated transient errors across calls → cool-down sleep instead of abort
      - Every HEARTBEAT_BREAK_EVERY_N successful requests → 60s breather
      - On consecutive timeouts, the underlying httpx.Client is rebuilt
        to clear stuck connections.
    """

    def __init__(
        self,
        qps: float = DEFAULT_QPS,
        jitter_sec: float = DEFAULT_JITTER_SEC,
        heartbeat_every: int = HEARTBEAT_BREAK_EVERY_N,
        heartbeat_seconds: int = HEARTBEAT_BREAK_SECONDS,
        cooldown_after_n_errors: int = COOLDOWN_AFTER_N_ERRORS,
        cooldown_seconds: int = COOLDOWN_SECONDS,
        long_cooldown_seconds: int = LONG_COOLDOWN_SECONDS,
        stealth_fallback: Optional["StealthFetcher"] = None,
    ):
        self.client = _build_client()
        self.qps = qps
        self.jitter_sec = jitter_sec
        self.heartbeat_every = heartbeat_every
        self.heartbeat_seconds = heartbeat_seconds
        self.cooldown_after_n_errors = cooldown_after_n_errors
        self.cooldown_seconds = cooldown_seconds
        self.long_cooldown_seconds = long_cooldown_seconds
        self.stealth_fallback = stealth_fallback

        self._last_request_at: Optional[float] = None
        self._consecutive_429 = 0
        self._consecutive_transient = 0      # network error or 5xx
        self._cooldowns_taken = 0             # escalates each time
        self._success_count = 0               # for heartbeat break
        self._last_url: Optional[str] = None  # for Referer chain

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

    def _heartbeat_break(self) -> None:
        if self.heartbeat_every <= 0:
            return
        if self._success_count > 0 and self._success_count % self.heartbeat_every == 0:
            logger.info("[fetcher] heartbeat break — %d successes, sleeping %ds",
                        self._success_count, self.heartbeat_seconds)
            time.sleep(self.heartbeat_seconds)

    def _take_cooldown(self) -> None:
        """Cooldown sleep on cluster of transient errors. First cool-down is short,
        repeated cool-downs escalate to long. After 3 escalations we give up."""
        self._cooldowns_taken += 1
        if self._cooldowns_taken == 1:
            secs = self.cooldown_seconds
        elif self._cooldowns_taken < 4:
            secs = self.long_cooldown_seconds
        else:
            raise RuntimeError(
                f"too many cool-downs taken ({self._cooldowns_taken}). "
                f"bimmerpost likely rate-limiting this IP — pause manually + retry later."
            )
        logger.warning("[fetcher] entering cool-down #%d for %ds (consecutive_transient=%d)",
                       self._cooldowns_taken, secs, self._consecutive_transient)
        time.sleep(secs)
        # rebuild client to clear stuck pool / sockets
        try:
            self.client.close()
        except Exception:
            pass
        self.client = _build_client()
        self._consecutive_transient = 0
        logger.info("[fetcher] cool-down complete, client rebuilt")

    def _rebuild_client_if_stuck(self) -> None:
        """Soft refresh: after consecutive timeouts but before full cool-down,
        rebuild the client to clear any hung connections."""
        try:
            self.client.close()
        except Exception:
            pass
        self.client = _build_client()
        logger.info("[fetcher] client rebuilt after consecutive timeouts")

    def get(self, url: str) -> str:
        try:
            return self._http_get(url)
        except BotChallenge:
            if self.stealth_fallback is None:
                raise
            logger.warning("[fetcher] 403 BotChallenge for %s — escalating to stealth fallback", url)
            text = self.stealth_fallback.get(url)
            # treat as success: clear transient counters and advance bookkeeping
            self._consecutive_429 = 0
            self._consecutive_transient = 0
            self._success_count += 1
            self._last_url = url
            return text

    def _http_get(self, url: str) -> str:
        # heartbeat must run before rate-limit so its sleep doesn't get jittered
        self._heartbeat_break()

        last_exc: Optional[Exception] = None
        attempt = 0
        max_attempts = 3
        while attempt < max_attempts:
            self._rate_limit()

            headers = {}
            if self._last_url:
                headers["Referer"] = self._last_url

            try:
                resp = self.client.get(url, headers=headers)
                self._last_request_at = time.monotonic()
            except (httpx.RequestError, httpx.RemoteProtocolError) as e:
                last_exc = e
                self._consecutive_transient += 1
                if self._consecutive_transient >= self.cooldown_after_n_errors:
                    # major recovery — sleep, rebuild client, reset attempt counter,
                    # and try again. Cool-down has already cleared consecutive_transient.
                    self._take_cooldown()
                    attempt = 0
                    continue
                if self._consecutive_transient >= 2:
                    self._rebuild_client_if_stuck()
                attempt += 1
                if attempt < max_attempts:
                    time.sleep(2 ** attempt)
                    continue
                raise

            status = resp.status_code
            if status == 200:
                self._consecutive_429 = 0
                self._consecutive_transient = 0
                self._success_count += 1
                self._last_url = url
                return resp.text
            if status == 429:
                self._consecutive_429 += 1
                self._consecutive_transient += 1
                if self._consecutive_429 >= 5:
                    raise RuntimeError(f"5 consecutive 429s — aborting (last url: {url})")
                if self._consecutive_429 <= 2:
                    time.sleep(60)
                else:
                    self._take_cooldown()
                    attempt = 0  # cool-down reset; try again
                continue
            if 500 <= status < 600:
                self._consecutive_transient += 1
                if self._consecutive_transient >= self.cooldown_after_n_errors:
                    self._take_cooldown()
                    attempt = 0
                    continue
                attempt += 1
                if attempt < max_attempts:
                    time.sleep(2 ** attempt)
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
