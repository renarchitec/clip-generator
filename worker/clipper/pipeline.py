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
from dataclasses import dataclass, field, replace
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

from . import llm
from . import reframe as reframe_mod
from .models import (
    JOB_ID_RE,
    MAX_DESCRIPTION_CHARS,
    ClipResult,
    JobData,
    JobParams,
    JobResult,
    ManualRange,
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
    video: Optional[str] = None
    subtitles: Optional[str] = None
    # Mode manual: satu file per rentang, berisi (path, offset awal di video asli).
    sections: List[Tuple[str, float]] = field(default_factory=list)


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
        fmt = (
            "bv*[ext=mp4][protocol^=http]+ba[ext=mp4][protocol^=http]"
            "/b[ext=mp4][protocol^=http]"
        )
    else:
        fmt = "bv*[ext=mp4]+ba[ext=mp4]/b[ext=mp4]/b"
    return [
        "yt-dlp",
        "-f",
        fmt,
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
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

    Mode manual hanya mengunduh rentang terpilih (satu `section-NN.*` per
    rentang via --download-sections), bukan video penuh. yt-dlp mereset
    timestamp file section ke 0; offset awal rentang disimpan untuk render.

    Mode auto dengan `max_source_sec` hanya mengunduh 0–limit sebagai satu
    section (offset 0) dan memakai file itu sebagai sumber render.
    """
    os.makedirs(workdir, exist_ok=True)

    ranges = _valid_ranges(job.ranges) if job.mode == "manual" else []
    if job.mode == "manual" and not ranges:
        # Gagal cepat: jangan unduh video penuh untuk job manual tanpa rentang sah.
        raise ValueError("mode manual butuh minimal satu range")
    sections: List[Tuple[str, float]] = []
    video: Optional[str] = None

    if ranges:
        await _emit(on_progress, "download", 0, f"mengunduh {len(ranges)} rentang")
        for index, item in enumerate(ranges):
            cmd = _yt_dlp_base(sections=True) + [
                "--download-sections",
                f"*{item.start:.3f}-{item.end:.3f}",
                # Re-encode keyframe agar potongan tepat pada batas rentang.
                "--force-keyframes-at-cuts",
                "-o",
                os.path.join(workdir, f"section-{index:02d}.%(ext)s"),
                job.url,
            ]
            try:
                await asyncio.to_thread(_run, cmd)
            except Exception as exc:
                log.warning(
                    "gagal unduh section %d (%.1f-%.1f), fallback unduh video penuh: %s",
                    index,
                    item.start,
                    item.end,
                    exc,
                )
                for path, _ in sections:
                    os.remove(path)
                sections = []
                break
            path = _find_media(workdir, f"section-{index:02d}")
            if not path:
                raise RuntimeError(
                    f"yt-dlp selesai tanpa file untuk rentang {item.start:.1f}-{item.end:.1f}"
                )
            sections.append((path, item.start))
        probes = [await asyncio.to_thread(_has_video, path) for path, _ in sections]
        if not all(probes):
            # yt-dlp kadang menghasilkan section audio-saja (format terbatas/429).
            log.warning("section tanpa stream video, fallback unduh video penuh")
            for path, _ in sections:
                os.remove(path)
            sections = []
        elif any(
            [await asyncio.to_thread(_section_video_lags_audio, path) for path, _ in sections]
        ):
            log.warning("section A/V tidak sinkron (video mulai lebih lambat), fallback unduh video penuh")
            for path, _ in sections:
                os.remove(path)
            sections = []
        else:
            sections = [
                (await asyncio.to_thread(_ensure_opencv_readable, path), offset)
                for path, offset in sections
            ]
    if not sections and job.mode == "auto" and job.max_source_sec:
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

    if not sections and not video:
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
    return Downloaded(video=video, subtitles=subtitles, sections=sections)


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

    16:9 (landscape): reframe diabaikan — skala pas 1920x1080, pad hitam bila
    sumber bukan 16:9 (mayoritas sumber YouTube sudah 16:9, jadi efektif skala saja).
    Mode centered (black_bars, blurred_fill) lewat tanpa deteksi frame.
    face_tracking memanggil MediaPipe; dep hilang -> raise RuntimeError.
    """
    if landscape:
        return [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black",
            "setsar=1",
        ]
    if reframe == "black_bars":
        return [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black",
            "setsar=1",
        ]
    if reframe == "blurred_fill":
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


def _facecam_box_for(video: str, moment: llm.Moment) -> Optional[Tuple[int, int, int, int]]:
    """Kotak wajah facecam (piksel sumber); None -> fallback reframe biasa."""
    out = _run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", video,
        ]
    )
    src_w, src_h = (int(part) for part in out.strip().split(",")[:2])
    frames = reframe_mod.sample_face_frames(video, moment.start, moment.end)
    return reframe_mod.facecam_box(frames, src_w, src_h)


def _facecam_graph(
    box: Tuple[int, int, int, int],
    ass_path: Optional[str],
) -> tuple[List[str], str]:
    """filter_complex facecam: panel wajah 1080x640 di atas gameplay 1080x1280.

    Kotak dari `facecam_box` (piksel sumber); panel bawah crop 27:32 full-height
    di tengah frame, keduanya diskalakan lalu ditumpuk (total 1080x1920).
    """
    x, y, w, h = box
    graph = [
        "[0:v]split=2[fc0][fc1]",
        f"[fc0]crop={w}:{h}:{x}:{y},scale=1080:640[top]",
        "[fc1]crop=w='min(ih*27/32,in_w)':h=ih:x='(in_w-out_w)/2':y=0,scale=1080:1280[bot]",
        "[top][bot]vstack=inputs=2[v]",
    ]
    label = "[v]"
    if ass_path:
        graph.append(f"[v]subtitles={_ffmpeg_filter_path(ass_path)}[vout]")
        label = "[vout]"
    return graph, label


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
) -> None:
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
    font_size = max(1, round(FONT_SIZE * height / 1920))
    margin_v = max(1, round(MARGIN_V * height / 1920))

    out_path = os.path.join(outdir, filename)
    ass_path = os.path.join(outdir, os.path.splitext(filename)[0] + ".ass")
    # Teks takarir dicocokkan dengan timestamp absolut video asli.
    absolute_start = moment.start + timeline_offset
    absolute_end = moment.end + timeline_offset
    clip_cues = _clip_cues(cues, absolute_start, absolute_end)
    burn_captions = captions and bool(clip_cues)

    if burn_captions:
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
                    max_chars=WRAP_CHARS_WIDE if landscape else WRAP_CHARS,
                )
            )

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
    ]

    if two_speakers:
        graph, label = _two_speaker_graph(
            video, moment, ass_path if burn_captions else None
        )
        cmd += ["-filter_complex", ";".join(graph), "-map", label, "-map", "0:a:0?"]
    else:
        graph: Optional[tuple[List[str], str]] = None
        if facecam:
            try:
                box = _facecam_box_for(video, moment)
            except Exception as exc:
                log.warning("facecam: deteksi wajah gagal, fallback reframe biasa: %s", exc)
                box = None
            if box:
                graph = _facecam_graph(box, ass_path if burn_captions else None)
        if graph:
            filters, label = graph
            cmd += ["-filter_complex", ";".join(filters), "-map", label, "-map", "0:a:0?"]
        else:
            filters = _reframe_filters(reframe, video, moment, width, height, landscape)
            if burn_captions:
                filters.append("subtitles=" + _ffmpeg_filter_path(ass_path))
            cmd += ["-vf", ",".join(filters), "-map", "0:v:0", "-map", "0:a:0?"]

    cmd += [
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
    video: Optional[str],
    subs: Sequence[Cue],
    outdir: str,
    on_progress=None,
    should_cancel=None,
    sections: Optional[Sequence[Tuple[str, float]]] = None,
) -> List[ClipResult]:
    """Render tiap momen sesuai aspectRatio; subtitle terbakar bila job.captions.

    9:16 -> 1080x1920 (reframe/twoSpeakers seperti biasa), 1:1 -> 1080x1080
    (reframe dengan target persegi), 16:9 -> 1920x1080 (reframe diabaikan:
    skala pas + pad hitam). twoSpeakers hanya berlaku untuk 9:16.

    Jika sections diberikan (mode manual), tiap klip membaca file section
    terkait dengan offset start relatif (= moment.start - section_offset).
    """
    if not moments:
        raise ValueError("tidak ada momen untuk dirender")
    if not video and not sections:
        raise ValueError("sumber video tidak tersedia untuk render")
    if sections is not None and len(sections) != len(moments):
        raise ValueError("jumlah section tidak sama dengan jumlah momen")

    os.makedirs(outdir, exist_ok=True)
    await _emit(on_progress, "render", 0, f"merender {len(moments)} clip")

    clips: List[ClipResult] = []
    total = len(moments)
    for index, moment in enumerate(moments, start=1):
        await _check_cancel(should_cancel)  # berhenti di antara clip, bukan di tengah ffmpeg
        filename = f"clip-{index:02d}.mp4"

        # Tentukan file video input dan pergeseran timestamp momen
        if sections:
            src_video, offset = sections[index - 1]
            render_moment = replace(
                moment,
                start=max(0.0, moment.start - offset),
                end=max(0.0, moment.end - offset),
            )
        else:
            if not video:
                raise RuntimeError("file video sumber tidak ditemukan")
            src_video = video
            offset = 0.0
            render_moment = moment

        await asyncio.to_thread(
            _render_one,
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
        )
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
        cues = await transcribe(media.subtitles, on_progress)
        if job.mode == "auto" and job.max_source_sec:
            # Mode manual mengabaikan maxSourceSec: rentangnya sudah eksplisit.
            cues = _cues_within_limit(cues, job.max_source_sec)
        await _check_cancel(should_cancel)
        moments = await select(job, cues, on_progress)
        await _check_cancel(should_cancel)
        clips = await render(
            job,
            moments,
            media.video,
            cues,
            output_dir,
            on_progress,
            should_cancel,
            sections=media.sections or None,
        )
        await _check_cancel(should_cancel)
        result = JobResult(clips=clips)
        await save(result, clips_dir, job.job_id, on_progress)
        log.info("job %s selesai, %s clip", job.job_id, len(clips))
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def run_preview(data: Mapping[str, Any], temp_root: Optional[str] = None) -> Dict[str, Any]:
    """Pratinjau momen: subtitle + LLM saja, tanpa unduh video dan render.

    Mengembalikan kandidat momen (klien & filter sama seperti mode auto) dan
    daftar cue terdeduplikasi untuk transkrip penuh di UI. Bila `maxSourceSec`
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
