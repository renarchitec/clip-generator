import json
from io import BytesIO

import pytest

from clipper import live_chat


def test_extract_bootstrap_scopes_token_to_chat_renderer():
    html = '''"INNERTUBE_API_KEY" : "key", "continuation":"unrelated",
      "liveChatRenderer":{"continuations":[{"reloadContinuationData":{"continuation":"abc\\u003d"}}]}'''
    assert live_chat.extract_live_chat_bootstrap(html) == ("key", "abc=")
    assert live_chat.extract_live_chat_bootstrap(
        '"INNERTUBE_API_KEY":"key", "reloadContinuationData": {"continuation":"other"}'
    ) == ("key", "other")
    assert live_chat.extract_live_chat_bootstrap('"INNERTUBE_API_KEY":"key","continuation":"wrong"') is None
    assert live_chat.extract_live_chat_bootstrap('"liveChatRenderer":{"continuation":"keyless"}') is None


def _message(sec, *runs):
    return {"replayChatItemAction": {"videoOffsetTimeMsec": str(int(sec * 1000)), "actions": [
        {"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {"message": {"runs": runs}}}}},
    ]}}


def test_parse_actions_counts_reactions_but_not_pinned_or_system_items():
    actions = [
        _message(0, {"text": "PINNED!!!"}),
        _message(70, {"text": "hi"}),
        _message(80, {"text": "wkwkwk"}),
        _message(90, {"emoji": {"shortcuts": [":😂:"]}}),
        _message(130, {"text": "W"}),
        _message(131, {"text": "NOPE"}),
        {"replayChatItemAction": {"videoOffsetTimeMsec": "99000", "actions": [
            {"addChatItemAction": {"item": {"liveChatPaidMessageRenderer": {"message": "gg"}}}},
        ]}},
        {"replayChatItemAction": {"videoOffsetTimeMsec": "broken"}},
    ]
    assert live_chat.parse_chat_actions(actions, 100) == pytest.approx((4, 60, (4 / 60) * 1.6))
    assert live_chat.parse_chat_actions(actions, 400) == (0, 4.0, 0.0)
    assert live_chat.parse_chat_actions([_message(100, {"text": "WHAT!!!"})], 100) == (1, 4, 0.45)


def test_ranked_nms_lead_trail_and_boundary_clamp():
    assert live_chat.select_peak_windows(
        [(85, 5), (40, 6), (150, 0), (300, 4)], duration_sec=310,
    ) == [(0.0, 65.0), (245.0, 310.0)]
    assert live_chat.select_peak_windows([(100, 5), (300, 4)], 500, max_windows=1) == [(45.0, 125.0)]


def test_adjacent_windows_merge_and_respect_budget():
    samples = [(100, 5), (180, 4), (265, 3), (500, 8)]
    assert live_chat.select_peak_windows(samples, 600) == [(45.0, 290.0), (445.0, 525.0)]
    assert live_chat.select_peak_windows(samples, 600, max_total_sec=120) == [
        (72.5, 112.5), (445.0, 525.0),
    ]


def test_heatmap_centers_windows_and_honors_source_limit():
    heatmap = [
        {"start_time": 90, "end_time": 110, "value": 0.7},
        {"start_time": 290, "end_time": 310, "value": 1.0},
        {"start_time": 5, "value": 99},
    ]
    assert live_chat.windows_from_heatmap(heatmap, 800, max_source_sec=120) == [(60.0, 120.0)]
    assert live_chat.windows_from_heatmap(None, 800) == []


def test_probe_posts_seek_offsets_and_ignores_failed_probes(monkeypatch):
    offsets = []

    def fake_urlopen(request, timeout):
        if request.get_method() == "GET":
            assert timeout == 15 and request.get_header("User-agent") == "Mozilla/5.0"
            return BytesIO(b'"INNERTUBE_API_KEY":"key","liveChatRenderer":{"continuation":"token"}')
        assert request.full_url.endswith("/get_live_chat_replay?key=key")
        assert timeout == 10
        request_data = json.loads(request.data)
        assert request_data["continuation"] == "token"
        sec = int(request_data["currentPlayerState"]["playerOffsetMs"]) / 1000
        offsets.append(sec)
        if sec < 40:
            raise OSError("probe failed")
        data = {"continuationContents": {"liveChatContinuation": {"actions": [_message(sec, {"text": "gg"})]}}}
        return BytesIO(json.dumps(data).encode())

    monkeypatch.setattr(live_chat, "urlopen", fake_urlopen)
    windows = live_chat.probe_live_chat_windows("https://www.youtube.com/watch?v=example", 500, max_source_sec=100)
    assert sorted(offsets) == [10, 50, 90]
    assert windows == [(0.0, 75.0)]
