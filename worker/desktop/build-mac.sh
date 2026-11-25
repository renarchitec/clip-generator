#!/usr/bin/env bash
# Bundel worker lokal (macOS Apple Silicon): PyInstaller onedir + ffmpeg/ffprobe statis.
# Output: worker/desktop/dist/dartclip-worker/{dartclip-worker,bin/ffmpeg,bin/ffprobe,...}
set -euo pipefail
cd "$(dirname "$0")"

[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] || { echo "hanya macOS arm64" >&2; exit 1; }

VENV="${VENV:-.venv}"
if [ ! -x "$VENV/bin/python" ]; then
  uv venv -p 3.12 "$VENV"
fi
VIRTUAL_ENV="$VENV" uv pip install -r ../requirements.in pyinstaller

# ffmpeg statis arm64 (martin-riedl.de: build statis, libx264 + videotoolbox + libass).
FF_CACHE="${FF_CACHE:-.ffmpeg}"
mkdir -p "$FF_CACHE"
for tool in ffmpeg ffprobe; do
  if [ ! -x "$FF_CACHE/$tool" ]; then
    curl -fsSL -o "$FF_CACHE/$tool.zip" \
      "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/$tool.zip"
    unzip -o -q "$FF_CACHE/$tool.zip" -d "$FF_CACHE"
    rm "$FF_CACHE/$tool.zip"
    xattr -d com.apple.quarantine "$FF_CACHE/$tool" 2>/dev/null || true
  fi
done

"$VENV/bin/pyinstaller" --noconfirm --clean dartclip-worker.spec

mkdir -p dist/dartclip-worker/bin
cp "$FF_CACHE/ffmpeg" "$FF_CACHE/ffprobe" dist/dartclip-worker/bin/
du -sh dist/dartclip-worker
