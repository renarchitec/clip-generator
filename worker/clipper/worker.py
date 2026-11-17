"""Konsumen BullMQ: satu job = satu video.

Kontrak data mengikuti packages/shared/src/index.ts.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal

import redis.asyncio as redis
from bullmq import Worker

from . import models, pipeline

log = logging.getLogger("clipper.worker")

QUEUE_NAME = models.QUEUE_NAME
CONCURRENCY = 1


def clips_dir() -> str:
    return os.getenv("CLIPS_DIR", "/data/clips")


async def handle_job(job, token: str | None = None):
    data = models.job_data_from_dict(job.data)
    log.info("job %s mulai (mode=%s)", data.job_id, data.mode)

    async def on_progress(stage: str, percent: float, message: str = "") -> None:
        payload = models.JobProgress(stage=stage, percent=percent, message=message).to_dict()
        try:
            await job.updateProgress(payload)
        except Exception as exc:  # progress gagal tidak boleh membatalkan render
            log.warning("job %s: gagal kirim progress: %s", data.job_id, exc)

    result = await pipeline.run_job(
        data,
        on_progress,
        clips_dir=clips_dir(),
        temp_root=os.getenv("TEMP_ROOT") or None,
    )
    log.info("job %s selesai: %s clip", data.job_id, len(result.clips))
    return result.to_dict()


async def main() -> None:
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        raise SystemExit("REDIS_URL wajib diisi")

    worker = Worker(
        QUEUE_NAME,
        handle_job,
        {
            # decode_responses=True: sama seperti client internal bullmq.
            "connection": redis.from_url(redis_url, decode_responses=True),
            "concurrency": CONCURRENCY,
        },
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if sig is None:
            continue
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            # Windows tidak mendukung add_signal_handler.
            signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))

    log.info("worker menunggu job di antrean %s", QUEUE_NAME)
    try:
        await stop.wait()
    finally:
        log.info("worker berhenti, menunggu job aktif selesai")
        await worker.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    asyncio.run(main())
