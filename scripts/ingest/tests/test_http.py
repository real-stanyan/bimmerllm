"""Fetcher rate-limit + retry behaviour. httpx is mocked end-to-end."""
import time

import httpx
import pytest

from ingest.http import BotChallenge, Fetcher


def make_response(status: int, body: str = "<html></html>") -> httpx.Response:
    return httpx.Response(status_code=status, text=body, request=httpx.Request("GET", "https://x"))


def test_get_returns_body_on_200(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mock = mocker.patch.object(f.client, "get", return_value=make_response(200, "hello"))
    assert f.get("https://x") == "hello"
    mock.assert_called_once_with("https://x")
    f.close()


def test_get_retries_on_5xx(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch("ingest.http.time.sleep")  # no-op the backoff
    mock = mocker.patch.object(f.client, "get", side_effect=[
        make_response(503), make_response(503), make_response(200, "ok"),
    ])
    assert f.get("https://x") == "ok"
    assert mock.call_count == 3
    f.close()


def test_get_raises_after_3_retries_5xx(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch("ingest.http.time.sleep")
    mocker.patch.object(f.client, "get", return_value=make_response(503))
    with pytest.raises(RuntimeError, match="gave up"):
        f.get("https://x")
    f.close()


def test_get_handles_429_with_long_sleep(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    sleep_mock = mocker.patch("ingest.http.time.sleep")
    mocker.patch.object(f.client, "get", side_effect=[
        make_response(429), make_response(200, "ok"),
    ])
    assert f.get("https://x") == "ok"
    # Verify a 60s cooldown was used somewhere
    assert any(call.args[0] >= 60 for call in sleep_mock.call_args_list)
    f.close()


def test_get_raises_BotChallenge_on_403(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch.object(f.client, "get", return_value=make_response(403))
    with pytest.raises(BotChallenge):
        f.get("https://x")
    f.close()


def test_get_retries_on_request_error(mocker):
    f = Fetcher(qps=100.0, jitter_sec=0.0)
    mocker.patch("ingest.http.time.sleep")
    mocker.patch.object(f.client, "get", side_effect=[
        httpx.ConnectError("boom"),
        httpx.ConnectError("boom"),
        make_response(200, "ok"),
    ])
    assert f.get("https://x") == "ok"
    f.close()


def test_rate_limit_enforces_min_interval(mocker):
    f = Fetcher(qps=10.0, jitter_sec=0.0)  # 100ms min interval
    mocker.patch.object(f.client, "get", return_value=make_response(200, "ok"))

    sleeps: list[float] = []
    real_sleep = time.sleep
    mocker.patch("ingest.http.time.sleep", side_effect=lambda s: (sleeps.append(s), real_sleep(0))[1])

    f.get("https://x")
    f.get("https://x")  # second request should incur a wait
    f.get("https://x")  # third too

    # at least two sleeps roughly near 0.1s should have happened
    near_threshold = [s for s in sleeps if 0.05 < s < 0.2]
    assert len(near_threshold) >= 2
    f.close()
