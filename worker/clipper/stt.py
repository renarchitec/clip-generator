"""Timestamped speech transcription via 9router, with a multimodal audio fallback."""

from __future__ import annotations

import base64
import logging
import math
import os
import subprocess
import tempfile
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Mapping, Optional, Sequence, Tuple

from .llm import parse_llm_json
from .subtitles import MAX_TAIL_WORD_SEC, Cue, Word, _caption_tokens, cue_to_words, sanitize

log = logging.getLogger(__name__)
MAX_STT_CHUNK_SEC = 180.0
MAX_GEMINI_SLICE_SEC = 45.0
DEFAULT_STT_MODEL = "groq/whisper-large-v3-turbo"
DEFAULT_STT_FALLBACK_MODEL = "ag/gemini-4-hydrogen-low"


@dataclass(frozen=True)
class SttConfig:
    base_url: str
    api_key: str
    model: str
    fallback_model: str


def stt_config(env: Optional[Mapping[str, str]] = None) -> SttConfig:
    env = os.environ if env is None else env
    return SttConfig(
        base_url=(env.get("STT_BASE_URL", "").strip() or env.get("LLM_BASE_URL", "").strip()).rstrip("/"),
        api_key=env.get("STT_API_KEY", "").strip() or env.get("LLM_API_KEY", "").strip(),
        model=env.get("STT_MODEL", "").strip() or DEFAULT_STT_MODEL,
        fallback_model=env.get("STT_FALLBACK_MODEL", DEFAULT_STT_FALLBACK_MODEL).strip(),
    )


def _configured(cfg: SttConfig) -> bool:
    return bool(cfg.base_url and cfg.api_key and (cfg.model or cfg.fallback_model))


def is_stt_configured(env: Optional[Mapping[str, str]] = None) -> bool:
    return _configured(stt_config(env))


def extract_audio_chunk(
    media_path: str, out_path: str, start: Optional[float] = None,
    end: Optional[float] = None, audio_format: str = "mp3",
) -> str:
    codecs = {"mp3": ["-c:a", "libmp3lame", "-b:a", "32k"], "wav": ["-c:a", "pcm_s16le"]}
    if audio_format not in codecs:
        raise ValueError(f"format STT tidak didukung: {audio_format}")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.6f}"]
    cmd += ["-i", media_path]
    if end is not None:
        cmd += ["-t", f"{end - (start or 0.0):.6f}"]
    cmd += ["-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", *codecs[audio_format], "-f", audio_format, out_path]
    subprocess.run(cmd, check=True, capture_output=True, timeout=90)
    return out_path


def _number(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _field(obj: Any, name: str) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(name)
    value = getattr(obj, name, None)
    dump = getattr(obj, "model_dump", None)
    return dump().get(name) if value is None and callable(dump) else value


def words_to_cues(raw_words: Sequence[Mapping[str, Any]], offset_sec: float = 0.0) -> List[Cue]:
    pieces: List[str] = []
    offsets: List[int] = []
    times: List[Tuple[Optional[float], Optional[float]]] = []
    cursor = 0
    for raw in raw_words:
        text = str(_field(raw, "word") or "").strip()
        if not text:
            continue
        pieces.append(text)
        offsets.append(cursor)
        times.append((_number(_field(raw, "start")), _number(_field(raw, "end"))))
        cursor += len(text) + 1

    # Tokenize the joined text so annotations spanning multiple Whisper word entries
    # (e.g. "[", "__", "]") are suppressed without redistributing anyone's timestamps.
    words = []
    for pos, text, keep in _caption_tokens(" ".join(pieces)):
        if not keep or not (text := sanitize(text)):
            continue
        start, end = times[bisect_right(offsets, pos) - 1]
        if start is None or end is None:
            continue
        start = max(0.0, start)
        if end <= start:
            end = start + 0.05
        words.append(Word(start + offset_sec, end + offset_sec, text))
    words.sort(key=lambda w: w.start)

    cues: List[Cue] = []
    group: List[Word] = []

    def finish() -> None:
        tail = group[-1]
        tail.end = min(tail.end, tail.start + MAX_TAIL_WORD_SEC)
        cues.append(Cue(group[0].start, max(w.end for w in group), " ".join(w.text for w in group), list(group)))
        group.clear()

    for word in words:
        if group:
            prev = group[-1]
            pause = word.start - min(prev.end, prev.start + MAX_TAIL_WORD_SEC)
            if (pause >= 0.75 or len(group) >= 12 or word.end - group[0].start > 6.0
                    or (len(group) >= 4 and prev.text.rstrip('\"\'”’)]').endswith((".", "?", "!")))):
                finish()
        group.append(word)
    if group:
        finish()
    return cues


def segments_to_cues(raw_segments: Sequence[Mapping[str, Any]], offset_sec: float = 0.0) -> List[Cue]:
    cues = []
    for segment in raw_segments:
        text = sanitize(str(_field(segment, "text") or ""))
        start, end = _number(_field(segment, "start")), _number(_field(segment, "end"))
        if not text or start is None or end is None:
            continue
        start = max(0.0, start)
        if end <= start:
            continue
        cue = Cue(start + offset_sec, end + offset_sec, text)
        cue.words = cue_to_words(cue)
        cues.append(cue)
    return sorted(cues, key=lambda cue: cue.start)


def _openai_client(cfg: SttConfig):
    from openai import OpenAI

    return OpenAI(base_url=cfg.base_url, api_key=cfg.api_key, timeout=90.0)


def _transcribe_whisper(
    audio_path: str, cfg: SttConfig, language: Optional[str] = None, offset_sec: float = 0.0,
) -> List[Cue]:
    kwargs = {"language": language} if language in ("id", "en") else {}
    with _openai_client(cfg) as client, open(audio_path, "rb") as file:
        response = client.audio.transcriptions.create(
            model=cfg.model, file=file, response_format="verbose_json",
            timestamp_granularities=["word", "segment"], **kwargs,
        )
    words = _field(response, "words") or []
    segments = _field(response, "segments") or []
    if not words and not segments and sanitize(str(_field(response, "text") or "")):
        raise RuntimeError("Whisper mengembalikan transkrip tanpa timestamp")
    return words_to_cues(words, offset_sec) or segments_to_cues(segments, offset_sec)


_GEMINI_PROMPT = (
    'Transcribe only verbatim speech in its original language. Do not translate or include sound '
    'annotations such as [tertawa] or [Musik]. Return only strict JSON: '
    '{"segments":[{"start":0.0,"end":1.5,"text":"spoken words"}]}. '
    'Times are seconds relative to this audio slice, not the source video. Use an empty segments '
    'array if there is no speech.'
)


def _transcribe_gemini_audio(
    media_path: str, duration_sec: float, cfg: SttConfig, offset_sec: float = 0.0,
    workdir: Optional[str] = None,
) -> List[Cue]:
    cues: List[Cue] = []
    with tempfile.TemporaryDirectory(prefix="gemini-", dir=workdir) as tmp, _openai_client(cfg) as client:
        wav = os.path.join(tmp, "slice.wav")
        start = 0.0
        while start < duration_sec:
            end = min(duration_sec, start + MAX_GEMINI_SLICE_SEC)
            extract_audio_chunk(media_path, wav, start=start, end=end, audio_format="wav")
            encoded = base64.b64encode(Path(wav).read_bytes()).decode("ascii")
            response = client.chat.completions.create(
                model=cfg.fallback_model, temperature=0,
                messages=[{"role": "user", "content": [
                    {"type": "text", "text": _GEMINI_PROMPT},
                    {"type": "input_audio", "input_audio": {"data": encoded, "format": "wav"}},
                ]}],
            )
            choice = (_field(response, "choices") or [None])[0]
            segments = parse_llm_json(_field(_field(choice, "message"), "content"),
                                      list_keys=("segments",), allow_empty=True)
            length = end - start
            clamped = []
            for segment in segments:
                lo, hi = _number(segment.get("start")), _number(segment.get("end"))
                if lo is not None and hi is not None:
                    clamped.append({**segment, "start": min(length, max(0.0, lo)),
                                    "end": min(length, max(0.0, hi))})
            cues.extend(segments_to_cues(clamped, offset_sec + start))
            start = end
    return sorted(cues, key=lambda cue: cue.start)


def _probe_duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        check=True, capture_output=True, text=True, timeout=20,
    )
    duration = _number(result.stdout.strip())
    if duration is None or duration <= 0:
        raise RuntimeError("durasi media untuk transkripsi tidak terbaca")
    return duration


def transcribe_media_file(
    media_path: str, workdir: str, start: Optional[float] = None, end: Optional[float] = None,
    offset_sec: float = 0.0, language: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
) -> List[Cue]:
    cfg = stt_config(env)
    if not _configured(cfg):
        raise RuntimeError("STT belum dikonfigurasi.")
    first = max(0.0, start or 0.0)
    stop = _probe_duration(media_path) if end is None else end
    if not math.isfinite(stop):
        raise ValueError("batas akhir transkripsi tidak valid")
    cues: List[Cue] = []
    with tempfile.TemporaryDirectory(prefix="stt-", dir=workdir) as tmp:
        mp3 = os.path.join(tmp, "chunk.mp3")
        chunk_start = first
        while chunk_start < stop:
            chunk_end = min(stop, chunk_start + MAX_STT_CHUNK_SEC)
            extract_audio_chunk(media_path, mp3, start=chunk_start, end=chunk_end)
            chunk_offset = offset_sec + (chunk_start - first)
            try:
                cues.extend(_transcribe_whisper(mp3, cfg, language=language, offset_sec=chunk_offset))
            except Exception as exc:
                if not cfg.fallback_model:
                    raise
                log.warning("STT Whisper gagal (%s); mencoba model cadangan %s",
                            exc.__class__.__name__, cfg.fallback_model)
                cues.extend(_transcribe_gemini_audio(mp3, chunk_end - chunk_start, cfg,
                                                     offset_sec=chunk_offset, workdir=tmp))
            chunk_start = chunk_end
    return sorted(cues, key=lambda cue: cue.start)
