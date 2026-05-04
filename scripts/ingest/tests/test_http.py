"""Fetcher rate-limit + retry + cool-down behaviour. httpx is mocked end-to-end."""
import time
from unittest.mock import MagicMock

import httpx
import pytest

from ingest.http import BotChallenge, Fetcher


def make_response(status: int, body: str = "<html></html>") -> httpx.Response:
    return httpx.Response(status_code=status, text=body, request=httpx.Request("GET", "https://x"))


def _patch_client(mocker, *, get_side_effect=None, get_return=None):
    """Stub `_build_client` so every Fetcher instance + every client rebuild
    returns the same MagicMock, whose `.get` is configured by the caller.
    Returns the mock for assertion-side use."""
    fake = MagicMock()
    if get_side_effect is not None:
        fake.get.side_effect = get_side_effect
    elif get_return is not None:
        fake.get.return_value = get_return
    mocker.patch("ingest.http._build_client", return_value=fake)
    return fake


def test_get_returns_body_on_200(mocker):
    fake = _patch_client(mocker, get_return=make_response(200, "hello"))
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    assert f.get("https://x") == "hello"
    assert fake.get.call_count == 1
    args, kwargs = fake.get.call_args
    assert args == ("https://x",)
    f.close()


def test_get_retries_on_5xx(mocker):
    fake = _patch_client(mocker, get_side_effect=[
        make_response(503), make_response(503), make_response(200, "ok"),
    ])
    mocker.patch("ingest.http.time.sleep")
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    assert f.get("https://x") == "ok"
    assert fake.get.call_count == 3
    f.close()


def test_get_raises_after_3_retries_5xx(mocker):
    _patch_client(mocker, get_return=make_response(503))
    mocker.patch("ingest.http.time.sleep")
    # Disable cool-down so we exercise the bare-3-attempt path; otherwise
    # cool-down kicks in on the 3rd 503 and would loop until cool-down limit.
    f = Fetcher(qps=100.0, jitter_sec=0.0, cooldown_after_n_errors=99)
    with pytest.raises(RuntimeError, match="gave up"):
        f.get("https://x")
    f.close()


def test_get_handles_429_with_60s_sleep(mocker):
    _patch_client(mocker, get_side_effect=[
        make_response(429), make_response(200, "ok"),
    ])
    sleep_mock = mocker.patch("ingest.http.time.sleep")
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    assert f.get("https://x") == "ok"
    # First 1-2 429s → 60s sleep, escalates to cooldown after that
    assert any(call.args[0] >= 60 for call in sleep_mock.call_args_list)
    f.close()


def test_get_raises_BotChallenge_on_403(mocker):
    _patch_client(mocker, get_return=make_response(403))
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    with pytest.raises(BotChallenge):
        f.get("https://x")
    f.close()


def test_get_retries_on_request_error(mocker):
    fake = _patch_client(mocker, get_side_effect=[
        httpx.ConnectError("boom"),
        httpx.ConnectError("boom"),
        make_response(200, "ok"),
    ])
    mocker.patch("ingest.http.time.sleep")
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    assert f.get("https://x") == "ok"
    assert fake.get.call_count == 3
    f.close()


def test_rate_limit_enforces_min_interval(mocker):
    _patch_client(mocker, get_return=make_response(200, "ok"))
    f = Fetcher(qps=10.0, jitter_sec=0.0)  # 100ms min interval

    sleeps: list[float] = []
    real_sleep = time.sleep
    mocker.patch("ingest.http.time.sleep", side_effect=lambda s: (sleeps.append(s), real_sleep(0))[1])

    f.get("https://x")
    f.get("https://x")
    f.get("https://x")

    near_threshold = [s for s in sleeps if 0.05 < s < 0.2]
    assert len(near_threshold) >= 2
    f.close()


def test_heartbeat_break_after_n_successes(mocker):
    """Every heartbeat_every successes should trigger a multi-second sleep."""
    _patch_client(mocker, get_return=make_response(200, "ok"))
    sleep_mock = mocker.patch("ingest.http.time.sleep")
    f = Fetcher(qps=100.0, jitter_sec=0.0, heartbeat_every=3, heartbeat_seconds=42)

    for _ in range(7):
        f.get("https://x")

    # Heartbeat should have fired before request 4 (after 3 successes) and before
    # request 7 (after 6 successes) — at least two ~42s sleeps.
    heartbeat_sleeps = [c.args[0] for c in sleep_mock.call_args_list if c.args[0] == 42]
    assert len(heartbeat_sleeps) >= 2
    f.close()


def test_cooldown_triggers_on_consecutive_transient_errors(mocker):
    """After N consecutive 5xx + network errors, fetcher should sleep cooldown
    and rebuild the client instead of just aborting."""
    fake = _patch_client(mocker, get_side_effect=[
        # 5 transient errors triggers cool-down on the 5th
        make_response(503), make_response(503), make_response(503),
        make_response(503), make_response(503),
        make_response(200, "ok"),
    ])
    sleep_mock = mocker.patch("ingest.http.time.sleep")
    f = Fetcher(qps=100.0, jitter_sec=0.0, cooldown_after_n_errors=5,
                cooldown_seconds=300)

    # First call burns 3 retry attempts on 503; but after 3 consecutive transient
    # errors (less than the threshold of 5) it gives up. Make a second call
    # to push consecutive_transient to ≥ 5 and observe cooldown sleep.
    with pytest.raises(RuntimeError):
        f.get("https://x")  # raises after 3 attempts (consecutive_transient=3)
    # consecutive_transient is 3, need 2 more to hit cooldown threshold
    f.get("https://x")  # 4th + 5th → cooldown → new client → 200

    # cool-down sleep of 300s should have been requested
    cooldown_sleeps = [c.args[0] for c in sleep_mock.call_args_list if c.args[0] == 300]
    assert cooldown_sleeps, f"no 300s cooldown sleep observed (saw: {[c.args[0] for c in sleep_mock.call_args_list]})"
    f.close()


def test_referer_chain(mocker):
    """Each successful call should record its URL as Referer for the next."""
    fake = _patch_client(mocker, get_return=make_response(200, "ok"))
    f = Fetcher(qps=100.0, jitter_sec=0.0)

    f.get("https://x/page1")
    f.get("https://x/page2")

    # second call must have included Referer: page1
    second_call = fake.get.call_args_list[1]
    assert second_call.kwargs.get("headers", {}).get("Referer") == "https://x/page1"
    f.close()


def test_client_rebuilt_after_consecutive_timeouts(mocker):
    """After 2 consecutive ConnectError, the underlying httpx.Client should be
    rebuilt — protecting against httpx pool getting stuck on half-open sockets."""
    fake = _patch_client(mocker, get_side_effect=[
        httpx.ConnectError("boom"),
        httpx.ConnectError("boom"),
        make_response(200, "ok"),
    ])
    build_mock = mocker.patch.object(fake, "close", return_value=None)
    mocker.patch("ingest.http.time.sleep")

    f = Fetcher(qps=100.0, jitter_sec=0.0)
    initial_build_count = mocker.patch
    # Track how many times _build_client is invoked total (init + rebuilds)
    builder = mocker.patch("ingest.http._build_client", return_value=fake)

    # Make a call that triggers 2 consecutive transient errors → rebuild → success
    f.get("https://x")

    # _build_client called at least once for rebuild (after the initial fixture call)
    assert builder.call_count >= 1, \
        f"expected at least one client rebuild, got {builder.call_count}"
    f.close()
