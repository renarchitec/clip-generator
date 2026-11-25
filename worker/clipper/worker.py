"""Konsumen BullMQ: job render `clip-jobs` dan job pratinjau `previews`.

Kontrak data mengikuti packages/shared/src/index.ts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from datetime import datetime, timezone

import redis.asyncio as redis
from bullmq import Worker

from . import llm, models, pipeline, reference_pipeline

log = logging.getLogger("clipper.worker")

QUEUE_NAME = models.QUEUE_NAME
CONCURRENCY = 1
# Antrean preview punya worker sendiri supaya tidak menunggu render.
PREVIEW_QUEUE_NAME = models.PREVIEW_QUEUE_NAME
PREVIEW_CONCURRENCY = 2
# Regenerasi caption satu klip (hanya LLM, cepat).
CAPTION_QUEUE_NAME = models.CAPTION_QUEUE_NAME
CAPTION_CONCURRENCY = 2
# Satu frame JPEG untuk posisi watermark di UI.
FRAME_QUEUE_NAME = models.FRAME_QUEUE_NAME
FRAME_CONCURRENCY = int(os.getenv("FRAME_CONCURRENCY", "1"))
def clips_dir() -> str:
    return os.getenv("CLIPS_DIR", "/data/clips")


# Reference Edit: antrean dan konkurensi worker tersendiri.
REFERENCE_QUEUE_NAME = models.REFERENCE_QUEUE_NAME
REFERENCE_CONCURRENCY = 1
DEFAULT_CLIPS_DIR = clips_dir()
DEFAULT_TEMP_ROOT = os.getenv("TEMP_ROOT") or None

# Kunci status LLM untuk UI. Harus sama dengan apps/api/src/system/llm-status.constants.ts.
LLM_STATUS_KEY = "worker:status:llm"
LLM_STATUS_TTL = 90
LLM_STATUS_INTERVAL = 30


def build_llm_status_payload() -> dict:
    base_url = (os.getenv("LLM_BASE_URL") or "").strip()
    api_key = (os.getenv("LLM_API_KEY") or "").strip()
    model = (os.getenv("LLM_MODEL") or "").strip()
    configured = bool(base_url and api_key and model)

    return {
        "configured": configured,
        "model": model or None,
        "lastCall": llm.last_llm_call(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


async def write_llm_status(redis_client: redis.Redis | None) -> None:
    """Best-effort tulis status LLM ke Redis; jangan pernah lempar error ke pemanggil."""
    if redis_client is None:
        return
    try:
        payload = build_llm_status_payload()
        await redis_client.set(
            LLM_STATUS_KEY,
            json.dumps(payload),
            ex=LLM_STATUS_TTL,
        )
    except Exception as exc:
        log.warning("gagal memperbarui status LLM di redis: %s", exc)


async def handle_job(job, token: str | None = None, redis_client: redis.Redis | None = None):
    data = models.job_data_from_dict(job.data)
    log.info("job %s mulai (mode=%s)", data.job_id, data.mode)

    async def should_cancel() -> bool:
        if redis_client is None:
            return False
        try:
            return bool(await redis_client.exists(models.CANCEL_KEY.format(data.job_id)))
        except Exception as exc:
            log.warning("gagal cek sinyal pembatalan: %s", exc)
            return False

    async def on_progress(
        stage: str, percent: float, message: str = "", *, clip: dict | None = None
    ) -> None:
        payload = models.JobProgress(
            stage=stage, percent=percent, message=message, clip=clip
        ).to_dict()
        try:
            await job.updateProgress(payload)
        except Exception as exc:  # progress gagal tidak boleh membatalkan render
            log.warning("job %s: gagal kirim progress: %s", data.job_id, exc)

    try:
        result = await pipeline.run_job(
            data,
            on_progress,
            clips_dir=clips_dir(),
            temp_root=os.getenv("TEMP_ROOT") or None,
            should_cancel=should_cancel,
        )
        log.info("job %s selesai: %s clip", data.job_id, len(result.clips))
        return result.to_dict()
    except pipeline.JobCancelled:
        log.info("job %s dihentikan aman karena dibatalkan", data.job_id)
        raise
    finally:
        if redis_client is not None:
            try:
                await redis_client.delete(models.CANCEL_KEY.format(data.job_id))
            except Exception:
                pass
        await write_llm_status(redis_client)


async def handle_preview_job(job, token: str | None = None, redis_client: redis.Redis | None = None):
    job_id = getattr(job, "id", None) or getattr(job, "jobId", None) or "preview"
    log.info("preview job %s mulai", job_id)
    try:
        result = await pipeline.run_preview(
            job.data or {},
            temp_root=os.getenv("TEMP_ROOT") or None,
        )
        log.info(
            "preview job %s selesai: %s kandidat, %s cue",
            job_id,
            len(result.get("candidates") or []),
            len(result.get("cues") or []),
        )
        return result
    finally:
        await write_llm_status(redis_client)


async def handle_caption_job(job, token: str | None = None, redis_client: redis.Redis | None = None):
    """Job antrean captions: `brief` memperluas brief, lainnya regenerasi caption.

    Gagal apa pun -> job failed (API membalas 503).
    """
    job_id = getattr(job, "id", None) or "caption"
    is_brief = getattr(job, "name", None) == "brief"
    try:
        if is_brief:
            brief = await asyncio.to_thread(llm.expand_brief, getattr(job, "data", None) or {})
            result = {"brief": brief}
        else:
            caption = await asyncio.to_thread(llm.regenerate_caption, getattr(job, "data", None) or {})
            result = {"caption": caption.caption, "hashtags": list(caption.hashtags)}
    except llm.CaptionUnavailable as exc:
        log.warning("caption job %s gagal: %s", job_id, exc)
        raise RuntimeError("caption_unavailable") from None
    except Exception as exc:  # noqa: BLE001 - input rusak tidak boleh menjatuhkan worker
        log.warning("caption job %s error tak terduga: %s", job_id, exc.__class__.__name__)
        raise RuntimeError("caption_unavailable") from None
    finally:
        await write_llm_status(redis_client)
    log.info("caption job %s selesai", job_id)
    return result


async def handle_frame_job(job, token: str | None = None, redis_client: redis.Redis | None = None):
    """Satu frame pratinjau untuk penempatan watermark; gagal -> job failed."""
    job_id = getattr(job, "id", None) or "frame"
    try:
        return await asyncio.wait_for(
            pipeline.run_frame(
                getattr(job, "data", None) or {}, clips_dir(),
                temp_root=os.getenv("TEMP_ROOT") or None,
            ),
            timeout=120,
        )
    except (RuntimeError, asyncio.TimeoutError) as exc:
        log.warning("frame job %s gagal: %s", job_id, exc)
        raise RuntimeError(str(exc) or "frame_render_failed") from None
    except Exception as exc:  # noqa: BLE001 - input tak terduga jangan menjatuhkan worker
        log.warning("frame job %s error tak terduga: %s", job_id, exc.__class__.__name__)
        raise RuntimeError("frame_render_failed") from None
    finally:
        await write_llm_status(redis_client)


async def handle_reference_job(
    job,
    _token: str | None = None,
    *,
    clips_dir: str = DEFAULT_CLIPS_DIR,
    temp_root: str | None = DEFAULT_TEMP_ROOT,
    redis_client: redis.Redis | None = None,
):
    """Job antrean reference-jobs: analisis referensi + footage, rencana, render."""
    data = models.reference_job_data_from_dict(getattr(job, "data", None) or {})
    log.info("reference job %s mulai (footage=%s)", data.job_id, len(data.footage))

    async def should_cancel() -> bool:
        if redis_client is None:
            return False
        try:
            return bool(await redis_client.exists(models.CANCEL_KEY.format(data.job_id)))
        except Exception as exc:
            log.warning("gagal cek sinyal pembatalan: %s", exc)
            return False

    async def on_progress(progress: models.ReferenceJobProgress) -> None:
        try:
            await job.updateProgress(progress.to_dict())
        except Exception as exc:  # progress gagal tidak boleh membatalkan render
            log.warning("reference job %s: gagal kirim progress: %s", data.job_id, exc)

    try:
        result = await reference_pipeline.run_reference_job(
            data,
            clips_dir=clips_dir,
            temp_root=temp_root,
            on_progress=on_progress,
            should_cancel=should_cancel,
            env=os.environ,
        )
        log.info("reference job %s selesai: %s", data.job_id, result.output_file_path)
        return result.to_dict()
    except pipeline.JobCancelled:
        log.info("reference job %s dihentikan aman karena dibatalkan", data.job_id)
        raise
    finally:
        if redis_client is not None:
            try:
                await redis_client.delete(models.CANCEL_KEY.format(data.job_id))
            except Exception:
                pass
        await write_llm_status(redis_client)


async def main() -> None:
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        raise SystemExit("REDIS_URL wajib diisi")

    redis_client = redis.from_url(redis_url, decode_responses=True)

    # BullMQ Worker.run() mati permanen kalau Redis belum siap saat start,
    # sementara proses tetap hidup. Tunggu Redis dulu sebelum membuat consumer.
    for attempt in range(1, 61):
        try:
            await redis_client.ping()
            break
        except Exception as exc:  # noqa: BLE001
            log.warning("redis belum siap (percobaan %s): %s", attempt, exc)
            await asyncio.sleep(5)
    else:
        raise SystemExit("redis tidak bisa dihubungi, keluar agar container di-restart")

    async def _handle(job, token: str | None = None):
        return await handle_job(job, token, redis_client=redis_client)

    async def _handle_preview(job, token: str | None = None):
        return await handle_preview_job(job, token, redis_client=redis_client)

    render_worker = Worker(
        QUEUE_NAME,
        _handle,
        {
            # decode_responses=True: sama seperti client internal bullmq.
            "connection": redis_client,
            "concurrency": CONCURRENCY,
        },
    )

    preview_worker = Worker(
        PREVIEW_QUEUE_NAME,
        _handle_preview,
        {
            "connection": redis_client,
            "concurrency": PREVIEW_CONCURRENCY,
        },
    )

    async def _handle_caption(job, token: str | None = None):
        return await handle_caption_job(job, token, redis_client=redis_client)

    caption_worker = Worker(
        CAPTION_QUEUE_NAME,
        _handle_caption,
        {
            "connection": redis_client,
            "concurrency": CAPTION_CONCURRENCY,
        },
    )

    async def _status_loop():
        while True:
            await write_llm_status(redis_client)
            try:
                await asyncio.sleep(LLM_STATUS_INTERVAL)
            except asyncio.CancelledError:
                break

    status_task = asyncio.create_task(_status_loop())

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

    async def _handle_frame(job, token: str | None = None):
        return await handle_frame_job(job, token, redis_client=redis_client)

    frame_worker = Worker(
        FRAME_QUEUE_NAME,
        _handle_frame,
        {
            "connection": redis_client,
            "concurrency": FRAME_CONCURRENCY,
        },
    )

    async def _handle_reference(job, token: str | None = None):
        return await handle_reference_job(job, token, redis_client=redis_client)

    reference_worker = Worker(
        REFERENCE_QUEUE_NAME,
        _handle_reference,
        {
            "connection": redis_client,
            "concurrency": REFERENCE_CONCURRENCY,
        },
    )

    log.info("worker menunggu job di antrean %s (concurrency=%s), %s (concurrency=%s), %s (concurrency=%s), %s (concurrency=%s), %s (concurrency=%s)",
             QUEUE_NAME, CONCURRENCY, PREVIEW_QUEUE_NAME, PREVIEW_CONCURRENCY,
             CAPTION_QUEUE_NAME, CAPTION_CONCURRENCY,
             FRAME_QUEUE_NAME, FRAME_CONCURRENCY,
             REFERENCE_QUEUE_NAME, REFERENCE_CONCURRENCY)
    try:
        await stop.wait()
    finally:
        log.info("worker berhenti, menunggu job aktif selesai")
        status_task.cancel()
        try:
            await status_task
        except asyncio.CancelledError:
            pass
        await asyncio.gather(
            render_worker.close(),
            preview_worker.close(),
            caption_worker.close(),
            frame_worker.close(),
            reference_worker.close(),
            return_exceptions=True,
        )


if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    asyncio.run(main())
