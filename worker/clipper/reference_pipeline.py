"""Reference Edit: analisis referensi, pencocokan footage, render, dan simpan.

Kontrak data mengikuti REFERENCE_* di packages/shared/src/index.ts. Seluruh
pekerjaan berat (OpenCV/ffmpeg/LLM) berjalan di thread terpisah lewat
asyncio.to_thread, sama seperti pipeline.py.
"""

from __future__ import annotations

import asyncio
import base64
import glob
import json
import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from . import llm, pipeline, reframe
from .models import (
    REFERENCE_STAGES,
    ReferenceFootageItem,
    ReferenceJobData,
    ReferenceJobProgress,
    ReferenceJobResult,
    ReferencePlanSlot,
    ReferenceTemplateSlot,
)

log = logging.getLogger(__name__)

# Batas slot referensi (2..8, tiap 1..15 detik).
MIN_SLOTS = 2
MAX_SLOTS = 8
MIN_SLOT_SEC = 1.0
MAX_SLOT_SEC = 15.0
SINGLE_SHOT_SEC = 3.5
BEAT_SNAP_SEC = 0.25
KEYFRAME_WIDTH = 512
MAX_KEYFRAMES_PER_FOOTAGE = 2
RENDER_TIMEOUT_SEC = 900.0
PROBE_TIMEOUT_SEC = 60.0
CAPTION_SYSTEM = "Kamu editor video shorts berbahasa Indonesia. Jawab hanya JSON object."
_OVERLAY_SPLIT_RE = re.compile(r"[ \t]+")


def _text(value: Any, limit: int = 200) -> str:
    return " ".join(str(value or "").split())[:limit].strip()


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if result == result and abs(result) != float("inf") else default


async def _emit(
    on_progress: Optional[Callable[[ReferenceJobProgress], Awaitable[None] | None]],
    progress: ReferenceJobProgress,
) -> None:
    if on_progress is None:
        return
    result = on_progress(progress)
    if asyncio.iscoroutine(result) or isinstance(result, asyncio.Future):
        await result


async def _check_cancel(
    should_cancel: Optional[Callable[[], Awaitable[bool] | bool]]
) -> None:
    if should_cancel is None:
        return
    result = should_cancel()
    if asyncio.iscoroutine(result) or isinstance(result, asyncio.Future):
        result = await result
    if result:
        raise pipeline.JobCancelled("job dibatalkan")


def _run(cmd: Sequence[str], timeout: Optional[float] = None) -> str:
    """Run subprocess with captured output (blocking; called via to_thread)."""
    log.debug("reference: %s", " ".join(cmd))
    try:
        proc = subprocess.run(
            list(cmd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"{cmd[0]} tidak terpasang di worker: {exc}") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-6:]
        raise RuntimeError(f"{cmd[0]} gagal (exit {proc.returncode}): " + " | ".join(tail))
    return proc.stdout or ""


def _probe(path: str) -> Dict[str, Any]:
    out = _run(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "stream=index,codec_type,width,height,duration:format=duration",
            "-of", "json", path,
        ],
        timeout=PROBE_TIMEOUT_SEC,
    )
    data = json.loads(out or "{}")
    streams = data.get("streams") or []
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("file tanpa stream video")
    duration = _number(video.get("duration")) or _number((data.get("format") or {}).get("duration"))
    return {
        "duration": duration,
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "has_audio": any(stream.get("codec_type") == "audio" for stream in streams),
    }


def _resolve_media(clips_dir: str, file_path: str) -> str:
    """Resolve a clips-relative path, rejecting traversal and missing files."""
    rel = file_path.replace("\\", "/")
    if os.path.isabs(rel) or ".." in rel.split("/"):
        raise RuntimeError(f"path di luar CLIPS_DIR ditolak: {file_path!r}")
    root = os.path.realpath(clips_dir)
    path = os.path.realpath(os.path.join(root, rel))
    if os.path.commonpath([root, path]) != root or path == root:
        raise RuntimeError(f"path di luar CLIPS_DIR ditolak: {file_path!r}")
    if not os.path.isfile(path):
        raise RuntimeError(f"file tidak ditemukan: {file_path}")
    return path


def _download_reference(url: str, workdir: str) -> str:
    cmd = [
        "yt-dlp", "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format", "mp4", "--no-playlist", "--no-progress",
        "--no-warnings", "-o", os.path.join(workdir, "reference.%(ext)s"), url,
    ]
    _run(cmd, timeout=900.0)
    for path in sorted(glob.glob(os.path.join(workdir, "reference*"))):
        if ".part" not in path.lower() and path.lower().endswith((".mp4", ".webm", ".mkv", ".mov")):
            return path
    raise RuntimeError("yt-dlp selesai tanpa menghasilkan video referensi")


def _detect_shot_boundaries(video: str, duration: float) -> List[float]:
    """Return 0..duration boundaries: OpenCV shot cuts where possible, else even slots."""
    cuts: List[float] = []
    try:
        import cv2

        capture = cv2.VideoCapture(video)
        try:
            if capture.isOpened():
                fps = float(capture.get(cv2.CAP_PROP_FPS) or 0) or 5.0
                step = max(0.5, min(1.0, 5.0 / fps))
                previous: Optional[Tuple[Any, Any]] = None
                last_cut = -10.0
                at = 0.0
                while at < duration:
                    capture.set(cv2.CAP_PROP_POS_MSEC, at * 1000)
                    ok, frame = capture.read()
                    if not ok or frame is None:
                        break
                    signature = reframe._shot_signature(frame, cv2)
                    if previous is not None and reframe._is_shot_cut(previous, signature, cv2):
                        if at - last_cut >= 1.0:
                            cuts.append(at)
                            last_cut = at
                    previous = signature
                    at += step
        finally:
            capture.release()
    except Exception as exc:  # noqa: BLE001 - fallback deterministik
        log.warning("deteksi shot cut gagal, pakai pembagian merata: %s", exc)

    # Buang cut yang terlalu rapat dan beri batas 1..15 detik per slot.
    clean: List[float] = []
    for cut in cuts:
        prev = clean[-1] if clean else 0.0
        if 1.0 <= cut - prev <= 15.0 and duration - cut >= 1.0:
            clean.append(cut)
    if len(clean) + 1 < MIN_SLOTS or len(clean) + 1 > MAX_SLOTS:
        count = min(MAX_SLOTS, max(MIN_SLOTS, math.ceil(duration / SINGLE_SHOT_SEC)))
        count = min(count, max(MIN_SLOTS, int(duration // MIN_SLOT_SEC)))
        return [round(duration * index / count, 3) for index in range(count + 1)]
    return [round(value, 3) for value in ([0.0] + clean + [duration])]


def _beat_peaks(video: str, workdir: str, duration: float) -> List[float]:
    """Approximate onset peaks from mono PCM energy (no librosa needed)."""
    try:
        import numpy as np

        audio = os.path.join(workdir, "reference-audio.raw")
        _run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", video, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", audio,
            ],
            timeout=PROBE_TIMEOUT_SEC,
        )
        samples = np.fromfile(audio, dtype="<i2")
        if samples.size == 0:
            return []
        hop = 800  # 0.1 s
        frames = samples[: len(samples) // hop * hop].reshape(-1, hop)
        energy = np.sqrt((frames.astype(np.float64) ** 2).mean(axis=1))
        if energy.size < 3:
            return []
        # Local maxima above mean energy, adjacent peaks at least 0.3 s apart.
        candidates = [
            index * 0.1
            for index in range(1, energy.size - 1)
            if energy[index] >= energy[index - 1]
            and energy[index] > energy[index + 1]
            and energy[index] > energy.mean()
        ]
        peaks: List[float] = []
        for time in candidates:
            if time > duration or (peaks and time - peaks[-1] < 0.3):
                continue
            peaks.append(time)
        return peaks
    except Exception as exc:  # noqa: BLE001 - beat sync opsional
        log.warning("deteksi beat gagal: %s", exc)
        return []


def _snap_to_beats(boundaries: List[float], peaks: Sequence[float]) -> List[float]:
    if not peaks:
        return boundaries
    snapped: List[float] = []
    for index, value in enumerate(boundaries):
        if index in (0, len(boundaries) - 1):
            snapped.append(value)
            continue
        nearest = min(peaks, key=lambda peak: abs(peak - value))
        if abs(nearest - value) <= BEAT_SNAP_SEC:
            snapped.append(round(nearest, 3))
        else:
            snapped.append(value)
    # Jaga durasi slot tetap wajar setelah snap.
    for index in range(1, len(snapped)):
        if snapped[index] <= snapped[index - 1] + MIN_SLOT_SEC:
            snapped[index] = round(min(boundaries[-1], snapped[index - 1] + MIN_SLOT_SEC), 3)
    return snapped


def _keyframe_b64(video: str, at: float, workdir: str, name: str) -> Optional[str]:
    out = os.path.join(workdir, f"{name}.jpg")
    try:
        _run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-ss", f"{max(0.0, at):.3f}", "-i", video, "-frames:v", "1",
                "-vf", f"scale='min({KEYFRAME_WIDTH},iw)':-2", "-q:v", "5", out,
            ],
            timeout=PROBE_TIMEOUT_SEC,
        )
        if os.path.isfile(out) and os.path.getsize(out) > 0:
            with open(out, "rb") as handle:
                return base64.b64encode(handle.read()).decode("ascii")
    except Exception as exc:  # noqa: BLE001 - frame opsional untuk LLM
        log.warning("ekstrak keyframe gagal (%s): %s", name, exc)
    return None


def _fallback_slots(boundaries: Sequence[float], total: float) -> List[ReferenceTemplateSlot]:
    shot_types = ("hook", "talking_head", "b_roll", "closeup", "cta")
    slots: List[ReferenceTemplateSlot] = []
    for index in range(len(boundaries) - 1):
        start, end = boundaries[index], boundaries[index + 1]
        slots.append(
            ReferenceTemplateSlot(
                index=index,
                start_sec=round(start, 3),
                end_sec=round(end, 3),
                duration_sec=round(max(0.0, end - start), 3),
                shot_type=shot_types[min(index, len(shot_types) - 1)],
                description=f"Bagian {index + 1} dari video referensi ({start:.1f}-{end:.1f} detik)",
                overlay_text=None,
                zoom="none",
                beat_sync=False,
            )
        )
    return slots


def _vision_config(env: Mapping[str, str]) -> Tuple[str, str, str]:
    return (
        (env.get("LLM_BASE_URL") or "").strip(),
        (env.get("LLM_API_KEY") or "").strip(),
        llm.vision_model_from_env(env),
    )


def _label_slots(
    boundaries: Sequence[float],
    images: Sequence[Optional[str]],
    total: float,
    job: ReferenceJobData,
    env: Mapping[str, str],
) -> List[ReferenceTemplateSlot]:
    fallback = _fallback_slots(boundaries, total)
    base_url, api_key, model = _vision_config(env)
    if not (base_url and api_key):
        return fallback
    prompt = (
        "Berikut adalah keyframe dari setiap bagian video referensi, berurutan dari "
        "index 0. Labeli tiap bagian. Balas HANYA JSON object:\n"
        '{"slots":[{"index":0,"shotType":"hook","description":"...",'
        '"overlayText":"...","zoom":"none","beatSync":false}]}\n'
        f"Jumlah slot: {len(fallback)}. Durasi total: {total:.1f} detik.\n"
        f"Brief pengguna: {_text(job.brief) or '-'}\n"
        "shotType salah satu: hook, talking_head, b_roll, closeup, cta. "
        'zoom salah satu: "none", "in", "out". OverlayText boleh null.'
    )
    try:
        raw = llm.complete_vision(
            CAPTION_SYSTEM, prompt, [image for image in images if image],
            base_url=base_url, api_key=api_key, model=model,
        )
        items = (llm.parse_llm_object(raw).get("slots") or [])
        if not isinstance(items, list):
            raise ValueError("slots bukan list")
        by_index = {
            int(item["index"]): item
            for item in items
            if isinstance(item, Mapping) and str(item.get("index", "")).isdigit()
        }
        for slot in fallback:
            item = by_index.get(slot.index)
            if not item:
                continue
            shot_type = _text(item.get("shotType"), 40).lower()
            if shot_type:
                slot.shot_type = shot_type[:40]
            description = _text(item.get("description"), 300)
            if description:
                slot.description = description
            overlay = item.get("overlayText")
            if isinstance(overlay, str) and _text(overlay, 120):
                slot.overlay_text = _text(overlay, 120)
            zoom = item.get("zoom")
            if zoom in ("none", "in", "out"):
                slot.zoom = zoom
            if isinstance(item.get("beatSync"), bool):
                slot.beat_sync = item["beatSync"]
        return fallback
    except Exception as exc:  # noqa: BLE001 - fallback deterministik
        log.warning("label LLM gagal, pakai metadata deterministik: %s", exc)
        return fallback


def _analyze_reference(
    job: ReferenceJobData, clips_dir: str, workdir: str, env: Mapping[str, str]
) -> Tuple[List[ReferenceTemplateSlot], str, float]:
    video = (
        _resolve_media(clips_dir, job.reference_file_path)
        if job.reference_file_path
        else _download_reference(job.reference_url or "", workdir)
    )
    info = _probe(video)
    duration = info["duration"] or job.reference_duration_sec or 0.0
    if duration <= 0:
        raise RuntimeError("durasi video referensi tidak terbaca")
    boundaries = _detect_shot_boundaries(video, duration)
    if job.beat_sync:
        boundaries = _snap_to_beats(boundaries, _beat_peaks(video, workdir, duration))
    images = [
        _keyframe_b64(video, (boundaries[index] + boundaries[index + 1]) / 2, workdir, f"ref-{index}")
        for index in range(len(boundaries) - 1)
    ]
    return _label_slots(boundaries, images, duration, job, env), video, duration


def _frame_stats(video: str, at: float) -> Tuple[Optional[str], float]:
    """Satu keyframe representatif + skor ketajaman/kecerahan (0..1)."""
    try:
        import cv2
        import numpy as np

        capture = cv2.VideoCapture(video)
        try:
            if not capture.isOpened():
                return None, 0.0
            capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, at) * 1000)
            ok, frame = capture.read()
            if not ok or frame is None:
                return None, 0.0
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            brightness = float(gray.mean()) / 255.0
            score = min(1.0, sharpness / 500.0) * 0.6 + brightness * 0.4
            small = frame
            height, width = small.shape[:2]
            if width > KEYFRAME_WIDTH:
                scale = KEYFRAME_WIDTH / width
                small = cv2.resize(small, (KEYFRAME_WIDTH, max(1, int(height * scale))))
            ok, encoded = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                return None, score
            return base64.b64encode(encoded.tobytes()).decode("ascii"), round(score, 4)
        finally:
            capture.release()
    except Exception as exc:  # noqa: BLE001
        log.warning("analisis footage gagal: %s", exc)
        return None, 0.0


def _describe_footage(
    job: ReferenceJobData,
    clips_dir: str,
    env: Mapping[str, str],
) -> Dict[str, Dict[str, Any]]:
    """Deskripsi + jendela terbaik tiap footage, dengan fallback deterministik."""
    result: Dict[str, Dict[str, Any]] = {}
    images: List[str] = []
    for item in job.footage:
        path = _resolve_media(clips_dir, item.file_path)
        info = _probe(path)
        duration = info["duration"] or item.duration_sec or 0.0
        offsets = (
            [duration * 0.25, duration * 0.75] if duration >= 4.0 else [duration * 0.5]
        )
        frames: List[str] = []
        scores: List[float] = []
        for offset in offsets[:MAX_KEYFRAMES_PER_FOOTAGE]:
            frame, score = _frame_stats(path, offset)
            if frame:
                frames.append(frame)
            scores.append(score)
        quality = max(scores, default=0.0)
        result[item.id] = {
            "item": item,
            "duration": duration,
            "quality": quality,
            "description": f"Klip {item.name} ({duration:.1f} detik)",
            "start": 0.0,
            "end": duration,
            "images": frames,
        }
        images.extend(frames)

    base_url, api_key, model = _vision_config(env)
    if not (base_url and api_key) or not images:
        return result

    prompt = (
        "Berikut keyframe dari beberapa klip footage, dikelompokkan berurutan "
        "berdasarkan daftar di bawah. Untuk tiap footage beri deskripsi visual singkat "
        "dan jendela terbaik (sourceStartSec, sourceEndSec) dalam durasi klip itu. "
        "Balas HANYA JSON object:\n"
        '{"footage":[{"id":"...","description":"...","sourceStartSec":0,'
        '"sourceEndSec":3.5}]}\n'
        + "\n".join(
            f"- id={item.id}, nama={item.name}, durasi={data['duration']:.1f} detik"
            for item in job.footage
            for data in [result[item.id]]
        )
    )
    try:
        raw = llm.complete_vision(
            CAPTION_SYSTEM, prompt, images, base_url=base_url,
            api_key=api_key, model=model,
        )
        items = llm.parse_llm_object(raw).get("footage") or []
        if isinstance(items, list):
            for entry in items:
                if not isinstance(entry, Mapping):
                    continue
                data = result.get(str(entry.get("id")))
                if not data:
                    continue
                description = _text(entry.get("description"), 300)
                if description:
                    data["description"] = description
                duration = data["duration"]
                start = max(0.0, min(_number(entry.get("sourceStartSec")), max(0.0, duration - 1.0)))
                end = _number(entry.get("sourceEndSec"), duration)
                if end > start + 1.0 and end <= duration + 0.01:
                    data["start"], data["end"] = round(start, 3), round(end, 3)
    except Exception as exc:  # noqa: BLE001
        log.warning("deskripsi footage LLM gagal, pakai fallback: %s", exc)
    return result


def _plan_slots(
    slots: Sequence[ReferenceTemplateSlot],
    footage: Mapping[str, Dict[str, Any]],
    job: ReferenceJobData,
    env: Mapping[str, str],
) -> List[ReferencePlanSlot]:
    items = list(job.footage)
    if not items:
        return []

    # Fallback: round-robin berurutan dengan prioritas kualitas ringan.
    ranked = sorted(items, key=lambda item: footage.get(item.id, {}).get("quality", 0.0), reverse=True)
    plans = [
        ReferencePlanSlot(
            slot_index=slot.index,
            footage_id=ranked[slot.index % len(ranked)].id,
            footage_name=ranked[slot.index % len(ranked)].name,
            source_start_sec=0.0,
            source_end_sec=0.0,
            target_duration_sec=slot.duration_sec,
            shot_type=slot.shot_type,
            reason=f"Fallback otomatis: {slot.shot_type}",
            overlay_text=slot.overlay_text,
            zoom=slot.zoom,
        )
        for slot in slots
    ]
    for plan in plans:
        data = footage.get(plan.footage_id, {})
        duration = float(data.get("duration") or 0.0)
        start = float(data.get("start") or 0.0)
        wanted = max(1.0, plan.target_duration_sec)
        plan.source_start_sec = round(min(start, max(0.0, duration - 1.0)), 3)
        plan.source_end_sec = round(min(duration, plan.source_start_sec + wanted), 3)
        if plan.source_end_sec - plan.source_start_sec < 1.0 and duration > 1.0:
            plan.source_start_sec = 0.0
            plan.source_end_sec = round(min(duration, wanted), 3)

    base_url, api_key, model = _vision_config(env)
    if not (base_url and api_key):
        return plans

    prompt = (
        "Pilih footage terbaik untuk setiap slot referensi berikut. Balas HANYA JSON object:\n"
        '{"plan":[{"slotIndex":0,"footageId":"...","sourceStartSec":0,'
        '"sourceEndSec":3.5,"reason":"..."}]}\n'
        "Slot: "
        + "; ".join(
            f"index={slot.index}, durasi={slot.duration_sec:.1f}, "
            f"shotType={slot.shot_type}, deskripsi={_text(slot.description, 120)}"
            for slot in slots
        )
        + "\nFootage: "
        + "; ".join(
            f"id={item.id}, nama={_text(item.name, 60)}, "
            f"durasi={footage.get(item.id, {}).get('duration', 0):.1f}, "
            f"deskripsi={_text(footage.get(item.id, {}).get('description'), 120)}"
            for item in items
        )
    )
    try:
        raw = llm.complete_vision(
            CAPTION_SYSTEM, prompt, [], base_url=base_url,
            api_key=api_key, model=model,
        )
        entries = llm.parse_llm_object(raw).get("plan") or []
        if not isinstance(entries, list):
            return plans
        known = {item.id for item in items}
        for entry in entries:
            if not isinstance(entry, Mapping):
                continue
            try:
                index = int(entry.get("slotIndex"))
            except (TypeError, ValueError):
                continue
            if index < 0 or index >= len(plans):
                continue
            footage_id = str(entry.get("footageId") or "")
            if footage_id not in known:
                continue
            plan = plans[index]
            data = footage.get(footage_id, {})
            duration = float(data.get("duration") or 0.0)
            start = max(0.0, min(_number(entry.get("sourceStartSec")), max(0.0, duration - 1.0)))
            end = min(_number(entry.get("sourceEndSec"), start + plan.target_duration_sec), duration)
            wanted = max(1.0, plan.target_duration_sec)
            if end - start < wanted and start + wanted <= duration:
                end = start + wanted
            if end - start < 1.0:
                continue
            plan.footage_id = footage_id
            plan.footage_name = str(data.get("item").name) if data.get("item") else footage_id
            plan.source_start_sec = round(start, 3)
            plan.source_end_sec = round(end, 3)
            reason = _text(entry.get("reason"), 200)
            if reason:
                plan.reason = reason
    except Exception as exc:  # noqa: BLE001
        log.warning("perencanaan LLM gagal, pakai fallback: %s", exc)
    return plans


def _ass_overlay(text: str) -> Tuple[str, str]:
    escaped = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    escaped = escaped.replace("\n", "\\N")
    return escaped, ":".join(_OVERLAY_SPLIT_RE.split(escaped)[:8])


def _overlay_ass(path: str, text: str, duration: float) -> None:
    """ASS minimal: teks overlay dipusatkan di bawah, diedit agar aman."""
    escaped, _ = _ass_overlay(text)
    start, end = 0.0, max(0.1, duration)
    style = (
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding\n"
        "Style: Default,Anton,80,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,"
        "-1,0,0,0,100,100,0,0,1,4,2,2,60,60,180,1\n"
    )

    def stamp(value: float) -> str:
        hours = int(value // 3600)
        minutes = int(value // 60) % 60
        seconds = value % 60
        return f"{hours:d}:{minutes:02d}:{seconds:05.2f}"

    with open(path, "w", encoding="utf-8") as handle:
        handle.write("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n")
        handle.write(style)
        handle.write("\n[Events]\n")
        handle.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
        handle.write(f"Dialogue: 0,{stamp(start)},{stamp(end)},Default,,0,0,0,,{escaped}\n")


def _render_cmd(
    source: str, out: str, width: int, height: int, start: float, end: float,
    zoom: str, overlay_ass_path: Optional[str],
) -> List[str]:
    duration = max(1.0 / 30.0, end - start)
    video_filters = [
        f"scale={width}:{height}:force_original_aspect_ratio=increase",
        f"crop={width}:{height}",
        "setsar=1",
        "fps=30",
        "format=yuv420p",
    ]
    if zoom in ("in", "out"):
        # z=1.00 -> 1.06 (zoom in) atau sebaliknya; efek halus selama satu slot.
        direction = "1.00+0.06*on" if zoom == "in" else "1.06-0.06*on"
        video_filters.insert(
            3,
            f"zoompan=z='{direction}':d=1:x='iw/2-(iw/zoom/2)':"
            f"y='ih/2-(ih/zoom/2)':s={width}x{height}:fps=30",
        )
    if overlay_ass_path:
        video_filters.append(f"subtitles={pipeline._ffmpeg_filter_path(overlay_ass_path)}")

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", source,
    ]
    if overlay_ass_path:
        pass  # subtitles filter reads the ASS file directly; no extra input needed
    info = _probe(source)
    if not info["has_audio"]:
        cmd += ["-f", "lavfi", "-t", f"{duration:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
    audio_input = "0:a:0" if info["has_audio"] else "1:a:0"
    cmd += [
        "-t", f"{duration:.3f}",
        "-vf", ",".join(video_filters),
        "-map", "0:v:0", "-map", audio_input,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-movflags", "+faststart", "-sn", "-f", "mp4", out,
    ]
    return cmd


def _render_segments(
    job: ReferenceJobData,
    plans: Sequence[ReferencePlanSlot],
    clips_dir: str,
    workdir: str,
) -> List[str]:
    width, height = pipeline.OUTPUT_SIZES.get(job.aspect_ratio, pipeline.OUTPUT_SIZES["9:16"])
    segments: List[str] = []
    cached: Dict[str, Tuple[str, Dict[str, Any]]] = {}
    for index, plan in enumerate(plans):
        if plan.footage_id not in cached:
            source = _resolve_media(clips_dir, next(
                item.file_path for item in job.footage if item.id == plan.footage_id
            ))
            cached[plan.footage_id] = source, _probe(source)
        source, info = cached[plan.footage_id]
        duration = info["duration"] or (plan.source_end_sec - plan.source_start_sec)
        start = max(0.0, min(plan.source_start_sec, max(0.0, duration - 0.1)))
        end = min(duration, max(start + 1.0 / 30.0, plan.source_end_sec))
        out = os.path.join(workdir, f"segment-{index:03d}.mp4")
        overlay_path: Optional[str] = None
        if job.captions and plan.overlay_text:
            overlay_path = os.path.join(workdir, f"overlay-{index:03d}.ass")
            _overlay_ass(overlay_path, plan.overlay_text, end - start)
        _run(
            _render_cmd(source, out, width, height, start, end, plan.zoom, overlay_path),
            timeout=RENDER_TIMEOUT_SEC,
        )
        segments.append(out)
    return segments


def _concat(segments: Sequence[str], out: str) -> float:
    if not segments:
        raise RuntimeError("tidak ada segmen untuk dirender")
    listing = os.path.join(os.path.dirname(out), "concat-list.txt")
    with open(listing, "w", encoding="utf-8") as handle:
        for segment in segments:
            handle.write(f"file '{pipeline._ffmpeg_filter_path(segment)}'\n")
    _run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", listing,
            "-c", "copy", "-movflags", "+faststart", "-f", "mp4", out,
        ],
        timeout=RENDER_TIMEOUT_SEC,
    )
    return float(_probe(out).get("duration") or 0.0)


async def run_reference_job(
    job: ReferenceJobData,
    *,
    clips_dir: str,
    temp_root: Optional[str] = None,
    on_progress: Optional[Callable[[ReferenceJobProgress], Awaitable[None] | None]] = None,
    should_cancel: Optional[Callable[[], Awaitable[bool] | bool]] = None,
    env: Optional[Mapping[str, str]] = None,
) -> ReferenceJobResult:
    """Orkestrasi seluruh tahap Reference Edit. Workdir selalu dibersihkan."""
    values = env if env is not None else os.environ
    clips_dir = str(clips_dir)
    temp_root = str(temp_root or os.getenv("TEMP_ROOT") or tempfile.gettempdir())
    os.makedirs(clips_dir, exist_ok=True)
    os.makedirs(temp_root, exist_ok=True)
    await asyncio.to_thread(pipeline._check_free_space, clips_dir)

    workdir = tempfile.mkdtemp(prefix=f"ref-{job.job_id}-", dir=temp_root)
    log.info("reference job %s mulai, workdir=%s", job.job_id, workdir)
    try:
        await _check_cancel(should_cancel)
        slots, _, _ = await asyncio.to_thread(
            _analyze_reference, job, clips_dir, workdir, values
        )
        await _emit(
            on_progress,
            ReferenceJobProgress(
                stage="analyze_reference", percent=90,
                message=f"{len(slots)} slot referensi terdeteksi", template_slots=slots,
            ),
        )
        await _check_cancel(should_cancel)

        footage = await asyncio.to_thread(_describe_footage, job, clips_dir, values)
        await _emit(
            on_progress,
            ReferenceJobProgress(
                stage="analyze_footage", percent=90,
                message=f"{len(footage)} klip footage dianalisis",
            ),
        )
        await _check_cancel(should_cancel)

        plans = await asyncio.to_thread(_plan_slots, slots, footage, job, values)
        await _emit(
            on_progress,
            ReferenceJobProgress(
                stage="plan_edit", percent=90,
                message=f"{len(plans)} slot direncanakan",
                template_slots=slots, plan_slots=plans,
            ),
        )
        await _check_cancel(should_cancel)

        await _emit(on_progress, ReferenceJobProgress(stage="render", percent=0, message="merender segmen"))
        segments = await asyncio.to_thread(_render_segments, job, plans, clips_dir, workdir)
        await _check_cancel(should_cancel)

        await _emit(on_progress, ReferenceJobProgress(stage="save", percent=90, message="menyimpan hasil"))
        output_dir = pipeline.clip_dir(clips_dir, job.job_id)
        await asyncio.to_thread(os.makedirs, output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, "reference-edit.mp4")
        duration = await asyncio.to_thread(_concat, segments, output_path)

        caption: Optional[str] = None
        hashtags: List[str] = []
        if job.captions:
            try:
                moments = [
                    llm.Moment(
                        start=plan.source_start_sec, end=plan.source_end_sec,
                        title=_text(plan.shot_type, 70), reason=_text(plan.reason, 200),
                    )
                    for plan in plans
                ]
                captions = await asyncio.to_thread(
                    llm.generate_captions, moments, [], job.brief, values
                )
                generated = next((item for item in captions if item is not None), None)
                if generated is not None:
                    caption, hashtags = generated.caption, list(generated.hashtags)
            except Exception as exc:  # noqa: BLE001 - caption opsional
                log.warning("caption sosial dilewati: %s", exc)

        result = ReferenceJobResult(
            output_file_path=f"{job.job_id}/reference-edit.mp4",
            duration_sec=duration,
            template_slots=slots,
            plan_slots=plans,
            caption=caption,
            hashtags=hashtags,
        )
        await _emit(on_progress, ReferenceJobProgress(stage="save", percent=100, message="selesai"))
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
