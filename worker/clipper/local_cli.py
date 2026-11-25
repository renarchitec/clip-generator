"""Entrypoint lokal (desktop): jalankan pipeline tanpa Redis/BullMQ.

Mode CLI langsung (fase 1, tetap kompatibel):
  python -m clipper.local_cli --url https://youtu.be/XXXX --range 120-175
  python -m clipper.local_cli --url ... --mode auto --max-source-sec 900

Mode antrean lokal (fase 2, dipanggil API NestJS desktop):
  dartclip-worker --task job|preview|frame|caption|brief|reference|llm-check
                  [--payload-file /path/to/payload.json] (atau baca JSON dari stdin)
                  [--clips-dir ~/DartClip] [--temp-dir ~/DartClip/tmp]
                  [--cancel-file /path/to/cancel.flag]

Output stdout: satu event JSON per baris:
  {"event": "start", ...}
  {"event": "progress", "stage": ..., "percent": ..., "message": ..., "clip": ...}
  {"event": "result", "data": ...}
  {"event": "llm_status", "configured": ..., "model": ..., "lastCall": ..., "updatedAt": ...}
  {"event": "done", "folder": ..., "files": [...], "seconds": ...}  (hanya CLI langsung)
  {"event": "cancelled"}
  {"event": "error", "message": ..., "code": ...}

Log biasa tetap ke stderr.

LLM (mode auto / caption / brief): endpoint dipilih dari env tanpa key di kode.
Urutan:
  1. 9router (`DARTCLIP_9ROUTER_URL` + `NINEROUTER_API_KEY`, model `NINEROUTER_MODEL`)
  2. Fallback: Gemini (`GEMINI_API_KEY`) lalu OpenAI (`OPENAI_API_KEY`)
  Atau bila `LLM_BASE_URL` + `LLM_API_KEY` langsung di-set.
Bila 9router dan fallback sama-sama tersedia, fallback tetap disimpan ke `LLM_FALLBACK_JSON`
supaya gagal/timeout saat pemanggilan chat/completions otomatis jatuh ke fallback.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional

DEFAULT_9ROUTER_URL = "https://9router.rencraft.site/v1"
DEFAULT_9ROUTER_MODEL = "tabi-fixer"
GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
OPENAI_URL = "https://api.openai.com/v1"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

TASK_CHOICES = ("job", "preview", "frame", "caption", "brief", "reference", "llm-check")


def _emit(event: str, **payload: Any) -> None:
    sys.stdout.write(json.dumps({"event": event, **payload}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _reachable(base_url: str, timeout: float = 4.0) -> bool:
    try:
        req = urllib.request.Request(base_url.rstrip("/") + "/models", method="GET")
        with urllib.request.urlopen(req, timeout=timeout):
            return True
    except urllib.error.HTTPError:
        return True  # server menjawab (mis. 401 tanpa key) = bisa dijangkau
    except Exception:
        return False


def _build_llm_candidates(env: Mapping[str, str]) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    if (env.get("LLM_BASE_URL") or "").strip() and (env.get("LLM_API_KEY") or "").strip():
        candidates.append(
            {
                "name": "env",
                "baseUrl": env["LLM_BASE_URL"].strip(),
                "apiKey": env["LLM_API_KEY"].strip(),
                "model": (env.get("LLM_MODEL") or "").strip() or DEFAULT_9ROUTER_MODEL,
                "probe": False,
            }
        )
    router_key = (env.get("NINEROUTER_API_KEY") or "").strip()
    if router_key:
        router_url = (env.get("DARTCLIP_9ROUTER_URL") or "").strip() or DEFAULT_9ROUTER_URL
        router_model = (env.get("NINEROUTER_MODEL") or "").strip() or DEFAULT_9ROUTER_MODEL
        candidates.append(
            {
                "name": "9router",
                "baseUrl": router_url,
                "apiKey": router_key,
                "model": router_model,
                "probe": True,
            }
        )
    gemini_key = (env.get("GEMINI_API_KEY") or "").strip()
    if gemini_key:
        candidates.append(
            {
                "name": "gemini",
                "baseUrl": GEMINI_OPENAI_URL,
                "apiKey": gemini_key,
                "model": (env.get("GEMINI_MODEL") or "").strip() or DEFAULT_GEMINI_MODEL,
                "probe": False,
            }
        )
    openai_key = (env.get("OPENAI_API_KEY") or "").strip()
    if openai_key:
        candidates.append(
            {
                "name": "openai",
                "baseUrl": OPENAI_URL,
                "apiKey": openai_key,
                "model": (env.get("OPENAI_MODEL") or "").strip() or DEFAULT_OPENAI_MODEL,
                "probe": False,
            }
        )
    return candidates


def resolve_llm_env(env: Dict[str, str]) -> Optional[str]:
    """Isi LLM_BASE_URL/LLM_API_KEY/LLM_MODEL + LLM_FALLBACK_JSON di `env`; return nama primary."""
    candidates = _build_llm_candidates(env)
    if not candidates:
        env.pop("LLM_FALLBACK_JSON", None)
        return None

    chosen_idx: Optional[int] = None
    for idx, candidate in enumerate(candidates):
        if candidate["probe"] and not _reachable(candidate["baseUrl"]):
            logging.warning("LLM %s tidak terjangkau, coba berikutnya", candidate["name"])
            continue
        chosen_idx = idx
        break

    if chosen_idx is None:
        # Tidak ada yang lolos probe; tetap coba kandidat terakhir daripada kosong.
        chosen_idx = len(candidates) - 1

    primary = candidates[chosen_idx]
    env["LLM_BASE_URL"] = primary["baseUrl"]
    env["LLM_API_KEY"] = primary["apiKey"]
    if primary.get("model"):
        env["LLM_MODEL"] = primary["model"]

    fallbacks = [
        {"baseUrl": item["baseUrl"], "apiKey": item["apiKey"], "model": item["model"]}
        for item in candidates[chosen_idx + 1 :]
    ]
    if fallbacks:
        env["LLM_FALLBACK_JSON"] = json.dumps(fallbacks)
    else:
        env.pop("LLM_FALLBACK_JSON", None)
    return str(primary["name"])


def _install_tool_shims() -> None:
    """Saat dibundel PyInstaller: sediakan `yt-dlp` di PATH dan ffmpeg bundel.

    Pipeline memanggil `yt-dlp`/`ffmpeg`/`ffprobe` lewat PATH; jalur Docker tidak
    berubah. Di bundel, yt-dlp adalah modul Python di dalam binary ini, jadi shim
    shell memanggil binary ini lagi dengan `--yt-dlp`.
    """
    if not getattr(sys, "frozen", False):
        return
    bundle_dir = os.path.dirname(os.path.abspath(sys.executable))
    shim_dir = tempfile.mkdtemp(prefix="dartclip-bin-")
    shim = os.path.join(shim_dir, "yt-dlp")
    with open(shim, "w") as handle:
        handle.write(f'#!/bin/sh\nexec "{sys.executable}" --yt-dlp "$@"\n')
    os.chmod(shim, os.stat(shim).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    paths = [shim_dir]
    for candidate in (os.path.join(bundle_dir, "bin"), os.path.join(bundle_dir, "..", "bin")):
        if os.path.isdir(candidate):
            paths.append(os.path.abspath(candidate))
    os.environ["PATH"] = os.pathsep.join(paths + [os.environ.get("PATH", "")])
    # ffmpeg statis (OpenSSL) tidak membaca keychain macOS: tanpa CA bundle,
    # unduhan section (yt-dlp -> ffmpeg https) gagal "certificate verify failed".
    # Hook PyInstaller mengarahkan MPLCONFIGDIR ke temp baru tiap start, sehingga
    # cache font matplotlib (diimpor mediapipe) dibangun ulang ~5 dtk per job.
    mpl_cache = os.path.expanduser("~/Library/Caches/DartClip/matplotlib")
    os.makedirs(mpl_cache, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = mpl_cache
    if os.path.isfile("/etc/ssl/cert.pem"):  # selalu ada di macOS
        os.environ.setdefault("SSL_CERT_FILE", "/etc/ssl/cert.pem")
    fonts = os.path.join(getattr(sys, "_MEIPASS", bundle_dir), "fonts")
    if os.path.isdir(fonts):
        os.environ.setdefault("FONTS_DIR", fonts)


def _parse_range(text: str) -> Dict[str, float]:
    start, _, end = text.partition("-")
    return {"start": float(start), "end": float(end)}


def _emit_llm_status(llm_mod: Any, source: Optional[str]) -> None:
    model = (os.getenv("LLM_MODEL") or "").strip() or None
    configured = bool(
        (os.getenv("LLM_BASE_URL") or "").strip()
        and (os.getenv("LLM_API_KEY") or "").strip()
        and model
    )
    _emit(
        "llm_status",
        configured=configured,
        source=source,
        model=model,
        lastCall=llm_mod.last_llm_call(),
        updatedAt=datetime.now(timezone.utc).isoformat(),
    )


def _load_payload(payload_file: Optional[str]) -> Dict[str, Any]:
    if payload_file:
        with open(payload_file, "r", encoding="utf-8") as handle:
            raw = handle.read()
    else:
        raw = sys.stdin.read()
    if not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("payload harus berupa JSON object")
    return parsed


def _make_cancel_checker(cancel_file: Optional[str]) -> tuple[Any, Dict[str, bool]]:
    state = {"cancelled": False}

    def _on_signal(_signum: int, _frame: Any) -> None:
        state["cancelled"] = True

    for sig_name in ("SIGTERM", "SIGINT"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                signal.signal(sig, _on_signal)
            except Exception:
                pass

    async def should_cancel() -> bool:
        if state["cancelled"]:
            return True
        if cancel_file and os.path.exists(cancel_file):
            state["cancelled"] = True
            return True
        return False

    return should_cancel, state


async def _run_task(args: argparse.Namespace) -> int:
    task = args.task
    if args.encoder:
        os.environ["VIDEO_ENCODER"] = args.encoder

    clips_dir = args.clips_dir or os.getenv("CLIPS_DIR") or os.path.expanduser("~/DartClip")
    temp_dir = args.temp_dir or os.getenv("TEMP_ROOT") or os.path.join(clips_dir, "tmp")
    os.makedirs(clips_dir, exist_ok=True)
    os.makedirs(temp_dir, exist_ok=True)

    llm_source = resolve_llm_env(os.environ)

    if task == "llm-check":
        from . import llm

        _emit_llm_status(llm, llm_source)
        _emit("result", data={"ok": True, "source": llm_source, "model": os.getenv("LLM_MODEL") or None})
        return 0

    try:
        payload = _load_payload(args.payload_file)
    except Exception as exc:
        _emit("error", message=f"payload tidak valid: {exc}")
        return 2

    should_cancel, _ = _make_cancel_checker(args.cancel_file)

    if task == "caption":
        from . import llm

        try:
            caption = await asyncio.to_thread(llm.regenerate_caption, payload)
            _emit_llm_status(llm, llm_source)
            _emit("result", data={"caption": caption.caption, "hashtags": list(caption.hashtags)})
            return 0
        except llm.CaptionUnavailable as exc:
            _emit_llm_status(llm, llm_source)
            _emit("error", message=str(exc), code="caption_unavailable")
            return 1
        except Exception as exc:
            _emit_llm_status(llm, llm_source)
            _emit("error", message=str(exc), code="caption_unavailable")
            return 1

    if task == "brief":
        from . import llm

        try:
            expanded = await asyncio.to_thread(llm.expand_brief, payload)
            _emit_llm_status(llm, llm_source)
            _emit("result", data={"brief": expanded})
            return 0
        except llm.CaptionUnavailable as exc:
            _emit_llm_status(llm, llm_source)
            _emit("error", message=str(exc), code="brief_unavailable")
            return 1
        except Exception as exc:
            _emit_llm_status(llm, llm_source)
            _emit("error", message=str(exc), code="brief_unavailable")
            return 1

    from . import llm, models, pipeline

    if task == "preview":
        _emit("start", task="preview", llm=llm_source)
        try:
            result = await pipeline.run_preview(payload, temp_root=temp_dir)
            _emit_llm_status(llm, llm_source)
            _emit("result", data=result)
            return 0
        except Exception as exc:
            _emit_llm_status(llm, llm_source)
            _emit("error", message=str(exc))
            return 1

    if task == "frame":
        _emit("start", task="frame")
        try:
            result = await asyncio.wait_for(
                pipeline.run_frame(payload, clips_dir, temp_root=temp_dir),
                timeout=120,
            )
            _emit("result", data=result)
            return 0
        except Exception as exc:
            _emit("error", message=str(exc) or "frame_render_failed")
            return 1

    if task == "reference":
        from . import reference_pipeline

        data = models.reference_job_data_from_dict(payload)
        _emit("start", task="reference", jobId=data.job_id, llm=llm_source)

        async def on_ref_progress(progress: models.ReferenceJobProgress) -> None:
            _emit("progress", **progress.to_dict())

        try:
            result = await reference_pipeline.run_reference_job(
                data,
                clips_dir=clips_dir,
                temp_root=temp_dir,
                on_progress=on_ref_progress,
                should_cancel=should_cancel,
                env=os.environ,
            )
            _emit_llm_status(llm, llm_source)
            _emit("result", data=result.to_dict())
            return 0
        except pipeline.JobCancelled:
            _emit("cancelled")
            return 130
        except Exception as exc:
            _emit_llm_status(llm, llm_source)
            _emit("error", message=str(exc))
            return 1

    # task == "job"
    job_data = models.job_data_from_dict(payload)
    _emit(
        "start",
        task="job",
        jobId=job_data.job_id,
        encoder=pipeline._video_encoder(),
        llm=llm_source,
        mode=job_data.mode,
    )

    def on_progress(stage: str, percent: float, message: str = "", *, clip=None) -> None:
        _emit("progress", stage=stage, percent=round(percent, 1), message=message, clip=clip)

    try:
        result = await pipeline.run_job(
            job_data,
            on_progress,
            clips_dir=clips_dir,
            temp_root=temp_dir,
            should_cancel=should_cancel,
        )
        _emit_llm_status(llm, llm_source)
        _emit("result", data=result.to_dict())
        return 0
    except pipeline.JobCancelled:
        _emit("cancelled")
        return 130
    except Exception as exc:
        _emit_llm_status(llm, llm_source)
        _emit("error", message=str(exc))
        return 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="dartclip-worker", description=__doc__.splitlines()[0])
    p.add_argument("--task", choices=TASK_CHOICES, help="mode antrean lokal (baca JSON payload)")
    p.add_argument("--payload-file", help="file JSON payload (default baca stdin bila --task dipakai)")
    p.add_argument("--clips-dir", help="folder root file DartClip (default ~/DartClip atau CLIPS_DIR)")
    p.add_argument("--temp-dir", help="folder sementara worker (default <clips-dir>/tmp)")
    p.add_argument("--cancel-file", help="path flag file untuk membatalkan job yang sedang berjalan")

    # Argumen CLI langsung (fase 1)
    p.add_argument("--url")
    p.add_argument(
        "--range",
        action="append",
        default=[],
        metavar="START-END",
        help="rentang detik, boleh berulang; tanpa --range = mode auto (butuh LLM)",
    )
    p.add_argument("--mode", choices=["auto", "manual"])
    p.add_argument("--reframe", default="face_tracking")
    p.add_argument("--aspect", default="9:16")
    p.add_argument("--no-captions", action="store_true")
    p.add_argument("--max-source-sec", type=int)
    p.add_argument("--out", default=os.path.expanduser("~/DartClip/clips"))
    p.add_argument("--job-id")
    p.add_argument("--encoder", help="libx264 | h264_videotoolbox (override VIDEO_ENCODER)")
    p.add_argument(
        "--no-social-captions",
        action="store_true",
        help="lewati LLM caption sosial (mode manual tanpa LLM)",
    )
    return p


async def _main(args: argparse.Namespace) -> int:
    if args.task:
        return await _run_task(args)

    if not args.url:
        _emit("error", message="--url atau --task wajib diisi")
        return 2

    from . import pipeline  # import berat (cv2/mediapipe) setelah shim & env siap

    if args.encoder:
        os.environ["VIDEO_ENCODER"] = args.encoder
    llm_source = resolve_llm_env(os.environ)
    mode = args.mode or ("manual" if args.range else "auto")
    if mode == "auto" and not llm_source:
        _emit(
            "error",
            message="mode auto butuh LLM: set NINEROUTER_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY",
        )
        return 2
    if args.no_social_captions or not llm_source:
        # caption sosial opsional; tanpa LLM pipeline sudah toleran, ini hanya mempercepat.
        pipeline.llm.generate_captions = lambda moments, *a, **k: [None] * len(moments)

    job_id = args.job_id or f"local-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    data = {
        "jobId": job_id,
        "url": args.url,
        "mode": mode,
        "reframe": args.reframe,
        "aspectRatio": args.aspect,
        "captions": not args.no_captions,
        "ranges": [_parse_range(r) for r in args.range],
        "maxSourceSec": args.max_source_sec,
    }
    _emit("start", jobId=job_id, encoder=pipeline._video_encoder(), llm=llm_source, mode=mode)

    def on_progress(stage: str, percent: float, message: str = "", *, clip=None) -> None:
        _emit("progress", stage=stage, percent=round(percent, 1), message=message, clip=clip)

    started = time.monotonic()
    try:
        result = await pipeline.run_job(data, on_progress, clips_dir=args.out)
    except Exception as exc:
        _emit("error", message=str(exc))
        return 1
    folder = pipeline.clip_dir(args.out, job_id)
    _emit(
        "done",
        folder=folder,
        files=[os.path.join(folder, c.file) for c in result.clips],
        seconds=round(time.monotonic() - started, 2),
    )
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["--yt-dlp"]:
        import yt_dlp

        return yt_dlp.main(argv[1:])  # type: ignore[func-returns-value]
    _install_tool_shims()
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return asyncio.run(_main(build_parser().parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
