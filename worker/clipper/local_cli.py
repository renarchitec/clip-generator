"""Entrypoint lokal (desktop spike): jalankan pipeline tanpa Redis/BullMQ.

Contoh:
  python -m clipper.local_cli --url https://youtu.be/XXXX --range 120-175
  python -m clipper.local_cli --url ... --mode auto --max-source-sec 900

Output: klip di <out>/<job_id>/clip-NN.mp4 (default ~/DartClip/clips).
stdout berisi satu event JSON per baris ({"event": "progress"|"done"|"error", ...})
supaya shell Electron bisa menampilkan progress tanpa parsing log; log biasa ke stderr.

LLM (hanya mode auto / caption sosial): endpoint dipilih dari env, tidak ada key
di kode. Urutan: LLM_BASE_URL/LLM_API_KEY/LLM_MODEL bila di-set; kalau tidak,
9router (DARTCLIP_9ROUTER_URL, key NINEROUTER_API_KEY) bila bisa dijangkau;
lalu Gemini (GEMINI_API_KEY) atau OpenAI (OPENAI_API_KEY) langsung.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from typing import Dict, List, Optional

DEFAULT_9ROUTER_URL = "https://9router.rencraft.site/v1"
GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
OPENAI_URL = "https://api.openai.com/v1"


def _emit(event: str, **payload) -> None:
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


def resolve_llm_env(env: Dict[str, str]) -> Optional[str]:
    """Isi LLM_BASE_URL/LLM_API_KEY/LLM_MODEL di `env`; kembalikan nama sumber."""
    if env.get("LLM_BASE_URL") and env.get("LLM_API_KEY"):
        return "env"
    router_key = env.get("NINEROUTER_API_KEY")
    router_url = env.get("DARTCLIP_9ROUTER_URL") or DEFAULT_9ROUTER_URL
    candidates = []
    if router_key:
        candidates.append(("9router", router_url, router_key, env.get("NINEROUTER_MODEL"), True))
    if env.get("GEMINI_API_KEY"):
        candidates.append(("gemini", GEMINI_OPENAI_URL, env["GEMINI_API_KEY"],
                           env.get("GEMINI_MODEL") or "gemini-2.5-flash", False))
    if env.get("OPENAI_API_KEY"):
        candidates.append(("openai", OPENAI_URL, env["OPENAI_API_KEY"],
                           env.get("OPENAI_MODEL") or "gpt-4o-mini", False))
    for name, url, key, model, probe in candidates:
        if probe and not _reachable(url):
            logging.warning("LLM %s tidak terjangkau, coba berikutnya", name)
            continue
        env["LLM_BASE_URL"], env["LLM_API_KEY"] = url, key
        if model:
            env["LLM_MODEL"] = model
        return name
    return None


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


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="dartclip-worker", description=__doc__.splitlines()[0])
    p.add_argument("--url", required=True)
    p.add_argument("--range", action="append", default=[], metavar="START-END",
                   help="rentang detik, boleh berulang; tanpa --range = mode auto (butuh LLM)")
    p.add_argument("--mode", choices=["auto", "manual"])
    p.add_argument("--reframe", default="face_tracking")
    p.add_argument("--aspect", default="9:16")
    p.add_argument("--no-captions", action="store_true")
    p.add_argument("--max-source-sec", type=int)
    p.add_argument("--out", default=os.path.expanduser("~/DartClip/clips"))
    p.add_argument("--job-id")
    p.add_argument("--encoder", help="libx264 | h264_videotoolbox (override VIDEO_ENCODER)")
    p.add_argument("--no-social-captions", action="store_true",
                   help="lewati LLM caption sosial (mode manual tanpa LLM)")
    return p


async def _main(args: argparse.Namespace) -> int:
    from . import pipeline  # import berat (cv2/mediapipe) setelah shim & env siap

    if args.encoder:
        os.environ["VIDEO_ENCODER"] = args.encoder
    llm_source = resolve_llm_env(os.environ)
    mode = args.mode or ("manual" if args.range else "auto")
    if mode == "auto" and not llm_source:
        _emit("error", message="mode auto butuh LLM: set NINEROUTER_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY")
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
