"""Timestamped Whisper transcription with a separate multimodal audio fallback."""

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
from threading import Lock
from typing import Any, List, Mapping, Optional, Sequence, Tuple

from .llm import parse_llm_json
from .subtitles import (
    MAX_TAIL_WORD_SEC,
    MAX_WORD_DISPLAY_SEC,
    Cue,
    Word,
    _caption_tokens,
    cue_to_words,
    ends_sentence,
    sanitize,
)

log = logging.getLogger(__name__)
MAX_STT_CHUNK_SEC = 180.0
MAX_GEMINI_SLICE_SEC = 45.0
DEFAULT_STT_MODEL = "groq/whisper-large-v3-turbo"
DEFAULT_STT_FALLBACK_MODEL = "ag/gemini-4-hydrogen-low"
_SEGMENT_WARNING_LOCK = Lock()
_WARNED_SEGMENT_ONLY_MODELS: set[str] = set()


@dataclass(frozen=True)
class SttConfig:
    base_url: str
    api_key: str
    model: str
    fallback_model: str
    fallback_base_url: str
    fallback_api_key: str

    @property
    def whisper_configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)

    @property
    def gemini_configured(self) -> bool:
        return bool(self.fallback_base_url and self.fallback_api_key and self.fallback_model)


def stt_config(env: Optional[Mapping[str, str]] = None) -> SttConfig:
    env = os.environ if env is None else env
    llm_base_url = env.get("LLM_BASE_URL", "").strip().rstrip("/")
    llm_api_key = env.get("LLM_API_KEY", "").strip()
    base_url = env.get("STT_BASE_URL", "").strip().rstrip("/") or llm_base_url
    api_key = env.get("STT_API_KEY", "").strip() or llm_api_key
    return SttConfig(
        base_url=base_url,
        api_key=api_key,
        model=env.get("STT_MODEL", "").strip() or DEFAULT_STT_MODEL,
        fallback_model=env.get("STT_FALLBACK_MODEL", DEFAULT_STT_FALLBACK_MODEL).strip(),
        fallback_base_url=env.get("STT_FALLBACK_BASE_URL", "").strip().rstrip("/") or llm_base_url or base_url,
        fallback_api_key=env.get("STT_FALLBACK_API_KEY", "").strip() or llm_api_key or api_key,
    )


def _configured(cfg: SttConfig) -> bool:
    return cfg.whisper_configured or cfg.gemini_configured


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
            prev.end = min(prev.end, prev.start + MAX_WORD_DISPLAY_SEC)
            pause = word.start - prev.end
            if (pause >= 0.75 or len(group) >= 12 or word.end - group[0].start > 6.0
                    or (len(group) >= 4 and ends_sentence(prev.text))):
                finish()
        group.append(word)
    if group:
        finish()
    return cues


def segments_to_cues(
    raw_segments: Sequence[Mapping[str, Any]], offset_sec: float = 0.0, *, trim_leading_silence: bool = True,
) -> List[Cue]:
    cues = []
    for segment in raw_segments:
        text = sanitize(str(_field(segment, "text") or ""))
        start, end = _number(_field(segment, "start")), _number(_field(segment, "end"))
        if not text or start is None or end is None:
            continue
        start = max(0.0, start)
        if end <= start:
            continue
        if trim_leading_silence:
            # Whisper may extend the segment start across preceding silence; keep its end.
            words = text.split()
            chars = sum(len(word) for word in words)
            max_spoken = max(1.2, len(words) * 0.55 + 0.5, chars / 9.0 + 0.6)
            start = max(start, end - max_spoken)
        cue = Cue(start + offset_sec, end + offset_sec, text)
        cue.words = cue_to_words(cue)
        cues.append(cue)
    return sorted(cues, key=lambda cue: cue.start)


def _openai_client_for(base_url: str, api_key: str):
    from openai import OpenAI

    return OpenAI(base_url=base_url, api_key=api_key, timeout=90.0)


def _warn_segment_only(model: str) -> None:
    with _SEGMENT_WARNING_LOCK:
        if model in _WARNED_SEGMENT_ONLY_MODELS:
            return
        _WARNED_SEGMENT_ONLY_MODELS.add(model)
    log.warning("STT %s tidak mengembalikan timestamp per kata; gunakan STT_BASE_URL langsung ke "
                "Groq/OpenAI untuk sinkronisasi presisi", model)


def _transcribe_whisper(
    audio_path: str, cfg: SttConfig, language: Optional[str] = None, offset_sec: float = 0.0,
) -> List[Cue]:
    kwargs = {"language": language} if language in ("id", "en") else {}
    with _openai_client_for(cfg.base_url, cfg.api_key) as client, open(audio_path, "rb") as file:
        response = client.audio.transcriptions.create(
            model=cfg.model, file=file, response_format="verbose_json",
            timestamp_granularities=["word", "segment"], **kwargs,
        )
    words = _field(response, "words") or []
    segments = _field(response, "segments") or []
    if not words and segments:
        _warn_segment_only(cfg.model)
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
    with (
        tempfile.TemporaryDirectory(prefix="gemini-", dir=workdir) as tmp,
        _openai_client_for(cfg.fallback_base_url, cfg.fallback_api_key) as client,
    ):
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
            cues.extend(segments_to_cues(clamped, offset_sec + start, trim_leading_silence=False))
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


def _transcribe_audio_chunk(
    path: str, duration: float, cfg: SttConfig, language: Optional[str], offset_sec: float,
    workdir: str,
) -> List[Cue]:
    if cfg.whisper_configured:
        try:
            return _transcribe_whisper(path, cfg, language=language, offset_sec=offset_sec)
        except Exception as exc:
            if not cfg.gemini_configured:
                raise
            log.warning("STT Whisper gagal (%s); mencoba model cadangan %s",
                        exc.__class__.__name__, cfg.fallback_model)
    return _transcribe_gemini_audio(path, duration, cfg, offset_sec=offset_sec, workdir=workdir)


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
    if (start is None and end is None and Path(media_path).suffix.lower() == ".mp3"
            and stop <= MAX_STT_CHUNK_SEC and os.path.getsize(media_path) <= 20 * 1024 * 1024):
        cues = _transcribe_audio_chunk(media_path, stop, cfg, language, offset_sec, workdir)
        return sorted(cues, key=lambda cue: cue.start)

    cues: List[Cue] = []
    with tempfile.TemporaryDirectory(prefix="stt-", dir=workdir) as tmp:
        mp3 = os.path.join(tmp, "chunk.mp3")
        chunk_start = first
        while chunk_start < stop:
            chunk_end = min(stop, chunk_start + MAX_STT_CHUNK_SEC)
            extract_audio_chunk(media_path, mp3, start=chunk_start, end=chunk_end)
            chunk_offset = offset_sec + (chunk_start - first)
            cues.extend(_transcribe_audio_chunk(mp3, chunk_end - chunk_start, cfg, language, chunk_offset, tmp))
            chunk_start = chunk_end
    return sorted(cues, key=lambda cue: cue.start)
