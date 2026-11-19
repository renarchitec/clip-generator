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
DEFAULT_ASPECT = "9:16"

# Batas pemindaian sumber (detik); harus sama dengan MIN_SOURCE_SEC /
# MAX_SOURCE_SEC di packages/shared/src/index.ts.
MIN_SOURCE_SEC = 60
MAX_SOURCE_SEC = 36000

# Batas judul/alasan rentang manual hasil tinjauan LLM; harus sama dengan
# MaxLength di apps/api/src/jobs/dto/create-job.dto.ts.
MAX_RANGE_TITLE_CHARS = 70
MAX_RANGE_REASON_CHARS = 200

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


@dataclass
class ManualRange:
    """detik"""

    start: float
    end: float
    # Judul/alasan hasil tinjauan LLM; None bila rentang berasal dari transkrip.
    title: Optional[str] = None
    reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"start": self.start, "end": self.end}
        if self.title:
            payload["title"] = self.title
        if self.reason:
            payload["reason"] = self.reason
        return payload

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ManualRange":
        return cls(
            start=_to_float(data.get("start"), 0.0),
            end=_to_float(data.get("end"), 0.0),
            title=_to_text(data.get("title"), MAX_RANGE_TITLE_CHARS),
            reason=_to_text(data.get("reason"), MAX_RANGE_REASON_CHARS),
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
    aspect_ratio: AspectRatio = DEFAULT_ASPECT
    # Batas pemindaian sumber (detik); None = durasi penuh. Dipakai mode auto
    # dan preview; mode manual mengabaikannya (rentang sudah eksplisit).
    max_source_sec: Optional[int] = None
    description: Optional[str] = None
    params: JobParams = field(default_factory=JobParams)
    ranges: List[ManualRange] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "jobId": self.job_id,
            "url": self.url,
            "mode": self.mode,
            "reframe": self.reframe,
            "captions": self.captions,
            "twoSpeakers": self.two_speakers,
            "aspectRatio": self.aspect_ratio,
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

    # Rasio output: parse toleran — nilai tidak dikenal/hilang -> default 9:16.
    raw_aspect = str(
        _first(data, "aspectRatio", "aspect_ratio", default=DEFAULT_ASPECT)
    ).strip()
    aspect_ratio = raw_aspect if raw_aspect in ASPECT_RATIOS else DEFAULT_ASPECT

    max_source_sec = to_max_source_sec(
        _first(data, "maxSourceSec", "max_source_sec")
    )

    return JobData(
        job_id=job_id,
        url=url,
        mode=mode,  # type: ignore[arg-type]
        reframe=reframe,  # type: ignore[arg-type]
        captions=captions,
        two_speakers=two_speakers,
        aspect_ratio=aspect_ratio,  # type: ignore[arg-type]
        max_source_sec=max_source_sec,
        description=description,
        params=JobParams.from_dict(_first(data, "params", default={}) or {}),
        ranges=ranges,
    )


@dataclass
class JobProgress:
    stage: JobStage
    percent: float
    message: str = ""

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "stage": self.stage,
            "percent": round(max(0.0, min(100.0, float(self.percent))), 1),
        }
        if self.message:
            payload["message"] = self.message
        return payload


@dataclass
class ClipResult:
    title: str
    start: float
    end: float
    file: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "file": self.file,
        }


@dataclass
class JobResult:
    clips: List[ClipResult] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {"clips": [clip.to_dict() for clip in self.clips]}
