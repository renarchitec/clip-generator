# Clipper

Alat internal: satu video panjang → beberapa klip vertikal 9:16 bersubtitle Indonesia.
Konteks produk ada di `living-docs/PRD.md`, rencana fase di `living-docs/IMPLEMENTATION_PLAN.md`.

## Struktur

```text
apps/api        NestJS + Prisma, REST + SSE
apps/web        (Fase 2) TanStack Start
packages/shared kontrak data job (sumber kebenaran)
worker          Python: pipeline ffmpeg/yt-dlp + consumer BullMQ
```

## Status

Fase 1 — worker dan API. Auth, web, dan retensi file menyusul di Fase 2.

## Butuh

Node 22, pnpm 10, Postgres, Redis. Worker: Python 3.12, ffmpeg.

```bash
pnpm install
cp .env.example .env
pnpm --filter api prisma migrate dev
pnpm dev            # api
cd worker && python -m pytest
```

## Kontrak data

`packages/shared/src/index.ts` menentukan bentuk `JobData`, `JobProgress`, `JobResult`.
Worker Python (`worker/clipper/models.py`) mengikuti bentuk yang sama. Ubah keduanya bersamaan.
