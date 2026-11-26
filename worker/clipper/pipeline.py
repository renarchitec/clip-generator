"""Pipeline: satu fungsi per tahap, kerja berat lewat asyncio.to_thread."""

from __future__ import annotations

import asyncio
import glob
import inspect
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, replace
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

from . import llm
from . import reframe as reframe_mod
from .hook_thumbnail import extract_cover_frame, prepend_hook_intro, render_hook_thumbnail
from .models import (
    JOB_ID_RE,
    MAX_DESCRIPTION_CHARS,
    CaptionStyle,
    ClipResult,
    JobData,
    JobParams,
    JobResult,
    ManualRange,
    Outro,
    Watermark,
    WatermarkChromaKey,
    _first,
    _to_bool,
    job_data_from_dict,
    to_max_source_sec,
)
from .subtitles import (
    MAX_WORDS_PER_CUE,
    MAX_WORDS_PER_CUE_WIDE,
    WRAP_CHARS,
    WRAP_CHARS_WIDE,
    Cue,
    Word,
    clip_words,
    parse_vtt,
    write_ass,
)

log = logging.getLogger(__name__)

# Nilai referensi takarir 9:16 (1080x1920); format lain diskalakan relatif tinggi output.
FONT_SIZE = 80
MARGIN_V = 180
# Ukuran output per aspectRatio; 9:16 = perilaku lama (1080x1920).
OUTPUT_SIZES = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}
DEFAULT_MIN_FREE_GB = 5.0
NO_SUBTITLE_ERROR = "Subtitle YouTube tidak tersedia untuk video ini."


def _accepts_clip(callback) -> bool:
    try:
        params = inspect.signature(callback).parameters.values()
    except (TypeError, ValueError):
        return True
    return any(p.name == "clip" or p.kind is inspect.Parameter.VAR_KEYWORD for p in params)


async def _emit(on_progress, stage: str, percent: float, message: str = "", *, clip=None) -> None:
    """Dukung callback sync maupun async (worker memakai async).

    `clip` hanya diteruskan bila diisi dan callback menerimanya, supaya
    callback lama 3-argumen (mis. selftest) tetap jalan.
    """
    if on_progress is None:
        return
    value = max(0.0, min(100.0, float(percent)))
    if clip is not None and _accepts_clip(on_progress):
        result = on_progress(stage, value, message, clip=clip)
    else:
        result = on_progress(stage, value, message)
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
    video: Optional[str] = None
    subtitles: Optional[str] = None


def _valid_ranges(ranges: Sequence[ManualRange]) -> List[ManualRange]:
    """Rentang yang bisa dirender, urut start; urutan sama dipakai unduh & select."""
    return sorted((item for item in ranges if item.end > item.start), key=lambda item: item.start)


def _find_media(workdir: str, prefix: str) -> Optional[str]:
    for path in sorted(glob.glob(os.path.join(workdir, f"{prefix}*"))):
        if ".part" in path.lower():
            continue
        if path.lower().endswith((".mp4", ".webm", ".mkv", ".mov")):
            return path
    return None


def _find_video(workdir: str) -> Optional[str]:
    exact = os.path.join(workdir, "source.mp4")
    if os.path.isfile(exact):
        return exact
    return _find_media(workdir, "source")


def _find_subtitles(workdir: str) -> Optional[str]:
    files = sorted(glob.glob(os.path.join(workdir, "source*.vtt")))
    if not files:
        return None
    for path in files:
        if ".id." in os.path.basename(path).lower():
            return path
    return files[0]


def _subtitle_cmd(url: str, workdir: str, auto: bool) -> List[str]:
    # --ignore-errors: satu bahasa kena 429 (mis. `id` hasil terjemahan) tidak boleh
    # membatalkan bahasa lain (en-orig) dalam perintah yang sama.
    cmd = ["yt-dlp", "--skip-download", "--ignore-errors"]
    cmd.append("--write-auto-subs" if auto else "--write-subs")
    cmd += [
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
    return cmd


def _fetch_subtitles(url: str, workdir: str) -> Optional[str]:
    """Subtitle asli YouTube: manual didahulukan, auto hanya bila manual kosong."""
    for auto in (False, True):
        try:
            _run(_subtitle_cmd(url, workdir, auto))
        except Exception as exc:
            log.warning("gagal unduh subtitle %s: %s", "auto" if auto else "manual", exc)
        found = _find_subtitles(workdir)
        if found:
            return found
    return None


def _yt_dlp_base(sections: bool = False) -> List[str]:
    if sections:
        # Section wajib format http/mp4 terindeks: fallback HLS/TS memotong video
        # di keyframe berikutnya sehingga video lebih lambat dari audio (A/V offset).
        # Audio DASH YouTube ber-ext m4a; ba[ext=mp4] hanya cocok audio HLS.
        fmt = (
            "bv*[ext=mp4][protocol^=http]+ba[ext=m4a][protocol^=http]"
            "/bv*[ext=mp4][protocol^=http]+ba[ext=mp4][protocol^=http]"
            "/b[ext=mp4][protocol^=http]"
        )
    else:
        fmt = "bv*[ext=mp4]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=mp4]/b[ext=mp4]/b"
    return [
        "yt-dlp",
        "-f",
        fmt,
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        # Unduhan paralel: fragmen HLS/DASH (default 1) + range HTTP untuk file
        # tunggal. Tanpa ini yt-dlp menunggu satu koneksi per chunk.
        "-N",
        "8",
        "--http-chunk-size",
        "10M",
    ]


def _has_video(path: str) -> bool:
    try:
        out = _run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                    "stream=index", "-of", "csv=p=0", path])
    except Exception:
        return False
    return bool(str(out or "").strip())


def _probe_start(path: str, stream: str) -> Optional[float]:
    """start_time stream terpilih; None bila stream tidak ada atau tak terbaca."""
    try:
        out = _run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                stream,
                "-show_entries",
                "stream=start_time",
                "-of",
                "csv=p=0",
                path,
            ]
        )
    except Exception:
        return None
    lines = str(out or "").strip().splitlines()
    if not lines:
        return None
    try:
        return float(lines[0].strip())
    except ValueError:
        return None  # "N/A" dsb.


def _section_video_lags_audio(path: str) -> bool:
    """Video section mulai lebih lambat dari audio > 0.05s (keyframe offset HLS).

    True berarti A/V tidak sinkron dan section harus dibuang. Tanpa stream
    audio/video yang terbaca, anggap aman (jangan gagal job).
    """
    video_start = _probe_start(path, "v:0")
    audio_start = _probe_start(path, "a:0")
    if video_start is None or audio_start is None:
        return False
    return video_start - audio_start > 0.05


def _opencv_readable(path: str) -> bool:
    try:
        import cv2
    except Exception:
        return True  # tanpa OpenCV tidak ada face tracking yang perlu dilindungi
    capture = cv2.VideoCapture(path)
    try:
        ok, frame = capture.read() if capture.isOpened() else (False, None)
        return bool(ok and frame is not None)
    finally:
        capture.release()


def _ensure_opencv_readable(path: str) -> str:
    """Section yt-dlp bisa ber-codec (mis. AV1) yang tak didekode OpenCV; transcode ke H.264."""
    if _opencv_readable(path):
        return path
    fixed = os.path.splitext(path)[0] + "-h264.mp4"
    _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", path,
          "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", fixed])
    os.remove(path)
    return fixed


async def download(job: JobData, workdir: str, on_progress=None) -> Downloaded:
    """yt-dlp: mp4 terbaik + subtitle asli; tanpa subtitle job gagal.

    Mode manual: hanya subtitle yang diunduh di sini; section per rentang
    diunduh satu per satu oleh _download_one_section (dipanggil dari loop
    streaming di run_job) supaya tidak ada dua proses berat bersamaan.

    Mode auto dengan `max_source_sec` hanya mengunduh 0–limit sebagai satu
    section (offset 0) dan memakai file itu sebagai sumber render.
    """
    os.makedirs(workdir, exist_ok=True)

    ranges = _valid_ranges(job.ranges) if job.mode == "manual" else []
    if job.mode == "manual" and not ranges:
        # Gagal cepat: jangan unduh video penuh untuk job manual tanpa rentang sah.
        raise ValueError("mode manual butuh minimal satu range")

    video: Optional[str] = None

    # --- Mode manual: hanya ambil subtitle di sini; section diunduh streaming ---
    if ranges:
        await _emit(on_progress, "download", 0, f"mengunduh subtitle untuk {len(ranges)} rentang")
        subtitles = await asyncio.to_thread(_fetch_subtitles, job.url, workdir)
        if not subtitles:
            raise RuntimeError(NO_SUBTITLE_ERROR)
        await _emit(on_progress, "download", 100, "subtitle siap")
        return Downloaded(video=None, subtitles=subtitles)

    # --- Mode auto: section batas sumber atau video penuh ---
    if not ranges and job.mode == "auto" and job.max_source_sec:
        # Batas pemindaian sumber: unduh hanya 0–limit sebagai satu section
        # (offset 0, jadi timestamp identik dengan video asli). Section gagal
        # / tanpa stream video / A/V tidak sinkron -> jatuh ke unduhan video
        # penuh di bawah.
        limit = float(job.max_source_sec)
        await _emit(on_progress, "download", 0, f"mengunduh 0-{limit:.0f} detik")
        cmd = _yt_dlp_base(sections=True) + [
            "--download-sections",
            f"*0.000-{limit:.3f}",
            "--force-keyframes-at-cuts",
            "-o",
            os.path.join(workdir, "source.%(ext)s"),
            job.url,
        ]
        try:
            await asyncio.to_thread(_run, cmd)
        except Exception as exc:
            log.warning("gagal unduh section batas sumber, fallback unduh penuh: %s", exc)
        else:
            path = _find_video(workdir)
            if path and await asyncio.to_thread(_has_video, path):
                if await asyncio.to_thread(_section_video_lags_audio, path):
                    log.warning("section batas sumber A/V tidak sinkron, fallback unduh penuh")
                    os.remove(path)
                else:
                    video = await asyncio.to_thread(_ensure_opencv_readable, path)
            elif path:
                log.warning("section batas sumber tanpa stream video, fallback unduh penuh")
                os.remove(path)

    if not video:
        await _emit(on_progress, "download", 0, "mengunduh video")
        cmd = _yt_dlp_base() + [
            "-o",
            os.path.join(workdir, "source.%(ext)s"),
            job.url,
        ]
        await asyncio.to_thread(_run, cmd)
        video = _find_video(workdir)
        if not video:
            raise RuntimeError("yt-dlp selesai tanpa menghasilkan file video")

    subtitles = await asyncio.to_thread(_fetch_subtitles, job.url, workdir)
    if not subtitles:
        raise RuntimeError(NO_SUBTITLE_ERROR)

    await _emit(on_progress, "download", 100, "media siap dirender")
    return Downloaded(video=video, subtitles=subtitles)


def _remove_section_files(workdir: str, index: int) -> None:
    """Buang sisa file section yang gagal (mis. yt-dlp error setelah menulis)."""
    for path in glob.glob(os.path.join(workdir, f"section-{index:02d}*")):
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


async def _download_preview_section(url: str, at_sec: float, workdir: str) -> tuple[str, float]:
    """Unduh jendela kecil; offset menghubungkan waktu section dengan sumber asli."""
    start = max(0.0, at_sec - 1.0)
    end = at_sec + 3.0
    cmd = _yt_dlp_base(sections=True) + [
        "--download-sections", f"*{start:.3f}-{end:.3f}", "--force-keyframes-at-cuts",
        "-o", os.path.join(workdir, "frame-source.%(ext)s"), url,
    ]
    await asyncio.to_thread(_run, cmd, timeout=100)
    path = _find_media(workdir, "frame-source")
    if not path or not await asyncio.to_thread(_has_video, path):
        raise RuntimeError("download_preview_failed")
    return await asyncio.to_thread(_ensure_opencv_readable, path), start


async def _download_one_section(
    job: JobData,
    index: int,
    item,
    workdir: str,
) -> Tuple[str, float]:
    """Unduh satu rentang manual sebagai section yt-dlp; kembalikan (path, offset).

    Validasi (_has_video, _section_video_lags_audio, _ensure_opencv_readable)
    dilakukan di sini sebelum dikembalikan. RuntimeError bila gagal.
    """
    cmd = _yt_dlp_base(sections=True) + [
        "--download-sections",
        f"*{item.start:.3f}-{item.end:.3f}",
        "--force-keyframes-at-cuts",
        "-o",
        os.path.join(workdir, f"section-{index:02d}.%(ext)s"),
        job.url,
    ]
    await asyncio.to_thread(_run, cmd)
    path = _find_media(workdir, f"section-{index:02d}")
    if not path:
        raise RuntimeError(
            f"yt-dlp selesai tanpa file untuk rentang {item.start:.1f}-{item.end:.1f}"
        )
    if not await asyncio.to_thread(_has_video, path):
        os.remove(path)
        raise RuntimeError(
            f"section {index} tanpa stream video (format terbatas/429)"
        )
    if await asyncio.to_thread(_section_video_lags_audio, path):
        os.remove(path)
        raise RuntimeError(
            f"section {index} A/V tidak sinkron (video mulai lebih lambat dari audio)"
        )
    path = await asyncio.to_thread(_ensure_opencv_readable, path)
    return path, item.start


def _read_vtt(path: str) -> List[Cue]:
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return parse_vtt(handle.read(), word_level=True)


def _cues_within_limit(cues: Sequence[Cue], max_source_sec: Optional[int]) -> List[Cue]:
    """Batasi transkrip ke jendela 0–limit.

    Cue yang mulai di/lewat limit dibuang; cue yang melintasi limit di-clamp
    end-nya (termasuk kata) supaya prompt LLM, validasi momen, refinement, dan
    snap semuanya berhenti di limit.
    """
    if not max_source_sec:
        return list(cues)

    limit = float(max_source_sec)
    kept: List[Cue] = []
    for cue in cues:
        if cue.start >= limit:
            continue
        if cue.end <= limit:
            kept.append(cue)
            continue
        words = [
            Word(start=word.start, end=min(word.end, limit), text=word.text)
            for word in cue.words
            if word.start < limit
        ]
        kept.append(replace(cue, end=limit, words=words))
    return kept


async def transcribe(subtitles: Optional[str], on_progress=None) -> List[Cue]:
    """Caption selalu dari subtitle asli YouTube; tanpa subtitle = job gagal."""
    await _emit(on_progress, "transcribe", 0, "menyiapkan transkrip")

    if not subtitles or not os.path.exists(subtitles):
        raise RuntimeError(NO_SUBTITLE_ERROR)

    cues = await asyncio.to_thread(_read_vtt, subtitles)
    if not cues:
        raise RuntimeError(NO_SUBTITLE_ERROR)

    await _emit(on_progress, "transcribe", 100, f"{len(cues)} cue dari subtitle")
    return cues


def _moments_from_ranges(cues: Sequence[Cue], ranges) -> List[llm.Moment]:
    moments: List[llm.Moment] = []
    for item in _valid_ranges(ranges):
        # Pakai judul/alasan dari tinjauan LLM bila ada; timestamp hanya fallback.
        title = (item.title or "").strip()
        reason = (item.reason or "").strip()
        moments.append(
            llm.Moment(
                start=round(float(item.start), 2),
                end=round(float(item.end), 2),
                title=title[:70] or llm.title_from_cues(cues, item.start, item.end),
                reason=reason[:200] or "manual",
                hook_text=item.hook_text,
            )
        )
    return moments


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
    """Ambil cue di dalam jendela clip (absolut), geser waktunya ke 0 (termasuk kata)."""
    limit = max(0.0, end - start)
    relative: List[Cue] = []
    for cue in cues:
        if cue.end <= start or cue.start >= end:
            continue
        cue_start = max(0.0, cue.start - start)
        cue_end = min(limit, cue.end - start)
        if cue_end <= cue_start:
            continue
        words: List[Word] = []
        for word in cue.words:
            word_start = max(0.0, word.start - start)
            word_end = min(limit, word.end - start)
            if word_end > word_start:
                words.append(Word(start=word_start, end=word_end, text=word.text))
        relative.append(Cue(start=cue_start, end=cue_end, text=cue.text, words=words))
    return relative


def _reframe_filters(
    reframe: str,
    video: str,
    moment: llm.Moment,
    width: int,
    height: int,
    landscape: bool = False,
) -> List[str]:
    """Bangun filter video sesuai mode reframe dan ukuran output.

    16:9 (landscape): reframe diabaikan — skala pas 1920x1080 di atas latar buram
    dari video yang sama bila sumber bukan 16:9 (sumber 16:9 menutup penuh latar).
    Mode centered (black_bars, blurred_fill) lewat tanpa deteksi frame.
    face_tracking memanggil MediaPipe; dep hilang -> raise RuntimeError.
    """
    if reframe == "black_bars" and not landscape:
        return [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black",
            "setsar=1",
        ]
    # 16:9 selalu blurred fill: sumber bukan 16:9 (vertikal/4:3) tidak dapat
    # bar hitam, tapi potongan video yang sama diburamkan di belakangnya.
    if reframe == "blurred_fill" or landscape:
        return [
            (
                f"split=2[fg][bg];"
                f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height},"
                f"boxblur=luma_radius=min(h\\,w)/10:luma_power=2[blurred];"
                f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[sharp];"
                f"[blurred][sharp]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2"
            ),
            "setsar=1",
        ]

    # Default / fallback eksplisit: face_tracking (cut per pembicara aktif)
    segments = reframe_mod.face_track_samples(video, moment.start, moment.end)
    if segments:
        return [reframe_mod.cut_crop_filter(segments, width, height), "setsar=1"]
    return [reframe_mod.portrait_crop_filter(0.5, width, height), "setsar=1"]


def _two_speaker_graph(
    video: str,
    moment: llm.Moment,
    ass_path: Optional[str],
) -> tuple[List[str], str]:
    """filter_complex dua panel 1080x960 ditumpuk vertikal (1080x1920).

    Panel atas = pembicara paling kiri, panel bawah = paling kanan. Tanpa dua
    wajah dominan, pakai kuarter kiri/kanan frame (clamp crop ffmpeg mendekati
    separuh kiri/kanan). Reframe diabaikan saat dua pembicara.
    """
    centers = reframe_mod.two_speaker_centers(video, moment.start, moment.end)
    left, right = centers if centers else (0.25, 0.75)
    graph = [
        "[0:v]split=2[s0][s1]",
        f"[s0]{reframe_mod.panel_crop_filter(left)}[top]",
        f"[s1]{reframe_mod.panel_crop_filter(right)}[bottom]",
        "[top][bottom]vstack=inputs=2[vstacked]",
    ]
    label = "[vstacked]"
    if ass_path:
        graph.append(f"[vstacked]subtitles={_ffmpeg_filter_path(ass_path)}[vout]")
        label = "[vout]"
    return graph, label


_FACECAM_BOX_CACHE: Dict[str, Optional[Tuple[int, int, int, int]]] = {}
_FACECAM_KNOWN_BOXES: List[Tuple[Tuple[int, int, int, int], int, int]] = []
_VIDEO_META_CACHE: Dict[str, Tuple[int, int, float]] = {}


def _clear_facecam_cache() -> None:
    _FACECAM_BOX_CACHE.clear()
    _FACECAM_KNOWN_BOXES.clear()
    _VIDEO_META_CACHE.clear()


def _facecam_sample_fps(duration: float, max_samples: int = reframe_mod.FACECAM_MAX_SAMPLES) -> float:
    """Laju sampling facecam, dibatasi jumlah sampel maksimum."""
    return min(reframe_mod.FACECAM_SAMPLE_FPS, max_samples / max(1.0, duration))


def _probe_video_meta(video: str, *, cache: bool = True) -> Tuple[int, int, float]:
    if cache and video in _VIDEO_META_CACHE:
        return _VIDEO_META_CACHE[video]

    out = _run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", video,
        ]
    )
    src_w, src_h = (int(part) for part in out.strip().split(",")[:2])
    duration_out = _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]
    )
    duration = float(duration_out.strip() or 0.0) or 1.0
    meta = (src_w, src_h, duration)
    if cache:
        _VIDEO_META_CACHE[video] = meta
    return meta


def _remember_facecam_box(video: str, box: Tuple[int, int, int, int], src_w: int, src_h: int) -> None:
    entry = (box, src_w, src_h)
    if entry in _FACECAM_KNOWN_BOXES:
        _FACECAM_KNOWN_BOXES.remove(entry)
    _FACECAM_KNOWN_BOXES.append(entry)
    _FACECAM_BOX_CACHE[video] = box


def _facecam_box_for(
    video: str,
    start: Optional[float] = None,
    end: Optional[float] = None,
    *,
    reuse_known: bool = True,
) -> Optional[Tuple[int, int, int, int]]:
    """Kotak facecam (piksel sumber); None berarti fallback reframe biasa."""
    whole_video = start is None or end is None
    if whole_video and video in _FACECAM_BOX_CACHE:
        return _FACECAM_BOX_CACHE[video]

    src_w, src_h, duration = _probe_video_meta(video, cache=reuse_known)
    if start is None or end is None:
        win_start, win_end = 0.0, duration
        frames = reframe_mod.facecam_face_frames(
            video, win_start, win_end, sample_fps=_facecam_sample_fps(duration)
        )
    else:
        win_start, win_end = max(0.0, float(start)), min(duration, float(end))
        if win_end <= win_start + 0.25:
            win_start, win_end = 0.0, duration
        if reuse_known:
            for cand_box, cand_w, cand_h in reversed(_FACECAM_KNOWN_BOXES):
                if (cand_w, cand_h) != (src_w, src_h):
                    continue
                if reframe_mod.facecam_box_matches_window(video, win_start, win_end, cand_box, src_w, src_h):
                    log.info(
                        "facecam: pakai ulang kotak cache %s (terverifikasi pada %.1f–%.1fs)",
                        cand_box, win_start, win_end,
                    )
                    _remember_facecam_box(video, cand_box, src_w, src_h)
                    return cand_box

        win_dur = max(0.5, win_end - win_start)
        max_samples = reframe_mod.FACECAM_CLIP_MAX_SAMPLES
        frames = reframe_mod.facecam_face_frames(
            video, win_start, win_end,
            sample_fps=_facecam_sample_fps(win_dur, max_samples=max_samples),
            max_samples=max_samples,
        )

    box = reframe_mod.facecam_box(frames, src_w, src_h)
    seen = sum(1 for _, faces in frames if faces)
    if box is not None:
        log.info("facecam: wajah di %d/%d sampel pada %.1f–%.1fs, box=%s", seen, len(frames), win_start, win_end, box)
    else:
        log.info(
            "facecam: wajah di %d/%d sampel pada %.1f–%.1fs, fallback reframe biasa",
            seen, len(frames), win_start, win_end,
        )
    if box is not None and reuse_known:
        _remember_facecam_box(video, box, src_w, src_h)
    elif whole_video:
        _FACECAM_BOX_CACHE[video] = box
    return box


def _facecam_graph(
    box: Tuple[int, int, int, int],
    ass_path: Optional[str],
) -> tuple[List[str], str]:
    """filter_complex facecam: panel wajah 1080x768 (40%) di atas gameplay 1080x1152 (60%).

    Kotak dari `facecam_box` (piksel sumber, selalu di dalam frame); panel bawah
    crop 15:16 full-height di tengah frame, keduanya diskalakan lalu ditumpuk
    (total 1080x1920).
    """
    panel_w, panel_h = reframe_mod.FACECAM_PANEL_W, reframe_mod.FACECAM_PANEL_H
    game_h = reframe_mod.FACECAM_GAMEPLAY_H
    x, y, w, h = box
    graph = [
        "[0:v]split=2[fc0][fc1]",
        f"[fc0]crop={w}:{h}:{x}:{y},scale={panel_w}:{panel_h},setsar=1[top]",
        f"[fc1]crop=w='min(ih*{panel_w}/{game_h},in_w)':h=ih:x='(in_w-out_w)/2':y=0,scale={panel_w}:{game_h},setsar=1[bot]",
        "[top][bot]vstack=inputs=2[v]",
    ]
    label = "[v]"
    if ass_path:
        graph.append(f"[v]subtitles={_ffmpeg_filter_path(ass_path)}[vout]")
        label = "[vout]"
    return graph, label


def _probe_video_codec(path: str) -> str | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=codec_name", "-of", "default=nw=1:nk=1", path],
            capture_output=True, text=True, check=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip().lower() or None


def _watermark_input_args(watermark_path: str, duration: float, wm: Watermark) -> list[str]:
    if not wm.is_video:
        return ["-loop", "1", "-t", f"{duration:.3f}", "-i", watermark_path]

    decoder = []
    if watermark_path.lower().endswith(".webm") or (wm.mime_type or "").lower() == "video/webm":
        # Native VP8/VP9 decoders don't expose WebM's alpha channel.
        codec = _probe_video_codec(watermark_path)
        if codec == "vp9":
            decoder = ["-c:v", "libvpx-vp9"]
        elif codec == "vp8":
            decoder = ["-c:v", "libvpx"]
    return [*decoder, "-stream_loop", "-1", "-t", f"{duration:.3f}", "-an", "-i", watermark_path]


def _chroma_key_filters(ck: WatermarkChromaKey) -> list[str]:
    hex6 = ck.color.lstrip("#").upper()
    r, g, b = (int(hex6[i:i + 2], 16) for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    sat = (mx - mn) / mx if mx > 0 else 0.0
    options = f"color=0x{hex6}:similarity={ck.similarity:.3f}:blend={ck.blend:.3f}"
    if sat < 0.15:
        return [f"colorkey={options}"]
    filters = [f"chromakey={options}"]
    if g > r and g > b:
        filters.append("despill=type=green")
    elif b > r and b > g:
        filters.append("despill=type=blue")
    return filters


def _watermark_chain(
    width: int, height: int, wm: Watermark, input_label: str = "[1:v]", out_label: str = "[wm]"
) -> str:
    """Rantai filter watermark: key opsional, skala (lebar genap), RGBA, opacity."""
    wm_w = max(2, round(width * wm.scale / 2) * 2)
    steps = []
    if wm.is_video:
        steps.append("setpts=PTS-STARTPTS")
    if wm.chroma_key and wm.chroma_key.enabled:
        steps.extend(_chroma_key_filters(wm.chroma_key))
    steps.extend((f"scale=w={wm_w}:h=-2", "format=rgba", f"colorchannelmixer=aa={wm.opacity:.3f}"))
    return f"{input_label}{','.join(steps)}{out_label}"


def _watermark_overlay(
    label: str, wm: Watermark, wm_label: str = "[wm]", out_label: str = "[wmout]"
) -> str:
    """Overlay dengan PUSAT di (x,y) pecahan frame, dijepit agar tetap di dalam frame."""
    x_expr = f"max(0,min(main_w-overlay_w,main_w*{wm.x:.4f}-overlay_w/2))"
    y_expr = f"max(0,min(main_h-overlay_h,main_h*{wm.y:.4f}-overlay_h/2))"
    return (
        f"{label}{wm_label}overlay=x='{x_expr}':y='{y_expr}':shortest=1:format=auto{out_label}"
    )


def _with_watermark(
    graph: List[str], label: str, width: int, height: int, wm: Watermark
) -> tuple[List[str], str]:
    """Tambahkan watermark (input ffmpeg ke-1) di atas label terakhir graph."""
    return (
        graph
        + [_watermark_chain(width, height, wm), _watermark_overlay(label, wm)],
        "[wmout]",
    )


def _with_watermarks(
    graph: List[str], label: str, width: int, height: int, watermarks: Sequence[Watermark]
) -> tuple[List[str], str]:
    """Tambahkan watermark dari bawah ke atas sesuai urutan daftar."""
    if not watermarks:
        return list(graph), label
    if len(watermarks) == 1:
        return _with_watermark(graph, label, width, height, watermarks[0])

    chain = list(graph)
    cur = label
    for idx, wm in enumerate(watermarks):
        in_label = f"[{idx + 1}:v]"
        wm_label = f"[wm{idx}]"
        out_label = "[wmout]" if idx == len(watermarks) - 1 else f"[wmout{idx}]"
        chain.append(_watermark_chain(width, height, wm, input_label=in_label, out_label=wm_label))
        chain.append(_watermark_overlay(cur, wm, wm_label=wm_label, out_label=out_label))
        cur = out_label
    return chain, cur


def _resolve_media_path(clips_root: str, file_path: str, label: str) -> Optional[str]:
    """Path absolut `file_path` (relatif clips_root); None bila tidak aman/tidak ada.

    Tidak pernah melempar: aset bermasalah = render tanpa aset itu.
    """
    try:
        rel = file_path.replace("\\", "/")
        if os.path.isabs(rel) or rel.startswith("/") or ".." in rel.split("/"):
            log.warning("%s ditolak (path tidak aman): %r", label, file_path)
            return None
        root = os.path.realpath(clips_root)
        path = os.path.realpath(os.path.join(root, rel))
        if os.path.commonpath([root, path]) != root or path == root:
            log.warning("%s ditolak (di luar folder clips): %r", label, file_path)
            return None
        if not os.path.isfile(path) or not os.access(path, os.R_OK):
            log.warning("file %s tidak ditemukan/terbaca: %s", label, file_path)
            return None
        return path
    except Exception as exc:  # noqa: BLE001 - jangan pernah gagalkan job
        log.warning("%s dilewati karena error: %s", label, exc)
        return None


def resolve_watermark_path(clips_root: str, wm: Optional[Watermark]) -> Optional[str]:
    """Path absolut file watermark di bawah clips_root; None bila tidak aman/tidak ada.

    Tidak pernah melempar: watermark bermasalah = render tanpa watermark.
    """
    if wm is None:
        return None
    return _resolve_media_path(clips_root, wm.file_path, "watermark")


def resolve_outro_path(clips_root: str, outro: Optional[Outro]) -> Optional[str]:
    """Path absolut file outro di bawah clips_root; None bila tidak aman/tidak ada."""
    if outro is None:
        return None
    return _resolve_media_path(clips_root, outro.file_path, "outro")


# ---------------------------------------------------------------- outro

OUTRO_AUDIO_RATE = 44100
OUTRO_TIMEOUT_SEC = 900.0


def _has_audio(path: str) -> bool:
    """Probe just the first audio stream; an empty result means video-only."""
    return bool(_run([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=index", "-of", "csv=p=0", path,
    ], timeout=20).strip())


def _parse_rate(value: Any) -> Optional[float]:
    try:
        text = str(value)
        if "/" in text:
            num, den = text.split("/", 1)
            rate = float(num) / float(den)
        else:
            rate = float(text)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return rate if 1.0 <= rate <= 240.0 else None


def _probe_media(path: str) -> Dict[str, Any]:
    """Info video/audio dari ffprobe; RuntimeError bila tanpa stream video."""
    out = _run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration:format=duration",
         "-of", "json", path]
    )
    data = json.loads(out or "{}")
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("tanpa stream video")
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    def number(value: Any) -> Optional[float]:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed == parsed and parsed > 0 else None

    duration = number(video.get("duration")) or number((data.get("format") or {}).get("duration"))
    if not duration:
        raise RuntimeError("durasi tidak terbaca")
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if width < 1 or height < 1:
        raise RuntimeError("dimensi tidak terbaca")
    fps = _parse_rate(video.get("avg_frame_rate")) or _parse_rate(video.get("r_frame_rate")) or 30.0
    return {
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
        "has_audio": has_audio,
    }


def _outro_command(
    clip_path: str, outro_path: str, out_path: str, clip: Dict[str, Any], outro: Dict[str, Any]
) -> List[str]:
    """Re-encode concat clip + outro. Outro dipas ke WxH klip (latar buram dari
    outro sendiri), fps/SAR/audio disamakan; audio hilang -> anullsrc."""
    width, height, fps = clip["width"], clip["height"], clip["fps"]
    clip_dur, outro_dur = clip["duration"], outro["duration"]
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", clip_path, "-i", outro_path]
    next_input = 2
    labels: Dict[str, str] = {}
    for key, has_audio, dur in (("clip", clip["has_audio"], clip_dur), ("outro", outro["has_audio"], outro_dur)):
        if not has_audio:
            cmd += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", f"anullsrc=r={OUTRO_AUDIO_RATE}:cl=stereo"]
            labels[key] = f"{next_input}:a"
            next_input += 1
        else:
            labels[key] = "0:a:0" if key == "clip" else "1:a:0"

    def audio(src: str, dst: str, dur: float) -> str:
        # apad+atrim: panjang audio = panjang video segmen supaya concat tidak drift.
        return (
            f"[{src}]aresample={OUTRO_AUDIO_RATE},"
            f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"apad=whole_dur={dur:.3f},atrim=end={dur:.3f},asetpts=PTS-STARTPTS[{dst}]"
        )

    graph = [
        f"[0:v]scale={width}:{height},setsar=1,fps={fps:.3f},format=yuv420p,setpts=PTS-STARTPTS[cv]",
        (
            f"[1:v]split=2[ofg][obg];"
            f"[obg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=luma_radius=min(h\\,w)/10:luma_power=2[oblur];"
            f"[ofg]scale={width}:{height}:force_original_aspect_ratio=decrease[osharp];"
            f"[oblur][osharp]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,"
            f"setsar=1,fps={fps:.3f},format=yuv420p,setpts=PTS-STARTPTS[ov]"
        ),
        audio(labels["clip"], "ca", clip_dur),
        audio(labels["outro"], "oa", outro_dur),
        "[cv][ca][ov][oa]concat=n=2:v=1:a=1[v][a]",
    ]
    return cmd + [
        "-filter_complex", ";".join(graph),
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", "-sn",
        "-f", "mp4", out_path,
    ]


def append_outro(clip_path: str, outro_path: str, timeout: Optional[float] = OUTRO_TIMEOUT_SEC) -> bool:
    """Tempel outro di akhir `clip_path` (ditulis ke temp lalu os.replace atomik).

    Mengembalikan True bila berhasil. Gagal apa pun -> log warning, klip asli
    tidak diubah, False. Tidak pernah melempar.
    """
    tmp_path = clip_path + ".outro.tmp"
    try:
        clip = _probe_media(clip_path)
        outro = _probe_media(outro_path)
        _run(_outro_command(clip_path, outro_path, tmp_path, clip, outro), timeout=timeout)
        if not os.path.isfile(tmp_path) or os.path.getsize(tmp_path) <= 0:
            raise RuntimeError("hasil outro kosong")
        os.replace(tmp_path, clip_path)
        return True
    except Exception as exc:  # noqa: BLE001 - outro tidak boleh menggagalkan job
        log.warning("outro dilewati, klip tetap tanpa outro: %s", exc)
        return False
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _apply_hook_intro_for_job(
    job: JobData, src_video: str, render_moment: llm.Moment, outdir: str, filename: str
) -> None:
    if not job.hook_banner:
        return
    text = (render_moment.hook_text or render_moment.title or "").strip()
    if not text:
        return
    clip_path = os.path.join(outdir, filename)
    png_path = clip_path + ".hook.png"
    try:
        frame = extract_cover_frame(src_video, render_moment.start, render_moment.end)
        width, height = OUTPUT_SIZES.get(str(job.aspect_ratio), OUTPUT_SIZES["9:16"])
        render_hook_thumbnail(frame, text, width, height, png_path)
        prepend_hook_intro(clip_path, png_path)
    except Exception as exc:
        log.warning("hook intro dilewati karena error: %s", exc)
    finally:
        try:
            os.remove(png_path)
        except OSError:
            pass


def _apply_outro_for_job(job: JobData, outdir: str, filename: str) -> None:
    """Tempel outro job (bila ada) ke klip final; satu helper untuk semua jalur render."""
    if not job.outro:
        return
    try:
        # outdir = <clips_dir>/<job_id>; outro relatif terhadap clips_dir.
        outro_path = resolve_outro_path(os.path.dirname(os.path.abspath(outdir)), job.outro)
        if outro_path:
            append_outro(os.path.join(outdir, filename), outro_path)
    except Exception as exc:  # noqa: BLE001
        log.warning("outro dilewati karena error: %s", exc)


def parse_frame_payload(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Validasi ketat payload queue frame sebelum menyentuh filesystem."""
    try:
        url = str(payload["url"])
        at_sec = float(payload["atSec"])
        out_path = str(payload["outPath"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError("invalid_frame_payload") from exc
    aspect_ratio = payload.get("aspectRatio")
    if not url or not url.startswith(("http://", "https://")) or not at_sec >= 0:
        raise RuntimeError("invalid_frame_payload")
    if aspect_ratio not in OUTPUT_SIZES or not out_path or os.path.isabs(out_path):
        raise RuntimeError("invalid_frame_payload")
    normalized = os.path.normpath(out_path)
    if normalized == ".." or normalized.startswith(".." + os.sep):
        raise RuntimeError("invalid_frame_path")
    return {
        "url": url, "atSec": at_sec, "aspectRatio": aspect_ratio,
        "reframe": str(payload.get("reframe") or "face_tracking"),
        "twoSpeakers": bool(payload.get("twoSpeakers", False)),
        "facecam": bool(payload.get("facecam", False)),
        "captions": bool(payload.get("captions", False)),
        "captionSample": str(payload.get("captionSample") or "Sample caption"),
        "hookBanner": _to_bool(_first(payload, "hookBanner", "hook_banner"), False),
        "captionStyle": CaptionStyle.from_dict(payload.get("captionStyle")),
        "outPath": normalized,
    }


def _cleanup_old_frames(frames_dir: str, max_age: float = 3600) -> None:
    if not os.path.isdir(frames_dir):
        return
    cutoff = time.time() - max_age
    for root, _, files in os.walk(frames_dir):
        for name in files:
            path = os.path.join(root, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except OSError:
                pass


async def run_frame(payload: Mapping[str, Any], clips_dir: str, temp_root: Optional[str] = None) -> Dict[str, Any]:
    """Render satu JPEG melalui jalur render clip normal, tanpa watermark."""
    data = parse_frame_payload(payload)
    destination = os.path.realpath(os.path.join(clips_dir, data["outPath"]))
    root = os.path.realpath(clips_dir)
    if os.path.commonpath((root, destination)) != root:
        raise RuntimeError("invalid_frame_path")
    frames_dir = os.path.join(root, ".frames")
    await asyncio.to_thread(_cleanup_old_frames, frames_dir)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    workdir = tempfile.mkdtemp(prefix="frame-", dir=temp_root)
    try:
        video, offset = await _download_preview_section(data["url"], data["atSec"], workdir)
        moment = llm.Moment(start=0.0, end=2.0, title="frame")
        cues = [Cue(offset, offset + 2.0, data["captionSample"])] if data["captions"] else []
        rendered = os.path.join(workdir, "render.mp4")
        extra: Dict[str, Any] = {}
        if data["captionStyle"] is not None:
            extra["caption_style"] = data["captionStyle"]
        if data["facecam"]:
            extra["facecam_reuse_cache"] = False
        await asyncio.to_thread(
            _render_one, video, moment, cues, workdir, "render.mp4", data["reframe"],
            data["captions"], data["twoSpeakers"], data["facecam"], offset,
            data["aspectRatio"], None, None, 100.0,
            **extra,
        )
        await asyncio.to_thread(_run, [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", "1.000", "-i", rendered, "-frames:v", "1", "-q:v", "3", destination,
        ], timeout=20)
        width, height = OUTPUT_SIZES[data["aspectRatio"]]
        return {"file": data["outPath"], "width": width, "height": height, "atSec": data["atSec"]}
    except Exception as exc:
        log.warning("frame render gagal: %s", exc)
        detail = str(exc).strip().splitlines()
        message = (detail[0].strip() if detail else "")[:120]
        raise RuntimeError(message or "frame_render_failed") from None
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _render_one(
    video: str,
    moment: llm.Moment,
    cues: Sequence[Cue],
    outdir: str,
    filename: str,
    reframe: str = "face_tracking",
    captions: bool = True,
    two_speakers: bool = False,
    facecam: bool = False,
    timeline_offset: float = 0.0,
    aspect_ratio: str = "9:16",
    watermark: Optional[Watermark] = None,
    watermark_path: Optional[str] = None,
    run_timeout: Optional[float] = None,
    caption_style: Optional[CaptionStyle] = None,
    watermarks: Sequence[tuple[Watermark, str]] = (),
    normalize_audio: bool = False,
    *,
    facecam_reuse_cache: bool = True,
) -> None:
    resolved_wms: list[tuple[Watermark, str]] = []
    if watermarks:
        resolved_wms = [(wm, path) for wm, path in watermarks if wm is not None and path]
    elif watermark is not None and watermark_path:
        resolved_wms = [(watermark, watermark_path)]
    width, height = OUTPUT_SIZES.get(str(aspect_ratio), OUTPUT_SIZES["9:16"])
    landscape = aspect_ratio == "16:9"
    if aspect_ratio != "9:16":
        # Defensif: dua pembicara/facecam hanya berlaku untuk 9:16 (API sudah menormalkan).
        two_speakers = False
        facecam = False
    elif two_speakers:
        facecam = False  # dua pembicara menang atas facecam
    # Font/margin diskalakan dari nilai referensi 9:16 relatif tinggi output;
    # 16:9 boleh memuat baris lebih panjang (6 kata / 32 karakter).
    ref_font_size = caption_style.font_size if caption_style else FONT_SIZE
    font_size = max(1, round(ref_font_size * height / 1920))
    margin_v = max(1, round(MARGIN_V * height / 1920))

    out_path = os.path.join(outdir, filename)
    ass_path = os.path.join(outdir, os.path.splitext(filename)[0] + ".ass")
    # Teks takarir dicocokkan dengan timestamp absolut video asli.
    absolute_start = moment.start + timeline_offset
    absolute_end = moment.end + timeline_offset
    clip_cues = _clip_cues(cues, absolute_start, absolute_end) if captions else []
    burn_ass = bool(clip_cues)
    duration = max(0.5, moment.end - moment.start)
    loudnorm = normalize_audio and _has_audio(video)
    box = None
    if facecam:
        try:
            box = _facecam_box_for(video, moment.start, moment.end, reuse_known=facecam_reuse_cache)
        except Exception as exc:
            log.warning("facecam: deteksi wajah gagal, fallback reframe biasa: %s", exc)

    if burn_ass:
        with open(ass_path, "w", encoding="utf-8") as handle:
            handle.write(
                write_ass(
                    clip_cues,
                    width,
                    height,
                    font_size,
                    0 if two_speakers else margin_v,
                    two_speakers=two_speakers,
                    max_words=MAX_WORDS_PER_CUE_WIDE if landscape else MAX_WORDS_PER_CUE,
                    max_chars=(max(10, round((WRAP_CHARS_WIDE if landscape else WRAP_CHARS) * 80 / caption_style.font_size)) if caption_style and caption_style.font_size > 84 else (WRAP_CHARS_WIDE if landscape else WRAP_CHARS)),
                    style=caption_style,
                )
            )

    head = [
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
    ]
    tail = [
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "160k" if loudnorm else "128k",
        *(["-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "44100"] if loudnorm else []),
        "-movflags",
        "+faststart",
        "-sn",
        out_path,
    ]
    wm_input: list[str] = []
    for wm, path in resolved_wms:
        wm_input.extend(_watermark_input_args(path, duration, wm))

    # Graph dasar dibangun sekali; dipakai ulang bila render dengan watermark
    # gagal dan harus diulang tanpa watermark (file rusak tetap tak menggagalkan job).
    base_graph: Optional[List[str]] = None
    base_label = ""
    vf: Optional[str] = None
    if two_speakers:
        base_graph, base_label = _two_speaker_graph(
            video, moment, ass_path if burn_ass else None
        )
    elif box:
        base_graph, base_label = _facecam_graph(box, ass_path if burn_ass else None)
    else:
        filters = _reframe_filters(reframe, video, moment, width, height, landscape)
        if burn_ass:
            filters.append("subtitles=" + _ffmpeg_filter_path(ass_path))
        vf = ",".join(filters)
        base_graph, base_label = [f"[0:v]{vf}[base]"], "[base]"

    def command(use_watermark: bool) -> List[str]:
        if use_watermark and resolved_wms:
            chain, label = _with_watermarks(
                base_graph, base_label, width, height, [wm for wm, _ in resolved_wms]
            )
            return (
                head + wm_input + [
                    "-filter_complex", ";".join(chain), "-map", label, "-map", "0:a:0?"
                ] + tail
            )
        if vf is not None:
            # Tanpa watermark: pertahankan jalur -vf yang sudah ada (lebih ringan).
            return head + ["-vf", vf, "-map", "0:v:0", "-map", "0:a:0?"] + tail
        return (
            head + [
                "-filter_complex", ";".join(base_graph),
                "-map", base_label, "-map", "0:a:0?",
            ] + tail
        )

    try:
        try:
            _run(command(True), timeout=run_timeout)
        except Exception as exc:
            if not resolved_wms:
                raise
            log.warning("gagal membakar watermark (%s), render ulang tanpa watermark", exc)
            _run(command(False), timeout=run_timeout)
    finally:
        if os.path.exists(ass_path):
            os.remove(ass_path)


def _clip_report(clip: ClipResult) -> Dict[str, Any]:
    """Payload `clip` untuk progress: sama dengan ClipResult.to_dict tanpa
    caption/hashtags (caption baru dibuat setelah semua klip dirender)."""
    payload = clip.to_dict()
    payload.pop("caption", None)
    payload.pop("hashtags", None)
    return payload


def _render_clip_sync(
    job: JobData,
    moment: llm.Moment,
    subs: Sequence[Cue],
    src_video: str,
    filename: str,
    outdir: str,
    offset: float,
) -> ClipResult:
    """Render satu klip (dipanggil via asyncio.to_thread)."""
    render_moment = (
        replace(
            moment,
            start=max(0.0, moment.start - offset),
            end=max(0.0, moment.end - offset),
        )
        if offset
        else moment
    )
    extra: Dict[str, Any] = {}
    # outdir = <clips_dir>/<job_id>; watermark relatif terhadap clips_dir.
    clips_root = os.path.dirname(os.path.abspath(outdir))
    resolved_wms: list[tuple[Watermark, str]] = []
    for wm in job.watermarks:
        wm_path = resolve_watermark_path(clips_root, wm)
        if wm_path:
            resolved_wms.append((wm, wm_path))
    if len(resolved_wms) == 1:
        extra["watermark"], extra["watermark_path"] = resolved_wms[0]
    elif resolved_wms:
        extra["watermarks"] = resolved_wms
    if job.caption_style is not None:
        extra["caption_style"] = job.caption_style

    _render_one(
        src_video,
        render_moment,
        subs,
        outdir,
        filename,
        job.reframe,
        job.captions,
        job.two_speakers,
        job.facecam,
        offset,
        job.aspect_ratio,
        normalize_audio=job.normalize_audio,
        **extra,
    )
    _apply_hook_intro_for_job(job, src_video, render_moment, outdir, filename)
    # Outro ditempel setelah intro; start/end klip tak berubah.
    _apply_outro_for_job(job, outdir, filename)
    return ClipResult(
        title=moment.title,
        start=round(moment.start, 2),
        end=round(moment.end, 2),
        file=filename,
        transcript=llm.clip_transcript(subs, moment.start, moment.end) or None,
        viral_score=moment.viral_score,
        hook_text=moment.hook_text,
    )


async def render(
    job: JobData,
    moments: Sequence[llm.Moment],
    video: Optional[str],
    subs: Sequence[Cue],
    outdir: str,
    on_progress=None,
    should_cancel=None,
) -> List[ClipResult]:
    """Render tiap momen sesuai aspectRatio; subtitle terbakar bila job.captions.

    9:16 -> 1080x1920 (reframe/twoSpeakers seperti biasa), 1:1 -> 1080x1080
    (reframe dengan target persegi), 16:9 -> 1920x1080 (reframe diabaikan:
    skala pas + pad hitam). twoSpeakers hanya berlaku untuk 9:16.

    Mode manual tidak lewat sini: lihat render_manual (streaming per rentang).
    """
    if not moments:
        raise ValueError("tidak ada momen untuk dirender")
    if not video:
        raise ValueError("sumber video tidak tersedia untuk render")

    os.makedirs(outdir, exist_ok=True)
    _clear_facecam_cache()
    await _emit(on_progress, "render", 0, f"merender {len(moments)} clip")

    clips: List[ClipResult] = []
    total = len(moments)
    for index, moment in enumerate(moments, start=1):
        await _check_cancel(should_cancel)  # berhenti di antara clip, bukan di tengah ffmpeg
        filename = f"clip-{index:02d}.mp4"
        clip = await asyncio.to_thread(
            _render_clip_sync, job, moment, subs, video, filename, outdir, 0.0
        )
        clips.append(clip)
        # Klip langsung dilaporkan selagi job masih jalan (API mem-parse data.clip).
        await _emit(
            on_progress,
            "render",
            index * 100 / total,
            f"clip {index}/{total} selesai",
            clip=_clip_report(clip),
        )

    log.info("job %s: %s clip dirender", job.job_id, total)
    return clips


async def render_manual(
    job: JobData,
    moments: Sequence[llm.Moment],
    subs: Sequence[Cue],
    outdir: str,
    workdir: str,
    on_progress=None,
    should_cancel=None,
) -> List[ClipResult]:
    """Mode manual: unduh satu section → validasi → render → hapus, per rentang.

    Hanya satu proses berat (yt-dlp/ffmpeg) yang hidup pada satu waktu supaya
    host kecil tidak OOM. Klip dilaporkan lewat progress begitu file-nya ada,
    jadi UI tidak perlu menunggu seluruh job selesai.

    Fallback: bila section gagal (unduh error / tanpa stream video / A/V tidak
    sinkron), video penuh diunduh sekali lalu rentang itu dan semua rentang
    berikutnya dirender dari video penuh (offset 0).
    """
    if not moments:
        raise ValueError("tidak ada momen untuk dirender")

    os.makedirs(outdir, exist_ok=True)
    _clear_facecam_cache()
    total = len(moments)
    await _emit(on_progress, "render", 0, f"merender {total} clip")

    clips: List[ClipResult] = []
    # Diisi setelah fallback: sumber video penuh untuk semua klip berikutnya.
    full_video: Optional[str] = None

    for index, moment in enumerate(moments, start=1):
        await _check_cancel(should_cancel)  # berhenti di antara klip
        filename = f"clip-{index:02d}.mp4"
        section: Optional[str] = None

        if full_video is None:
            await _emit(
                on_progress,
                "download",
                (index - 1) * 100 / total,
                f"mengunduh clip {index}/{total}",
            )
            try:
                for attempt in (1, 2):
                    try:
                        section, offset = await _download_one_section(
                            job, index, moment, workdir
                        )
                        break
                    except Exception as exc:
                        # 403 sesekali terjadi pada URL section; buang sisa file
                        # dan coba sekali lagi sebelum jatuh ke video penuh.
                        if attempt == 1 and "403" in str(exc):
                            _remove_section_files(workdir, index)
                            log.warning(
                                "job %s: section %s kena 403 (%s), coba ulang sekali",
                                job.job_id,
                                index,
                                exc,
                            )
                            continue
                        raise
            except Exception as exc:
                log.warning(
                    "job %s: section %s gagal (%s), fallback unduh video penuh",
                    job.job_id,
                    index,
                    exc,
                )
                _remove_section_files(workdir, index)
                await _emit(
                    on_progress,
                    "download",
                    (index - 1) * 100 / total,
                    "section gagal, mengunduh video penuh",
                )
                full_video = await _download_full(job, workdir, on_progress)

        if full_video is not None:
            src_video, offset = full_video, 0.0
        elif section is not None:
            src_video = section
        else:  # pragma: no cover - tidak mungkin: section atau full video ada
            raise RuntimeError("sumber video tidak tersedia untuk render")

        try:
            clip = await asyncio.to_thread(
                _render_clip_sync, job, moment, subs, src_video, filename, outdir, offset
            )
        finally:
            # Section besar (ratusan MB) dibuang segera setelah dipakai.
            if section is not None and os.path.exists(section):
                os.remove(section)

        clips.append(clip)
        await _emit(
            on_progress,
            "render",
            index * 100 / total,
            f"clip {index}/{total} selesai",
            clip=_clip_report(clip),
        )

    log.info("job %s: %s clip dirender (manual, streaming)", job.job_id, total)
    return clips


async def _download_full(job: JobData, workdir: str, on_progress=None) -> str:
    """Unduhan video penuh (satu-satunya proses berat yang jalan saat itu)."""
    await _emit(on_progress, "download", 0, "mengunduh video penuh")
    cmd = _yt_dlp_base() + [
        "-o",
        os.path.join(workdir, "source.%(ext)s"),
        job.url,
    ]
    await asyncio.to_thread(_run, cmd)
    video = _find_video(workdir)
    if not video:
        raise RuntimeError("yt-dlp selesai tanpa menghasilkan file video")
    return video



def clip_dir(clips_dir: str, job_id: str) -> str:
    """Folder clip selalu dari job_id tervalidasi, tidak pernah dari input pengguna."""
    if not JOB_ID_RE.match(job_id or ""):
        raise ValueError(f"job_id tidak valid: {job_id!r}")
    return os.path.join(clips_dir, job_id)


def _ensure_saved(result: JobResult, folder: str) -> None:
    """Buang klip yang file-nya sudah tidak ada dari hasil.

    Klip dilaporkan satu per satu selagi job berjalan, jadi pengguna bisa
    menghapusnya sebelum job selesai. Itu bukan kegagalan: klip tersebut
    cukup tidak ikut di hasil akhir (API tidak membuatnya ulang). Job baru
    gagal bila tidak ada satu pun klip yang tersisa.
    """
    os.makedirs(folder, exist_ok=True)
    kept = []
    for clip in result.clips:
        path = os.path.join(folder, clip.file)
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            kept.append(clip)
        else:
            log.info("klip %s tidak ada lagi (dihapus pengguna?), dilewati", clip.file)
    if not kept:
        raise RuntimeError("tidak ada file clip yang tersisa setelah render")
    result.clips[:] = kept


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
        cues = await transcribe(media.subtitles, on_progress)
        if job.mode == "auto" and job.max_source_sec:
            # Mode manual mengabaikan maxSourceSec: rentangnya sudah eksplisit.
            cues = _cues_within_limit(cues, job.max_source_sec)
        await _check_cancel(should_cancel)
        moments = await select(job, cues, on_progress)
        await _check_cancel(should_cancel)
        if job.mode == "manual":
            # Streaming: satu section diunduh, dirender, lalu dihapus per rentang.
            clips = await render_manual(
                job, moments, cues, output_dir, workdir, on_progress, should_cancel
            )
        else:
            clips = await render(
                job,
                moments,
                media.video,
                cues,
                output_dir,
                on_progress,
                should_cancel,
            )
        await _check_cancel(should_cancel)
        await _emit(on_progress, "save", 0, "membuat caption sosial")
        if job.custom_hashtags:
            for clip in clips:
                clip.hashtags = list(job.custom_hashtags)
        try:
            social_captions = await asyncio.to_thread(
                llm.generate_captions,
                moments,
                cues,
                job.description,
                None,
                job.caption_language,
                job.custom_hashtags,
            )
            for clip, social_caption in zip(clips, social_captions or ()):
                if social_caption is not None:
                    clip.caption = social_caption.caption
                    if not job.custom_hashtags:
                        clip.hashtags = list(social_caption.hashtags)
                    clip.platform_captions = social_caption.platforms or None
        except Exception as exc:
            # Caption bersifat opsional; jangan pernah menggagalkan klip yang sudah dirender.
            log.warning(
                "job %s: caption sosial dilewati karena error tak terduga (%s)",
                job.job_id,
                exc.__class__.__name__,
            )
        result = JobResult(clips=clips)
        await save(result, clips_dir, job.job_id, on_progress)
        log.info("job %s selesai, %s clip", job.job_id, len(clips))
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def run_preview(data: Mapping[str, Any], temp_root: Optional[str] = None) -> Dict[str, Any]:
    """Pratinjau momen: subtitle + LLM saja, tanpa unduh video dan render.

    Mengembalikan semua kandidat momen yang ditemukan tanpa batas `clipCount`
    dan daftar cue terdeduplikasi untuk transkrip di UI. Bila `maxSourceSec`
    diisi, hanya cue 0–limit yang dipindai dan dikembalikan.
    """
    url = data.get("url")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("url wajib diisi untuk preview")

    raw_description = data.get("description")
    description = (
        str(raw_description).strip()[:MAX_DESCRIPTION_CHARS]
        if isinstance(raw_description, str) and str(raw_description).strip()
        else None
    )
    # Parameter preview dikirim flat (clipCount/targetDurationSec), bukan nested.
    params = JobParams.from_dict(
        {key: data[key] for key in ("clipCount", "targetDurationSec") if data.get(key) is not None}
    )
    max_source_sec = to_max_source_sec(data.get("maxSourceSec"))

    temp_root = temp_root or os.getenv("TEMP_ROOT") or tempfile.gettempdir()
    os.makedirs(temp_root, exist_ok=True)
    workdir = tempfile.mkdtemp(prefix="preview-", dir=temp_root)
    try:
        subtitles = await asyncio.to_thread(_fetch_subtitles, url, workdir)
        if not subtitles:
            raise RuntimeError(NO_SUBTITLE_ERROR)

        cues = await asyncio.to_thread(_read_vtt, subtitles)
        if not cues:
            raise RuntimeError(NO_SUBTITLE_ERROR)

        cues = _cues_within_limit(cues, max_source_sec)

        moments = await asyncio.to_thread(
            llm.select_moments,
            cues,
            params,
            os.environ,
            description,
            all_moments=True,
        )
        return {
            "candidates": [moment.to_dict() for moment in moments],
            "cues": [
                {"start": round(cue.start, 2), "end": round(cue.end, 2), "text": cue.text}
                for cue in cues
            ],
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
