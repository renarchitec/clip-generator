#!/bin/sh
# Entrypoint runtime API: terapkan migrasi Prisma dulu, baru start Nest.
# `prisma migrate deploy` idempoten: migrasi yang sudah tercatat di
# _prisma_migrations dilewati, jadi aman dijalankan setiap kali container boot.
# Sengaja tanpa retry/backoff di dalam skrip: biarkan orchestrator (Dokploy /
# Docker restart policy) yang mengulang container bila DB belum siap.
set -eu

echo "[entrypoint] Prisma migrate deploy..."
apps/api/node_modules/.bin/prisma migrate deploy \
  --schema apps/api/prisma/schema.prisma

echo "[entrypoint] Migrasi selesai, start API..."
exec node apps/api/dist/main.js
