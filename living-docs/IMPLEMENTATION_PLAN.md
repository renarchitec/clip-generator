# Rencana implementasi & Arsitektur Sistem

## Ringkasan arsitektur

Platform dibangun dalam monorepo yang memisahkan aplikasi API, web front-end, paket tipe bersama, dan worker pemrosesan video di latar belakang.

| Lapisan | Pilihan | Alasan |
| --- | --- | --- |
| Repo | Monorepo Turborepo + pnpm workspaces + Cargo workspace | API, Web, `@clipper/shared`, dan worker dalam satu repositori |
| API | NestJS 11 + Prisma ORM + BullMQ | Framework TypeScript terstruktur, validasi DTO via `class-validator` / `zod`, dan listener event antrean |
| Web | TanStack Start + TanStack Query + shadcn/ui + Tailwind v4 | SSR + SPA type-safe, styling atomic responsif, caching query, i18n (EN/ID), serta dark/light theme |
| Web Server | srvx production server | Server runtime produksi performan untuk TanStack Start SSR |
| Worker | Rust (`dartclip-worker`) + bridge Node.js BullMQ | Menjalankan job render, preview, frame, caption, dan brief; Split Screen dan media lokal memerlukan worker Rust |
| Antrean | Redis di Dokploy | Broker BullMQ (`clip-jobs`, `previews`, `clip-frames`, `captions`, `publish`), sinyal pembatalan, dan heartbeat LLM |
| Database | PostgreSQL di Dokploy | Penyimpanan relasional pengguna, sesi, metadata job, klip, dan unggahan |
| Penyimpanan | Bind mount host `/srv/storage/clips` → `/data/clips` | Disk tambahan VPS, di-mount bersama ke API dan worker pada direktori yang sama |
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
│  │     ├─ jobs/             # CRUD job, cancel, retry, DTO, snapshot, SSE stream
│  │     ├─ previews/         # transkrip, kandidat LLM, dan storyboard B-roll
│  │     ├─ frames/           # pratinjau frame render
│  │     ├─ media/            # pustaka unggahan dan resolusi sumber milik pengguna
│  │     ├─ clips/            # stream Range, download, delete clip fisik + DB
│  │     ├─ social/           # akun sosial, OAuth YouTube, enkripsi token, fondasi publikasi
│  │     ├─ publish/          # publikasi sosial: endpoint, penjadwalan, antrean `publish`, uploader
│  │     ├─ system/           # status LLM worker dari Redis (GET /api/system/llm-status)
│  │     ├─ queue/            # BullMQ producer, listener QueueEvents, Redis
│  │     └─ config/           # validasi env (Zod)
│  └─ web/                    # TanStack Start + Vite
│     ├─ Dockerfile
│     └─ src/
│        ├─ routes/           # login, register, dashboard (/), job index (/jobs/), job detail (/jobs/$jobId), clips (/clips), settings (/settings: akun sosial terhubung), reverse proxy (/api/$)
│        ├─ components/       # UI components (shadcn/ui), login-form, llm-status, chrome
│        └─ lib/              # auth helper, i18n (EN/ID), theme (dark/light/system), api client, formatting helpers
├─ packages/shared/src/index.ts # Kontrak TypeScript API, Web, dan payload worker
├─ rust/crates/
│  ├─ dartclip-core/src/      # models.rs, pipeline.rs, split_screen.rs, llm.rs, stt.rs, subtitles.rs
│  ├─ dartclip-face/          # deteksi wajah (YuNet)
│  └─ dartclip-worker/        # CLI pemrosesan, input JSON / output JSONL
├─ worker-rust/               # Dockerfile dan bridge.mjs (BullMQ → CLI Rust)
├─ worker/                    # Worker Python; tidak mengimplementasikan Split Screen/media lokal
├─ pnpm-workspace.yaml
├─ turbo.json
└─ README.md
```

Tipe di `packages/shared/src/index.ts` mendefinisikan kontrak data. `rust/crates/dartclip-core/src/models.rs` mendeserialisasi payload Rust.

## Database Schema & Migrations

Database dikelola melalui Prisma ORM dengan PostgreSQL. Migrasi dijalankan secara otomatis saat container API dimulai via `docker-entrypoint.sh` (`prisma migrate deploy`).

### Daftar Riwayat Migrasi (`apps/api/prisma/migrations`)

1. `20260101000000_init`: Pembuatan tabel dasar `jobs` (enum `JobMode`: auto, manual; enum `JobStatus`: queued, running, done, failed) dan tabel `clips`.
2. `20260102000000_add_job_cancelled`: Penambahan status `cancelled` pada enum `JobStatus`.
3. `20260103000000_add_users_sessions_job_ownership`: Pembuatan tabel `users`, tabel `sessions`, serta penambahan relasi kepemilikan `userId` pada tabel `jobs`.
4. `20260104000000_add_job_description`: Penambahan kolom teks `description` pada tabel `jobs` untuk arahan brief mode otomatis.
5. `20260105000000_add_job_reframe`: Penambahan kolom `reframe` pada tabel `jobs` (default `face_tracking`).
6. `20260106000000_add_job_captions`: Penambahan kolom boolean `captions` pada tabel `jobs` (default `true`).
7. `20260107000000_add_job_two_speakers`: Penambahan kolom boolean `twoSpeakers` pada tabel `jobs` (default `false`).
8. `20260110000000_add_job_aspect_ratio`: Penambahan kolom string `aspectRatio` pada tabel `jobs` (default `'9:16'`; nilai sah: `9:16` / `1:1` / `16:9`, divalidasi `@IsIn(ASPECT_RATIOS)` di DTO, parse toleran di worker: tidak dikenal/hilang -> `9:16`).
9. `20260111000000_add_job_max_source_sec`: Penambahan kolom `maxSourceSec` `INTEGER` nullable pada tabel `jobs` (batas pemindaian sumber 60–36000 detik; NULL = durasi penuh; divalidasi `@IsInt @Min(60) @Max(36000)` di DTO, parse toleran di worker: invalid/di luar rentang -> `None`).
10. `20260120000000_add_job_facecam`: Penambahan kolom boolean `facecam` pada tabel `jobs` (default `false`; API menormalkan ke `false` bila `aspectRatio` bukan `9:16` atau `twoSpeakers` aktif).
11. `20260122000000_add_social_publishing`: Penambahan `caption` dan `hashtags` pada `clips`, enum `SocialPlatform`/`PublicationStatus`, tabel `social_accounts` untuk token terenkripsi per pengguna, serta tabel `publications` sebagai fondasi status unggah Fase 2.
12. `20260123000000_publication_youtube_fields`: Penambahan `title` (default `''`), `madeForKids` (default `false`), `progress` (persen unggah, default 0), dan `publishedAt` pada `publications`, serta indeks `status` untuk pemulihan saat boot.
13. `20260124000000_caption_language`: Penambahan kolom `captionLanguage` `TEXT NOT NULL DEFAULT 'auto'` pada `jobs` (nilai sah `auto` / `id` / `en`, divalidasi `@IsIn(CAPTION_LANGUAGES)` di DTO, parse toleran di worker: tidak dikenal/hilang -> `auto`) dan kolom `transcript` `TEXT` nullable pada `clips` (cuplikan transkrip klip ≤ 2.000 karakter untuk regenerasi caption; NULL untuk klip lama).
14. `20260130000000_custom_hashtags`: Penambahan kolom `customHashtags` `TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` pada `jobs` (hashtag kustom per job, maks 15 tag × 50 karakter; bila tidak kosong di-inject ke `clip.hashtags` dan LLM tidak membuat hashtag otomatis).

15. `20260203000000_hook_banner_viral_score`: Kolom `jobs.hookBanner` (`BOOLEAN NOT NULL DEFAULT false`), `jobs.normalizeAudio` (`BOOLEAN NOT NULL DEFAULT true`), `clips.viralScore` (`INTEGER` nullable), dan `clips.hookText` (`TEXT` nullable).

16. `20261128000000_split_screen_media`: Kolom JSONB nullable `Job.primarySource` dan `Job.splitScreen` pada tabel `jobs`, serta model `MediaAsset` (`media_assets`) di `apps/api/prisma/schema.prisma`. Aset menyimpan `id`, `userId` (FK cascade), `name`, `filePath` relatif, `mimeType`, `durationSec`, `width`, `height`, `sizeBytes`, `createdAt`; indeks `(userId, createdAt)`.

### Kontrak sumber media & Split Screen

- **`PrimaryMediaSource`**: `kind` (`url`, `upload`, `clip`), dengan `url`, `mediaId`, atau `clipId` sesuai jenis. API mengisi `filePath` relatif untuk sumber lokal, beserta label dan durasi. Untuk URL, `Job.url` tetap URL tervalidasi dan `primarySource` bernilai `null`; sumber lokal memakai `media://<id>` atau `clip://<id>` sebagai `Job.url`.
- **`MediaAssetResponse`**: `{ id, name, mimeType, durationSec, width, height, sizeBytes, createdAt }`, tanpa path disk. `createdAt` dalam ISO.
- **`SplitScreenConfig`**: `{ enabled, ratio, swap, primaryFit, secondaryFit, secondaryVolume, matchMode, clips }`. Rasio atas:bawah `50:50`, `40:60`, `60:40`; fit `cover` atau `contain_blur`; volume B-roll dinormalisasi ke `0..1` (default UI `0`); `matchMode` = `auto` atau `sequential`. Split aktif hanya untuk `9:16` tanpa Two Speakers atau Facecam (konflik → 400); nonaktif disimpan sebagai `null`.
- **`SplitScreenClipSource`**: 1–10 entri dengan ID B-roll unik, sumber `url`/`upload`/`clip`, label, deskripsi opsional, dan trim `startSec`/`endSec` opsional. Jika keduanya diberikan, `endSec` harus lebih besar dari `startSec`. Untuk klip DartClip, deskripsi kosong dapat diisi dari transkrip atau caption klip.
- **`SplitScreenSegment`**: `{ atStart, atEnd, clipId, sourceStartSec?, reason? }`, dengan waktu relatif terhadap awal hasil klip; `clipId` menunjuk ID B-roll, dan `sourceStartSec` adalah offset pada sumber B-roll setelah trim. Preview mengembalikan `candidates[].splitTimeline` bila Split Screen aktif; edit dikirim lewat `ranges[].splitTimeline` pada job manual.

### API pustaka media

| Endpoint | Respons / perilaku |
| --- | --- |
| `GET /api/media` | Daftar `MediaAssetResponse[]` milik pengguna, terbaru dulu |
| `POST /api/media` | Multipart `file` (satu video) dan `name` opsional; HTTP 201 `MediaAssetResponse` |
| `GET /api/media/:id/file` | Streaming dengan MIME aset dan HTTP byte-range |
| `DELETE /api/media/:id` | HTTP 204; hapus baris aset dan coba hapus file fisik |

`apps/api/src/media/` memakai Multer `diskStorage` di `CLIPS_DIR/.tmp-uploads`. `ffprobe` (dari paket `ffmpeg` di `apps/api/Dockerfile`) memvalidasi kontainer MP4/MOV/WebM, stream video, dimensi, dan durasi. Batasnya 100 MiB (104.857.600 byte), 3.600 detik/file, dan 50 aset/pengguna; cek kuota akhir diserialkan dengan lock baris pengguna. File valid dipindah ke `CLIPS_DIR/media/<userId>/<id>.<ext>`.

`POST /api/jobs`, `POST /api/previews`, dan `POST /api/frames` memakai `MediaResolverService` untuk memvalidasi URL HTTP(S) YouTube/TikTok/Instagram dan memastikan aset/klip milik pengguna sesi aktif (klip harus belum dihapus; tidak ditemukan/bukan milik pengguna → 404). API mengisi path dari database sebelum mengantrekan job; klien tidak menentukan path disk. Retry memvalidasi ulang sumber dan meneruskan Split Screen serta rentang lama. Endpoint media juga membatasi akses ke pemilik.

### Kontrak API kualitas klip

- `POST /api/jobs` menerima boolean opsional `hookBanner` dan `normalizeAudio`, serta `ranges[].hookText` opsional (maks. 80 karakter). API menyimpan nilai yang dinormalisasi dan meneruskannya ke payload BullMQ `clip-jobs`; retry menyalin opsi dan rentang asli.
- `CaptionStyle.animate` memakai nilai boolean eksplisit atau default preset (`true` untuk `hook` dan `beast`, `false` untuk `boxed`, `neon`, dan `cinema`). Perbedaan animasi ikut menentukan preset `custom`. `POST /api/frames` tetap menerima `hookBanner` opsional untuk kompatibilitas (default `false`), tetapi Web tidak mengirimkannya karena kartu intro tidak mengubah frame klip.
- `ClipResult` dapat memuat `viralScore` dan `hookText`. Listener menyimpan keduanya dari progress dan completion: skor finite dibulatkan dan dibatasi ke 0–100, teks di-trim dan dipotong hingga 80 karakter; nilai yang tidak valid menjadi `NULL`. Detail job, snapshot SSE, dan klip terbaru menyertakan metadata klip ini. Daftar/detail job dan SSE menyertakan kedua opsi boolean job.

## Pipeline Pemrosesan Worker

`worker-rust/bridge.mjs` menghubungkan `clip-jobs` (concurrency 1), `previews` (2), `captions` (2, termasuk brief), dan `clip-frames` (`FRAME_CONCURRENCY`, default 1) ke CLI Rust. Pipeline render berada di `rust/crates/dartclip-core/src/pipeline.rs`.

### 1. Pengecekan Awal

Worker memeriksa sisa ruang pada `CLIPS_DIR` (`MIN_FREE_GB`, default 5 GB).

### 2. Sumber Media (`download`)

- **URL:** `yt-dlp` mengambil sumber. Untuk auto berlimit, worker mencoba section `0–maxSourceSec`; untuk manual, satu section per rentang. Bila section tidak dapat dipakai, worker dapat memakai unduhan penuh. Saat render section manual, seek memakai waktu relatif dalam file, sedangkan cue dan hasil memakai waktu sumber.
- **Unggahan/klip:** worker membuka file dari volume bersama tanpa unduh; `split_screen.rs` mengkanonikalkan path dan menolak file di luar `CLIPS_DIR`.
- **Video B:** `split_screen.rs` mengunduh klip URL atau membuka file lokal, membaca durasi dengan `ffprobe`, dan menerapkan trim opsional. Auto-match dapat mendeskripsikan B-roll berlabel generik tanpa deskripsi dengan Vision AI: ambil hingga tiga frame (20%, 50%, 80% durasi) dan kirim ke model `LLM_VISION_MODEL` (default `clipper-vision`) melalui `llm.rs`.

### 3. Transkrip (`transcribe`)

- **URL:** `transcriptSource` memilih `youtube`, `auto`, atau `live_chat_stt`; worker memakai subtitle atau STT sesuai jalur yang dipilih. Pembacaan subtitle merapikan cue rolling dan menghasilkan timing kata.
- **Unggahan/klip:** `stt.rs` memakai layanan STT kompatibel OpenAI (model utama default `groq/whisper-large-v3-turbo`). Auto dan preview mentranskripsi jendela sumber (dibatasi `maxSourceSec` bila ada) dan gagal bila tidak ada cue. Mode manual mentranskripsi rentang yang memerlukan takarir atau auto-match tanpa timeline yang sudah disediakan.

### 4. Pemilihan Momen (`select`)

- **Auto:** LLM memilih momen dari cue yang sudah dibatasi `maxSourceSec`, dengan brief opsional. Refinement `LLM_REFINE` (default aktif) dan snap deterministik `snap.rs` merapikan batas momen. Error pemilihan momen tidak digantikan oleh aturan heuristik.
- **Manual:** gunakan rentang pengguna tanpa refinement/snap; pertahankan `title`, `reason`, dan `hookText` jika disediakan. `maxSourceSec` tidak berlaku.
- **Timeline Split Screen:** timeline manual yang tidak kosong diprioritaskan. Jika tidak ada, `llm.rs::plan_split_screen_timeline` mencocokkan cue komentator pada momen dengan katalog B-roll. `normalize_split_timeline` menyaring ID/waktu tidak valid, membatasi offset, menghapus segmen <1,5 detik kecuali yang terpanjang, dan menutup celah dari awal hingga akhir. Mode `sequential`, AI yang tidak menghasilkan rencana, atau hasil normalisasi kosong memakai urutan katalog; klip dapat berulang agar durasi tercukupi.

### 5. Rendering (`render`)

- **Layout biasa:** `9:16` = 1080×1920, `1:1` = 1080×1080, dan `16:9` = 1920×1080. Untuk potret/persegi, reframe menawarkan `center_crop`, `face_tracking`, `black_bars`, dan `blurred_fill`. Pada 9:16 tersedia juga Two Speakers dan Facecam; `16:9` memakai skala pas/padding, tanpa reframe.
- **Split Screen:** `split_screen.rs` membuat `broll_track.mp4` dari segmen B-roll 30 fps, dengan fit panel, pengulangan/padding bila perlu, lalu concat. FFmpeg `vstack` menggabungkan Video A dan track B-roll; tinggi panel atas 960/768/1152 px untuk `50:50`/`40:60`/`60:40`, dengan `swap` menukar isi tanpa memindahkan sambungan. `amix` mencampur audio jika Video A punya audio dan volume B-roll > 0,001; segmen B-roll tanpa audio diberi hening saat menyiapkan track audio. Normalisasi opsional diterapkan setelah pencampuran. Input B-roll memakai indeks `1`, sehingga indeks awal watermark bergeser dari `1` ke `2`.
- **Takarir:** ASS dibakar pada hasil komposit bila aktif dan cue tersedia; Split Screen menempatkannya pada sambungan kecuali ada `captionStyle.positionY` eksplisit. Pratinjau frame memakai B-roll pertama dari awal setelah trim, tanpa perencanaan AI/timeline.
- **Hook dan outro:** `hookBanner` dapat memakai cover komposit dari Video A dan segmen B-roll pertama (fallback: frame sumber utama), dengan teks hook atau judul momen. Intro 0,9 detik dipasang sebelum isi klip; outro tetap dapat disambungkan sesudahnya.

### 6. Penyimpanan (`save`)

File klip disimpan di `CLIPS_DIR/<job_id>/clip-01.mp4`, `clip-02.mp4`, dst. Direktori kerja Rust memakai `tempfile::TempDir` untuk pembersihan.

### 7. Pembatalan Job & Penghapusan Klip
- **Pembatalan (`POST /api/jobs/:id/cancel`):** API menyetel key `cancel:<job_id>` (TTL 24 jam) dan mencabut job yang belum berjalan dari antrean jika memungkinkan. Bridge memantau key untuk menghentikan proses Rust yang aktif.
- **Penghapusan Klip (`DELETE /api/clips/:id`):** Endpoint API langsung menghapus file fisik di filesystem (mengabaikan `ENOENT` jika sudah terhapus) dan menghapus baris dari tabel `clips` di PostgreSQL.
- **Penghapusan Job (`DELETE /api/jobs/:id`):** `JobsService.remove` memverifikasi kepemilikan via `findOne(id, userId)` (404 bila bukan milik user). Bila status job masih `queued`/`running`, endpoint menyetel key `cancel:<job_id>` di Redis (TTL 24 jam) dan mencabut job BullMQ bila masih `waiting`/`delayed`/`prioritized`. Setelah itu semua path klip di-resolve lewat `resolveClipPath(clipsDir, filePath)` (menolak path traversal) dan file fisiknya di-`unlink` (ENOENT diabaikan; error lain membatalkan operasi). Baris job lalu dihapus dengan `prisma.job.delete({ where: { id } })`; baris `clips` terhapus otomatis via FK `onDelete: Cascade`. Subscription SSE (`jobEvents.close(id)`) ditutup dan endpoint mengembalikan HTTP 204.
- **Pengulangan Job (`POST /api/jobs/:id/retry`):** `JobsService.retry` memeriksa kepemilikan (404) dan status `failed`/`cancelled` (selain itu 400). Sumber, Split Screen, dan rentang beserta timeline disalin bersama konfigurasi lama dan divalidasi ulang lewat `create`. Respons adalah snapshot job baru; job lama tetap utuh.

### 8. Sinkronisasi Status Job (Queue Listener & Pemulihan Basi)

`QueueListener` (`apps/api/src/queue/queue.listener.ts`) adalah satu-satunya penulis status job selain endpoint create. Setiap update menulis ke database lalu mem-publish snapshot SSE, jadi kolom DB dan SSE tidak pernah berbeda. Sumber event utama adalah `QueueEvents` BullMQ (`progress`, `completed`, `failed`).

Event BullMQ bisa hilang saat Redis/worker restart (job selesai di worker, tetapi API tidak pernah menerima `completed`; klip sudah tersimpan sementara status DB tetap `running`). Karena itu listener juga menjalankan **pemulihan status basi**:

- Berjalan sekali saat module init (setelah `waitUntilReady`) lalu tiap 60 detik (`setInterval`, di-`unref` dan dibersihkan saat shutdown).
- Query semua job DB berstatus `queued`/`running`, lalu bandingkan dengan state job BullMQ:
  - `completed` → jalankan logika `onCompleted` yang sama dengan `job.returnvalue`.
  - `failed` → jalankan `onFailed` dengan `failedReason`.
  - Job tidak ada di Redis dan `createdAt` lebih tua dari 1 jam → ditandai `failed` dengan pesan `"Job hilang dari antrean (worker/redis restart). Jalankan ulang."`; job yang lebih muda dibiarkan (race dengan `queue.add`).
- **Idempoten:** `onCompleted` tidak menduplikasi clip (createMany hanya bila job belum punya clip) dan memakai update bersyarat `status in (queued, running)` sehingga job `done`/`failed`/`cancelled` tidak pernah ditimpa; `fail` juga hanya mengubah job yang masih `queued`/`running`. Job `cancelled` tidak pernah disentuh oleh pemulihan maupun event terlambat.
- **Metadata sosial AI:** `caption` opsional dari hasil LLM worker di-trim dan dibatasi 2.200 karakter (kosong menjadi `null`). Setiap hashtag dibuang awalan `#`-nya, hanya huruf/angka Unicode dan underscore yang dipertahankan, lalu dideduplikasi dan dibatasi 15 item. Nilai yang sudah dinormalisasi disimpan bersama clip dan disertakan pada `GET /api/clips/recent`, detail job, serta snapshot SSE.

## Publikasi Sosial — Fase 1 (YouTube)

Fase 1 menyediakan koneksi akun dan model data publikasi; pengunggahan clip melalui tabel `publications` berada di Fase 2 (bagian berikut). YouTube, TikTok, dan Instagram tersedia bila kredensial provider dikonfigurasi. Semua rute berada di balik `AuthGuard` global dan akun dibatasi pada pengguna sesi aktif.

| Endpoint | Respons / perilaku |
| --- | --- |
| `GET /api/social/providers` | `[{ platform, configured, available }]`. YouTube dan TikTok `available=true`; TikTok `configured=true` bila `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, dan `SOCIAL_TOKEN_KEY` terisi. Instagram tetap `available=false, configured=false`. |
| `GET /api/social/accounts` | `[{ id, platform, displayName, avatarUrl, connectedAt, expiresAt, needsReconnect }]`; `needsReconnect=true` bila refresh token tidak ada dan access token sudah kedaluwarsa. Token terenkripsi tidak pernah dikembalikan. |
| `DELETE /api/social/accounts/:id` | HTTP 204; 404 bila akun bukan milik pengguna. YouTube direvokasi best-effort ke `https://oauth2.googleapis.com/revoke`, TikTok ke `https://open.tiktokapis.com/v2/oauth/revoke/`, lalu baris lokal dihapus. |
| `GET /api/social/youtube/connect` | HTTP 302 ke Google OAuth, atau ke `/settings?social_error=not_configured` bila konfigurasi belum lengkap. |
| `GET /api/social/youtube/callback?code&state` | Menukar code, membaca channel YouTube, meng-upsert akun, lalu HTTP 302 ke `/settings?connected=youtube`. Kegagalan dialihkan ke `/settings?social_error=<short_code>` tanpa token pada URL/log. |

| `GET /api/social/tiktok/connect` | HTTP 302 ke `https://www.tiktok.com/v2/auth/authorize/?client_key=...&scope=user.info.basic,video.upload,video.publish&response_type=code&redirect_uri=...&state=...` (tanpa PKCE; state tetap disimpan di Redis 10 menit). Belum dikonfigurasi → `/settings?social_error=not_configured`. |
| `GET /api/social/tiktok/callback?code&state` | State dikonsumsi atomik, token ditukar di `/v2/oauth/token/` (form-urlencoded), profil diambil dari `/v2/user/info/` (`open_id` sebagai externalId), refresh token hasil rotasi selalu disimpan. Sukses → `/settings?connected=tiktok`; galat → `/settings?social_error=<kode>`. |
| `GET /api/social/accounts/:id/tiktok/creator-info` | 200 `{ nickname, username, avatarUrl, privacyLevelOptions, commentDisabled, duetDisabled, stitchDisabled, maxVideoPostDurationSec }`; 404 bila akun bukan milik pengguna, 400 `platform_mismatch`, 409 `needs_reconnect`, 502 galat TikTok. |

**Alur OAuth TikTok:** redirect_uri = `${PUBLIC_WEB_URL}/api/social/tiktok/callback`; scope dipisah koma; token/refresh memakai `client_key`/`client_secret`; revoke memakai `/v2/oauth/revoke/`. Refresh token berotasi dan diserialkan per akun agar dua refresh bersamaan tidak saling menimpa.

**Alur OAuth YouTube:

1. API membuat `state` acak dan PKCE verifier/challenge S256. Payload `{userId, platform, codeVerifier}` disimpan pada Redis key `social:oauth:<state>` dengan TTL 600 detik. Koneksi memakai `redisConnection()` yang sama dengan BullMQ.
2. Redirect Google memakai scope `youtube.upload` dan `youtube.readonly`, `access_type=offline`, `prompt=consent`, serta `include_granted_scopes=true`. `redirect_uri` adalah `${PUBLIC_WEB_URL}/api/social/youtube/callback`; web meneruskan `/api/*` ke API same-origin.
3. Callback mengonsumsi state secara atomik (`GET` + `DEL`, sekali pakai), memeriksa `userId` dan platform, lalu menukar authorization code di `https://oauth2.googleapis.com/token`. Channel diambil dari `youtube/v3/channels?part=snippet&mine=true`.
4. Access/refresh token dienkripsi AES-256-GCM dengan format `v1:<iv>:<tag>:<ciphertext>` (komponen base64url) sebelum upsert. Refresh token lama dipertahankan bila Google tidak mengirim yang baru.
5. `SocialService.getValidAccessToken(accountId)` untuk Fase 2 me-refresh token yang kedaluwarsa dalam 60 detik dan menyimpan token baru. Provider diabstraksikan lewat `SocialProvider` agar Instagram/TikTok dapat ditambahkan tanpa mengubah kontrak akun.

## Publikasi Sosial — Fase 2 (Publish dan Penjadwalan)

Fase 2 mengunggah klip ke akun YouTube, TikTok, dan Instagram terhubung. Pemrosesan berlangsung di API lewat antrean BullMQ `publish` (`PUBLISH_QUEUE_NAME` di `queue.constants.ts` dan `packages/shared`). Semua rute berada di balik `AuthGuard` global; clip dan akun yang bukan milik pengguna menghasilkan 404.

| Endpoint | Respons / perilaku |
| --- | --- |
| `POST /api/clips/:id/publish` | `PublishRequest` berisi 1..5 target (akun unik), opsional `scheduledAt` ISO di tingkat permintaan maupun target. Jadwal target non-null menggantikan jadwal permintaan. Klip harus sudah dirender dan belum dihapus, tetapi job tidak harus `done`. Pasangan dengan publikasi aktif (`scheduled`/`queued`/`uploading`/`processing`) → 409 `publication_in_progress`. HTTP 201 `PublicationResponse[]`. |
| `GET /api/clips/:id/publications` | `PublicationResponse[]` milik clip, terbaru dulu. |
| `POST /api/publications/:id/retry` | Hanya `failed` atau `cancelled`; 409 bila ada publikasi aktif lain untuk klip+akun. Reset ke `queued` dan kosongkan jadwal, progres, error, ID/URL eksternal, serta waktu publikasi. Masukkan unggahan tanpa delay. |
| `POST /api/publications/:id/cancel` | HTTP 200 `PublicationResponse`; hanya `scheduled`/`queued`, lain → 400 `publication_not_cancellable`. Klaim status `cancelled` dengan `updateMany` bersyarat sebelum menghapus job BullMQ secara best-effort. |
| `POST /api/jobs/:id/schedule-publish` | HTTP 201 `{ scheduled, skipped }`; body `{ clipIds? (maks. 20), accountIds (1..5), startAt?, intervalHours (0.5..168), privacy?, madeForKids?, tiktokMode?, tiktok? }`. Hanya klip belum dihapus, urutan `clipIds` bila diberikan atau `viralScore DESC NULLS LAST, createdAt ASC`. Satu slot per klip, semua akunnya memakai slot sama. Lewati pasangan aktif atau `published` dengan alasan `already_published_or_scheduled`. YouTube default `private`; TikTok default `inbox`, opsi divalidasi untuk `direct`. |

Untuk TikTok, target dapat menambahkan `mode?: 'direct'|'inbox'` (default `direct`) dan `tiktok?: { privacyLevel, disableComment, disableDuet, disableStitch, brandContent, brandOrganic }`; caption maksimal 2200 UTF-16, title opsional, `privacy` boleh absen. Mode inbox mengabaikan opsi dan menyimpan `privacy = 'inbox'`; direct menyimpan privacy level dan opsi di `publications.options` (JSONB, migrasi `20260125000000_publication_tiktok`). Validasi server: privacy level harus masih ada di `creator_info` segar, durasi klip ≤ `maxVideoPostDurationSec`, dan `brandContent` tidak boleh dipasang dengan `SELF_ONLY`.

Tanggal awal ISO ditolak jika lebih dari 60 detik di masa lalu atau 90 hari di masa depan; sampai 15 detik ke depan dihitung langsung. Batch menghitung slot dari waktu awal + indeks × interval. Baris `scheduled` menyimpan `scheduledAt` dan job `upload` dijadwalkan lewat `delay` BullMQ. Batch memakai metadata `platformCaptions[platform]` bila tersedia, atau judul/caption/hashtag generik, serta menerapkan batas metadata masing-masing platform.

`PublicationResponse` dan `ClipPublicationSummary` di `packages/shared` mengembalikan `scheduledAt` sebagai ISO atau `null`. Klip terbaru, detail job, dan SSE tetap merangkum publikasi terbaru per akun. Migrasi `20260205000000_platform_captions_scheduled_publish` menambah nilai enum `scheduled`/`cancelled`, `clips.platformCaptions` (JSONB nullable), serta `publications.scheduledAt` (`TIMESTAMP(3)` nullable dengan indeks).

**Alur `PublishProcessor` (`@Processor('publish')`, concurrency 2):**

1. Job `upload` mengklaim publikasi `scheduled` atau `queued` (atau `uploading` yang stalled) menjadi `uploading`, `attempts++`, lalu memuat clip, memeriksa file di `CLIPS_DIR` lewat `resolveClipPath`, dan mengambil token via `SocialService.getValidAccessToken` (gagal refresh → `failed` dengan pesan "Reconnect your account").
2. Sesi resumable dibuat dengan `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` berisi `snippet {title, description: caption, categoryId: '22'}` dan `status {privacyStatus, selfDeclaredMadeForKids}` serta header `X-Upload-Content-Type: video/mp4` dan `X-Upload-Content-Length`.
3. File di-`PUT` per chunk 8 MiB (kelipatan 256 KiB) dengan `Content-Range`, di-stream dari disk (`createReadStream` start/end) tanpa buffer penuh. Respons 308 dilanjutkan dari header `Range`; 5xx/galat jaringan memakai backoff eksponensial (maks 5 kali per chunk) lalu menanyakan status sesi dengan `Content-Range: bytes */<size>`. Progres ditulis ke DB per chunk bila persen berubah.
4. Setelah unggah selesai, status menjadi `processing` dengan `externalId` = id video dan `externalUrl` = `https://youtube.com/shorts/<id>`. Job `check` tertunda 15 detik memanggil `videos.list?part=status,processingDetails`; `processed`/`succeeded` (atau `uploaded` tanpa processingDetails) → `published` + `publishedAt`; `failed`/`rejected`/`deleted` → `failed` dengan alasannya; masih diproses → job `check` berikutnya (maks 80 kali ≈ 20 menit, setelah itu dianggap `published` karena video sudah ada).
5. Galat Google dipetakan ke pesan singkat (`quotaExceeded`, `uploadLimitExceeded`, `youtubeSignupRequired`, 401 → "Reconnect your account", `forbidden`, dll.). Token tidak pernah dicatat atau disimpan pada `error`. Job BullMQ selalu selesai normal; pengulangan dilakukan lewat endpoint retry.
6. Untuk TikTok, processor mengambil token, memanggil `creator_info` segar untuk validasi privacy/durasi, lalu `POST /v2/post/publish/video/init/` (direct) atau `/v2/post/publish/inbox/video/init/` (inbox). `video_size`/`chunk_size`/`total_chunk_count` dihitung dari ukuran file (5–64 MiB per chunk, chunk terakhir menyerap sisa); `title` = caption untuk direct (maks 2200 UTF-16). PUT chunk berurutan dengan `Content-Type: video/mp4` dan `Content-Range: bytes first-last/total`; galat sementara diulang maksimal 3 kali. Status menjadi `processing` dengan `externalId` = `publish_id`. Job `check` tiap 5 detik memanggil `/v2/post/publish/status/fetch/` maksimal 120 kali (±10 menit, lalu gagal dengan pesan timeout). `SEND_TO_USER_INBOX`/`PUBLISH_COMPLETE` sukses untuk inbox; direct hanya `PUBLISH_COMPLETE`. URL `https://www.tiktok.com/@{username}/video/{id}` dibentuk hanya bila `publicaly_available_post_id` ada dan username diketahui dari `creator_info`; otherwise `null`. `fail_reason` dipetakan ke pesan Inggris (durasi/format/fps/ukuran, spam, auth_removed → reconnect, `unaudited_client_can_only_post_to_private_accounts` → "TikTok account must be private while the app is unaudited"). Aplikasi masih unaudited, sehingga Direct Post praktis hanya berfungsi untuk akun privat; privacy level tetap diambil dari opsi `creator_info`, bukan hardcode.
7. Saat API boot, publikasi aktif tanpa job BullMQ dipulihkan: `queued` dimasukkan ulang langsung, `scheduled` memakai sisa delay (atau langsung bila sudah jatuh tempo), `uploading` yang lebih tua dari 1 jam ditandai `failed` ("Upload interrupted"), dan `processing` dijadwalkan cek status ulang.

## Bahasa Caption & Regenerasi Caption

- **Kontrak shared** (`packages/shared/src/index.ts`, dicerminkan `rust/crates/dartclip-core/src/models.rs`): `CAPTION_LANGUAGES = ['auto','id','en']`, `CaptionLanguage`, `DEFAULT_CAPTION_LANGUAGE = 'auto'`, `CAPTION_QUEUE_NAME = 'captions'`, `CLIP_TRANSCRIPT_MAX = 2000`. `JobData.captionLanguage` wajib dikirim API; worker memakai `auto` bila field absen/tidak dikenal. `ClipResult.transcript?` berisi cuplikan transkrip klip. `CaptionJobData` = `{ clipId, title, transcript, currentCaption, description, language }`; `CaptionJobResult` = `{ caption, hashtags, platformCaptions? }`. `ClipResult` juga menerima `platformCaptions?`; listener menyimpannya saat progress dan completion. API hanya menerima varian `youtube`/`tiktok`/`instagram`, menormalkan `title` (maks. 100), `caption` (maks. 2200) dan hashtag, lalu meneruskannya di detail job, SSE, dan klip terbaru.
- **Job render**: `POST /api/jobs` menerima `captionLanguage` opsional (default `auto`), menyimpannya di `jobs.captionLanguage`, dan meneruskannya di `JobData`; retry menyalinnya dari job lama; daftar/detail job dan snapshot SSE menyertakannya. Di tahap `save`, `llm.generate_captions(..., language)` memilih aturan bahasa prompt: `auto` = bahasa transkrip, `id` = Bahasa Indonesia, `en` = English (hashtag boleh mengikuti bahasa pilihan). Render menyisipkan `llm.clip_transcript()` (teks cue di dalam rentang klip, tanpa timestamp, ≤ 2.000 karakter) ke `ClipResult.transcript`; `to_dict` hanya mengirimnya bila tidak kosong. `QueueListener.onCompleted` menyimpannya ke `clips.transcript` via `sanitizeClipTranscript` (trim, maks 2.000, kosong -> NULL).
- **Hashtag kustom (`customHashtags`)**: `POST /api/jobs` menerima string atau array string yang divalidasi DTO lalu dinormalisasi shared (`normalizeCustomHashtags`: split spasi/koma/`#`, Unicode letter/number/underscore, 50 karakter/tag, dedupe case-insensitive, 15 tag). API menyimpan array di `jobs.customHashtags`, meneruskannya di `JobData`, menyalinnya pada retry, dan menyertakannya pada snapshot/SSE. Bila tidak kosong, prompt batch dan single-caption melarang generator hashtag otomatis serta meminta `hashtags: []`; worker mengabaikan hashtag LLM, menghapus token hashtag inline dari caption, lalu memasang nilai kustom pada tiap `clip.hashtags`. Fallback LLM gagal/tidak dikonfigurasi juga memasang hashtag kustom. Regenerasi satu klip mengirim nilai job melalui `CaptionJobData` dan API menegakkan nilai tersebut untuk hashtag generik dan tiap varian platform sebelum menyimpan hasil.
- **Regenerasi caption** (`POST /api/clips/:id/caption`, body `RegenerateCaptionDto { language }` divalidasi `@IsIn(CAPTION_LANGUAGES)`): `ClipCaptionsService` mencari klip milik pengguna yang belum dihapus (404 bila tidak ada), mengantrekan `CaptionJobData` ke antrean BullMQ `captions` (`attempts: 1`, `removeOnComplete: true`, `removeOnFail: true`), lalu `job.waitUntilFinished(QueueEvents('captions'), 60_000)`. Hasil disanitasi dengan `parseCaptionResult` (sanitizer `sanitizeClipSocialMetadata` yang sama dengan job render) lalu disimpan ke `clips.caption`/`clips.hashtags`/`clips.platformCaptions` lewat update bersyarat (klip yang terhapus selama menunggu → 404). Timeout, job gagal, atau hasil tanpa caption → 503 `{ message: 'caption_unavailable' }`.
- **Worker Rust**: bridge meneruskan antrean `captions` (concurrency 2) ke CLI. Dengan transkrip, LLM menulis ulang caption berdasarkan transkrip; tanpa transkrip, gunakan judul dan caption lama. Bridge memetakan kegagalan ke `caption_unavailable`.

## Pratinjau Momen (Review Moments)

Tinjau Momen memindai sumber, mengembalikan kandidat dan transkrip, lalu memungkinkan pengguna memilih rentang untuk job manual. Split Screen menambahkan storyboard B-roll per kandidat.

- **`POST /api/previews`** → `201 { id }`. Menerima `url` atau `primarySource`, `splitScreen`, opsi layout (`aspectRatio`, `twoSpeakers`, `facecam`), `transcriptSource`, dan parameter pemindaian: `description` (maks. 500), `clipCount` (1–10, default 5), `targetDurationSec` (15–180, default 45), `maxSourceSec` (60–36000, `null` = durasi penuh).
- **`GET /api/previews/:id`** → status, konfigurasi sumber/Split Screen, kandidat, dan cue `{ start, end, text }` saat selesai. Kandidat Split Screen memuat `splitTimeline`; `brollSummaries` memetakan ID B-roll ke deskripsinya bila ada. ID yang tidak ada atau bukan milik pengguna → 404. Preview tidak memakai tabel DB; BullMQ menyimpan hasil/status selama 1 jam setelah selesai/gagal.
- **Worker:** memakai subtitle atau STT, memilih momen melalui jalur auto (refinement + snap), dan mempersiapkan B-roll untuk storyboard bila Split Screen aktif. `maxSourceSec` membatasi cue dan kandidat yang dikembalikan. Preview tidak merender klip.
- **Draf Web:** `sessionStorage` (`clipper-review-draft`) menyimpan konfigurasi, termasuk sumber utama dan Split Screen, serta `previewId` dan pilihan rentang. Polling dilanjutkan saat tab kembali ke Workspace. Jika preview hilang (404), polling berhenti dan UI menawarkan pindai ulang.

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
- **Framework:** TanStack Start (SSR dan file-based routing) + TanStack Query untuk state manajemen server; Swiper React untuk carousel klip (Navigation, Pagination, A11y, breakpoint responsif).
- **Standar library — TanStack-first:** Setiap fitur baru memilih library TanStack sebelum dependency lain bila ada padanannya (Router/Start = routing, Query = state server, Form = form + validasi, Table = tabel, Virtual = virtualisasi). Form `login`, `register`, dan kartu pembuatan job di `/` memakai `@tanstack/react-form` untuk validasi klien berpesan EN/ID. Kartu job memakai nilai field TanStack Form sebagai satu-satunya sumber kebenaran; mode, reframe, takarir, dan opsi terkait tetap state komponen. Draft review (`saveReviewDraft`) membaca store form, sementara prefill regenerate (`/?from`) mengisi field lewat `form.setFieldValue`; alur preview tetap menggunakan nilai form terkini. Validasi mencakup sumber wajib (URL valid atau ID sumber lokal), batas pindai kustom 1–600 menit, jumlah klip 1–10, durasi 15–180 detik, dan rentang manual 1–10 dengan end > start.
- **Shell dan dashboard:** Area aplikasi memakai sidebar navigasi menuju dashboard dan `/jobs/`, header sticky dengan navigasi ponsel, pencarian klien-side atas URL klip terbaru, preferensi bahasa/tema, dan sign out. Dashboard menampilkan composer tunggal dengan mode otomatis/manual tersegmen, daftar job aktif/gagal, dan carousel klip Swiper dengan dialog pemutar. Route `/jobs/` menggunakan `GET /api/jobs` melalui Query untuk menampilkan seluruh pekerjaan dalam baris responsif. Light theme memakai kanvas abu terang dan surface putih; dark theme memakai kanvas arang, surface gelap, dan aksen mint untuk tindakan utama serta state terpilih.
- **Komponen UI:** Komponen modular shadcn/ui berbasis Radix UI, termasuk dialog player aksesibel, ikon Lucide, dan utility `tw-animate-css`.
- **Tailwind CSS v4:** Styling modern menggunakan engine Tailwind v4.
- **Server Produksi:** Dijalankan menggunakan runtime `srvx` (`srvx --prod -s ../client dist/server/server.js`).
- **Internal Reverse Proxy:** Route `/api/$` mem-proxy semua permintaan HTTP dari klien browser ke endpoint NestJS via `API_INTERNAL_URL` (default `http://localhost:3000`). Pendekatan ini membuat cookie autentikasi tetap *same-origin* tanpa kendala CORS.
- **Standar UI (Antislop):** Setiap pekerjaan pembuatan/perubahan UI diwajibkan memuat skills Antislop (core `antislop` + `antislop-ui`, dan skill turunannya sesuai konteks: `antislop-layoutmobile`, `antislop-human`, `antislop-copywriting`) sebelum menulis komponen.
- **Internasionalisasi (i18n):** Mendukung Bahasa Inggris (EN, default) dan Bahasa Indonesia (ID), disimpan di cookie `clipper_language`.
- **Tema:** Mendukung tema `light`, `dark`, dan `system`, disimpan di cookie `clipper_theme`.
- **Halaman & Rute Utama:**
  - `/login`: Masuk dengan email & password, mengarahkan ke dashboard.
  - `/register`: Pendaftaran akun (hanya aktif jika belum ada user atau `ALLOW_REGISTRATION=true`).
  - `/` (`apps/web/src/routes/index.tsx`): Workspace untuk sumber utama, opsi render, monitor/seam Split Screen, dan Tinjau Momen. `/?from=<jobId>` memulihkan sumber dan pengaturan Split Screen bersama opsi render lainnya.
  - `apps/web/src/components/media-source-picker.tsx` dipakai untuk Video A dan B: URL, unggah/pilih/hapus aset lokal, atau pilih klip terbaru milik pengguna. `split-screen-panel.tsx` mengatur urutan/label/trim B-roll, panel, fit, volume, dan mode pencocokan.
  - `apps/web/src/components/review-panel.tsx` menampilkan `split-timeline-editor.tsx` pada kartu kandidat; edit untuk kandidat terpilih dikirim sebagai `ranges[].splitTimeline` saat render.
  - `/jobs/`: Daftar seluruh job pengguna dari `GET /api/jobs`, status/tahap, progres job aktif, jumlah klip, usia relatif; diakses dari sidebar dan navigasi header mobile.
  - `/jobs/$jobId` (`apps/web/src/routes/jobs.$jobId.tsx`): detail progres SSE, pemutar hasil dan sumber lokal, ringkasan rasio/urutan panel/mode/volume serta daftar B-roll, pembatalan, unduh, buat ulang, dan hapus klip.

## Keteramatan Status LLM

Worker memantau konfigurasi dan status LLM melalui Redis:
- Setiap 30 detik (dan setiap kali panggilan inferensi selesai), worker menulis payload status ke Redis key `worker:status:llm` dengan TTL 90 detik.
- Payload mencakup: `configured` (apakah variabel env lengkap), `model` (nama model LLM yang digunakan), `lastCall` (`{ok, at, error}`), dan `updatedAt`.
- API menyediakan endpoint `GET /api/system/llm-status`.
- Front-end menampilkan badge status real-time di antarmuka (LLM siap, model yang aktif, atau peringatan bila worker offline / pemanggilan gagal).

## Konfigurasi Deployment Dokploy

Seluruh aplikasi di-deploy pada VPS tunggal di bawah project Dokploy `clipper`.

| Service | Tipe | Image / Build | Volume Mount | Domain / Routing | Catatan |
| --- | --- | --- | --- | --- | --- |
| `clipper-api` | Application | Dockerfile `apps/api` | Bind `/srv/storage/clips` → `/data/clips` | `https://api-clipper.rencraft.site` | Menjalankan `prisma migrate deploy` saat boot |
| `clipper-web` | Application | Dockerfile `apps/web` | — | `https://clipper.rencraft.site` | Server srvx TanStack Start, reverse proxy `/api/*` |
| `clipper-worker` | Application | Image Rust dari `worker-rust/Dockerfile` | Bind `/srv/storage/clips` → `/data/clips` | Tanpa domain eksternal | CLI Rust + bridge BullMQ; perlu untuk Split Screen/media lokal |
| Postgres | Database | PostgreSQL Dokploy | Volume internal | Internal | Database relasional untuk API |
| Redis | Database | Redis Dokploy | Volume internal | Internal | Broker BullMQ (`clip-jobs`, `previews`), cancel keys, LLM heartbeat |

Akses jaringan publik dilindungi menggunakan **Cloudflare Tunnel** yang mengarahkan domain publik ke port internal container di server.

### Image Worker Rust

`worker-rust/Dockerfile` membangun `dartclip-worker`; image runtime menyertakan FFmpeg/ffprobe, yt-dlp, dan font. Container berjalan sebagai UID/GID `10001:10001`; volume `CLIPS_DIR` harus dapat ditulis oleh user tersebut. CLI menjalankan `self-check` saat boot sebelum bridge BullMQ. Worker Python masih ada untuk alur Reference Edit (`reference-jobs`), yang tidak dikonsumsi bridge Rust; jangan arahkan kedua worker ke antrean fitur ini.

### Variabel Lingkungan

| Variabel | Digunakan Oleh | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | API | Connection string PostgreSQL Dokploy internal |
| `REDIS_URL` | API, worker | Connection string Redis Dokploy internal |
| `CLIPS_DIR` | API, worker | Lokasi mount volume bersama (`/data/clips`) |
| `PORT` | API, web | Port listener HTTP (default 3000) |
| `ALLOW_REGISTRATION` | API | Boolean (`true`/`false`), membuka pendaftaran pengguna tambahan |
| `SOCIAL_TOKEN_KEY` | API | Opsional; kunci AES-256 32 byte dalam base64 atau hex untuk enkripsi token akun sosial |
| `PUBLIC_WEB_URL` | API | Opsional; origin web untuk callback/redirect OAuth (default `https://clipper.rencraft.site`) |
| `GOOGLE_CLIENT_ID` | API | Opsional; client ID OAuth Google untuk koneksi YouTube |
| `GOOGLE_CLIENT_SECRET` | API | Opsional; client secret OAuth Google untuk koneksi YouTube |
| `TIKTOK_CLIENT_KEY` | API | Opsional; client key OAuth TikTok |
| `TIKTOK_CLIENT_SECRET` | API | Opsional; client secret OAuth TikTok |
| `API_INTERNAL_URL` | Web | URL upstream API untuk reverse proxy server (mis. `http://clipper-api:3000`) |
| `LLM_BASE_URL` | Worker | URL endpoint OpenAI-compatible (mis. OpenRouter / OpenCode Go) |
| `LLM_API_KEY` | Worker | Kunci API untuk otentikasi LLM |
| `LLM_MODEL` | Worker | Nama model LLM yang digunakan untuk pemilihan momen dan refinement batas |
| `LLM_VISION_MODEL` | Worker Rust | Model deskripsi B-roll multimodal; default `clipper-vision` |
| `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL` | Worker Rust | Layanan transkripsi; endpoint/kunci mengikuti LLM jika kosong, model default `groq/whisper-large-v3-turbo` |
| `LLM_REFINE` | Worker | Pass-2 refinement batas momen oleh LLM; default aktif, matikan dengan `0`/`false`/`no`/`off` |
| `MIN_FREE_GB` | Worker | Ambang batas ruang disk minimum (default `5.0`) |
| `LOG_LEVEL` | Worker | Tingkat logging (`INFO`, `DEBUG`, dsb.) |

## Testing

- **Worker Rust:** Unit test di `dartclip-core` mencakup normalisasi timeline, layout/fit panel, resolusi path lokal, dan penempatan takarir pada seam. Suite Python tetap tersedia di `worker/tests/`.
- **API (Node):** Contract spec via `node --experimental-strip-types` untuk validasi DTO cancel, delete job, retry job (kepemilikan, status gate, salinan konfigurasi, jalur create yang sama), description, reframe, captions, aspect ratio (persistensi, normalisasi `twoSpeakers` ke `false` di luar 9:16, ukuran output worker), manual ranges/preservasi title-reason, batas pemindaian sumber `maxSourceSec`, pemulihan status job basi, preview momen, penghapusan klip, kriptografi scrypt, sanitasi caption/hashtag, AES-256-GCM token sosial, serta PKCE/URL OAuth (`apps/api/src/**/*.spec.ts`, dijalankan lewat `pnpm --filter api test`).
- **Verifikasi CLI tanpa Redis:** `dartclip-worker --task job --payload-file <path>` memproses payload job langsung, dengan keluaran JSONL.
