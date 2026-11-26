"""Fungsi murni untuk subtitle: parse VTT, bersihkan teks, tulis ASS karaoke.

Tidak ada impor faster_whisper atau ffmpeg di sini supaya bisa dites murni.
"""

from __future__ import annotations

import re
from bisect import bisect_right
from dataclasses import dataclass, field
from html import unescape
from typing import Iterator, List, Optional, Sequence

from .models import CaptionStyle

# 00:00:01.000 / 0:01.000 / 01:02,5
_TIMESTAMP_RE = re.compile(r"(?:(\d+):)?(\d{1,3}):(\d{1,2})[.,](\d{1,3})")
_INLINE_TIMESTAMP_RE = re.compile(rf"<{_TIMESTAMP_RE.pattern}>")
_TAG_RE = re.compile(r"<[^>]*>")
_TOKEN_RE = re.compile(r"[♪♫♬♩]+|[^\s♪♫♬♩]+")
_ANNOTATION_RE = re.compile(r"\[[^\]]*\]|\(([^()[\]]{1,40})\)")
_CENSOR_MARK_RE = re.compile(r"_+|\*+")
_MASKED_WORD_RE = re.compile(r"[A-Za-z]+\*+[A-Za-z*]*|\*+[A-Za-z]+[A-Za-z*]*")
_ORPHAN_PUNCT_RE = re.compile(r"[.,;:!?]+")
_EXPRESSION_TERMS = {
    "tertawa", "tawa", "musik", "tepuk tangan", "bersorak", "sorakan",
    "menangis", "tangisan", "menghela napas", "napas", "batuk", "berdeham",
    "hening", "diam", "sensor", "disensor", "bleep", "bip", "efek suara",
    "laughter", "laughs", "laughing", "chuckles", "giggles", "music", "singing",
    "applause", "cheering", "cheers", "clapping", "crying", "sobbing", "sighs",
    "sighing", "gasps", "groans", "coughs", "clears throat", "silence", "inaudible",
    "unintelligible", "crosstalk", "censored", "expletive", "beep", "sound effect",
    "foreign", "speaking foreign language",
}
_NON_CUE_BLOCKS = {"NOTE", "STYLE", "REGION"}
MAX_TAIL_WORD_SEC = 1.2

# Anton (condensed, huruf besar) jauh lebih lebar per karakter daripada DejaVu:
# 4 kata / 18 karakter supaya takarir tetap satu baris di 1080px.
WRAP_CHARS = 18
MAX_WORDS_PER_CUE = 4
# 16:9 (1920px lebar) bisa memuat lebih banyak kata per baris.
WRAP_CHARS_WIDE = 32
MAX_WORDS_PER_CUE_WIDE = 6

# Gaya caption "hook": putih tebal outline hitam 6px, kata aktif kuning.
# ASS memakai BGR: &H0000FFFF = kuning, &H00FFFFFF = putih.
FONT_NAME = "Anton"
HIGHLIGHT_COLOUR = "&H0000FFFF"
TEXT_COLOUR = "&H00FFFFFF"


def hex_to_ass_color(hex_color: str, alpha: int = 0) -> str:
    """Convert #RRGGBB to ASS &HAABBGGRR."""
    color = hex_color.lstrip("#")
    return f"&H{max(0, min(255, int(alpha))):02X}{color[4:6].upper()}{color[2:4].upper()}{color[:2].upper()}"


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


def _caption_tokens(text: str) -> Iterator[tuple[int, str, bool]]:
    """Yield each token's text offset and whether it should be displayed."""
    def tokens(start: int, end: int) -> Iterator[tuple[int, str, bool]]:
        for match in _TOKEN_RE.finditer(text, start, end):
            token = match[0]
            core = token.strip(".,!?;:\"'()—–-")
            filtered = (
                token[0] in "♪♫♬♩"
                or _ORPHAN_PUNCT_RE.fullmatch(token)
                or (len(core) >= 2 and _CENSOR_MARK_RE.fullmatch(core))
                or _MASKED_WORD_RE.fullmatch(core)
            )
            yield match.start(), token, not filtered

    cursor = 0
    for match in _ANNOTATION_RE.finditer(text):
        inner = match[1]
        if inner is not None:
            expression = " ".join(inner.lower().split())
            if expression not in _EXPRESSION_TERMS and not _CENSOR_MARK_RE.fullmatch(expression):
                continue
        yield from tokens(cursor, match.start())
        yield match.start(), match[0], False
        cursor = match.end()
    yield from tokens(cursor, len(text))


def sanitize(text: str) -> str:
    """Remove VTT tags, annotations and censored words, and normalize whitespace."""
    if not text:
        return ""
    cleaned = unescape(_TAG_RE.sub(" ", text))
    return " ".join(token for _, token, keep in _caption_tokens(cleaned) if keep)


def _is_auto_caption_line(line: str) -> bool:
    return bool(_INLINE_TIMESTAMP_RE.search(line))


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
            while index < total and lines[index] != "":
                body.append(lines[index])
                index += 1
            if start is None or end is None or end <= start:
                continue
            if word_level and any(_is_auto_caption_line(line) for line in body):
                words = _word_timing(body, start, end)
                if words:
                    body_text = " ".join(word.text for word in words)
                    _append_cue(cues, Cue(words[0].start, words[-1].end, body_text, words))
            else:
                body_text = sanitize("\n".join(body))
                if body_text:
                    _append_cue(cues, Cue(start, end, body_text))
            continue

        keyword = line.split()[0].upper()
        if keyword in _NON_CUE_BLOCKS:
            while index < total and lines[index] != "":
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
            if not previous.words:
                previous.end = max(previous.end, cue.end)
            return

        prev_tokens = [word.text for word in previous.words] or previous.text.split()
        tokens = [word.text for word in cue.words] or cue.text.split()
        if (
            not cue.words
            and cue.duration <= 0.05
            and len(tokens) >= len(prev_tokens)
            and tokens[-len(prev_tokens):] == prev_tokens
        ):
            return
        overlap = 0
        for size in range(min(len(prev_tokens), len(tokens)), 0, -1):
            if tokens[:size] == prev_tokens[-size:]:
                overlap = size
                break
        if overlap:
            remaining = tokens[overlap:]
            if not remaining:
                if not previous.words:
                    previous.end = max(previous.end, cue.end)
                return
            remaining_words = cue.words[overlap:]
            cue = Cue(
                start=remaining_words[0].start if remaining_words else cue.start,
                end=cue.end,
                text=" ".join(remaining),
                words=remaining_words,
            )
    cues.append(cue)


def _word_timing(
    lines: Sequence[str],
    cue_start: Optional[float] = None,
    cue_end: float = float("inf"),
) -> List[Word]:
    """Read inline timestamps, ignoring the previous line of rolling captions."""
    first_ts_idx = next((i for i, line in enumerate(lines) if _is_auto_caption_line(line)), None)
    if first_ts_idx is None:
        return []

    # Track offsets through tag removal so annotations can span inline timestamps.
    chunks: List[str] = []
    offsets: List[int] = []
    starts: List[Optional[float]] = []
    offset = 0
    current = cue_start
    raw = " ".join(lines[first_ts_idx:])
    cursor = 0
    for tag in _TAG_RE.finditer(raw):
        chunk = unescape(raw[cursor:tag.start()])
        offsets.append(offset)
        starts.append(current)
        chunks.append(chunk)
        offset += len(chunk) + 1
        if _INLINE_TIMESTAMP_RE.fullmatch(tag[0]):
            current = _parse_timestamp(tag[0])
        cursor = tag.end()
    offsets.append(offset)
    starts.append(current)
    chunks.append(unescape(raw[cursor:]))

    words: List[Word] = []
    visible: List[Word] = []
    for token_offset, token, keep in _caption_tokens(" ".join(chunks)):
        start = starts[bisect_right(offsets, token_offset) - 1]
        if start is None:
            return []
        word = Word(start, start, token)
        words.append(word)
        if keep:
            visible.append(word)
    # A suppressed word still marks the end of the preceding spoken word.
    if words:
        _fill_word_ends(words, cue_end)
    return visible


def _fill_word_ends(words: Sequence[Word], cue_end: float) -> None:
    """End each word at the next start, splitting tied starts and capping tail silence."""
    total = len(words)
    index = 0
    while index < total:
        group_start = words[index].start
        end_index = index + 1
        while end_index < total and words[end_index].start <= group_start:
            end_index += 1
        if end_index < total:
            group_end = max(group_start, words[end_index].start)
        elif cue_end > group_start:
            group_end = min(cue_end, group_start + MAX_TAIL_WORD_SEC)
        else:
            group_end = group_start

        if end_index - index == 1:
            words[index].end = group_end
        else:
            group = words[index:end_index]
            weights = [len(word.text) + 1 for word in group]
            weight_sum = float(sum(weights))
            span = max(0.0, group_end - group_start)
            cursor = group_start
            for word, weight in zip(group, weights):
                word.start = cursor
                cursor += span * weight / weight_sum
                word.end = cursor
            group[-1].end = group_end
        index = end_index


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


def _split_words(
    cue: Cue,
    max_words: int = MAX_WORDS_PER_CUE,
    max_chars: int = WRAP_CHARS,
) -> List[Cue]:
    """Pecah jadi baris ringkas sambil mempertahankan timing karaoke."""
    timed_words = cue_to_words(cue)
    chunks: List[List[Word]] = []
    current: List[Word] = []
    char_count = 0
    for word in timed_words:
        word_length = len(word.text)
        if current and (len(current) >= max_words or char_count + 1 + word_length > max_chars):
            chunks.append(current)
            current = []
            char_count = 0
        current.append(word)
        char_count += word_length + (1 if len(current) > 1 else 0)
    if current:
        chunks.append(current)

    return [
        Cue(
            start=chunk[0].start,
            end=chunk[-1].end,
            text=" ".join(word.text for word in chunk),
            words=chunk,
        )
        for chunk in chunks
        if chunk[-1].end > chunk[0].start
    ]


def _non_overlapping_cues(cues: Sequence[Cue]) -> List[Cue]:
    """Clamp each cue to the next start so ASS dialogue events never overlap."""
    ordered = sorted((cue for cue in cues if cue.end > cue.start), key=lambda cue: cue.start)
    result: List[Cue] = []
    for index, cue in enumerate(ordered):
        end = min(cue.end, ordered[index + 1].start) if index + 1 < len(ordered) else cue.end
        if end > cue.start:
            result.append(Cue(cue.start, end, cue.text, cue.words))
    return result


def _render_words(cue: Cue) -> List[Word]:
    if not cue.words:
        return cue_to_words(Cue(cue.start, cue.end, sanitize(cue.text)))

    # Filter across word boundaries as direct callers may split an annotation
    # such as "[ __ ]" into separate timed words.
    chunks = [unescape(word.text) for word in cue.words]
    offsets = [0]
    for chunk in chunks:
        offsets.append(offsets[-1] + len(chunk) + 1)
    visible: List[List[str]] = [[] for _ in cue.words]
    for offset, token, keep in _caption_tokens(" ".join(chunks)):
        if keep:
            visible[bisect_right(offsets, offset) - 1].append(token)
    return [
        Word(word.start, word.end, " ".join(tokens))
        for word, tokens in zip(cue.words, visible)
        if tokens
    ]


def _render_cue_parts(
    cues: Sequence[Cue],
    max_words: int = MAX_WORDS_PER_CUE,
    max_chars: int = WRAP_CHARS,
) -> List[Cue]:
    """Normalize overlaps and split oversized captions without losing word timing."""
    parts: List[Cue] = []
    for cue in _non_overlapping_cues(cues):
        timed_words = _render_words(cue)
        words: List[Word] = []
        cursor = cue.start
        for word in timed_words:
            start = max(cursor, cue.start, word.start)
            end = min(cue.end, word.end)
            if end > start:
                words.append(Word(start, end, word.text))
                cursor = end
        if words:
            parts.extend(
                _split_words(Cue(cue.start, cue.end, cue.text, words), max_words, max_chars)
            )
    return parts


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
    font_size: int = 68,
    margin_v: int = 180,
    two_speakers: bool = False,
    max_words: int = MAX_WORDS_PER_CUE,
    max_chars: int = WRAP_CHARS,
    style: Optional[CaptionStyle] = None,
) -> str:
    """Tulis ASS takarir pendek tebal (Anton, UPPERCASE, kata aktif kuning).

    - width/height menjadi PlayResX/PlayResY (ukuran output nyata).
    - two_speakers=True: Alignment 5 (tengah frame, tepat di batas panel atas/bawah),
      margin_v di-reset ke 0.
    - two_speakers=False: Alignment 2 (bawah tengah), margin_v aman >=18% tinggi frame.
    - style.position_y mengatur pusat takarir secara eksplisit dan mengabaikan margin vertikal.
    - max_words/max_chars mengatur pemecahan baris (16:9 memakai 6 kata / 32 karakter).
    - Tiap jendela kata menyorot satu kata aktif, dengan animasi pop bila aktif.
    """
    animate = style.animate if style is not None else True
    if style is None:
        alignment = 5 if two_speakers else 2
        safe_margin_v = 0 if two_speakers else max(int(margin_v), int(height * 0.18))
        font_name, primary_col, highlight_col, italic_flag = FONT_NAME, TEXT_COLOUR, HIGHLIGHT_COLOUR, 0
        border_style, outline, shadow, outline_col, back_col, uppercase = 1, 6, 2, "&H00000000", "&H80000000", True
    else:
        font_name, primary_col, highlight_col = style.font_family, hex_to_ass_color(style.primary_color), hex_to_ass_color(style.highlight_color)
        italic_flag, uppercase = (-1 if style.italic else 0), style.uppercase
        if style.effect == "outline":
            border_style, outline, shadow, outline_col, back_col = 1, (6 if height == 1920 else max(1, round(6 * height / 1920))), (2 if height == 1920 else max(1, round(2 * height / 1920))), hex_to_ass_color(style.outline_color), "&H80000000"
        elif style.effect == "shadow":
            border_style, outline, shadow, outline_col, back_col = 1, max(1, round(2 * height / 1920)), max(1, round(6 * height / 1920)), hex_to_ass_color(style.outline_color), hex_to_ass_color(style.outline_color, 0x60)
        elif style.effect == "box":
            border_style, outline, shadow, outline_col, back_col = 3, max(4, round(14 * height / 1920)), 0, hex_to_ass_color(style.outline_color, 0x45), hex_to_ass_color(style.outline_color, 0x45)
        else:
            border_style, outline, shadow, outline_col, back_col = 1, 0, max(1, round(height / 1920)), hex_to_ass_color(style.outline_color), "&H80000000"
        if style.position == "center" or (two_speakers and style.preset != "custom" and style.position == "bottom"):
            alignment, safe_margin_v = 5, 0
        elif style.position == "top":
            alignment, safe_margin_v = 8, max(int(margin_v), int(height * 0.12))
        else:
            alignment, safe_margin_v = 2, max(int(margin_v), int(height * 0.18))
    pos_tag = ""
    if style is not None and style.position_y is not None:
        alignment, safe_margin_v = 5, 0
        pos_tag = f"\\an5\\pos({round(width / 2)},{round(height * style.position_y)})"
    ass_style = f"Style: Default,{font_name},{int(font_size)},{primary_col},{highlight_col},{outline_col},{back_col},-1,{italic_flag},0,0,100,100,0,0,{border_style},{outline},{shadow},{alignment},80,80,{safe_margin_v},1"

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        "Collisions: Reverse",
        f"PlayResX: {int(width)}",
        f"PlayResY: {int(height)}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        ass_style,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    for part in _render_cue_parts(cues, max_words, max_chars):
        _write_cue_part(
            part, lines, uppercase=uppercase, primary_col=primary_col,
            highlight_col=highlight_col, pos_tag=pos_tag, animate=animate,
        )

    return "\n".join(lines) + "\n"


def _write_cue_part(
    cue: Cue, lines: List[str], uppercase: bool = True, primary_col: str = TEXT_COLOUR,
    highlight_col: str = HIGHLIGHT_COLOUR, pos_tag: str = "", animate: bool = True,
) -> None:
    if cue.end <= cue.start:
        return
    words = cue_to_words(cue)
    if not words:
        return

    # Buat satu event per window kata yang berurutan dan non-overlapping.
    # Teks seluruh chunk ditampilkan UPPERCASE; hanya kata aktif yang disorot kuning.
    for i, active_word in enumerate(words):
        w_start = active_word.start
        w_end = active_word.end
        # Clamp rentang waktu ke batas cue
        seg_start = max(cue.start, w_start)
        seg_end = min(cue.end, w_end)
        if seg_end <= seg_start:
            continue

        pop = r"\fscx110\fscy110\t(0,120,\fscx100\fscy100)" if animate else ""
        restore_scale = r"\fscx100\fscy100" if animate else ""
        rendered_words: List[str] = []
        for j, w in enumerate(words):
            word_text = _ass_escape(w.text.upper() if uppercase else w.text)
            if j == i:
                rendered_words.append(
                    f"{{\\c{highlight_col}&{pop}}}{word_text}{{\\c{primary_col}&{restore_scale}}}"
                )
            else:
                rendered_words.append(word_text)

        text_line = (f"{{{pos_tag}}}" if pos_tag else "") + " ".join(rendered_words)
        lines.append(
            f"Dialogue: 0,{_timestamp(seg_start)},{_timestamp(seg_end)},Default,,0,0,0,,{text_line}"
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
