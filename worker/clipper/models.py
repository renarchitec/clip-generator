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

# Kunci Redis sinyal pembatalan; harus sama dengan cancelKey() di
# apps/api/src/queue/queue.constants.ts.
CANCEL_KEY = "cancel:{}"

JOB_STAGES = ("download", "transcribe", "select", "render", "save")
JOB_MODES = ("auto", "manual")
REFRAME_MODES = ("face_tracking", "black_bars", "blurred_fill")

JobStage = Literal["download", "transcribe", "select", "render", "save"]
JobMode = Literal["auto", "manual"]
ReframeMode = Literal["face_tracking", "black_bars", "blurred_fill"]

DEFAULT_CLIP_COUNT = 3
DEFAULT_TARGET_DURATION_SEC = 45.0
MAX_DESCRIPTION_CHARS = 500
DEFAULT_REFRAME = "face_tracking"

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


@dataclass
class ManualRange:
    """detik"""

    start: float
    end: float

    def to_dict(self) -> Dict[str, float]:
        return {"start": self.start, "end": self.end}

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ManualRange":
        return cls(start=_to_float(data.get("start"), 0.0), end=_to_float(data.get("end"), 0.0))


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
    description: Optional[str] = None
    params: JobParams = field(default_factory=JobParams)
    ranges: List[ManualRange] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "jobId": self.job_id,
            "url": self.url,
            "mode": self.mode,
            "reframe": self.reframe,
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

    return JobData(
        job_id=job_id,
        url=url,
        mode=mode,  # type: ignore[arg-type]
        reframe=reframe,  # type: ignore[arg-type]
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
