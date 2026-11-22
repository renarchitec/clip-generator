FROM python:3.12-slim

# Jalur ISP homeserver ke CDN PyPI (Fastly) cuma ~1-2 Mbps; mirror Aliyun ~12 Mbps.
# Override saat build: --build-arg PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
ENV PYTHONUNBUFFERED=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_DEFAULT_TIMEOUT=60 \
    PIP_RETRIES=5

# ffmpeg dipakai untuk render clip + burn subtitle ASS.
# fonts-dejavu-core wajib sebagai fallback. fontconfig + fc-cache untuk registrasi Anton.
# libglib2.0-0 + libgl1 dibutuhkan mediapipe/opencv (mediapipe wheel: linux x86_64 cp312).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-dejavu-core \
        fontconfig \
        libglib2.0-0 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Font utama caption hook: Anton (OFL) dengan DejaVu sebagai fallback.
COPY worker/fonts/ /usr/share/fonts/truetype/anton/
RUN fc-cache -f -v

COPY worker/requirements.txt /app/requirements.txt
# Cache pip BuildKit: wheel yang sudah pernah di-download tidak diambil ulang saat layer ini rebuild.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY worker/clipper/ /app/clipper/

# Volume `clips-data` di-mount ke /data/clips (CLIPS_DIR).

CMD ["python", "-m", "clipper.worker"]
