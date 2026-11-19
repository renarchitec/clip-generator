"""Pipeline: satu fungsi per tahap, kerja berat lewat asyncio.to_thread."""

from __future__ import annotations

import asyncio
import glob
import inspect
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from typing import List, Optional, Sequence, Union

from . import llm
from .models import JOB_ID_RE, ClipResult, JobData, JobResult, job_data_from_dict
from .subtitles import Cue, parse_vtt, sanitize, split_long_cues, write_ass

log = logging.getLogger(__name__)

FONT_SIZE = 64
MARGIN_V = 180
VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
DEFAULT_MIN_FREE_GB = 5.0


async def _emit(on_progress, stage: str, percent: float, message: str = "") -> None:
    """Dukung callback sync maupun async (worker memakai async)."""
    if on_progress is None:
        return
    result = on_progress(stage, max(0.0, min(100.0, float(percent))), message)
    if inspect.isawaitable(result):
        await result


class JobCancelled(RuntimeError):
    """Job dihentikan karena permintaan pembatalan pengguna."""


async def _check_cancel(should_cancel) -> None:
    """Pembatalan dicek di batas tahap: subproses yang sedang jalan tetap selesai dulu."""
    if should_cancel is None:
        return
    cancelled = should_cancel()
    if inspect.isawaitable(cancelled):
        cancelled = await cancelled
    if cancelled:
        raise JobCancelled("job dibatalkan")


def _run(cmd: Sequence[str], cwd: Optional[str] = None, timeout: Optional[float] = None) -> str:
    log.debug("jalankan: %s", " ".join(cmd))
    try:
        proc = subprocess.run(
            list(cmd),
            cwd=cwd,
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


@dataclass
class Downloaded:
    video: str
    subtitles: Optional[str] = None


def _find_video(workdir: str) -> Optional[str]:
    exact = os.path.join(workdir, "source.mp4")
    if os.path.isfile(exact):
        return exact
    for path in sorted(glob.glob(os.path.join(workdir, "source*"))):
        if ".part" in path.lower():
            continue
        if path.lower().endswith((".mp4", ".webm", ".mkv", ".mov")):
            return path
    return None


def _find_subtitles(workdir: str) -> Optional[str]:
    files = sorted(glob.glob(os.path.join(workdir, "source*.vtt")))
    if not files:
        return None
    for path in files:
        if ".id." in os.path.basename(path).lower():
            return path
    return files[0]


def _fetch_subtitles_best_effort(url: str, workdir: str) -> None:
    """Subtitle best-effort: YouTube rate-limit (429) tidak boleh batalkan job."""
    cmd = [
        "yt-dlp",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--extractor-args",
        "youtube:skip=translated_subs",
        "--sub-langs",
        "id,id-orig,en,en-orig",
        "--sub-format",
        "vtt",
        "--convert-subs",
        "vtt",
        "--no-progress",
        "--no-warnings",
        "-o",
        os.path.join(workdir, "source.%(ext)s"),
        url,
    ]
    try:
        _run(cmd)
    except Exception as exc:
        log.warning("gagal unduh subtitle yt-dlp (lanjut fallback Whisper): %s", exc)


async def download(job: JobData, workdir: str, on_progress=None) -> Downloaded:
    """yt-dlp: mp4 terbaik; subtitle via best-effort terpisah (fallback ke Whisper)."""
    os.makedirs(workdir, exist_ok=True)
    await _emit(on_progress, "download", 0, "mengunduh video")

    # 1. Download video murni — kebal dari subtitle 429
    cmd = [
        "yt-dlp",
        "-f",
        "bv*[ext=mp4]+ba[ext=mp4]/b[ext=mp4]/b",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        "-o",
        os.path.join(workdir, "source.%(ext)s"),
        job.url,
    ]
    await asyncio.to_thread(_run, cmd)

    video = _find_video(workdir)
    if not video:
        raise RuntimeError("yt-dlp selesai tanpa menghasilkan file video")

    # 2. Coba ambil subtitle (best-effort); gagal = fallback Whisper di transcribe()
    await asyncio.to_thread(_fetch_subtitles_best_effort, job.url, workdir)

    subtitles = _find_subtitles(workdir)
    await _emit(on_progress, "download", 100, "video siap diunduh")
    return Downloaded(video=video, subtitles=subtitles)


def _read_vtt(path: str) -> List[Cue]:
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return parse_vtt(handle.read())


def _whisper_cues(video_path: str) -> List[Cue]:
    from faster_whisper import WhisperModel  # impor lambat: model besar, hanya saat perlu

    model_name = os.getenv("WHISPER_MODEL", "small")
    model = WhisperModel(
        model_name,
        device=os.getenv("WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    )
    segments, _info = model.transcribe(video_path, language="id", vad_filter=True)

    cues: List[Cue] = []
    for segment in segments:
        text = sanitize(getattr(segment, "text", "") or "")
        start = float(getattr(segment, "start", 0.0) or 0.0)
        end = float(getattr(segment, "end", 0.0) or 0.0)
        if text and end > start:
            cues.append(Cue(start=start, end=end, text=text))

    if not cues:
        raise RuntimeError("Whisper tidak menghasilkan transkrip")
    return cues


async def transcribe(video: str, subtitles: Optional[str], on_progress=None) -> List[Cue]:
    """Pakai subtitle hasil download bila ada, selain itu Whisper bahasa Indonesia."""
    await _emit(on_progress, "transcribe", 0, "menyiapkan transkrip")

    if subtitles and os.path.exists(subtitles):
        cues = await asyncio.to_thread(_read_vtt, subtitles)
        if cues:
            await _emit(on_progress, "transcribe", 100, f"{len(cues)} cue dari subtitle")
            return cues
        log.warning("subtitle %s kosong setelah parse, jatuh ke Whisper", subtitles)

    await _emit(on_progress, "transcribe", 10, "menjalankan Whisper (bisa lama)")
    cues = await asyncio.to_thread(_whisper_cues, video)
    await _emit(on_progress, "transcribe", 100, f"{len(cues)} cue dari Whisper")
    return cues


def _moments_from_ranges(cues: Sequence[Cue], ranges) -> List[llm.Moment]:
    moments: List[llm.Moment] = []
    for item in ranges:
        if item.end <= item.start:
            continue
        moments.append(
            llm.Moment(
                start=round(float(item.start), 2),
                end=round(float(item.end), 2),
                title=llm.title_from_cues(cues, item.start, item.end),
                reason="manual",
            )
        )
    return sorted(moments, key=lambda moment: moment.start)


async def select(job: JobData, cues: Sequence[Cue], on_progress=None) -> List[llm.Moment]:
    await _emit(on_progress, "select", 0, "memilih momen")

    if job.mode == "manual":
        if not job.ranges:
            raise ValueError("mode manual butuh minimal satu range")
        moments = _moments_from_ranges(cues, job.ranges)
        if not moments:
            raise ValueError("semua range manual tidak valid (end harus > start)")
    else:
        moments = await asyncio.to_thread(
            llm.select_moments,
            cues,
            job.params,
            os.environ,
            job.description,
        )

    if not moments:
        raise RuntimeError("tidak ada momen yang bisa dirender")

    await _emit(on_progress, "select", 100, f"{len(moments)} momen dipilih")
    return moments


def _ffmpeg_filter_path(path: str) -> str:
    # Filter ffmpeg memakai ':' dan '\\' sebagai pemisah: escape agar path aman.
    return path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def _clip_cues(cues: Sequence[Cue], start: float, end: float) -> List[Cue]:
    """Ambil cue di dalam jendela clip, geser waktunya ke 0."""
    limit = end - start
    relative: List[Cue] = []
    for cue in cues:
        if cue.end <= start or cue.start >= end:
            continue
        cue_start = max(0.0, cue.start - start)
        cue_end = min(limit, cue.end - start)
        if cue_end <= cue_start:
            continue
        relative.append(Cue(start=cue_start, end=cue_end, text=cue.text))
    return split_long_cues(relative)


def _render_one(video: str, moment: llm.Moment, cues: Sequence[Cue], outdir: str, filename: str) -> None:
    out_path = os.path.join(outdir, filename)
    ass_path = os.path.join(outdir, os.path.splitext(filename)[0] + ".ass")
    clip_cues = _clip_cues(cues, moment.start, moment.end)

    filters = [
        f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=increase",
        f"crop={VIDEO_WIDTH}:{VIDEO_HEIGHT}",
        "setsar=1",
    ]
    if clip_cues:
        with open(ass_path, "w", encoding="utf-8") as handle:
            handle.write(write_ass(clip_cues, VIDEO_WIDTH, VIDEO_HEIGHT, FONT_SIZE, MARGIN_V))
        filters.append("subtitles=" + _ffmpeg_filter_path(ass_path))

    duration = max(0.5, moment.end - moment.start)
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{moment.start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        video,
        "-vf",
        ",".join(filters),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-sn",
        out_path,
    ]
    try:
        _run(cmd)
    finally:
        if os.path.exists(ass_path):
            os.remove(ass_path)


async def render(
    job: JobData,
    moments: Sequence[llm.Moment],
    video: str,
    subs: Sequence[Cue],
    outdir: str,
    on_progress=None,
    should_cancel=None,
) -> List[ClipResult]:
    """Render tiap momen jadi 1080x1920 dengan subtitle terbakar."""
    if not moments:
        raise ValueError("tidak ada momen untuk dirender")

    os.makedirs(outdir, exist_ok=True)
    await _emit(on_progress, "render", 0, f"merender {len(moments)} clip")

    clips: List[ClipResult] = []
    total = len(moments)
    for index, moment in enumerate(moments, start=1):
        await _check_cancel(should_cancel)  # berhenti di antara clip, bukan di tengah ffmpeg
        filename = f"clip-{index:02d}.mp4"
        await asyncio.to_thread(_render_one, video, moment, subs, outdir, filename)
        clips.append(
            ClipResult(
                title=moment.title,
                start=round(moment.start, 2),
                end=round(moment.end, 2),
                file=filename,
            )
        )
        await _emit(on_progress, "render", index * 100 / total, f"clip {index}/{total} selesai")

    log.info("job %s: %s clip dirender", job.job_id, total)
    return clips


def clip_dir(clips_dir: str, job_id: str) -> str:
    """Folder clip selalu dari job_id tervalidasi, tidak pernah dari input pengguna."""
    if not JOB_ID_RE.match(job_id or ""):
        raise ValueError(f"job_id tidak valid: {job_id!r}")
    return os.path.join(clips_dir, job_id)


def _ensure_saved(result: JobResult, folder: str) -> None:
    os.makedirs(folder, exist_ok=True)
    for clip in result.clips:
        path = os.path.join(folder, clip.file)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            raise RuntimeError(f"file clip tidak ditemukan setelah render: {clip.file}")


async def save(result: JobResult, clips_dir: str, job_id: str, on_progress=None) -> str:
    folder = clip_dir(clips_dir, job_id)
    await asyncio.to_thread(_ensure_saved, result, folder)
    await _emit(on_progress, "save", 100, "clip tersimpan")
    return folder


def _check_free_space(path: str) -> None:
    try:
        minimum = float(os.getenv("MIN_FREE_GB") or DEFAULT_MIN_FREE_GB)
    except ValueError:
        minimum = DEFAULT_MIN_FREE_GB
    free_gb = shutil.disk_usage(path).free / (1024 ** 3)
    if free_gb < minimum:
        raise RuntimeError(
            f"Ruang disk tinggal {free_gb:.1f} GB, minimal {minimum:.0f} GB. "
            "Hapus clip lama lalu jalankan ulang job."
        )


async def run_job(
    job_data: Union[JobData, dict],
    on_progress=None,
    clips_dir: Optional[str] = None,
    temp_root: Optional[str] = None,
    should_cancel=None,
) -> JobResult:
    """Orkestrasi semua tahap. Folder sementara selalu dihapus di finally."""
    job = job_data if isinstance(job_data, JobData) else job_data_from_dict(job_data)
    clips_dir = clips_dir or os.getenv("CLIPS_DIR", "./clips")
    temp_root = temp_root or os.getenv("TEMP_ROOT") or tempfile.gettempdir()

    os.makedirs(clips_dir, exist_ok=True)
    os.makedirs(temp_root, exist_ok=True)
    _check_free_space(clips_dir)
    output_dir = clip_dir(clips_dir, job.job_id)

    workdir = tempfile.mkdtemp(prefix=f"clip-{job.job_id}-", dir=temp_root)
    log.info("job %s mulai, workdir=%s", job.job_id, workdir)
    try:
        await _check_cancel(should_cancel)
        media = await download(job, workdir, on_progress)
        await _check_cancel(should_cancel)
        cues = await transcribe(media.video, media.subtitles, on_progress)
        await _check_cancel(should_cancel)
        moments = await select(job, cues, on_progress)
        await _check_cancel(should_cancel)
        clips = await render(job, moments, media.video, cues, output_dir, on_progress, should_cancel)
        await _check_cancel(should_cancel)
        result = JobResult(clips=clips)
        await save(result, clips_dir, job.job_id, on_progress)
        log.info("job %s selesai, %s clip", job.job_id, len(clips))
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
