# Rust BullMQ worker

The GHCR image `ghcr.io/<owner>/dartclip-worker-rust:latest` (or a commit SHA tag) runs the render, preview, caption/brief and frame queues used by the API. Pull the image rather than building it on the homeserver. To build locally from the repository root, use `docker build -f worker-rust/Dockerfile .`.

Keep the existing `REDIS_URL`, LLM settings, and clips mount. The container uses UID/GID `10001:10001`; the bind mount at `/data/clips` must be writable by that identity. `CLIPS_DIR`, `FONTS_DIR`, `TEMP_ROOT`, `MIN_FREE_GB`, `VIDEO_ENCODER`, and `FRAME_CONCURRENCY` can be overridden. Startup verifies FFmpeg, ffprobe, Montserrat, and the embedded YuNet model. The image build also checks the standalone `yt-dlp` executable.

**Reference Edit is not migrated.** This image does not consume `reference-jobs` or use `LLM_VISION_MODEL`. Do not retire the Python worker if the deployment still needs Reference Edit; it needs a consumer for that queue. Do not run both full workers against the same four migrated queues unless you intend for them to share those jobs.

For direct CLI use, pass `--task` and either `--payload-file <path>` or `--payload-stdin`; `self-check` and `llm-check` require no payload. Stdout is JSONL: progress payloads can include new clips, followed by a result or an error event. Terminal events may carry `llmStatus` metadata for the bridge; it is not part of the BullMQ job return value. Diagnostics go to stderr.
