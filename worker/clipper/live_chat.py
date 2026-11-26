"""Sample YouTube chat replay at seek offsets instead of downloading the full replay."""

from __future__ import annotations

import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

_API_KEY = re.compile(r'"INNERTUBE_API_KEY"\s*:\s*"([^"\\]+)"')
_RENDERER = re.compile(r'"liveChatRenderer"\s*:\s*(?=\{)')
_RELOAD = re.compile(r'"reloadContinuationData"\s*:\s*(?=\{)')
_REACTION = re.compile(
    r"\b(?:(?:wk){2,}w?|(?:ha){2,}h?|(?:he){2,}h?|ngakak|kocak|anjir|anjay|"
    r"gokil|gila|parah|clip|klip|lmao|lol|wtf|omg|gg)\b|[😂🤣💀😭🔥]",
    re.IGNORECASE,
)
_EMPHASIS = re.compile(r"\b[WL]\b|!{3,}|\b[A-Z]{4,}\b")
_UA = "Mozilla/5.0"


def _continuation(data: Any) -> Optional[str]:
    if isinstance(data, dict):
        token = data.get("continuation")
        if isinstance(token, str) and token:
            return token
        for value in data.values():
            if token := _continuation(value):
                return token
    elif isinstance(data, list):
        for item in data:
            if token := _continuation(item):
                return token
    return None


def extract_live_chat_bootstrap(html: str) -> Optional[Tuple[str, str]]:
    key = _API_KEY.search(html)
    if not key:
        return None
    decoder = json.JSONDecoder()
    for pattern in (_RENDERER, _RELOAD):
        for match in pattern.finditer(html):
            try:
                data, _ = decoder.raw_decode(html, match.end())
            except ValueError:
                continue
            if token := _continuation(data.get("continuations")) or _continuation(data):
                return key[1], token
    return None


def _message_text(renderer: Mapping[str, Any]) -> str:
    message = renderer.get("message") or {}
    parts = []
    for run in message.get("runs") or []:
        if isinstance(run.get("text"), str):
            parts.append(run["text"])
        else:
            emoji = run.get("emoji") or {}
            labels = [*(emoji.get("shortcuts") or []), emoji.get("emojiId")]
            parts.append(" " + " ".join(label for label in labels if isinstance(label, str)) + " ")
    return "".join(parts).strip()


def parse_chat_actions(
    actions: Sequence[Mapping[str, Any]], anchor_sec: float, window_radius_sec: float = 30.0,
) -> Tuple[int, float, float]:
    times: List[float] = []
    reactions = 0
    for entry in actions:
        replay = entry.get("replayChatItemAction") or {}
        try:
            sec = float(replay.get("videoOffsetTimeMsec")) / 1000.0
        except (TypeError, ValueError):
            continue
        if not anchor_sec - window_radius_sec <= sec <= anchor_sec + window_radius_sec:
            continue
        for action in replay.get("actions") or []:
            item = (action.get("addChatItemAction") or {}).get("item") or {}
            renderer = item.get("liveChatTextMessageRenderer")
            if not renderer or not (text := _message_text(renderer)):
                continue
            times.append(sec)
            reactions += bool(_REACTION.search(text) or _EMPHASIS.search(text))
    count = len(times)
    span = max(max(times) - min(times), 4.0) if times else 4.0
    score = (count / span) * (1.0 + 0.8 * reactions / count) if count else 0.0
    return count, span, score


def select_peak_windows(
    samples: Sequence[Tuple[float, float]], duration_sec: float, max_windows: int = 8,
    window_sec: float = 80.0, lead_sec: float = 55.0, max_total_sec: float = 900.0,
) -> List[Tuple[float, float]]:
    if duration_sec <= 0 or max_windows <= 0 or window_sec <= 0 or max_total_sec <= 0:
        return []
    lead_sec = min(window_sec, max(0.0, lead_sec))
    peaks: List[float] = []
    ranked = sorted(samples, key=lambda sample: (-sample[1], sample[0]))
    for at, score in ranked:
        if not (score > 0 and 0 <= at <= duration_sec):
            continue
        if all(abs(at - peak) >= window_sec for peak in peaks):
            peaks.append(at)
            if len(peaks) >= max_windows:
                break

    merged: List[Tuple[float, float]] = []
    for peak in sorted(peaks):
        start = max(0.0, peak - lead_sec)
        end = min(duration_sec, peak + window_sec - lead_sec)
        if start >= end:
            continue
        if merged and start - merged[-1][1] <= 5.0:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    # When over budget, keep coverage nearest to the highest-ranked peaks first.
    if sum(end - start for start, end in merged) <= max_total_sec:
        return merged
    rank = {peak: i for i, peak in enumerate(peaks)}
    groups = [(min(rank[p] for p in peaks if start <= p <= end), start, end)
              for start, end in merged]
    result = []
    remaining = max_total_sec
    for best, start, end in sorted(groups):
        if remaining <= 0:
            break
        length = min(end - start, remaining)
        preferred = peaks[best] - min(lead_sec, length * lead_sec / window_sec)
        start = max(start, min(preferred, end - length))
        result.append((start, start + length))
        remaining -= length
    return sorted(result)


def _probe(api_key: str, continuation: str, offset: float) -> Tuple[float, float]:
    endpoint = "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay"
    payload = {
        "context": {"client": {"clientName": "WEB", "clientVersion": "2.20250101.00.00"}},
        "continuation": continuation,
        "currentPlayerState": {"playerOffsetMs": str(int(offset * 1000))},
    }
    req = Request(endpoint + "?" + urlencode({"key": api_key}),
                  data=json.dumps(payload).encode(),
                  headers={"User-Agent": _UA, "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as response:
            replay = json.load(response)["continuationContents"]["liveChatContinuation"]
        _, _, score = parse_chat_actions(replay.get("actions") or [], offset)
    except Exception:
        return offset, 0.0
    return offset, score


def _effective_end(duration_sec: float, max_source_sec: Optional[int]) -> float:
    return min(duration_sec, float(max_source_sec)) if max_source_sec else duration_sec


def probe_live_chat_windows(
    url: str, duration_sec: float, max_source_sec: Optional[int] = None,
    max_windows: int = 8, window_sec: float = 80.0,
) -> List[Tuple[float, float]]:
    effective_end = _effective_end(duration_sec, max_source_sec)
    if not math.isfinite(effective_end) or effective_end <= 0:
        return []
    try:
        with urlopen(Request(url, headers={"User-Agent": _UA}), timeout=15) as response:
            bootstrap = extract_live_chat_bootstrap(response.read().decode("utf-8", "replace"))
    except Exception:
        return []
    if not bootstrap:
        return []

    first = min(30.0, effective_end * 0.1)
    last = max(effective_end - 20.0, effective_end * 0.9)
    intervals = min(79, int((last - first) / 30.0))
    offsets = ([first + i * (last - first) / intervals for i in range(intervals + 1)]
               if intervals else [(first + last) / 2.0])
    with ThreadPoolExecutor(max_workers=6) as pool:
        samples = list(pool.map(lambda offset: _probe(*bootstrap, offset), offsets))
    return select_peak_windows(samples, effective_end, max_windows, window_sec)


def windows_from_heatmap(
    heatmap: Optional[Sequence[Mapping[str, Any]]], duration_sec: float,
    max_source_sec: Optional[int] = None, max_windows: int = 8, window_sec: float = 80.0,
) -> List[Tuple[float, float]]:
    samples = []
    for entry in heatmap or ():
        try:
            start, end = float(entry["start_time"]), float(entry["end_time"])
            score = float(entry["value"])
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= start <= end and math.isfinite(end) and math.isfinite(score):
            samples.append(((start + end) / 2.0, score))
    return select_peak_windows(samples, _effective_end(duration_sec, max_source_sec),
                               max_windows, window_sec, lead_sec=window_sec / 2.0)
