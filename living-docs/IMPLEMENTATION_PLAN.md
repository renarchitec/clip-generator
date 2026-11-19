# Rencana implementasi & Arsitektur Sistem

## Ringkasan arsitektur

Platform dibangun dalam monorepo yang memisahkan aplikasi API, web front-end, paket tipe bersama, dan worker pemrosesan video di latar belakang.

| Lapisan | Pilihan | Alasan |
| --- | --- | --- |
| Repo | Monorepo Turborepo + pnpm workspaces; folder Python terpisah | Satu repositori untuk API, web, paket tipe `@clipper/shared`, dan worker Python |
| API | NestJS 11 + Prisma ORM + BullMQ | Framework TypeScript terstruktur, validasi DTO via `class-validator` / `zod`, dan listener event antrean |
| Web | TanStack Start + TanStack Query + shadcn/ui + Tailwind v4 | SSR + SPA type-safe, styling atomic responsif, caching query, i18n (EN/ID), serta dark/light theme |
| Web Server | srvx production server | Server runtime produksi performan untuk TanStack Start SSR |
| Worker | Python 3.12 + BullMQ (`bullmq` Python) + asyncio | Menjalankan pipeline video berat secara asynchronous tanpa memblokir event loop |
| Antrean | Redis di Dokploy | Broker antrean BullMQ (`clip-jobs` dan `previews`), penyimpanan sinyal pembatalan, dan heartbeat status LLM |
| Database | PostgreSQL di Dokploy | Penyimpanan relasional pengguna, sesi, metadata job, dan klip |
| Penyimpanan | Docker volume `clips-data` (`/data/clips`) | Di-mounted bersama ke API dan worker pada direktori yang sama |
| Auth | Multi-user via database (`users` + `sessions`), scrypt, opaque session token | Keamanan cookie `clipper_session` (httpOnly, 30 hari), bearer token, isolasi per akun, klaim legacy jobs otomatis |

## Struktur repo

```text
clipper/
├─ apps/
│  ├─ api/                    # NestJS API
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma     # Skema database
│  │  │  └─ migrations/       # Riwayat migrasi SQL Prisma
│  │  ├─ docker-entrypoint.sh # Menjalankan prisma migrate deploy sebelum boot
│  │  ├─ Dockerfile
│  │  └─ src/
│  │     ├─ auth/             # scrypt hash, sessions DB, auth guard, cookie
│  │     ├─ jobs/             # CRUD job, cancel, DTO, snapshot, SSE stream
│  │     ├─ previews/         # pindai subtitle & LLM: POST /api/previews, GET /api/previews/:id
│  │     ├─ clips/            # stream Range, download, delete clip fisik + DB
│  │     ├─ system/           # status LLM worker dari Redis (GET /api/system/llm-status)
│  │     ├─ queue/            # BullMQ producer, listener QueueEvents, Redis
│  │     └─ config/           # validasi env (Zod)
│  └─ web/                    # TanStack Start + Vite
│     ├─ Dockerfile
│     └─ src/
│        ├─ routes/           # login, register, dashboard (/), job detail (/jobs/$jobId), reverse proxy (/api/$)
│        ├─ components/       # UI components (shadcn/ui), login-form, llm-status, chrome
│        └─ lib/              # auth helper, i18n (EN/ID), theme (dark/light/system), api client
├─ packages/
│  └─ shared/                 # Tipe TypeScript: JobData, JobProgress, JobResult, ReframeMode, PreviewJobData
├─ worker/                    # Python 3.12 pipeline
│  ├─ clipper/
│  │  ├─ pipeline.py          # Orkestrasi tahap: download, transcribe, select, render, save, run_preview
│  │  ├─ worker.py            # Consumer `clip-jobs` (concurrency 1) + `previews` (concurrency 2), heartbeat LLM
│  │  ├─ llm.py               # Pemanggilan OpenAI-compatible LLM & parsing momen
│  │  ├─ reframe.py           # face_tracking (MediaPipe), pan clamping & crop filters
│  │  ├─ subtitles.py         # Parser VTT, deduplikasi rolling, pembuat subtitle ASS karaoke
│  │  └─ models.py            # Definisi dataclass & konversi data job
│  ├─ tests/                  # Pytest unit & integration tests
│  ├─ requirements.txt
│  └─ Dockerfile              # ffmpeg, fonts-dejavu-core, mediapipe, opencv
├─ pnpm-workspace.yaml
├─ turbo.json
└─ README.md
```

Tipe di `packages/shared` adalah sumber kebenaran kontrak data antara API dan worker. `worker/clipper/models.py` mengimplementasikan struktur data yang identik.

## Database Schema & Migrations

Database dikelola melalui Prisma ORM dengan PostgreSQL. Migrasi dijalankan secara otomatis saat container API dimulai via `docker-entrypoint.sh` (`prisma migrate deploy`).

### Daftar Riwayat Migrasi (`apps/api/prisma/migrations`)

1. `20260101000000_init`: Pembuatan tabel dasar `jobs` (enum `JobMode`: auto, manual; enum `JobStatus`: queued, running, done, failed) dan tabel `clips`.
2. `20260102000000_add_job_cancelled`: Penambahan status `cancelled` pada enum `JobStatus`.
3. `20260103000000_add_users_sessions_job_ownership`: Pembuatan tabel `users`, tabel `sessions`, serta penambahan relasi kepemilikan `userId` pada tabel `jobs`.
4. `20260104000000_add_job_description`: Penambahan kolom teks `description` pada tabel `jobs` untuk arahan brief mode otomatis.
5. `20260105000000_add_job_reframe`: Penambahan kolom `reframe` pada tabel `jobs` (default `face_tracking`).
6. `20260106000000_add_job_captions`: Penambahan kolom boolean `captions` pada tabel `jobs` (default `true`).

## Pipeline Pemrosesan Worker

Worker berjalan sebagai proses mandiri dengan dua consumer BullMQ: `clip-jobs` (render, concurrency 1) dan `previews` (pratinjau momen, concurrency 2). Keduanya berbagi koneksi Redis dan heartbeat status LLM.

### 1. Pengecekan Awal
Worker memeriksa sisa ruang pada volume `CLIPS_DIR`. Jika kurang dari `MIN_FREE_GB` (default 5.0 GB), job langsung digagalkan sebelum mengunduh media.

### 2. Tahap Download (`download`)
- Memanggil `yt-dlp` untuk mengunduh video format MP4 terbaik (`bv*[ext=mp4]+ba[ext=mp4]/b[ext=mp4]/b`).
- Mengunduh trek subtitle asli YouTube (mengutamakan subtitle manual, fallback ke auto-subs) dalam format VTT.
- Jika subtitle YouTube tidak ditemukan sama sekali, job langsung digagalkan dengan error: `"Subtitle YouTube tidak tersedia untuk video ini."` (Whisper telah dihapus sepenuhnya dari worker).

### 3. Tahap Transkrip (`transcribe`)
- Men-decode file VTT menjadi daftar cue terstruktur.
- Menerapkan deduplikasi cue untuk auto-sub YouTube (*rolling captions*) di mana baris baru sering mengulang ekor baris sebelumnya.
- Menghasilkan token kata (*word-level timestamps*) baik dari tag inline VTT atau aproksimasi berbasis bobot karakter.

### 4. Tahap Pemilihan Momen (`select`)
- **Mode `manual`:** Menggunakan rentang timestamp `{start, end}` yang diberikan pengguna dan mencocokkan judul ringkas dari cue terdekat.
- **Mode `auto`:** Mengirimkan transkrip terstruktur, parameter (`clipCount`, `targetDurationSec`), dan instruksi `description` (brief konten) ke endpoint LLM OpenAI-compatible.
- Brief pengguna menjadi instruksi prioritas utama bagi LLM untuk memilih topik/bagian yang relevan.
- JSON dari respon LLM divalidasi ketat (dengan 1x retry jika respon rusak). Jika LLM tidak dikonfigurasi atau gagal memberikan momen valid, job langsung gagal (tanpa fallback berbasis aturan).

### 5. Tahap Rendering (`render`)
Masing-masing momen diproses secara berurutan. Di antara pemrosesan tiap klip, worker memeriksa apakah terdapat sinyal pembatalan (`should_cancel`).
- **Transformasi Reframe ke Potret 9:16 (1080x1920):**
  - `face_tracking`: Menjalankan deteksi wajah MediaPipe (`FaceDetection`, model selection 1) pada proxy video resolusi rendah (~360p, 5 fps). Hasil koordinat dihaluskan menggunakan Exponential Moving Average (EMA, `alpha=0.35`) dan pergerakan dibatasi (*pan clamp*, maks 0.15 lebar frame/detik). Jumlah titik sampel dibatasi maksimal 48 sampel pan agar ekspresi filter ffmpeg tetap efisien dan stabil.
  - `black_bars`: Skala video mempertahankan rasio asli dengan padding hitam di atas dan bawah.
  - `blurred_fill`: Membagi video menjadi dua layer; layer belakang diperbesar, dipotong, dan diburamkan (`boxblur`), layer depan diletakkan di tengah dengan rasio tajam.
- **Pembakaran Takarir ASS:**
  - Jika opsi `captions: true` dan terdapat teks subtitle pada durasi klip, dibuat file temporary `.ass` dengan gaya karaoke kata per kata (`{\k<durasi_cs>}`). Setiap event maksimal 5 kata / 26 karakter, event dipotong agar tidak tumpang tindih, margin aman bawah ≥18% tinggi frame dan samping 80px, teks putih tebal dengan outline hitam dan bayangan; kata aktif disorot kuning.
  - Jika `captions: false`, langkah pembakaran takarir dilewati.
- **Encoding Video:**
  - ffmpeg dipanggil menggunakan video codec `libx264` dengan pixel format standar `yuv420p` (menjamin kompatibilitas playback di Safari/iOS dan browser Android), audio `aac` 128k, preset `veryfast`, dan `movflags +faststart`.

### 6. Tahap Penyimpanan (`save`)
- File klip disimpan di direktori `CLIPS_DIR/<job_id>/clip-01.mp4`, `clip-02.mp4`, dst.
- Direktori kerja sementara (`temp_root/clip-<job_id>-*`) selalu dibersihkan di blok `finally`.

### 7. Pembatalan Job & Penghapusan Klip
- **Pembatalan (`POST /api/jobs/:id/cancel`):** Menyetel key `cancel:<job_id>` di Redis (TTL 24 jam) dan mencabut job dari status antrean BullMQ jika belum berjalan. Jika worker sedang memproses, worker akan menghentikan render di batas antar klip, melempar exception `JobCancelled`, membersihkan file temporary, dan status job tercatat `cancelled`.
- **Penghapusan Klip (`DELETE /api/clips/:id`):** Endpoint API langsung menghapus file fisik di filesystem (mengabaikan `ENOENT` jika sudah terhapus) dan menghapus baris dari tabel `clips` di PostgreSQL.
- **Penghapusan Job (`DELETE /api/jobs/:id`):** `JobsService.remove` memverifikasi kepemilikan via `findOne(id, userId)` (404 bila bukan milik user). Bila status job masih `queued`/`running`, endpoint menyetel key `cancel:<job_id>` di Redis (TTL 24 jam) dan mencabut job BullMQ bila masih `waiting`/`delayed`/`prioritized`. Setelah itu semua path klip di-resolve lewat `resolveClipPath(clipsDir, filePath)` (menolak path traversal) dan file fisiknya di-`unlink` (ENOENT diabaikan; error lain membatalkan operasi). Baris job lalu dihapus dengan `prisma.job.delete({ where: { id } })`; baris `clips` terhapus otomatis via FK `onDelete: Cascade`. Subscription SSE (`jobEvents.close(id)`) ditutup dan endpoint mengembalikan HTTP 204.

## Pratinjau Momen (Review Moments)

Fitur "tinjau momen sebelum memotong" memungkinkan pengguna memindai URL terlebih dahulu, melihat kandidat momen LLM dan transkrip penuh, lalu membuat job manual normal. Mode otomatis langsung dan mode manual yang sudah ada tidak berubah.

- **Endpoint:**
  - `POST /api/previews` (auth, sesi) — body `{ url, description? (maks 500), clipCount? (1–10, default 5), targetDurationSec? (15–180, default 45) }`. URL divalidasi dengan allowlist yang sama seperti job (`apps/api/src/jobs/validation.ts`). Respons `201 { id }`.
  - `GET /api/previews/:id` (auth, hanya pemilik) — `{ id, url, status: queued|running|done|failed, error: string|null, candidates: {start,end,title,reason}[]|null, cues: {start,end,text}[]|null }`. Mengembalikan 404 bila job tidak ada, sudah kedaluwarsa, atau milik pengguna lain.
- **Penyimpanan:** Tanpa tabel/migrasi baru. `userId`, URL, dan parameter disimpan di data job BullMQ pada antrean `previews`. Job yang selesai/gagal dipertahankan 1 jam (`removeOnComplete`/`removeOnFail` `age: 3600`), lalu dihapus Redis. Endpoint GET membaca state, `returnvalue`, dan `failedReason` langsung dari BullMQ.
- **Worker:** Consumer `previews` terpisah di proses Python yang sama (concurrency 2, tidak menunggu render). Handler hanya memanggil `_fetch_subtitles` (`yt-dlp --skip-download`), `_read_vtt` untuk cue terdeduplikasi, lalu `llm.select_moments` dengan brief yang sama seperti mode auto. Kandidat melewati validasi/clamp yang sama (`validate_moments`). Subtitle tidak tersedia → gagal dengan pesan `"Subtitle YouTube tidak tersedia untuk video ini."`; LLM tidak dikonfigurasi/gagal → gagal dengan pesan jelas. Worker mengembalikan `{candidates, cues}` sebagai return value job.
- **Transkrip:** `cues` berisi baris cue (bukan kata) `{start, end, text}` hasil deduplikasi rolling auto-sub.

## Autentikasi dan Otorisasi

- **Multi-user:** Menggunakan tabel `users` dan `sessions`.
- **Registrasi Akun:**
  - Registrasi terbuka untuk pendaftar pertama (`/api/auth/register`).
  - Pengguna pertama yang mendaftar secara otomatis mengklaim semua job legacy yang sebelumnya belum memiliki pemilik (`userId: null`).
  - Setelah pengguna pertama terdaftar, pendaftaran baru otomatis terkunci (403 Forbidden) kecuali variabel lingkungan `ALLOW_REGISTRATION=true` diaktifkan.
- **Keamanan Password:** Menggunakan algoritma hash bawaan Node.js `scrypt` dengan salt acak 16 byte (`<salt_hex>:<hash_hex>`).
- **Manajemen Sesi:**
  - Token sesi dibuat dari 32-byte nilai acak berkode `base64url`.
  - Nilai hash SHA-256 dari token disimpan di tabel `sessions`.
  - Token dikirimkan ke klien melalui cookie httpOnly `clipper_session` (masa berlaku 30 hari, `SameSite=Lax`, flag `Secure` aktif di production) atau dapat dikirim melalui header `Authorization: Bearer <token>`.
  - Guard global `AuthGuard` memeriksa validitas sesi pada setiap rute kecuali yang ditandai decorator `@Public()`.
- **Isolasi Data:** Setiap operasi membaca, streaming, download, membatalkan, atau menghapus job/klip memverifikasi bahwa entitas tersebut terhubung dengan `userId` sesi aktif. Permintaan ke job/klip milik orang lain menghasilkan respons 404 Not Found.

## Aplikasi Web Front-end

Aplikasi web berada di `apps/web`:
- **Framework:** TanStack Start (SSR dan file-based routing) + TanStack Query untuk state manajemen server.
- **Komponen UI:** Komponen modular shadcn/ui berbasis Radix UI, ikon Lucide, dan utility `tw-animate-css`.
- **Tailwind CSS v4:** Styling modern menggunakan engine Tailwind v4.
- **Server Produksi:** Dijalankan menggunakan runtime `srvx` (`srvx --prod -s ../client dist/server/server.js`).
- **Internal Reverse Proxy:** Route `/api/$` mem-proxy semua permintaan HTTP dari klien browser ke endpoint NestJS via `API_INTERNAL_URL` (default `http://localhost:3000`). Pendekatan ini membuat cookie autentikasi tetap *same-origin* tanpa kendala CORS.
- **Internasionalisasi (i18n):** Mendukung Bahasa Inggris (EN, default) dan Bahasa Indonesia (ID), disimpan di cookie `clipper_language`.
- **Tema:** Mendukung tema `light`, `dark`, dan `system`, disimpan di cookie `clipper_theme`.
- **Halaman & Rute Utama:**
  - `/login`: Masuk dengan email & password, mengarahkan ke dashboard.
  - `/register`: Pendaftaran akun (hanya aktif jika belum ada user atau `ALLOW_REGISTRATION=true`).
  - `/`: Dashboard utama. Memuat kartu pembuatan klip (URL sumber, mode switch, pilihan reframe, toggle captions, jumlah & durasi klip, arahan brief opsional atau rentang timestamp manual), kartu indikator status LLM, serta daftar riwayat job pengguna. Mendukung parameter pencarian `/?from=<jobId>` untuk prefill pembuatan job ulang (*regenerate*).
  - `/jobs/$jobId`: Tampilan detail progres job via SSE, tombol pembatalan, pemutar video klip 9:16 vertikal, tombol salin judul, tombol download klip, tombol buat ulang (*regenerate*), dan tombol dialog konfirmasi hapus klip.

## Keteramatan Status LLM

Worker Python memantau konfigurasi LLM dan mengeksekusi loop berkala:
- Setiap 30 detik (dan setiap kali panggilan inferensi selesai), worker menulis payload status ke Redis key `worker:status:llm` dengan TTL 90 detik.
- Payload mencakup: `configured` (apakah variabel env lengkap), `model` (nama model LLM yang digunakan), `lastCall` (`{ok, at, error}`), dan `updatedAt`.
- API menyediakan endpoint `GET /api/system/llm-status`.
- Front-end menampilkan badge status real-time di antarmuka (LLM siap, model yang aktif, atau peringatan bila worker offline / pemanggilan gagal).

## Konfigurasi Deployment Dokploy

Seluruh aplikasi di-deploy pada VPS tunggal di bawah project Dokploy `clipper`.

| Service | Tipe | Image / Build | Volume Mount | Domain / Routing | Catatan |
| --- | --- | --- | --- | --- | --- |
| `clipper-api` | Application | Dockerfile `apps/api` | `clips-data` → `/data/clips` | `https://api-clipper.rencraft.site` | Menjalankan `prisma migrate deploy` saat boot |
| `clipper-web` | Application | Dockerfile `apps/web` | — | `https://clipper.rencraft.site` | Server srvx TanStack Start, reverse proxy `/api/*` |
| `clipper-worker` | Application | Dockerfile `worker` | `clips-data` → `/data/clips` | Tanpa domain eksternal | Python 3.12, mediapipe, ffmpeg; render concurrency 1, preview concurrency 2 |
| Postgres | Database | PostgreSQL Dokploy | Volume internal | Internal | Database relasional untuk API |
| Redis | Database | Redis Dokploy | Volume internal | Internal | Broker BullMQ (`clip-jobs`, `previews`), cancel keys, LLM heartbeat |

Akses jaringan publik dilindungi menggunakan **Cloudflare Tunnel** yang mengarahkan domain publik ke port internal container di server.

### Variabel Lingkungan

| Variabel | Digunakan Oleh | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | API | Connection string PostgreSQL Dokploy internal |
| `REDIS_URL` | API, worker | Connection string Redis Dokploy internal |
| `CLIPS_DIR` | API, worker | Lokasi mount volume bersama (`/data/clips`) |
| `PORT` | API, web | Port listener HTTP (default 3000) |
| `ALLOW_REGISTRATION` | API | Boolean (`true`/`false`), membuka pendaftaran pengguna tambahan |
| `API_INTERNAL_URL` | Web | URL upstream API untuk reverse proxy server (mis. `http://clipper-api:3000`) |
| `LLM_BASE_URL` | Worker | URL endpoint OpenAI-compatible (mis. OpenRouter / OpenCode Go) |
| `LLM_API_KEY` | Worker | Kunci API untuk otentikasi LLM |
| `LLM_MODEL` | Worker | Nama model LLM yang digunakan untuk pemilihan momen |
| `MIN_FREE_GB` | Worker | Ambang batas ruang disk minimum (default `5.0`) |
| `LOG_LEVEL` | Worker | Tingkat logging (`INFO`, `DEBUG`, dsb.) |

## Testing

- **Worker (Python):** Unit tests pytest untuk `parse_vtt` / deduplikasi rolling, `write_ass` (ASS karaoke), face tracking & pan clamp (`reframe`), parser JSON jawaban LLM, dan pembatalan job (`worker/tests/`).
- **API (Node):** Contract spec via `node --experimental-strip-types` untuk validasi DTO cancel, description, reframe, captions, preview momen, penghapusan klip, dan kriptografi scrypt (`apps/api/src/**/*.spec.ts`, dijalankan lewat `pnpm --filter api test`).
- **Verifikasi pipeline tanpa Redis:** `python -m clipper.selftest --url <url> --mode <auto|manual> [--ranges 12-40,90-130]` menjalankan pipeline penuh secara lokal (tanpa antrean) untuk uji cepat.
