# Base image dikunci ke digest (manifest list multi-arch) supaya build reproducible
# dan tag yang ditimpa tidak diam-diam mengganti isi image. Update: ambil digest baru
# `python:3.12-slim` dari Docker Hub, ganti di sini, rebuild.
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

# Index PyPI dicoba berurutan. PyPI resmi dulu (normal ~170 Mbps dari homeserver);
# rute ISP ke CDN-nya (Fastly) kadang anjlok ke ~1-2 Mbps, jadi tiap index selain
# yang terakhir dibatasi PIP_INDEX_TIMEOUT detik lalu pindah ke index berikutnya.
# Wheel yang sudah selesai di-download tetap di cache pip, jadi tidak diambil ulang.
# Mirror tidak perlu dipercaya: requirements.txt mengunci versi + hash sha256 setiap
# wheel, dan --require-hashes menolak file yang isinya beda dari PyPI resmi.
# Override saat build: --build-arg PIP_INDEXES="https://pypi.tuna.tsinghua.edu.cn/simple"
ARG PIP_INDEXES="https://pypi.org/simple https://mirrors.aliyun.com/pypi/simple https://pypi.tuna.tsinghua.edu.cn/simple"
ARG PIP_INDEX_TIMEOUT=300
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=60 \
    PIP_RETRIES=5

# ffmpeg dipakai untuk render clip + burn subtitle ASS.
# fonts-dejavu-core wajib sebagai fallback. fontconfig + fc-cache untuk registrasi Anton.
# libglib2.0-0 + libgl1 dibutuhkan mediapipe/opencv.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-dejavu-core \
        fontconfig \
        libglib2.0-0 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

# User non-root dengan UID/GID tetap. Bind mount host /srv/storage/clips harus
# dimiliki 10001:10001 (lihat living-docs/IMPLEMENTATION_PLAN.md, bagian deploy).
RUN groupadd --system --gid 10001 clipper \
    && useradd --system --uid 10001 --gid clipper --home-dir /home/clipper --create-home \
        --shell /usr/sbin/nologin clipper

WORKDIR /app

# Font utama caption hook: Anton (OFL) dengan DejaVu sebagai fallback.
COPY worker/fonts/ /usr/share/fonts/truetype/anton/
RUN fc-cache -f

COPY worker/requirements.txt /app/requirements.txt
# --require-hashes: setiap paket (termasuk dependency transitif) wajib cocok hash-nya.
# --only-binary: jangan pernah menjalankan setup.py dari sdist saat build.
# Index URL lewat ARG (bukan ENV) supaya tidak terbawa ke image runtime.
# Cache pip BuildKit: wheel yang sudah pernah di-download tidak diambil ulang.
# Index terakhir jalan tanpa batas waktu; gagal di semua index = build gagal.
RUN --mount=type=cache,target=/root/.cache/pip \
    set -u; \
    set -- ${PIP_INDEXES}; \
    while [ "$#" -gt 0 ]; do \
        idx="$1"; shift; \
        limit="${PIP_INDEX_TIMEOUT}"; [ "$#" -eq 0 ] && limit=0; \
        echo ">> pip index: ${idx} (timeout ${limit}s, 0 = tanpa batas)"; \
        if timeout "${limit}" pip install --require-hashes --only-binary=:all: --no-deps \
            --index-url "${idx}" -r requirements.txt; then \
            exit 0; \
        fi; \
        echo ">> pip index gagal/terlalu lambat: ${idx}"; \
    done; \
    exit 1

# Kode milik root, read-only untuk user runtime.
COPY worker/clipper/ /app/clipper/

# Bind mount host /srv/storage/clips -> /data/clips (CLIPS_DIR).
USER clipper:clipper

CMD ["python", "-m", "clipper.worker"]
