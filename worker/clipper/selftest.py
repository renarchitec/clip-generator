"""CLI tanpa Redis untuk gate Fase 0.

Contoh:
    python -m clipper.selftest --url https://youtu.be/xxx --mode manual \
        --ranges 12-40,90-130
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import List, Optional

from . import pipeline
from .models import JobData, JobParams, ManualRange


def parse_ranges(raw: Optional[str]) -> List[ManualRange]:
    if not raw:
        return []
    ranges: List[ManualRange] = []
    for part in raw.split(","):
        chunk = part.strip()
        if not chunk:
            continue
        if "-" not in chunk:
            raise SystemExit(f"range tidak valid: {chunk!r} (format detik:awal-akhir)")
        start_text, _, end_text = chunk.partition("-")
        try:
            start, end = float(start_text), float(end_text)
        except ValueError:
            raise SystemExit(f"range bukan angka: {chunk!r}") from None
        if end <= start:
            raise SystemExit(f"range end harus > start: {chunk!r}")
        ranges.append(ManualRange(start=start, end=end))
    return ranges


def build_job(args: argparse.Namespace) -> JobData:
    return JobData(
        job_id=args.job_id,
        url=args.url,
        mode=args.mode,
        params=JobParams(clip_count=args.clips, target_duration_sec=args.duration),
        ranges=parse_ranges(args.ranges),
    )


async def run(args: argparse.Namespace) -> int:
    job = build_job(args)

    def on_progress(stage: str, percent: float, message: str = "") -> None:
        print(f"[{stage:<10}] {percent:5.1f}% {message}", flush=True)

    result = await pipeline.run_job(
        job,
        on_progress,
        clips_dir=args.clips_dir,
        temp_root=args.temp_root,
    )
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    folder = pipeline.clip_dir(args.clips_dir or os.getenv("CLIPS_DIR", "./clips"), job.job_id)
    print(f"\nClip tersimpan di: {folder}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Jalankan pipeline clip tanpa Redis")
    parser.add_argument("--url", required=True, help="URL video")
    parser.add_argument("--mode", choices=("auto", "manual"), default="auto")
    parser.add_argument("--ranges", default="", help='mode manual, mis. "12-40,90-130"')
    parser.add_argument("--clips", type=int, default=3, help="jumlah clip mode auto")
    parser.add_argument("--duration", type=float, default=60.0, help="target durasi detik")
    parser.add_argument("--job-id", default="selftest")
    parser.add_argument("--clips-dir", default=None, help="default CLIPS_DIR atau ./clips")
    parser.add_argument("--temp-root", default=None)
    args = parser.parse_args(argv)

    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"GAGAL: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
