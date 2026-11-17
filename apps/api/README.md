# clipper-api

NestJS 11 + Prisma + BullMQ. Fase 1: membuat job, memantau progress lewat SSE, menyajikan file clip.

## Env

Salin `.env.example` di root repo ke `.env`. Variabel yang wajib ada di Fase 1:

| Variabel | Contoh |
| --- | --- |
| `DATABASE_URL` | `postgresql://clipper:clipper@localhost:5432/clipper?schema=public` |
| `REDIS_URL` | `redis://localhost:6379` |
| `CLIPS_DIR` | `/data/clips` (path yang sama dengan worker) |
| `PORT` | `3000` (default kalau kosong) |

Boot gagal dengan daftar variabel yang kurang bila salah satu tidak diisi.

## Perintah

```bash
pnpm --filter api prisma:generate   # generate Prisma Client
pnpm --filter api prisma:migrate    # prisma migrate dev (butuh Postgres hidup)
pnpm --filter api dev               # nest start --watch
pnpm --filter api build             # prisma generate + nest build
pnpm --filter api start             # node dist/main.js
```

Migrasi pertama sudah ada di `prisma/migrations/20260101000000_init/migration.sql`. Untuk apply tanpa membuat migrasi baru (deploy/produksi):

```bash
pnpm --filter api exec prisma migrate deploy
```

## Endpoint

| Method | Path | Keterangan |
| --- | --- | --- |
| POST | `/api/jobs` | Body: `url`, `mode` (`auto`\|`manual`), `clipCount` 1-10 (default 3), `targetDurationSec` 15-180 (default 45), `ranges` (`{start,end}`, wajib saat `manual`) |
| GET | `/api/jobs` | Daftar job, terbaru dulu, plus `clipsCount` |
| GET | `/api/jobs/:id` | Job beserta clip |
| GET | `/api/jobs/:id/events` | SSE; state sekarang dikirim dulu, lalu setiap update |
| GET | `/api/clips/:id/stream` | Preview, mendukung `Range` (206) |
| GET | `/api/clips/:id/download` | Unduh, mengisi `downloaded_at` |

Host URL yang diterima: `youtube.com`, `youtu.be`, `tiktok.com`, `instagram.com` (termasuk subdomain). Selain itu 400.

## Catatan

- Path file selalu `CLIPS_DIR/<jobId>/<file>` di database, jadi tidak pernah dibentuk dari input pengguna. Endpoint clip tetap memverifikasi `path.resolve` tidak keluar dari `CLIPS_DIR`.
- Nama antrean didefinisikan ulang di `src/queue/queue.constants.ts` karena `packages/shared` hanya berisi TypeScript dan tidak bisa di-require saat runtime. Nilainya harus sama dengan `QUEUE_NAME` di `packages/shared/src/index.ts`; tipe `JobData`, `JobProgress`, `JobResult` tetap diimpor dari paket itu.
- BullMQ job id = id job di database, jadi event `QueueEvents` bisa langsung dipakai sebagai kunci update.
- Docker: build dengan context root repo (`docker build -f apps/api/Dockerfile .`) karena memakai `turbo prune --docker`. Tambahkan `.dockerignore` di root (minimal `node_modules`, `dist`, `.turbo`) supaya context tidak ikut mengirim `node_modules`.
