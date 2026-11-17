"""Fungsi murni untuk subtitle: parse VTT, bersihkan teks, tulis ASS.

Tidak ada impor faster_whisper atau ffmpeg di sini supaya bisa dites murni.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Sequence

# 00:00:01.000 / 0:01.000 / 01:02,5
_TIMESTAMP_RE = re.compile(r"(?:(\d+):)?(\d{1,3}):(\d{1,2})[.,](\d{1,3})")
_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")
_NON_CUE_BLOCKS = {"NOTE", "STYLE", "REGION"}

WRAP_CHARS = 42


@dataclass
class Cue:
    start: float
    end: float
    text: str

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def _parse_timestamp(value: str) -> Optional[float]:
    match = _TIMESTAMP_RE.search(value or "")
    if not match:
        return None
    hours, minutes, seconds, fraction = match.groups()
    millis = fraction
    if len(millis) > 3:
        millis = millis[:3]
    fraction_seconds = int(millis) / (10 ** len(millis)) if millis else 0.0
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds) + fraction_seconds


def _parse_timing(line: str) -> tuple[Optional[float], Optional[float]]:
    left, _, right = line.partition("-->")
    if not right:
        return None, None
    # Buang cue settings setelah timestamp: "align:start position:10%"
    end_token = right.strip().split()[0] if right.strip() else ""
    return _parse_timestamp(left), _parse_timestamp(end_token)


def sanitize(text: str) -> str:
    """Buang tag inline, rapikan spasi. Teks kosong jadi string kosong."""
    if not text:
        return ""
    cleaned = _TAG_RE.sub(" ", text)
    cleaned = (
        cleaned.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    return _WS_RE.sub(" ", cleaned).strip()


def parse_vtt(text: str) -> List[Cue]:
    """Parse WebVTT jadi cue berurutan. Blok rusak dilewati, bukan error."""
    if not text:
        return []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues: List[Cue] = []
    index = 0
    total = len(lines)

    while index < total:
        line = lines[index].strip()
        if not line:
            index += 1
            continue

        if "-->" in line:
            start, end = _parse_timing(line)
            index += 1
            body: List[str] = []
            while index < total and lines[index].strip():
                body.append(lines[index])
                index += 1
            body_text = sanitize("\n".join(body))
            if body_text and start is not None and end is not None and end > start:
                cues.append(Cue(start=start, end=end, text=body_text))
            continue

        keyword = line.split()[0].upper()
        if keyword in _NON_CUE_BLOCKS:
            while index < total and lines[index].strip():
                index += 1
            continue

        # Header (WEBVTT, Kind:, Language:) atau nomor urut cue.
        index += 1

    return cues


def _timestamp(value: float) -> str:
    """ASS: H:MM:SS.cc (centisecond)."""
    centiseconds = int(round(max(0.0, value) * 100))
    hours, rest = divmod(centiseconds, 360000)
    minutes, rest = divmod(rest, 6000)
    seconds, cs = divmod(rest, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    # "\\" dulu supaya backslash yang kita sisipkan untuk \N tidak ikut di-escape.
    return text.replace("\\", "\\\\").replace("{", "\\{")


def _wrap(text: str, max_chars: int = WRAP_CHARS) -> List[str]:
    words = text.split()
    if not words:
        return []
    lines: List[str] = []
    current = words[0]
    for word in words[1:]:
        if len(current) + 1 + len(word) <= max_chars:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _dialogue_text(text: str) -> str:
    lines = _wrap(text)
    if not lines:
        return ""
    return "\\N".join(_ass_escape(line) for line in lines)


def write_ass(
    cues: Sequence[Cue],
    width: int = 1080,
    height: int = 1920,
    font_size: int = 64,
    margin_v: int = 180,
) -> str:
    style = (
        "Style: Default,DejaVu Sans,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        "-1,0,0,0,100,100,0,0,1,3,0,2,60,60,{margin_v},1"
    ).format(font_size=int(font_size), margin_v=int(margin_v))

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        f"PlayResX: {int(width)}",
        f"PlayResY: {int(height)}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        style,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    for cue in cues:
        if cue.end <= cue.start:
            continue
        text = _dialogue_text(cue.text)
        if not text:
            continue
        lines.append(
            f"Dialogue: 0,{_timestamp(cue.start)},{_timestamp(cue.end)},Default,,0,0,0,,{text}"
        )

    return "\n".join(lines) + "\n"


def _chunk_words(words: Sequence[str], parts: int) -> List[str]:
    if parts <= 1:
        return [" ".join(words)]
    size = len(words) // parts
    remainder = len(words) % parts
    chunks: List[str] = []
    cursor = 0
    for part in range(parts):
        take = size + (1 if part < remainder else 0)
        chunks.append(" ".join(words[cursor : cursor + take]))
        cursor += take
    return [chunk for chunk in chunks if chunk]


def split_long_cues(
    cues: Sequence[Cue],
    max_chars: int = WRAP_CHARS,
    max_duration: float = 4.0,
) -> List[Cue]:
    """Pecah cue yang terlalu panjang/panjang durasinya jadi beberapa cue.

    Dipakai sebelum tulis ASS supaya subtitle tidak menumpuk di satu layar.
    """
    result: List[Cue] = []
    for cue in cues:
        if cue.end <= cue.start:
            continue
        words = cue.text.split()
        if not words:
            continue

        by_duration = int(-(-cue.duration // max_duration)) if max_duration > 0 else 1
        by_chars = int(-(-len(cue.text) // max_chars)) if max_chars > 0 else 1
        parts = max(1, by_duration, by_chars)
        if parts == 1:
            result.append(cue)
            continue

        chunks = _chunk_words(words, parts)
        if len(chunks) == 1:
            result.append(cue)
            continue

        step = cue.duration / len(chunks)
        for number, chunk in enumerate(chunks):
            start = cue.start + step * number
            result.append(Cue(start=start, end=start + step, text=chunk))

    return result
