"""Fungsi murni untuk subtitle: parse VTT, bersihkan teks, tulis ASS karaoke.

Tidak ada impor faster_whisper atau ffmpeg di sini supaya bisa dites murni.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

# 00:00:01.000 / 0:01.000 / 01:02,5
_TIMESTAMP_RE = re.compile(r"(?:(\d+):)?(\d{1,3}):(\d{1,2})[.,](\d{1,3})")
_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")
_NON_CUE_BLOCKS = {"NOTE", "STYLE", "REGION"}

WRAP_CHARS = 42
MAX_WORDS_PER_CUE = 7


@dataclass
class Word:
    start: float
    end: float
    text: str


@dataclass
class Cue:
    start: float
    end: float
    text: str
    words: List[Word] = field(default_factory=list)

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


def _is_auto_caption_line(line: str) -> bool:
    return bool(_TIMESTAMP_RE.search(line))


def parse_vtt(text: str, word_level: bool = False) -> List[Cue]:
    """Parse WebVTT jadi cue berurutan. Blok rusak dilewati, bukan error.

    word_level=True membaca tag <00:00:01.234> di dalam cue (subtitle auto
    YouTube) sebagai timestamp per kata.
    """
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
            words = _word_timing(body) if word_level else []
            if words:
                body_text = " ".join(word.text for word in words)
            else:
                body_text = sanitize("\n".join(body))
            if body_text and start is not None and end is not None and end > start:
                _fill_word_ends(words, end)
                _append_cue(cues, Cue(start=start, end=end, text=body_text, words=words))
            continue

        keyword = line.split()[0].upper()
        if keyword in _NON_CUE_BLOCKS:
            while index < total and lines[index].strip():
                index += 1
            continue

        # Header (WEBVTT, Kind:, Language:) atau nomor urut cue.
        index += 1

    return cues


def _append_cue(cues: List[Cue], cue: Cue) -> None:
    """Buang pengulangan khas auto-sub: cue = ekor cue sebelumnya (rolling caption)."""
    previous = cues[-1] if cues else None
    if previous is not None:
        if previous.text == cue.text:
            previous.end = max(previous.end, cue.end)  # baris sama tampil lebih lama
            return

        prev_tokens = [word.text for word in previous.words] or previous.text.split()
        tokens = [word.text for word in cue.words] or cue.text.split()
        overlap = 0
        for size in range(min(len(prev_tokens), len(tokens)), 0, -1):
            if tokens[:size] == prev_tokens[-size:]:
                overlap = size
                break
        if overlap:
            remaining = tokens[overlap:]
            if not remaining:
                previous.end = max(previous.end, cue.end)
                return
            cue = Cue(
                start=cue.start,
                end=cue.end,
                text=" ".join(remaining),
                words=cue.words[overlap:] if cue.words else [],
            )
    cues.append(cue)


def _word_timing(lines: Sequence[str]) -> List[Word]:
    """Timestamp inline per kata: "hi <00:01.500>there <00:02.000>you".

    Hasil kosong bila cue tidak punya timestamp inline.
    """
    words: List[Word] = []
    current: Optional[float] = None
    for line in lines:
        for chunk in re.split(r"(<\d+(?::\d+){1,2}[.,]\d+>)", line):
            if not chunk:
                continue
            if chunk.startswith("<") and _TIMESTAMP_RE.search(chunk):
                current = _parse_timestamp(chunk)
                continue
            for word in _WS_RE.sub(" ", _TAG_RE.sub(" ", chunk)).split():
                if current is None:
                    return []  # timestamp inline tidak lengkap: pakai cue utuh
                words.append(Word(start=current, end=current, text=word))
    return words


def _fill_word_ends(words: Sequence[Word], cue_end: float) -> None:
    """End tiap kata = start kata berikutnya; kata terakhir sampai cue_end."""
    for index, word in enumerate(words):
        word.end = words[index + 1].start if index + 1 < len(words) else cue_end


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


def _split_words(cue: Cue, max_words: int = MAX_WORDS_PER_CUE) -> List[Cue]:
    """Pecah cue panjang tanpa kata bertiming supaya layar tidak penuh."""
    if cue.words:
        return [cue]
    tokens = cue.text.split()
    if len(tokens) <= max_words:
        return [cue]
    step = cue.duration / len(tokens)
    result: List[Cue] = []
    for offset in range(0, len(tokens), max_words):
        chunk = tokens[offset : offset + max_words]
        start = cue.start + step * offset
        result.append(Cue(start=start, end=start + step * len(chunk), text=" ".join(chunk)))
    return result


def cue_to_words(cue: Cue) -> List[Word]:
    """Kata bertiming dari cue; tanpa inline timing dibagi durasi proporsional panjang kata."""
    if cue.words:
        return cue.words
    tokens = [token for token in cue.text.split() if token]
    if not tokens:
        return []
    # Bobot = jumlah huruf + 1 (spasi): kata panjang butuh waktu lebih lama.
    weights = [len(token) + 1 for token in tokens]
    total = float(sum(weights))
    words: List[Word] = []
    cursor = cue.start
    for token, weight in zip(tokens, weights):
        span = cue.duration * weight / total
        words.append(Word(start=cursor, end=cursor + span, text=token))
        cursor += span
    words[-1].end = cue.end  # buang drift pembulatan di kata terakhir
    return words


def clip_words(cues: Sequence[Cue], start: float, end: float) -> List[Word]:
    """Ambil kata di dalam jendela clip, geser waktunya ke 0."""
    limit = end - start
    result: List[Word] = []
    for cue in cues:
        for word in cue_to_words(cue):
            if word.end <= start or word.start >= end:
                continue
            word_start = max(0.0, word.start - start)
            word_end = min(limit, word.end - start)
            if word_end > word_start:
                result.append(Word(start=word_start, end=word_end, text=word.text))
    return result


def write_ass(
    cues: Sequence[Cue],
    width: int = 1080,
    height: int = 1920,
    font_size: int = 64,
    margin_v: int = 180,
) -> str:
    """Tulis ASS dengan format karaoke {\\k<durasi_cs>} per kata."""
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
        for part in _split_words(cue):
            _write_cue_part(part, lines)

    return "\n".join(lines) + "\n"


def _write_cue_part(cue: Cue, lines: List[str]) -> None:
    if cue.end <= cue.start:
        return
    words = cue_to_words(cue)
    if not words:
        return
    parts: List[str] = []
    for word in words:
        duration_cs = max(1, int(round((word.end - word.start) * 100)))
        parts.append(f"{{\\k{duration_cs}}}{_ass_escape(word.text)}")
    lines.append(
        f"Dialogue: 0,{_timestamp(cue.start)},{_timestamp(cue.end)},Default,,0,0,0,,"
        + " ".join(parts)
    )


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
