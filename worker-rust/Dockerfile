# syntax=docker/dockerfile:1
FROM rust:bookworm AS build
WORKDIR /src
COPY rust/ rust/
RUN export PATH="$HOME/.cargo/bin:$PATH" \
    && cargo build --release --manifest-path rust/Cargo.toml --bin dartclip-worker \
    && strip rust/target/release/dartclip-worker

FROM node:22-bookworm-slim
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in amd64) asset=yt-dlp_linux ;; arm64) asset=yt-dlp_linux_aarch64 ;; *) exit 1 ;; esac \
    && curl --fail --silent --show-error --location --retry 3 \
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$asset" -o /usr/local/bin/yt-dlp \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && printf '%s\n' '--js-runtimes node' > /etc/yt-dlp.conf

COPY worker/fonts/*.ttf /usr/share/fonts/truetype/dartclip/
RUN fc-cache -f \
    && groupadd --system --gid 10001 clipper \
    && useradd --system --uid 10001 --gid clipper --create-home --shell /usr/sbin/nologin clipper \
    && install -d -o 10001 -g 10001 /data/clips
ENV CLIPS_DIR=/data/clips FONTS_DIR=/usr/share/fonts/truetype/dartclip NODE_ENV=production HOME=/home/clipper
COPY --from=build /src/rust/target/release/dartclip-worker /usr/local/bin/dartclip-worker
WORKDIR /app
COPY worker-rust/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY worker-rust/bridge.mjs ./
USER 10001:10001
CMD ["sh", "-ec", "dartclip-worker --task self-check >&2; exec node /app/bridge.mjs"]
