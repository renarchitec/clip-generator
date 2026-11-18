FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface

# ffmpeg dipakai untuk render clip + burn subtitle ASS.
# fonts-dejavu-core wajib: image slim tidak punya font, libass tidak menggambar apa pun.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY worker/clipper/ /app/clipper/

# Model Whisper diunduh ke HF_HOME. Mount volume `whisper-cache` di
# /root/.cache/huggingface supaya model tidak diunduh ulang tiap deploy.
# Volume `clips-data` di-mount ke /data/clips (CLIPS_DIR).

CMD ["python", "-m", "clipper.worker"]
