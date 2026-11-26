"""Bentuk data job.

Cermin dari packages/shared/src/index.ts. Ubah dua file itu bersamaan:
nama field dan nilai string di sini harus sama dengan versi TypeScript.
"""

from __future__ import annotations

import re
from collections.abc import Mapping as MappingABC
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Mapping, Optional

QUEUE_NAME = "clip-jobs"
# Antrean pratinjau momen; harus sama dengan PREVIEW_QUEUE_NAME di versi TypeScript.
PREVIEW_QUEUE_NAME = "previews"
# Antrean regenerasi caption satu klip; harus sama dengan CAPTION_QUEUE_NAME.
CAPTION_QUEUE_NAME = "captions"
# Antrean frame tunggal untuk menata watermark pada UI.
FRAME_QUEUE_NAME = "clip-frames"

# Bahasa caption sosial; harus sama dengan CAPTION_LANGUAGES.
CAPTION_LANGUAGES = ("auto", "id", "en")
DEFAULT_CAPTION_LANGUAGE = "auto"
CaptionLanguage = Literal["auto", "id", "en"]
# Batas cuplikan transkrip per klip; harus sama dengan CLIP_TRANSCRIPT_MAX.
CLIP_TRANSCRIPT_MAX = 2000


CAPTION_FONTS = ("Anton", "Bebas Neue", "Montserrat", "Plus Jakarta Sans", "Oswald", "Bangers")
CAPTION_EFFECTS = ("outline", "shadow", "box", "none")
CAPTION_POSITIONS = ("bottom", "center", "top")
CAPTION_POSITION_Y_MIN = 0.05
CAPTION_POSITION_Y_MAX = 0.95
CAPTION_PRESETS = ("hook", "beast", "boxed", "neon", "cinema", "custom")
CAPTION_FONT_SIZE_MIN = 44
CAPTION_FONT_SIZE_MAX = 120
DEFAULT_CAPTION_FONT_SIZE = 80
CAPTION_PRESET_STYLES = {
    "hook": {"preset": "hook", "fontFamily": "Anton", "fontSize": 80, "primaryColor": "#FFFFFF", "highlightColor": "#FFFF00", "outlineColor": "#000000", "effect": "outline", "uppercase": True, "position": "bottom", "italic": False, "animate": True},
    "beast": {"preset": "beast", "fontFamily": "Montserrat", "fontSize": 84, "primaryColor": "#FFFFFF", "highlightColor": "#22C55E", "outlineColor": "#000000", "effect": "outline", "uppercase": True, "position": "bottom", "italic": False, "animate": True},
    "boxed": {"preset": "boxed", "fontFamily": "Plus Jakarta Sans", "fontSize": 68, "primaryColor": "#FFFFFF", "highlightColor": "#FACC15", "outlineColor": "#000000", "effect": "box", "uppercase": False, "position": "bottom", "italic": False, "animate": False},
    "neon": {"preset": "neon", "fontFamily": "Bebas Neue", "fontSize": 92, "primaryColor": "#FFFFFF", "highlightColor": "#5CE1C4", "outlineColor": "#09090B", "effect": "shadow", "uppercase": True, "position": "bottom", "italic": False, "animate": False},
    "cinema": {"preset": "cinema", "fontFamily": "Oswald", "fontSize": 68, "primaryColor": "#FEF08A", "highlightColor": "#FFFFFF", "outlineColor": "#000000", "effect": "shadow", "uppercase": False, "position": "bottom", "italic": False, "animate": False},
}
_CAPTION_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


@dataclass
class CaptionStyle:
    preset: str
    font_family: str
    font_size: int
    primary_color: str
    highlight_color: str
    outline_color: str
    effect: str
    uppercase: bool
    position: str
    italic: bool
    position_y: float | None = None
    animate: bool = True

    def to_dict(self) -> Dict[str, Any]:
        payload = {"preset": self.preset, "fontFamily": self.font_family, "fontSize": self.font_size, "primaryColor": self.primary_color, "highlightColor": self.highlight_color, "outlineColor": self.outline_color, "effect": self.effect, "uppercase": self.uppercase, "position": self.position, "italic": self.italic, "animate": self.animate}
        if self.position_y is not None:
            payload["positionY"] = self.position_y
        return payload

    @classmethod
    def from_dict(cls, data: Any) -> Optional["CaptionStyle"]:
        if not isinstance(data, MappingABC):
            return None
        preset = data.get("preset")
        base = dict(CAPTION_PRESET_STYLES[preset]) if isinstance(preset, str) and preset in CAPTION_PRESET_STYLES else dict(CAPTION_PRESET_STYLES["hook"])
        if isinstance(data.get("fontFamily"), str) and data["fontFamily"] in CAPTION_FONTS: base["fontFamily"] = data["fontFamily"]
        size = data.get("fontSize")
        if isinstance(size, (int, float)) and not isinstance(size, bool) and size == size and size not in (float("inf"), float("-inf")):
            base["fontSize"] = max(CAPTION_FONT_SIZE_MIN, min(CAPTION_FONT_SIZE_MAX, round(size)))
        for key in ("primaryColor", "highlightColor", "outlineColor"):
            value = data.get(key)
            if isinstance(value, str) and _CAPTION_HEX_RE.match(value): base[key] = value.upper()
        if data.get("effect") in CAPTION_EFFECTS: base["effect"] = data["effect"]
        if isinstance(data.get("uppercase"), bool): base["uppercase"] = data["uppercase"]
        if data.get("position") in CAPTION_POSITIONS: base["position"] = data["position"]
        if isinstance(data.get("italic"), bool): base["italic"] = data["italic"]
        if isinstance(data.get("animate"), bool): base["animate"] = data["animate"]
        fields = ("fontFamily", "fontSize", "primaryColor", "highlightColor", "outlineColor", "effect", "uppercase", "position", "italic", "animate")
        base["preset"] = next((name for name, style in CAPTION_PRESET_STYLES.items() if all(base[field] == style[field] for field in fields)), "custom")
        position_y = _first(data, "positionY", "position_y")
        if isinstance(position_y, (int, float)) and not isinstance(position_y, bool) and position_y == position_y and position_y not in (float("inf"), float("-inf")):
            position_y = round(_clamp(position_y, CAPTION_POSITION_Y_MIN, CAPTION_POSITION_Y_MAX), 4)
        else:
            position_y = None
        if position_y is not None:
            base["preset"] = "custom"
        return cls(base["preset"], base["fontFamily"], base["fontSize"], base["primaryColor"], base["highlightColor"], base["outlineColor"], base["effect"], base["uppercase"], base["position"], base["italic"], position_y, base["animate"])


def to_caption_language(value: Any) -> str:
    """Parse toleran: nilai tidak dikenal/hilang -> 'auto'."""
    if not isinstance(value, str):
        return DEFAULT_CAPTION_LANGUAGE
    lowered = value.strip().lower()
    return lowered if lowered in CAPTION_LANGUAGES else DEFAULT_CAPTION_LANGUAGE


# Batas hashtag kustom per job; harus sama dengan CUSTOM_HASHTAGS_MAX /
# CUSTOM_HASHTAG_MAX_LENGTH di packages/shared/src/index.ts.
CUSTOM_HASHTAGS_MAX = 15
CUSTOM_HASHTAG_MAX_LENGTH = 50
_CUSTOM_HASHTAG_SPLIT_RE = re.compile(r"[\s,#]+")
_CUSTOM_HASHTAG_STRIP_RE = re.compile(r"[^\w]", re.UNICODE)


def to_custom_hashtags(value: Any) -> List[str]:
    """Parse toleran hashtag kustom: str atau list/tuple str; selain itu -> [].

    Pecah per spasi/koma/'#', buang karakter selain huruf/angka/underscore,
    potong 50 karakter, dedupe case-insensitive (simpan penulisan pertama),
    maksimal 15 item. Cermin normalizeCustomHashtags di packages/shared.
    """
    if isinstance(value, str):
        items: List[str] = [value]
    elif isinstance(value, (list, tuple)):
        items = [item for item in value if isinstance(item, str)]
    else:
        return []

    result: List[str] = []
    seen = set()
    for item in items:
        for part in _CUSTOM_HASHTAG_SPLIT_RE.split(item):
            tag = _CUSTOM_HASHTAG_STRIP_RE.sub("", part)[:CUSTOM_HASHTAG_MAX_LENGTH]
            if not tag:
                continue
            key = tag.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(tag)
            if len(result) >= CUSTOM_HASHTAGS_MAX:
                return result
    return result


# Kunci Redis sinyal pembatalan; harus sama dengan cancelKey() di
# apps/api/src/queue/queue.constants.ts.
CANCEL_KEY = "cancel:{}"

JOB_STAGES = ("download", "transcribe", "select", "render", "save")
JOB_MODES = ("auto", "manual")
REFRAME_MODES = ("face_tracking", "black_bars", "blurred_fill")
# Rasio output klip; harus sama dengan ASPECT_RATIOS di packages/shared/src/index.ts.
ASPECT_RATIOS = ("9:16", "1:1", "16:9")

JobStage = Literal["download", "transcribe", "select", "render", "save"]
JobMode = Literal["auto", "manual"]
ReframeMode = Literal["face_tracking", "black_bars", "blurred_fill"]
AspectRatio = Literal["9:16", "1:1", "16:9"]

DEFAULT_CLIP_COUNT = 3
DEFAULT_TARGET_DURATION_SEC = 45.0
MAX_DESCRIPTION_CHARS = 500
DEFAULT_REFRAME = "face_tracking"
DEFAULT_CAPTIONS = True
DEFAULT_TWO_SPEAKERS = False
DEFAULT_FACECAM = False
DEFAULT_ASPECT = "9:16"

# Batas pemindaian sumber (detik); harus sama dengan MIN_SOURCE_SEC /
# MAX_SOURCE_SEC di packages/shared/src/index.ts.
MIN_SOURCE_SEC = 60
MAX_SOURCE_SEC = 36000

# Batas judul/alasan rentang manual hasil tinjauan LLM; harus sama dengan
# MaxLength di apps/api/src/jobs/dto/create-job.dto.ts.
MAX_RANGE_TITLE_CHARS = 70
MAX_RANGE_REASON_CHARS = 200
MAX_RANGE_HOOK_CHARS = 80

# job_id dipakai sebagai nama folder di CLIPS_DIR. Batasi keras supaya nilai
# dari antrean tidak bisa keluar dari CLIPS_DIR.
JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _first(data: Mapping[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return default


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _to_text(value: Any, max_chars: int) -> Optional[str]:
    """trim + batas panjang; kosong/bukan string -> None."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed[:max_chars] or None

def _to_bool(value: Any, default: bool) -> bool:
    """Boolean toleran: bool asli, string "0/false/no/off", None -> default."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "no", "off")
    if value is None:
        return default
    return bool(value)


def to_max_source_sec(value: Any) -> Optional[int]:
    """Parse toleran maxSourceSec: invalid / di luar 60-36000 -> None (durasi penuh)."""
    if value is None:
        return None
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return None
    return parsed if MIN_SOURCE_SEC <= parsed <= MAX_SOURCE_SEC else None


WATERMARK_DEFAULTS = {"x": 0.5, "y": 0.5, "scale": 0.25, "opacity": 1.0}
WATERMARK_MAX_PATH_CHARS = 512
WATERMARK_MAX_PER_JOB = 5
WATERMARK_VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov")
WATERMARK_CHROMA_SIMILARITY_MIN = 0.01
WATERMARK_CHROMA_SIMILARITY_MAX = 0.5
WATERMARK_CHROMA_BLEND_MIN = 0.0
WATERMARK_CHROMA_BLEND_MAX = 0.5


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _finite_float(value: Any, default: float) -> float:
    parsed = _to_float(value, default)
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else default


@dataclass(frozen=True)
class WatermarkChromaKey:
    enabled: bool = False
    color: str = "#00FF00"
    similarity: float = 0.18
    blend: float = 0.08

    @classmethod
    def from_dict(cls, raw: Any) -> WatermarkChromaKey | None:
        if not isinstance(raw, dict):
            return None
        enabled = raw.get("enabled")
        color = raw.get("color")
        return cls(
            enabled=enabled if isinstance(enabled, bool) else cls.enabled,
            color=color.upper() if isinstance(color, str) and _CAPTION_HEX_RE.fullmatch(color) else cls.color,
            similarity=_clamp(
                _finite_float(raw.get("similarity"), cls.similarity),
                WATERMARK_CHROMA_SIMILARITY_MIN, WATERMARK_CHROMA_SIMILARITY_MAX,
            ),
            blend=_clamp(
                _finite_float(raw.get("blend"), cls.blend),
                WATERMARK_CHROMA_BLEND_MIN, WATERMARK_CHROMA_BLEND_MAX,
            ),
        )


@dataclass
class Watermark:
    """Watermark gambar/video. x/y = PUSAT sebagai pecahan frame output (0..1);
    scale = lebar watermark sebagai pecahan lebar output; opacity 0..1."""

    file_path: str  # relatif terhadap CLIPS_DIR, mis. watermarks/<user>/<id>.png
    x: float = 0.5
    y: float = 0.5
    scale: float = 0.25
    opacity: float = 1.0
    mime_type: str | None = None
    chroma_key: WatermarkChromaKey | None = None

    @property
    def is_video(self) -> bool:
        return (self.mime_type or "").lower().startswith("video/") or self.file_path.lower().endswith(WATERMARK_VIDEO_EXTENSIONS)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "filePath": self.file_path,
            "x": self.x,
            "y": self.y,
            "scale": self.scale,
            "opacity": self.opacity,
        }
        if self.mime_type is not None:
            payload["mimeType"] = self.mime_type
        if self.chroma_key is not None:
            payload["chromaKey"] = {
                "enabled": self.chroma_key.enabled,
                "color": self.chroma_key.color,
                "similarity": self.chroma_key.similarity,
                "blend": self.chroma_key.blend,
            }
        return payload

    @classmethod
    def from_dict(cls, data: Any) -> Optional["Watermark"]:
        """Parse toleran + clamp; bukan object / filePath kosong -> None."""
        if not isinstance(data, MappingABC):
            return None
        file_path = _to_text(
            _first(data, "filePath", "file_path", "path"), WATERMARK_MAX_PATH_CHARS
        )
        if not file_path:
            return None
        d = WATERMARK_DEFAULTS
        return cls(
            file_path=file_path,
            x=_clamp(_finite_float(data.get("x"), d["x"]), 0.0, 1.0),
            y=_clamp(_finite_float(data.get("y"), d["y"]), 0.0, 1.0),
            scale=_clamp(_finite_float(data.get("scale"), d["scale"]), 0.0, 1.0),
            opacity=_clamp(_finite_float(data.get("opacity"), d["opacity"]), 0.0, 1.0),
            mime_type=_to_text(_first(data, "mimeType", "mime_type"), WATERMARK_MAX_PATH_CHARS),
            chroma_key=WatermarkChromaKey.from_dict(_first(data, "chromaKey", "chroma_key")),
        )


OUTRO_MAX_PATH_CHARS = 512


@dataclass
class Outro:
    """Video outro yang ditempel di AKHIR setiap klip hasil render."""

    file_path: str  # relatif terhadap CLIPS_DIR, mis. outros/<user>/<id>.mp4
    duration_sec: Optional[float] = None  # hanya informasi; durasi asli diprobe worker

    def to_dict(self) -> Dict[str, Any]:
        return {"filePath": self.file_path, "durationSec": self.duration_sec}

    @classmethod
    def from_dict(cls, data: Any) -> Optional["Outro"]:
        """Parse toleran; bukan object / filePath kosong -> None."""
        if not isinstance(data, MappingABC):
            return None
        file_path = _to_text(
            _first(data, "filePath", "file_path", "path"), OUTRO_MAX_PATH_CHARS
        )
        if not file_path:
            return None
        duration = _finite_float(_first(data, "durationSec", "duration_sec"), -1.0)
        return cls(file_path=file_path, duration_sec=duration if duration > 0 else None)


@dataclass
class ManualRange:
    """detik"""

    start: float
    end: float
    # Judul/alasan hasil tinjauan LLM; None bila rentang berasal dari transkrip.
    title: Optional[str] = None
    reason: Optional[str] = None
    hook_text: str | None = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"start": self.start, "end": self.end}
        if self.title:
            payload["title"] = self.title
        if self.reason:
            payload["reason"] = self.reason
        if self.hook_text is not None:
            payload["hookText"] = self.hook_text
        return payload

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ManualRange":
        hook = _to_text(_first(data, "hookText", "hook_text"), MAX_RANGE_HOOK_CHARS)
        return cls(
            start=_to_float(data.get("start"), 0.0),
            end=_to_float(data.get("end"), 0.0),
            title=_to_text(data.get("title"), MAX_RANGE_TITLE_CHARS),
            reason=_to_text(data.get("reason"), MAX_RANGE_REASON_CHARS),
            hook_text=hook.rstrip() if hook else None,
        )


@dataclass
class JobParams:
    clip_count: int = DEFAULT_CLIP_COUNT
    target_duration_sec: float = DEFAULT_TARGET_DURATION_SEC

    def to_dict(self) -> Dict[str, Any]:
        return {"clipCount": self.clip_count, "targetDurationSec": self.target_duration_sec}

    @classmethod
    def from_dict(cls, data: Optional[Mapping[str, Any]]) -> "JobParams":
        data = data or {}
        return cls(
            clip_count=max(1, _to_int(_first(data, "clipCount", "clip_count"), DEFAULT_CLIP_COUNT)),
            target_duration_sec=max(
                1.0,
                _to_float(
                    _first(data, "targetDurationSec", "target_duration_sec"),
                    DEFAULT_TARGET_DURATION_SEC,
                ),
            ),
        )


@dataclass
class JobData:
    job_id: str
    url: str
    mode: JobMode = "auto"
    reframe: ReframeMode = DEFAULT_REFRAME
    captions: bool = DEFAULT_CAPTIONS
    two_speakers: bool = DEFAULT_TWO_SPEAKERS
    # Layout facecam streamer (panel wajah 1080x640 + gameplay 1080x1280);
    # hanya berlaku untuk 9:16 dan saat twoSpeakers false (twoSpeakers menang).
    facecam: bool = DEFAULT_FACECAM
    aspect_ratio: AspectRatio = DEFAULT_ASPECT
    # Bahasa caption sosial: auto (ikut transkrip) / id / en.
    caption_language: CaptionLanguage = DEFAULT_CAPTION_LANGUAGE  # type: ignore[assignment]
    # Hashtag kustom; bila tidak kosong, di-inject ke caption klip dan LLM tidak membuat hashtag.
    custom_hashtags: List[str] = field(default_factory=list)
    # Batas pemindaian sumber (detik); None = durasi penuh. Dipakai mode auto
    # dan preview; mode manual mengabaikannya (rentang sudah eksplisit).
    max_source_sec: Optional[int] = None
    description: Optional[str] = None
    params: JobParams = field(default_factory=JobParams)
    ranges: List[ManualRange] = field(default_factory=list)
    # Gaya takarir opsional; None mempertahankan gaya hook lama.
    caption_style: Optional[CaptionStyle] = None
    # Watermark pertama untuk kompatibilitas payload lama.
    watermark: Optional[Watermark] = None
    # Outro video opsional; None = tanpa outro.
    outro: Optional[Outro] = None
    # Watermark ditumpuk dari bawah ke atas sesuai urutan daftar.
    watermarks: List[Watermark] = field(default_factory=list)
    hook_banner: bool = False
    normalize_audio: bool = True

    def __post_init__(self) -> None:
        if self.watermarks:
            self.watermarks = list(self.watermarks)[:WATERMARK_MAX_PER_JOB]
            if self.watermark is None:
                self.watermark = self.watermarks[0]
        elif self.watermark is not None:
            self.watermarks = [self.watermark]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "captionStyle": self.caption_style.to_dict() if self.caption_style else None,
            "watermark": self.watermark.to_dict() if self.watermark else None,
            "watermarks": [w.to_dict() for w in self.watermarks],
            "outro": self.outro.to_dict() if self.outro else None,
            "jobId": self.job_id,
            "url": self.url,
            "mode": self.mode,
            "reframe": self.reframe,
            "captions": self.captions,
            "twoSpeakers": self.two_speakers,
            "hookBanner": self.hook_banner,
            "normalizeAudio": self.normalize_audio,
            "facecam": self.facecam,
            "aspectRatio": self.aspect_ratio,
            "captionLanguage": self.caption_language,
            "customHashtags": list(self.custom_hashtags),
            "maxSourceSec": self.max_source_sec,
            "description": self.description,
            "params": self.params.to_dict(),
            "ranges": [item.to_dict() for item in self.ranges],
        }


def job_data_from_dict(data: Mapping[str, Any] | JobData) -> JobData:
    """Terima camelCase dari TypeScript (jobId) maupun snake_case (job_id)."""
    if isinstance(data, JobData):
        return data
    if not isinstance(data, MappingABC):
        raise ValueError("data job harus object")

    job_id = _first(data, "jobId", "job_id")
    url = _first(data, "url")
    if not job_id or not isinstance(job_id, str):
        raise ValueError("jobId wajib diisi")
    if not url or not isinstance(url, str):
        raise ValueError("url wajib diisi")

    mode = str(_first(data, "mode", default="auto")).strip().lower()
    if mode not in JOB_MODES:
        raise ValueError(f"mode tidak dikenal: {mode!r} (pakai auto/manual)")

    raw_ranges = _first(data, "ranges", default=[]) or []
    ranges = [ManualRange.from_dict(item) for item in raw_ranges if isinstance(item, MappingABC)]

    description = _first(data, "description")
    description = (
        str(description).strip()[:MAX_DESCRIPTION_CHARS]
        if isinstance(description, str) and str(description).strip()
        else None
    )

    raw_reframe = _first(data, "reframe", default=DEFAULT_REFRAME)
    reframe = str(raw_reframe).strip().lower()
    if reframe not in REFRAME_MODES:
        raise ValueError(f"reframe tidak dikenal: {reframe!r} ({'/'.join(REFRAME_MODES)})")

    raw_captions = _first(data, "captions", default=DEFAULT_CAPTIONS)
    captions = _to_bool(raw_captions, DEFAULT_CAPTIONS)

    raw_two_speakers = _first(data, "twoSpeakers", "two_speakers", default=DEFAULT_TWO_SPEAKERS)
    two_speakers = _to_bool(raw_two_speakers, DEFAULT_TWO_SPEAKERS)

    raw_facecam = _first(data, "facecam", default=DEFAULT_FACECAM)
    facecam = _to_bool(raw_facecam, DEFAULT_FACECAM)

    # Rasio output: parse toleran — nilai tidak dikenal/hilang -> default 9:16.
    raw_aspect = str(
        _first(data, "aspectRatio", "aspect_ratio", default=DEFAULT_ASPECT)
    ).strip()
    aspect_ratio = raw_aspect if raw_aspect in ASPECT_RATIOS else DEFAULT_ASPECT

    max_source_sec = to_max_source_sec(
        _first(data, "maxSourceSec", "max_source_sec")
    )

    def parse_watermarks(items: Any) -> List[Watermark]:
        watermarks: List[Watermark] = []
        if isinstance(items, (list, tuple)):
            for item in items:
                wm = Watermark.from_dict(item)
                if wm is not None:
                    watermarks.append(wm)
                    if len(watermarks) == WATERMARK_MAX_PER_JOB:
                        break
        return watermarks

    watermarks = parse_watermarks(data.get("watermarks"))
    if not watermarks:
        legacy_watermark = data.get("watermark")
        if isinstance(legacy_watermark, (list, tuple)):
            watermarks = parse_watermarks(legacy_watermark)
        else:
            wm = Watermark.from_dict(legacy_watermark)
            if wm is not None:
                watermarks = [wm]

    return JobData(
        job_id=job_id,
        url=url,
        mode=mode,  # type: ignore[arg-type]
        reframe=reframe,  # type: ignore[arg-type]
        captions=captions,
        two_speakers=two_speakers,
        facecam=facecam,
        aspect_ratio=aspect_ratio,  # type: ignore[arg-type]
        caption_language=to_caption_language(
            _first(data, "captionLanguage", "caption_language")
        ),  # type: ignore[arg-type]
        custom_hashtags=to_custom_hashtags(_first(data, "customHashtags", "custom_hashtags")),
        max_source_sec=max_source_sec,
        description=description,
        params=JobParams.from_dict(_first(data, "params", default={}) or {}),
        ranges=ranges,
        caption_style=CaptionStyle.from_dict(_first(data, "captionStyle", "caption_style")),
        watermark=watermarks[0] if watermarks else None,
        watermarks=watermarks,
        outro=Outro.from_dict(_first(data, "outro")),
        hook_banner=_to_bool(_first(data, "hookBanner", "hook_banner"), False),
        normalize_audio=_to_bool(_first(data, "normalizeAudio", "normalize_audio"), True),
    )


@dataclass
class JobProgress:
    stage: JobStage
    percent: float
    message: str = ""
    # Laporan satu klip yang baru saja selesai dirender (ClipResult.to_dict tanpa
    # caption/hashtags, karena caption baru dibuat di akhir job). API memakai
    # `data.clip` dari event progress BullMQ untuk menampilkan klip per tahap.
    clip: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "stage": self.stage,
            "percent": round(max(0.0, min(100.0, float(self.percent))), 1),
        }
        if self.message:
            payload["message"] = self.message
        if self.clip:
            payload["clip"] = dict(self.clip)
        return payload


@dataclass
class ClipResult:
    title: str
    start: float
    end: float
    file: str
    caption: Optional[str] = None
    hashtags: List[str] = field(default_factory=list)
    # Cuplikan transkrip klip (<= CLIP_TRANSCRIPT_MAX karakter).
    transcript: Optional[str] = None
    viral_score: int | None = None
    hook_text: str | None = None
    platform_captions: Optional[Dict[str, Dict[str, Any]]] = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "title": self.title,
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "file": self.file,
        }
        if self.caption:
            payload["caption"] = self.caption
        if self.hashtags:
            payload["hashtags"] = list(self.hashtags)
        if self.platform_captions:
            payload["platformCaptions"] = self.platform_captions
        transcript = (self.transcript or "").strip()[:CLIP_TRANSCRIPT_MAX].strip()
        if transcript:
            payload["transcript"] = transcript
        if self.viral_score is not None:
            payload["viralScore"] = self.viral_score
        if self.hook_text is not None:
            payload["hookText"] = self.hook_text
        return payload


@dataclass
class JobResult:
    clips: List[ClipResult] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {"clips": [clip.to_dict() for clip in self.clips]}
