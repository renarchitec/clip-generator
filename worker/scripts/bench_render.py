"""Benchmark render satu klip (desktop spike): libx264 vs h264_videotoolbox.

Sumber diunduh sekali (section yt-dlp), lalu `_render_one` dijalankan per encoder
pada file yang sama, jadi angka murni reframe+encode tanpa jaringan.

  python worker/scripts/bench_render.py --url URL --start 120 --end 170 [--repeat 2]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from clipper import llm, pipeline  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--start", type=float, required=True)
    p.add_argument("--end", type=float, required=True)
    p.add_argument("--reframe", default="face_tracking")
    p.add_argument("--repeat", type=int, default=2)
    p.add_argument("--encoders", default="libx264,h264_videotoolbox")
    args = p.parse_args()

    work = tempfile.mkdtemp(prefix="dartclip-bench-")
    src = os.path.join(work, "section.mp4")
    subprocess.run(
        pipeline._yt_dlp_base(sections=True)
        + ["--download-sections", f"*{args.start}-{args.end}", "--force-keyframes-at-cuts",
           "-o", src, args.url],
        check=True,
    )
    src = pipeline._ensure_opencv_readable(src)
    moment = llm.Moment(start=0.0, end=args.end - args.start, title="bench")
    results = []
    for encoder in args.encoders.split(","):
        os.environ["VIDEO_ENCODER"] = encoder
        for run in range(1, args.repeat + 1):
            name = f"{encoder}-{run}.mp4"
            t0 = time.monotonic()
            pipeline._render_one(src, moment, [], work, name, args.reframe, False)
            secs = time.monotonic() - t0
            size = os.path.getsize(os.path.join(work, name))
            results.append({"encoder": encoder, "run": run, "seconds": round(secs, 2),
                            "mb": round(size / 1e6, 1)})
            print(json.dumps(results[-1]), flush=True)
    print("workdir:", work)


if __name__ == "__main__":
    main()
