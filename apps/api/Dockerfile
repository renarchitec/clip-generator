# syntax=docker/dockerfile:1

# Build context harus root repo: turbo prune butuh seluruh workspace.
# Jalankan: docker build -f apps/api/Dockerfile -t clipper-api .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# openssl dibutuhkan Prisma untuk mendeteksi libssl (schema engine); tanpa ini
# Prisma mem-fallback ke openssl-1.1.x dan memunculkan warning di runtime.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.11 prune api --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter api prisma generate
RUN pnpm --filter api build

# Image runtime sengaja menyalin seluruh /app (termasuk devDependency) supaya
# Prisma client hasil generate dan engine-nya ikut. Tradeoff: image ~200 MB
# lebih besar. Ganti dengan `pnpm deploy --prod` bila ukuran mulai menyusahkan.
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/ .
COPY --from=pruner /app/apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
# Jalankan `prisma migrate deploy` dulu, lalu start Nest (lihat skrip).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
