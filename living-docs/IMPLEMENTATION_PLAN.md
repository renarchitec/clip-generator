# Rencana implementasi

## Ringkasan rencana

Platform dibangun dalam empat fase: pipeline CLI dulu, lalu worker dan API, lalu web MVP, lalu fitur P1 dan auto-posting. Setiap fase baru dimulai setelah gate fase sebelumnya lolos.

| Lapisan | Pilihan | Alasan |
| --- | --- | --- |
| Repo | Monorepo Turborepo + pnpm workspaces; folder Python terpisah | Satu tempat untuk API, web, tipe bersama, dan worker; task build, dev, lint, test di-cache Turborepo |
| API | NestJS + Prisma + `@nestjs/bullmq` | Stack yang sudah kamu pakai di Spendly |
| Web | TanStack Start + TanStack Query | Routing type-safe, SSR bila perlu; berjalan sebagai server Node |
| Worker | Python 3.12 + package `bullmq` versi Python | Pipeline `clipper.py` dipakai ulang, tidak ditulis ulang |
| Antrean | Redis di Dokploy | Dipakai bersama API dan worker |
| Database | Postgres di Dokploy | Sesuai keputusan di PRD |
| File clip | Volume Docker `clips-data` di VM | Di-mount ke API dan worker di path yang sama |
| Auth | Satu akun pemilik, hash password di env, JWT di cookie httpOnly | Cukup untuk single user, tanpa tabel users |

**Penyesuaian kecil dari PRD.** Folder clip memakai `<job_id>` (bukan `<video_id>`) supaya video yang sama bisa diproses dua kali. Tabel `clips` ditambah kolom `downloaded_at` dan `deleted_at`. API ditambah endpoint `GET /api/clips/:id/stream` untuk preview, agar memutar video tidak dihitung sebagai download.

## Struktur repo

Satu repo GitHub, tiga hal yang di-deploy terpisah: `apps/api`, `apps/web`, dan `worker`.

```text
clipper/
├─ apps/
│  ├─ api/                    # NestJS
│  │  ├─ prisma/schema.prisma
│  │  ├─ src/config/          # validasi env
│  │  ├─ src/auth/            # login, guard JWT
│  │  ├─ src/jobs/            # REST + SSE
│  │  ├─ src/clips/           # stream, download, ubah timestamp
│  │  ├─ src/queue/           # producer + listener QueueEvents
│  │  └─ src/cleanup/         # job terjadwal hapus file
│  └─ web/                    # TanStack Start
│     └─ src/routes/          # login, buat job, daftar job, detail job
├─ packages/
│  └─ shared/                 # tipe JobData, JobProgress, JobResult
├─ worker/                    # Python
│  ├─ clipper/pipeline.py     # isi clipper.py, dipecah per tahap
│  ├─ clipper/worker.py       # consumer BullMQ
│  ├─ tests/
│  ├─ requirements.txt
│  └─ Dockerfile
├─ pnpm-workspace.yaml
├─ turbo.json
└─ README.md
```

Tipe di `packages/shared` adalah sumber kebenaran bentuk data job. Worker Python mengikuti bentuk yang sama, dan perubahannya dicatat di README.

## Fase 0 — Pipeline CLI

Tujuannya membuktikan pipeline jalan di VM dan mengukur kebutuhan RAM sebelum membangun apa pun di atasnya.

- [ ] Jalankan `clipper.py` di VM dengan `--clips` manual dan `--no-upload`
- [ ] Uji mode otomatis lewat endpoint OpenAI-compatible (key OpenCode Go) dengan `LLM_API_KEY`
- [ ] Uji fallback Whisper pada video tanpa subtitle; catat lama proses dan puncak RAM
- [ ] Uji video panjang (lebih dari 1 jam); catat lama proses dan ruang disk sementara
- [ ] Ganti upload R2 dengan tulis ke direktori `CLIPS_DIR`
- [ ] Tetapkan memory limit worker dan ambang `MIN_FREE_GB` dari hasil pengukuran

**Gate 1:** 3 clip dari 1 video layak upload tanpa diedit.

## Fase 1 — Worker dan API

Hasil akhirnya: job bisa dibuat lewat API dan berjalan sampai file clip ada di volume, tanpa UI.

**Worker**

- [x] Pecah `clipper.py` jadi `pipeline.py`: satu fungsi per tahap, menerima callback progress; pemilihan momen memakai SDK openai dengan base\_url dari env, validasi JSON, dan satu kali retry bila jawaban tidak valid
- [x] `worker.py`: consumer antrean `clip-jobs` dengan concurrency 1
- [x] Jalankan langkah berat (yt-dlp, Whisper, ffmpeg) lewat `asyncio.to_thread` atau subprocess async, supaya worker tetap memperpanjang lock job selama proses panjang
- [x] Kirim progress per tahap: download, transkrip, pilih momen, render, simpan
- [x] Tulis hasil ke `CLIPS_DIR/<job_id>/`; folder sementara dihapus di blok `finally`
- [x] Cek ruang disk sebelum mulai; gagal dengan pesan jelas bila di bawah `MIN_FREE_GB`
- [x] Unit test untuk `parse_vtt`, `sanitize`, `write_ass`, dan parser JSON jawaban LLM

**API**

- [x] Setup Turborepo (pnpm workspaces) dengan task build, dev, lint, test di turbo.json, dan `packages/shared`
- [x] Modul config dengan validasi env saat start
- [x] Prisma schema `jobs` dan `clips` (termasuk `downloaded_at`, `deleted_at`), migrasi pertama
- [x] `POST /api/jobs` dengan validasi body, `GET /api/jobs`, `GET /api/jobs/:id`
- [x] Listener `QueueEvents`: progress → update `jobs`; completed → insert `clips`; failed → simpan error
- [x] `GET /api/jobs/:id/events` (SSE) dari event yang sama
- [x] `GET /api/clips/:id/stream` dengan dukungan Range, dan `GET /api/clips/:id/download` yang mengisi `downloaded_at`
- [x] Path file selalu dibentuk dari id di database, tidak pernah dari input pengguna

**Deploy**

- [ ] Redis dan Postgres sebagai Database di Dokploy
- [ ] Volume `clips-data` di-mount ke API dan worker
- [ ] Deploy `clipper-api` dan `clipper-worker` dari repo GitHub; Dockerfile API dan web memakai turbo prune --docker agar image hanya berisi package yang dibutuhkan

**Gate 2:** job lewat API selesai sampai file ada di disk VM.

## Fase 2 — Web MVP

Hasil akhirnya: seluruh alur P0 bisa dijalankan dari browser di `clipper.rencraft.site`.

**Auth (API)**

- [ ] `POST /api/auth/login`: cek username dan hash password (argon2) dari env, set JWT di cookie httpOnly + Secure + SameSite
- [ ] Guard JWT global; hanya login yang terbuka
- [ ] Rate limit login dengan `@nestjs/throttler`

**Web**

- [ ] Setup TanStack Start (file-based routing) + TanStack Query; data diambil dari NestJS lewat /api
- [ ] Halaman login
- [ ] Halaman buat job: URL, mode, parameter, timestamp manual, pengingat soal hak cipta
- [ ] Daftar job dengan status live lewat `EventSource`
- [ ] Detail job: player 9:16 dari endpoint stream, tombol download, salin judul
- [ ] Tampilan error yang jelas untuk job gagal

**Retensi file**

- [ ] Job terjadwal `cleanup` di BullMQ: hapus file yang sudah didownload lewat masa tenggang, atau lewat `CLIP_TTL_HOURS`, lalu isi `deleted_at`
- [ ] Galeri menandai clip yang filenya sudah dihapus

**Deploy**

- [ ] Deploy `clipper-web`; di Dokploy, domain `clipper.rencraft.site` path `/api` ke API dan sisanya ke web, supaya cookie tetap same-origin
- [ ] Rute `clipper.rencraft.site` di Cloudflare Tunnel

**Gate 3 (MVP siap):** semua fitur P0 jalan dari browser.

## Fase 3 — Fitur P1 dan auto-posting

Fitur P1 kecil dan mandiri; auto-posting paling banyak bergantung pada pihak luar, jadi riset izinnya dimulai lebih awal.

**Fitur P1**

- [ ] Retry job gagal dengan parameter yang sama
- [ ] Ubah timestamp satu clip: job jenis `rerender` yang hanya merender clip itu
- [ ] Hapus job beserta folder file-nya

**Auto-posting**

- [ ] Riset syarat terbaru TikTok Content Posting API dan Instagram Graph API (akun, app review, batas posting). Mulai sejak Fase 2 karena proses review bisa lama
- [ ] Hubungkan akun lewat OAuth; simpan token terenkripsi di Postgres
- [ ] Instagram mengambil video dari URL publik: buat link file publik yang bertanda tangan dan cepat kedaluwarsa lewat tunnel
- [ ] Antrean terpisah `publish` dengan status posting per clip
- [ ] Form caption dan pilihan platform di halaman detail job

## Konfigurasi Dokploy

Tiga Application dan dua Database, dengan satu volume yang dipakai bersama API dan worker.

| Service | Build | Volume | Domain | Resource |
| --- | --- | --- | --- | --- |
| `clipper-api` | Dockerfile `apps/api` | `clips-data` → `/data/clips` | `clipper.rencraft.site`, path `/api` | Default |
| `clipper-web` | Dockerfile `apps/web` (server Node TanStack Start) | — | `clipper.rencraft.site` | Default |
| `clipper-worker` | Dockerfile `worker` | `clips-data` → `/data/clips`, `whisper-cache` → `/root/.cache/huggingface` | Tanpa domain | Memory limit dari hasil Fase 0 |
| Redis | Database bawaan Dokploy | Bawaan | Internal | Persistence aktif |
| Postgres | Database bawaan Dokploy | Bawaan | Internal | Backup terjadwal |

**Environment variable**

| Variabel | Dipakai oleh | Isi |
| --- | --- | --- |
| `DATABASE_URL` | API | Connection string Postgres internal Dokploy |
| `REDIS_URL` | API, worker | Connection string Redis internal Dokploy |
| `CLIPS_DIR` | API, worker | `/data/clips` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | API | Akun pemilik; hash argon2, bukan password asli |
| `JWT_SECRET` | API | String acak panjang |
| `CLIP_TTL_HOURS`, `DOWNLOAD_GRACE_MINUTES` | API | Batas umur clip dan masa tenggang setelah download |
| `LLM_BASE_URL, LLM_API_KEY`, `LLM_MODEL` | Worker | Endpoint OpenAI-compatible, API key (mis. dari OpenCode Go), dan nama model |
| `WHISPER_MODEL` | Worker | `small` |
| `MIN_FREE_GB` | Worker | Ambang ruang disk minimum dari hasil Fase 0 |

## Testing dan definisi selesai

Sebuah gate dianggap lolos bila tesnya hijau dan uji manual di VM berhasil.

| Gate | Tes otomatis | Uji manual di VM |
| --- | --- | --- |
| Gate 1 | `pytest` untuk fungsi pipeline | 1 video berbahasa Indonesia jadi 3 clip; dicek di HP |
| Gate 2 | Test e2e API dengan database test; worker diuji dengan video pendek | Job dibuat lewat `curl`, file muncul di volume, status `done` di database |
| Gate 3 | Test auth dan guard; build web tanpa error | Login, buat job, pantau progress, preview, download dari HP lewat domain publik; file terhapus otomatis sesuai TTL |
