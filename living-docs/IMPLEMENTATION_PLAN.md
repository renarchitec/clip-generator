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
| Antrean | Redis di Dokploy | Broker antrean BullMQ (`clip-jobs`, `previews`, dan `captions`), penyimpanan sinyal pembatalan, dan heartbeat status LLM. Worker menunggu Redis siap (ping, maks ~5 menit) sebelum membuat consumer; kalau gagal, proses keluar agar container di-restart |
| Database | PostgreSQL di Dokploy | Penyimpanan relasional pengguna, sesi, metadata job, dan klip |
| Penyimpanan | Bind mount host `/srv/storage/clips` → `/data/clips` | Disk tambahan VPS, di-mount bersama ke API dan worker pada direktori yang sama |
| Auth | Multi-user via database (`users` + `sessions`), scrypt, opaque session token | Keamanan cookie `clipper_session` (httpOnly, 30 hari), bearer token, isolasi per akun, klaim legacy jobs otomatis |

## Struktur repo

```text
clipper/
├─ apps/
│  ├─ desktop/                # Spike Electron (macOS arm64, pribadi): jalankan worker bundel sebagai child process
│  ├─ api/                    # NestJS API
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma     # Skema database
│  │  │  └─ migrations/       # Riwayat migrasi SQL Prisma
│  │  ├─ docker-entrypoint.sh # Menjalankan prisma migrate deploy sebelum boot
│  │  ├─ Dockerfile
│  │  └─ src/
│  │     ├─ auth/             # scrypt hash, sessions DB, auth guard, cookie
│  │     ├─ jobs/             # CRUD job, cancel, retry, DTO, snapshot, SSE stream
│  │     ├─ previews/         # pindai subtitle & LLM: POST /api/previews, GET /api/previews/:id
│  │     ├─ clips/            # stream Range, download, delete clip fisik + DB
│  │     ├─ social/           # akun sosial, OAuth YouTube, enkripsi token, fondasi publikasi
│  │     ├─ publish/          # publikasi klip ke YouTube: endpoint, antrean `publish`, resumable upload
│  │     ├─ system/           # status LLM worker dari Redis (GET /api/system/llm-status)
│  │     ├─ queue/            # BullMQ producer, listener QueueEvents, Redis
│  │     └─ config/           # validasi env (Zod)
│  └─ web/                    # TanStack Start + Vite
│     ├─ Dockerfile
│     └─ src/
│        ├─ routes/           # login, register, dashboard (/), job index (/jobs/), job detail (/jobs/$jobId), clips (/clips), settings (/settings: akun sosial terhubung), reverse proxy (/api/$)
│        ├─ components/       # UI components (shadcn/ui), login-form, llm-status, chrome
│        └─ lib/              # auth helper, i18n (EN/ID), theme (dark/light/system), api client, formatting helpers
├─ packages/
│  └─ shared/                 # Tipe TypeScript: JobData, JobProgress, JobResult, ReframeMode, AspectRatio, PreviewJobData
├─ worker/                    # Python 3.12 pipeline
│  ├─ clipper/
│  │  ├─ pipeline.py          # Orkestrasi tahap: download, transcribe, select, render, save, run_preview
│  │  ├─ worker.py            # Consumer `clip-jobs` (concurrency 1) + `previews` (concurrency 2), heartbeat LLM
│  │  ├─ llm.py               # Pemanggilan OpenAI-compatible LLM & parsing momen + pass refinement
│  │  ├─ snap.py              # Snap deterministik batas momen ke cue/kalimat terdekat (murni)
│  │  ├─ reframe.py           # face_tracking / active speaker (FaceMesh), dua pembicara (2-means), crop filters
│  │  ├─ subtitles.py         # Parser VTT, deduplikasi rolling, takarir hook ASS per kata
│  │  ├─ local_cli.py         # Entrypoint lokal tanpa Redis (desktop spike), event JSON per baris di stdout
│  │  └─ models.py            # Definisi dataclass & konversi data job
│  ├─ tests/                  # Pytest unit & integration tests
│  ├─ desktop/                # PyInstaller spec + build-mac.sh (bundel worker + ffmpeg statis arm64)
│  ├─ scripts/bench_render.py # Benchmark render satu klip per encoder
│  ├─ fonts/                  # Anton-Regular.ttf + OFL.txt (font caption hook)
│  ├─ requirements.in        # dependency runtime (sumber)
│  ├─ requirements.txt       # lock ber-hash, hasil uv pip compile
│  ├─ requirements-dev.txt   # + pytest, tidak masuk image
│  └─ Dockerfile              # ffmpeg, fontconfig + Anton, fonts-dejavu-core, mediapipe, opencv
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
7. `20260107000000_add_job_two_speakers`: Penambahan kolom boolean `twoSpeakers` pada tabel `jobs` (default `false`).
8. `20260110000000_add_job_aspect_ratio`: Penambahan kolom string `aspectRatio` pada tabel `jobs` (default `'9:16'`; nilai sah: `9:16` / `1:1` / `16:9`, divalidasi `@IsIn(ASPECT_RATIOS)` di DTO, parse toleran di worker: tidak dikenal/hilang -> `9:16`).
9. `20260111000000_add_job_max_source_sec`: Penambahan kolom `maxSourceSec` `INTEGER` nullable pada tabel `jobs` (batas pemindaian sumber 60–36000 detik; NULL = durasi penuh; divalidasi `@IsInt @Min(60) @Max(36000)` di DTO, parse toleran di worker: invalid/di luar rentang -> `None`).
10. `20260120000000_add_job_facecam`: Penambahan kolom boolean `facecam` pada tabel `jobs` (default `false`; API menormalkan ke `false` bila `aspectRatio` bukan `9:16` atau `twoSpeakers` aktif).
11. `20260122000000_add_social_publishing`: Penambahan `caption` dan `hashtags` pada `clips`, enum `SocialPlatform`/`PublicationStatus`, tabel `social_accounts` untuk token terenkripsi per pengguna, serta tabel `publications` sebagai fondasi status unggah Fase 2.
12. `20260123000000_publication_youtube_fields`: Penambahan `title` (default `''`), `madeForKids` (default `false`), `progress` (persen unggah, default 0), dan `publishedAt` pada `publications`, serta indeks `status` untuk pemulihan saat boot.
13. `20260124000000_caption_language`: Penambahan kolom `captionLanguage` `TEXT NOT NULL DEFAULT 'auto'` pada `jobs` (nilai sah `auto` / `id` / `en`, divalidasi `@IsIn(CAPTION_LANGUAGES)` di DTO, parse toleran di worker: tidak dikenal/hilang -> `auto`) dan kolom `transcript` `TEXT` nullable pada `clips` (cuplikan transkrip klip ≤ 2.000 karakter untuk regenerasi caption; NULL untuk klip lama).
14. `20260130000000_custom_hashtags`: Penambahan kolom `customHashtags` `TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` pada `jobs` (hashtag kustom per job, maks 15 tag × 50 karakter; bila tidak kosong di-inject ke `clip.hashtags` dan LLM tidak membuat hashtag otomatis).

## Pipeline Pemrosesan Worker

Worker berjalan sebagai proses mandiri dengan dua consumer BullMQ: `clip-jobs` (render, concurrency 1) dan `previews` (pratinjau momen, concurrency 2). Keduanya berbagi koneksi Redis dan heartbeat status LLM.

### 1. Pengecekan Awal
Worker memeriksa sisa ruang pada volume `CLIPS_DIR`. Jika kurang dari `MIN_FREE_GB` (default 5.0 GB), job langsung digagalkan sebelum mengunduh media.

### 2. Tahap Download (`download`)
- Memanggil `yt-dlp` untuk mengunduh video format MP4 terbaik (`bv*[ext=mp4]+ba[ext=mp4]/b[ext=mp4]/b`). Unduhan penuh memakai format bebas; unduhan section (mode `auto` berlimit dan mode `manual`) dibatasi ke format MP4 terindeks via HTTP: `bv*[ext=mp4][protocol^=http]+ba[ext=mp4][protocol^=http]/b[ext=mp4][protocol^=http]`. Alasannya: fallback HLS/TS non-indexed memotong video section di keyframe berikutnya sehingga video lebih lambat dari audio (A/V tidak sinkron).
- **Mode `auto`:** mengunduh video penuh ke `source.*` seperti biasa. Bila `maxSourceSec` diisi (60–36000 detik), hanya bagian `0–limit` yang diunduh sebagai satu section `--download-sections "*0.000-limit"` + `--force-keyframes-at-cuts` ke file `source.*` (offset 0, jadi timestamp identik dengan video asli dan file itu langsung dipakai render). Section tanpa stream video (format terbatas/429) atau gagal OpenCV → transcode H.264 (`_ensure_opencv_readable`), dan bila tetap tanpa video → fallback unduh video penuh. Bila video lebih pendek dari limit, hasilnya sama dengan durasi penuh.
- **Mode `manual`:** hanya mengunduh rentang terpilih — satu file `section-NN.*` per rentang valid, diurutkan `start`, via `--download-sections "*start-end"` + `--force-keyframes-at-cuts` (potongan tepat pada batas rentang, dengan biaya re-encode). Timestamp file section direset ke 0 oleh yt-dlp; offset awal rentang disimpan dan dipakai render untuk menggeser `-ss`/deteksi wajah ke timeline file section, sementara timestamp absolut asli tetap dilaporkan pada hasil klip. Rentang yang tumpang tindih diunduh dua kali (satu file per rentang, tanpa deduplikasi). Tanpa rentang valid, job manual gagal cepat sebelum unduh apa pun. Mode manual mengabaikan `maxSourceSec` — rentangnya sudah eksplisit.
- **Paralelisme unduhan:** setiap perintah yt-dlp memakai `-N 8` (fragmen HLS/DASH konkuren) dan `--http-chunk-size 10M` (unduhan ber-range untuk file HTTP tunggal), menggantikan unduhan satu-koneksi default. Pada mode `manual`, seluruh rentang diunduh bersamaan via `asyncio.gather`; bila satu rentang gagal (termasuk file hasil tidak ditemukan), file rentang lain dihapus dan job melanjutkan ke unduhan video penuh seperti fallback biasa.
- **Fallback section (auto berlimit & manual):** bila perintah unduh section gagal, worker mencatat warning dan melanjutkan ke unduhan video penuh (job tidak digagalkan). Setelah unduh + validasi stream video, `ffprobe` membaca `start_time` `v:0` dan `a:0` per section; bila `video_start - audio_start > 0.05` detik (video tertinggal karena keyframe), section dibuang dan diganti unduhan video penuh. Section tanpa stream audio/video yang terbaca tidak memicu fallback ini (dicek hanya bila kedua start tersedia); tidak ada koreksi `setpts`, kontrak `(path, offset)` tetap.
- Mengunduh trek subtitle asli YouTube penuh (mengutamakan subtitle manual, fallback ke auto-subs; bahasa `id,id-orig,en,en-orig`, `--ignore-errors` agar satu bahasa yang gagal/429 tidak menggagalkan bahasa lain) dalam format VTT — tetap video penuh untuk kebutuhan pemilihan momen, takarir, dan transkrip.
- Jika subtitle YouTube tidak ditemukan sama sekali, job langsung digagalkan dengan error: `"Subtitle YouTube tidak tersedia untuk video ini."` (Whisper telah dihapus sepenuhnya dari worker).

### 3. Tahap Transkrip (`transcribe`)
- Men-decode file VTT menjadi daftar cue terstruktur.
- Menerapkan deduplikasi cue untuk auto-sub YouTube (*rolling captions*) di mana baris baru sering mengulang ekor baris sebelumnya.
- Menghasilkan token kata (*word-level timestamps*) baik dari tag inline VTT atau aproksimasi berbasis bobot karakter.

### 4. Tahap Pemilihan Momen (`select`)
- **Batas pemindaian sumber (`maxSourceSec`, hanya mode `auto`):** sebelum pemilihan momen, cue dibatasi ke jendela `0–limit` (`_cues_within_limit`): cue yang mulai di/lewat limit dibuang; cue yang melintasi limit di-clamp `end`-nya (termasuk kata di dalamnya). Karena prompt, validasi momen, refinement, dan snap semuanya memakai `total = akhir cue terakhir`, seluruh jalur pemilihan otomatis berhenti di limit: momen berakhir ≤ limit tanpa logika tambahan. Mode manual tidak memfilter cue (rentang eksplisit diabaikan limitnya).
- **Mode `manual`:** Menggunakan rentang timestamp `{start, end}` yang diberikan pengguna. Jika rentang memuat `title` dan `reason` (hasil tinjauan LLM), nilai tersebut digunakan langsung sebagai judul dan alasan momen; jika kosong (misal rentang manual biasa atau dari cue transkrip), judul menggunakan fallback berbasis timestamp `Clip mm:ss–mm:ss` dan reason `"manual"`.
- **Mode `auto`:** Mengirimkan transkrip terstruktur, parameter (`clipCount`, `targetDurationSec`), dan instruksi `description` (brief konten) ke endpoint LLM OpenAI-compatible.
- Brief pengguna menjadi instruksi prioritas utama bagi LLM untuk memilih topik/bagian yang relevan.
- JSON dari respon LLM divalidasi ketat (dengan 1x retry jika respon rusak). Jika LLM tidak dikonfigurasi atau gagal memberikan momen valid, job langsung gagal (tanpa fallback berbasis aturan).
- **Refinement dua-pass (default aktif, `LLM_REFINE=0/false/no/off` untuk mematikan):** setelah validasi pass-1, satu panggilan LLM tambahan (klien/model/env yang sama, temperature 0.0, gaya validasi JSON + 1x retry yang sama) mengirim tiap kandidat: `index`, `title`, `start`/`end` saat ini, dan excerpt transkrip ber-timestamp dari `start-20s` sampai `end+20s`. Bila ada brief/deskripsi pengguna, teks yang sama (maks 500 karakter) disertakan di blok `<preferensi>` dan LLM diminta menjaga relevansi tiap klip terhadapnya. LLM diminta menggeser `start`/`end` per kandidat agar klip dimulai di awal pemikiran/hook yang utuh dan berakhir setelah payoff/kalimat selesai. Validasi pass-2: angka finit, dalam jendela excerpt, `end > start`, durasi dalam batas target (0.6x–1.4x `targetDurationSec`); kandidat tidak valid/absen tetap memakai nilai pass-1. Error/timeout panggilan refinement -> semua kandidat tetap pakai pass-1 (job tidak gagal; kegagalan tidak menurunkan heartbeat status LLM).
- **Snap deterministik (`worker/clipper/snap.py`, fungsi murni):** hasil akhir (LLM refined maupun fallback rule-based) digeser: `start` ke awal cue terdekat <= start dalam jendela 3 detik; `end` mencari batas "kuat" (cue berakhir `.?!…` atau jeda antar-cue >= 0.4 detik) sampai 6 detik ke depan (lookahead lebih jauh daripada start) agar klip tidak berhenti di cue arbitrer saat kalimat/jeda selesai ada di dekatnya; bila tidak ada batas kuat, `end` jatuh ke akhir cue terdekat dalam 3 detik. Lalu bantalan `start - 0.15s`, `end + 0.25s` di-clamp ke `[0, akhir cue terakhir]`, durasi dijaga dalam batas target, dan tumpang tindih antar momen dirapikan (start momen berikutnya ditarik ke end momen sebelumnya).
- **Urutan:** pass-1 pilih -> pass-2 refinement LLM -> snap deterministik. Rentang manual/transkrip pilihan pengguna tidak melewati LLM maupun snap; hanya pemilihan otomatis (job `auto` dan kandidat `run_preview`) yang melewati keduanya.

### 5. Tahap Rendering (`render`)
Masing-masing momen diproses secara berurutan. Di antara pemrosesan tiap klip, worker memeriksa apakah terdapat sinyal pembatalan (`should_cancel`).
- **Sumber video:** mode `auto` memakai satu file `source.*` dengan timestamp absolut. Mode `manual` memakai file `section-NN.*` milik rentang terkait; timestamp momen digeser relatif ke file section (`moment - range.start`) untuk seek ffmpeg dan sampling FaceMesh, sedangkan pemilihan cue takarir tetap memakai timestamp absolut video asli. Nilai `start`/`end` yang disimpan pada hasil klip tetap absolut.
- **Rasio output (`aspectRatio`, default `9:16`):** menentukan ukuran render — `9:16` = 1080x1920 (perilaku lama, tidak berubah), `1:1` = 1080x1080, `16:9` = 1920x1080. Builder filter crop/pad/blur digeneralisasi menerima lebar/tinggi target (tidak di-hard-code 1080x1920).
- **Transformasi reframe:**
  - `face_tracking` ("Pembicara aktif" di UI): menganalisis proxy video resolusi rendah (~360p, 5 fps) dengan MediaPipe FaceMesh (`max_num_faces=4`). Per wajah diukur bukaan bibir (landmark inner lips 13/14) dan energi geraknya; wajah paling aktif dipilih sebagai pembicara dengan hysteresis (margin skor 1.25x, ambang noise 0.003) dan minimal hold 0.9 detik per cut. Hasilnya deretan crop statis per segmen (cut, bukan pan halus) maksimal 16 segmen, dieksekusi sebagai ekspresi filter ffmpeg piecewise (jendela crop mengikuti rasio target: 9:16 atau 1:1); tidak ada wajah sama sekali -> fallback crop tengah.
  - `black_bars`: Skala video mempertahankan rasio asli dengan padding hitam di sisi yang kurang (atas/bawah untuk 9:16; kiri/kanan untuk 1:1).
  - `blurred_fill`: Membagi video menjadi dua layer; layer belakang diperbesar, dipotong, dan diburamkan (`boxblur`), layer depan diletakkan di tengah dengan rasio tajam (target 1080x1920 atau 1080x1080).
  - `16:9`: reframe diabaikan — sumber di-skala pas 1920x1080 (`force_original_aspect_ratio=decrease`) dan di-pad hitam bila bukan 16:9; mayoritas sumber YouTube sudah 16:9 sehingga efektif skala saja.
- **`twoSpeakers: true` (tata letak dua pembicara, hanya `aspectRatio: 9:16`; API menormalkan `false` untuk 1:1/16:9 dan worker mengabaikannya secara defensif; reframe diabaikan):** semua pusat_x wajah dari sampling FaceMesh yang sama di-klaster 2-means menjadi dua pembicara dominan (kiri -> panel atas, kanan -> panel bawah; dua klaster wajib terpisah >= 0.08, jika kurang -> fallback kuarter kiri/kanan frame). Tiap panel = crop statis 9:8 (`w=ih*9/8` clamp ke `in_w`, `h=ih` atau lebih pendek `in_w*8/9`) di tengah pembicara, skala ke 1080x960, lalu `vstack` menjadi 1080x1920, dieksekusi lewat `-filter_complex` (`split` + `crop` + `scale` + `vstack`).
- **`facecam: true` (layout streamer, hanya 9:16, kalah dari `twoSpeakers`; reframe diabaikan):** sampling khusus `facecam_face_frames` (di `reframe.py`) memakai MediaPipe BlazeFace (`face_detection`) dua tahap — FaceMesh tidak bisa diandalkan untuk wajah facecam kecil (hanya 3/100 sampel pada video streamer nyata, sehingga `facecam_box` selalu None dan layout diam-diam jatuh ke reframe biasa). Fase 1: beberapa keyframe dipindai grid tile per-1/4-frame diperbesar 3x untuk menemukan wajah terkecil yang stabil (>=2 kemunculan di posisi mirip). Fase 2: crop ketat sekitar kandidat (~6x4 tinggi wajah, diperbesar 3x) dideteksi per sampel (1 detik/jendela, maks 240). Per frame ambil wajah terkecil, median cx/cy/tinggi; `facecam_box` mengembalikan `None` bila wajah ada di <50% sampel. Kotak 27:16 setinggi 3x tinggi wajah, dipusatkan pada wajah, di-clamp ke frame (dimensi genap). Graph: `split` → panel atas `crop=box,scale=1080:640` + panel bawah crop tengah `w=min(ih*27/32,in_w)` full-height `scale=1080:1280` → `vstack`. Takarir tetap Alignment 2 (bawah). Kotak `None`/deteksi gagal -> fallback filter reframe biasa (dicatat di log: jumlah sampel berwajah dan kotak terpilih).
- **Pembakaran Takarir ASS:**
  - Jika opsi `captions: true` dan terdapat teks subtitle pada durasi klip, dibuat file temporary `.ass` bergaya "hook": font Anton (OFL, di-vendor di `worker/fonts/`, terpasang ke `/usr/share/fonts/truetype/anton` + `fc-cache` di image; DejaVu tetap fallback fontconfig), UPPERCASE, putih, outline hitam 6px, bayangan semi-transparan. `PlayResX`/`PlayResY` mengikuti ukuran output nyata (1080x1920 / 1080x1080 / 1920x1080); ukuran font dan margin bawah diskalakan relatif tinggi output (referensi 9:16: font 80, margin 180; 1:1 dan 16:9 memakai font/margin lebih kecil — `round(nilai * height / 1920)`). Karaoke `\k` tidak dipakai; sebagai gantinya satu event `Dialogue` non-overlapping per jendela kata yang memuat seluruh teks chunk (9:16/1:1: maks 4 kata / 18 karakter; 16:9: maks 6 kata / 32 karakter) dengan kata aktif dibungkus `{\c&H0000FFFF&}...{\c&H00FFFFFF&}` (kuning) dan kata lain putih. Margin aman bawah >=18% tinggi frame (Alignment 2) pada mode satu pembicara; mode dua pembicara (hanya 9:16) memakai Alignment 5 (tengah, tepat pada sambungan panel) dengan MarginV 0.
  - Jika `captions: false`, langkah pembakaran takarir dilewati.
- **Encoding Video:**
  - ffmpeg dipanggil menggunakan video codec `libx264` (default; `VIDEO_ENCODER=h264_videotoolbox` memilih encoder hardware Mac dengan `-q:v` = `VT_QUALITY`, fallback otomatis ke `libx264` bila encoder tidak ada di build ffmpeg) dengan pixel format standar `yuv420p` (menjamin kompatibilitas playback di Safari/iOS dan browser Android), audio `aac` 128k, preset `veryfast`, dan `movflags +faststart`.

### 6. Tahap Penyimpanan (`save`)
- File klip disimpan di direktori `CLIPS_DIR/<job_id>/clip-01.mp4`, `clip-02.mp4`, dst.
- Direktori kerja sementara (`temp_root/clip-<job_id>-*`) selalu dibersihkan di blok `finally`.

### 7. Pembatalan Job & Penghapusan Klip
- **Pembatalan (`POST /api/jobs/:id/cancel`):** Menyetel key `cancel:<job_id>` di Redis (TTL 24 jam) dan mencabut job dari status antrean BullMQ jika belum berjalan. Jika worker sedang memproses, worker akan menghentikan render di batas antar klip, melempar exception `JobCancelled`, membersihkan file temporary, dan status job tercatat `cancelled`.
- **Penghapusan Klip (`DELETE /api/clips/:id`):** Endpoint API langsung menghapus file fisik di filesystem (mengabaikan `ENOENT` jika sudah terhapus) dan menghapus baris dari tabel `clips` di PostgreSQL.
- **Penghapusan Job (`DELETE /api/jobs/:id`):** `JobsService.remove` memverifikasi kepemilikan via `findOne(id, userId)` (404 bila bukan milik user). Bila status job masih `queued`/`running`, endpoint menyetel key `cancel:<job_id>` di Redis (TTL 24 jam) dan mencabut job BullMQ bila masih `waiting`/`delayed`/`prioritized`. Setelah itu semua path klip di-resolve lewat `resolveClipPath(clipsDir, filePath)` (menolak path traversal) dan file fisiknya di-`unlink` (ENOENT diabaikan; error lain membatalkan operasi). Baris job lalu dihapus dengan `prisma.job.delete({ where: { id } })`; baris `clips` terhapus otomatis via FK `onDelete: Cascade`. Subscription SSE (`jobEvents.close(id)`) ditutup dan endpoint mengembalikan HTTP 204.
- **Pengulangan Job (`POST /api/jobs/:id/retry`):** `JobsService.retry` memverifikasi kepemilikan via `findOne(id, userId)` (404 bila bukan milik user) dan menolak status selain `failed`/`cancelled` dengan 400. Seluruh konfigurasi job lama (`url`, `description`, `mode`, `reframe`, `captions`, `twoSpeakers`, `aspectRatio`, `captionLanguage`, `clipCount`, `targetDurationSec`, `ranges` beserta `title`/`reason`, dan `maxSourceSec` — di-null-kan kembali bila bukan mode auto) disalin ke `CreateJobDto` lalu job baru dibuat lewat `this.create(dto, userId)` yang sama dengan `POST /api/jobs`: validasi URL allowlist, normalisasi rentang/takarir/deskripsi, dan payload antrean BullMQ tidak diduplikasi. Job lama tidak diubah; endpoint mengembalikan snapshot job baru (bentuk respons sama dengan create).

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

Fase 1 menyediakan koneksi akun dan model data publikasi; pengunggahan clip melalui tabel `publications` berada di Fase 2 (bagian berikut). YouTube dan TikTok tersedia, sedangkan Instagram ditampilkan sebagai provider yang belum tersedia. Semua rute berada di balik `AuthGuard` global dan akun dibatasi pada pengguna sesi aktif.

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

## Publikasi Sosial — Fase 2 (Publish ke YouTube)

Fase 2 mengunggah klip ke akun YouTube terhubung. Pemrosesan berlangsung di API (bukan worker Python) lewat antrean BullMQ `publish` (`PUBLISH_QUEUE_NAME` di `queue.constants.ts` dan `packages/shared`). Semua rute berada di balik `AuthGuard` global; clip dan akun yang bukan milik pengguna menghasilkan 404.

| Endpoint | Respons / perilaku |
| --- | --- |
| `POST /api/clips/:id/publish` | Body `{ targets: [{ accountId, title (1..100, tanpa '<'/'>'), caption (0..5000), privacy: public\|unlisted\|private, madeForKids? }] }`, 1..5 target, accountId unik. Clip harus milik pengguna, belum dihapus, dan job-nya `done` (400 `clip_not_ready`). Akun non-YouTube → 400 `platform_unavailable`. Publikasi aktif (`queued`/`uploading`/`processing`) untuk clip+akun yang sama → 409 `publication_in_progress`. Membuat satu `Publication` per target (status `queued`), memasukkan job `upload` per publikasi, lalu mengembalikan HTTP 201 `PublicationResponse[]`. |
| `GET /api/clips/:id/publications` | `PublicationResponse[]` milik clip, terbaru dulu. |
| `POST /api/publications/:id/retry` | Hanya publikasi `failed` (400 selain itu, 409 bila ada publikasi aktif lain untuk clip+akun). Status direset ke `queued` (progres, error, ID/URL eksternal dikosongkan), job dimasukkan ulang, lalu mengembalikan `PublicationResponse`. |

Untuk TikTok, target dapat menambahkan `mode?: 'direct'|'inbox'` (default `direct`) dan `tiktok?: { privacyLevel, disableComment, disableDuet, disableStitch, brandContent, brandOrganic }`; caption maksimal 2200 UTF-16, title opsional, `privacy` boleh absen. Mode inbox mengabaikan opsi dan menyimpan `privacy = 'inbox'`; direct menyimpan privacy level dan opsi di `publications.options` (JSONB, migrasi `20260125000000_publication_tiktok`). Validasi server: privacy level harus masih ada di `creator_info` segar, durasi klip ≤ `maxVideoPostDurationSec`, dan `brandContent` tidak boleh dipasang dengan `SELF_ONLY`.

`PublicationResponse = { id, clipId, platform, accountId, accountName, title, caption, privacy (string), mode, status, progress, externalId, externalUrl, error, createdAt, updatedAt, publishedAt }` (tipe di `packages/shared`). `GET /api/clips/recent`, `GET /api/jobs/:id`, dan snapshot SSE menyertakan ringkasan ringan `publications: { platform, status, externalUrl }[]` per clip (terbaru per akun) untuk badge kartu.

**Alur `PublishProcessor` (`@Processor('publish')`, concurrency 2):**

1. Job `upload` mengklaim publikasi `queued` (atau `uploading` yang stalled) menjadi `uploading`, `attempts++`, lalu memuat clip, memeriksa file di `CLIPS_DIR` lewat `resolveClipPath`, dan mengambil token via `SocialService.getValidAccessToken` (gagal refresh → `failed` dengan pesan "Reconnect your account").
2. Sesi resumable dibuat dengan `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` berisi `snippet {title, description: caption, categoryId: '22'}` dan `status {privacyStatus, selfDeclaredMadeForKids}` serta header `X-Upload-Content-Type: video/mp4` dan `X-Upload-Content-Length`.
3. File di-`PUT` per chunk 8 MiB (kelipatan 256 KiB) dengan `Content-Range`, di-stream dari disk (`createReadStream` start/end) tanpa buffer penuh. Respons 308 dilanjutkan dari header `Range`; 5xx/galat jaringan memakai backoff eksponensial (maks 5 kali per chunk) lalu menanyakan status sesi dengan `Content-Range: bytes */<size>`. Progres ditulis ke DB per chunk bila persen berubah.
4. Setelah unggah selesai, status menjadi `processing` dengan `externalId` = id video dan `externalUrl` = `https://youtube.com/shorts/<id>`. Job `check` tertunda 15 detik memanggil `videos.list?part=status,processingDetails`; `processed`/`succeeded` (atau `uploaded` tanpa processingDetails) → `published` + `publishedAt`; `failed`/`rejected`/`deleted` → `failed` dengan alasannya; masih diproses → job `check` berikutnya (maks 80 kali ≈ 20 menit, setelah itu dianggap `published` karena video sudah ada).
5. Galat Google dipetakan ke pesan singkat (`quotaExceeded`, `uploadLimitExceeded`, `youtubeSignupRequired`, 401 → "Reconnect your account", `forbidden`, dll.). Token tidak pernah dicatat atau disimpan pada `error`. Job BullMQ selalu selesai normal; pengulangan dilakukan lewat endpoint retry.
6. Untuk TikTok, processor mengambil token, memanggil `creator_info` segar untuk validasi privacy/durasi, lalu `POST /v2/post/publish/video/init/` (direct) atau `/v2/post/publish/inbox/video/init/` (inbox). `video_size`/`chunk_size`/`total_chunk_count` dihitung dari ukuran file (5–64 MiB per chunk, chunk terakhir menyerap sisa); `title` = caption untuk direct (maks 2200 UTF-16). PUT chunk berurutan dengan `Content-Type: video/mp4` dan `Content-Range: bytes first-last/total`; galat sementara diulang maksimal 3 kali. Status menjadi `processing` dengan `externalId` = `publish_id`. Job `check` tiap 5 detik memanggil `/v2/post/publish/status/fetch/` maksimal 120 kali (±10 menit, lalu gagal dengan pesan timeout). `SEND_TO_USER_INBOX`/`PUBLISH_COMPLETE` sukses untuk inbox; direct hanya `PUBLISH_COMPLETE`. URL `https://www.tiktok.com/@{username}/video/{id}` dibentuk hanya bila `publicaly_available_post_id` ada dan username diketahui dari `creator_info`; otherwise `null`. `fail_reason` dipetakan ke pesan Inggris (durasi/format/fps/ukuran, spam, auth_removed → reconnect, `unaudited_client_can_only_post_to_private_accounts` → "TikTok account must be private while the app is unaudited"). Aplikasi masih unaudited, sehingga Direct Post praktis hanya berfungsi untuk akun privat; privacy level tetap diambil dari opsi `creator_info`, bukan hardcode.
7. Saat API boot, publikasi aktif tanpa job BullMQ dipulihkan: `queued` dimasukkan ulang, `uploading` yang lebih tua dari 1 jam ditandai `failed` ("Upload interrupted"), dan `processing` dijadwalkan cek status ulang.

## Bahasa Caption & Regenerasi Caption

- **Kontrak shared** (`packages/shared/src/index.ts`, dicerminkan `worker/clipper/models.py`): `CAPTION_LANGUAGES = ['auto','id','en']`, `CaptionLanguage`, `DEFAULT_CAPTION_LANGUAGE = 'auto'`, `CAPTION_QUEUE_NAME = 'captions'`, `CLIP_TRANSCRIPT_MAX = 2000`. `JobData.captionLanguage` wajib dikirim API; worker memakai `auto` bila field absen/tidak dikenal. `ClipResult.transcript?` berisi cuplikan transkrip klip. `CaptionJobData` = `{ clipId, title, transcript, currentCaption, description, language }`; `CaptionJobResult` = `{ caption, hashtags }`.
- **Job render**: `POST /api/jobs` menerima `captionLanguage` opsional (default `auto`), menyimpannya di `jobs.captionLanguage`, dan meneruskannya di `JobData`; retry menyalinnya dari job lama; daftar/detail job dan snapshot SSE menyertakannya. Di tahap `save`, `llm.generate_captions(..., language)` memilih aturan bahasa prompt: `auto` = bahasa transkrip, `id` = Bahasa Indonesia, `en` = English (hashtag boleh mengikuti bahasa pilihan). Render menyisipkan `llm.clip_transcript()` (teks cue di dalam rentang klip, tanpa timestamp, ≤ 2.000 karakter) ke `ClipResult.transcript`; `to_dict` hanya mengirimnya bila tidak kosong. `QueueListener.onCompleted` menyimpannya ke `clips.transcript` via `sanitizeClipTranscript` (trim, maks 2.000, kosong -> NULL).
- **Hashtag kustom (`customHashtags`)**: `POST /api/jobs` menerima string atau array string yang divalidasi DTO lalu dinormalisasi shared (`normalizeCustomHashtags`: split spasi/koma/`#`, Unicode letter/number/underscore, 50 karakter/tag, dedupe case-insensitive, 15 tag). API menyimpan array di `jobs.customHashtags`, meneruskannya di `JobData`, menyalinnya pada retry, dan menyertakannya pada snapshot/SSE. Bila tidak kosong, prompt batch dan single-caption melarang generator hashtag otomatis serta meminta `hashtags: []`; worker mengabaikan hashtag LLM, menghapus token hashtag inline dari caption, lalu memasang nilai kustom pada tiap `clip.hashtags`. Fallback LLM gagal/tidak dikonfigurasi juga memasang hashtag kustom. Regenerasi satu klip mengirim nilai job melalui `CaptionJobData` dan API menegakkan nilai tersebut sebelum menyimpan hasil.
- **Regenerasi caption** (`POST /api/clips/:id/caption`, body `RegenerateCaptionDto { language }` divalidasi `@IsIn(CAPTION_LANGUAGES)`): `ClipCaptionsService` mencari klip milik pengguna yang belum dihapus (404 bila tidak ada), mengantrekan `CaptionJobData` ke antrean BullMQ `captions` (`attempts: 1`, `removeOnComplete: true`, `removeOnFail: true`), lalu `job.waitUntilFinished(QueueEvents('captions'), 60_000)`. Hasil disanitasi dengan `parseCaptionResult` (sanitizer `sanitizeClipSocialMetadata` yang sama dengan job render) lalu disimpan ke `clips.caption`/`clips.hashtags` lewat update bersyarat (klip yang terhapus selama menunggu → 404). Timeout, job gagal, atau hasil tanpa caption → 503 `{ message: 'caption_unavailable' }`.
- **Worker**: consumer antrean `captions` (concurrency 2) memanggil `llm.regenerate_caption(data)`. Input di-parse toleran (`CaptionRequest.from_dict`: bukan object/field rusak -> kosong, bahasa tidak dikenal -> `auto`). Dengan transkrip, prompt menulis ulang caption dari transkrip; tanpa transkrip (klip lama), prompt menerjemahkan/menulis ulang dari judul + caption lama tanpa menambah fakta. Jawaban LLM diterima sebagai list atau object tunggal (`parse_single_caption`), satu percobaan ulang bila jawaban tidak valid. LLM tidak dikonfigurasi/error/tidak valid -> `CaptionUnavailable`; handler memetakan semua error ke kegagalan job `caption_unavailable` sehingga worker tidak pernah crash karena input buruk.

## Pratinjau Momen (Review Moments)

Fitur "tinjau momen sebelum memotong" memungkinkan pengguna memindai URL terlebih dahulu, melihat kandidat momen LLM dan transkrip penuh, lalu membuat job manual normal. Mode otomatis langsung dan mode manual yang sudah ada tidak berubah.

- **Endpoint:**
  - `POST /api/previews` (auth, sesi) — body `{ url, description? (maks 500), clipCount? (1–10, default 5), targetDurationSec? (15–180, default 45), maxSourceSec? (60–36000, default null = durasi penuh) }`. URL divalidasi dengan allowlist yang sama seperti job (`apps/api/src/jobs/validation.ts`). Respons `201 { id }`.
  - `GET /api/previews/:id` (auth, hanya pemilik) — `{ id, url, description: string|null, status: queued|running|done|failed, error: string|null, candidates: {start,end,title,reason}[]|null, cues: {start,end,text}[]|null }`. Mengembalikan 404 bila job tidak ada, sudah kedaluwarsa, atau milik pengguna lain.
- **Penyimpanan:** Tanpa tabel/migrasi baru. `userId`, URL, dan parameter disimpan di data job BullMQ pada antrean `previews`. Job yang selesai/gagal dipertahankan 1 jam (`removeOnComplete`/`removeOnFail` `age: 3600`), lalu dihapus Redis. Endpoint GET membaca state, `returnvalue`, dan `failedReason` langsung dari BullMQ.
- **Worker:** Consumer `previews` terpisah di proses Python yang sama (concurrency 2, tidak menunggu render). Handler hanya memanggil `_fetch_subtitles` (`yt-dlp --skip-download`), `_read_vtt` untuk cue terdeduplikasi, lalu `llm.select_moments` dengan brief yang sama seperti mode auto. Kandidat melewati jalur yang sama persis dengan mode auto: validasi `validate_moments` -> refinement dua-pass (`LLM_REFINE`) -> snap deterministik `snap.py`. Subtitle tidak tersedia → gagal dengan pesan `"Subtitle YouTube tidak tersedia untuk video ini."`; LLM tidak dikonfigurasi/gagal → gagal dengan pesan jelas. Worker mengembalikan `{candidates, cues}` sebagai return value job.
- **Batas pemindaian sumber (`maxSourceSec`):** body `{ maxSourceSec? (60–36000, default null = durasi penuh) }` ikut dikirim ke data job preview. `run_preview` memotong cue ke jendela `0–limit` sebelum memanggil LLM (`_cues_within_limit`) dan mengembalikan hanya cue terpotong itu, sehingga transkrip di UI hanya berisi bagian yang dipindai dan kandidat berakhir ≤ limit (prompt/validasi/refinement/snap mengikuti akhir cue terakhir).
- **Transkrip:** `cues` berisi baris cue (bukan kata) `{start, end, text}` hasil deduplikasi rolling auto-sub.
- **Persistensi State Web:** State draft review (`url`, `mode`, `reframe`, `captions`, `clipCount`, `duration`, `description`, `ranges`, `reviewFirst`, `previewId`, `selectedCandidates`, `cueRanges`, `selectedCueStart`, `selectedCueEnd`) disimpan di `sessionStorage` (`clipper-review-draft`). Saat navigasi bolak-balik dalam sesi tab yang sama, state dipulihkan dan polling `GET /api/previews/:id` dilanjutkan otomatis. Preview kedaluwarsa (HTTP 404) ditangani anggun: polling dihentikan, pesan kedaluwarsa ditampilkan dengan aksi coba lagi/pindai ulang, `previewId` di-reset, dan draft dibersihkan saat job manual berhasil dibuat atau sakelar review dinonaktifkan. Data sensitif/kredensial tidak pernah disimpan di storage ini.

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
- **Standar library — TanStack-first:** Setiap fitur baru memilih library TanStack sebelum dependency lain bila ada padanannya (Router/Start = routing, Query = state server, Form = form + validasi, Table = tabel, Virtual = virtualisasi). Form `login`, `register`, dan kartu pembuatan job di `/` memakai `@tanstack/react-form` untuk validasi klien berpesan EN/ID. Kartu job memakai nilai field TanStack Form sebagai satu-satunya sumber kebenaran; mode, reframe, takarir, dan opsi terkait tetap state komponen. Draft review (`saveReviewDraft`) membaca store form, sementara prefill regenerate (`/?from`) mengisi field lewat `form.setFieldValue`; alur preview tetap menggunakan nilai form terkini. Validasi mencakup URL wajib, batas pindai kustom 1–600 menit, jumlah klip 1–10, durasi 15–180 detik, dan rentang manual 1–10 dengan end > start.
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
  - `/`: Dashboard utama. Memuat kartu pembuatan klip (URL sumber, mode switch, pilihan reframe, toggle captions, jumlah & durasi klip, arahan brief opsional atau rentang timestamp manual), kartu indikator status LLM, serta daftar riwayat job pengguna. Mendukung parameter pencarian `/?from=<jobId>` untuk prefill pembuatan job ulang (*regenerate*).
  - `/jobs/`: Daftar seluruh job pengguna dari `GET /api/jobs`, status/tahap, progres job aktif, jumlah klip, usia relatif; diakses dari sidebar dan navigasi header mobile.
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
| `clipper-api` | Application | Dockerfile `apps/api` | Bind `/srv/storage/clips` → `/data/clips` | `https://api-clipper.rencraft.site` | Menjalankan `prisma migrate deploy` saat boot |
| `clipper-web` | Application | Dockerfile `apps/web` | — | `https://clipper.rencraft.site` | Server srvx TanStack Start, reverse proxy `/api/*` |
| `clipper-worker` | Application | Dockerfile `worker` | Bind `/srv/storage/clips` → `/data/clips` | Tanpa domain eksternal | Python 3.12, mediapipe, ffmpeg; render concurrency 1, preview concurrency 2 |
| Postgres | Database | PostgreSQL Dokploy | Volume internal | Internal | Database relasional untuk API |
| Redis | Database | Redis Dokploy | Volume internal | Internal | Broker BullMQ (`clip-jobs`, `previews`), cancel keys, LLM heartbeat |

Akses jaringan publik dilindungi menggunakan **Cloudflare Tunnel** yang mengarahkan domain publik ke port internal container di server.

### Image Worker (supply chain & runtime)

- **Base image** `python:3.12-slim` dipatok ke digest sha256 di `worker/Dockerfile`. Update: ambil digest baru dari Docker Hub, ganti, rebuild.
- **Dependency terkunci dengan hash.** Sumber dependency runtime ada di `worker/requirements.in`. `worker/requirements.txt` adalah lock hasil `uv pip compile requirements.in --generate-hashes --python-version 3.12 --python-platform aarch64-manylinux_2_28 -o requirements.txt` (versi pasti + sha256 untuk semua paket, termasuk transitif). Jangan edit `requirements.txt` manual; ubah `requirements.in` lalu regenerate. Dev/test (`pytest`) ada di `worker/requirements-dev.txt` dan tidak masuk image.
- **Install:** `pip install --require-hashes --only-binary=:all: --no-deps`, jadi file yang isinya beda dari PyPI resmi ditolak dan tidak ada `setup.py` sdist yang dieksekusi saat build.
- **Index PyPI berurutan dengan fallback** (`ARG PIP_INDEXES`): PyPI resmi → mirror Aliyun → mirror Tsinghua. Tiap index selain yang terakhir dibatasi `PIP_INDEX_TIMEOUT` detik (default 300); bila gagal atau melewati batas, build pindah ke index berikutnya, dan index terakhir jalan tanpa batas waktu. Alasannya: dari homeserver, PyPI resmi normalnya ~170 Mbps, tapi rute ISP ke CDN-nya (Fastly) kadang anjlok ke ~1–2 Mbps. Mirror tidak perlu dipercaya karena hash dicek. Urutan bisa diganti lewat build arg `PIP_INDEXES` (dipisah spasi). URL index tidak masuk ENV image runtime. Cache pip memakai BuildKit cache mount, jadi wheel yang sudah di-download dari index sebelumnya tidak diambil ulang.
- **Non-root:** container jalan sebagai `clipper` (UID/GID `10001`). Kode di `/app` milik root dan read-only untuk worker. Bind mount host `/srv/storage/clips` wajib dimiliki `10001:10001`; set sekali dengan `docker run --rm -v /srv/storage/clips:/d python:3.12-slim chown -R 10001:10001 /d` (user SSH server bukan root). Container API masih jalan sebagai root, jadi tetap bisa menghapus file klip.

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
| `LLM_REFINE` | Worker | Pass-2 refinement batas momen oleh LLM; default aktif, matikan dengan `0`/`false`/`no`/`off` |
| `MIN_FREE_GB` | Worker | Ambang batas ruang disk minimum (default `5.0`) |
| `LOG_LEVEL` | Worker | Tingkat logging (`INFO`, `DEBUG`, dsb.) |
| `VIDEO_ENCODER` | Worker | Opsional; `libx264` (default, server) atau `h264_videotoolbox` (Mac) |
| `VT_QUALITY` | Worker | Opsional; kualitas VideoToolbox 1–100 (default 65, 75 untuk transcode sumber) |
| `FONTS_DIR` | Worker | Opsional; folder font untuk filter `subtitles` (`fontsdir`). Kosong di Docker (font terpasang via fontconfig); diisi otomatis oleh bundel desktop |

## Desktop spike (macOS Apple Silicon, pemakaian pribadi)

Bukti konsep, bukan produk: tanpa signing/notarization, tanpa API/DB lokal. Jalur Docker/BullMQ tidak berubah.

- **Worker lokal:** `python -m clipper.local_cli --url URL [--range 120-170 ...] [--encoder h264_videotoolbox] [--out ~/DartClip/clips]` memanggil `pipeline.run_job` langsung (tanpa Redis). Tanpa `--range` = mode auto (butuh LLM). stdout = satu event JSON per baris (`start`/`progress`/`done`/`error`), log ke stderr.
- **LLM:** dipilih dari env, tanpa key di kode: `LLM_BASE_URL`+`LLM_API_KEY` bila di-set; lalu 9router (`NINEROUTER_API_KEY`, URL `DARTCLIP_9ROUTER_URL`, default `https://9router.rencraft.site/v1`, dicek terjangkau lewat `GET /models`); lalu Gemini (`GEMINI_API_KEY`, endpoint OpenAI-compatible) atau OpenAI (`OPENAI_API_KEY`). Tanpa LLM, mode manual tetap jalan dan caption sosial dilewati.
- **Bundel:** `worker/desktop/build-mac.sh` → PyInstaller onedir `worker/desktop/dist/dartclip-worker/` (~357 MB, tgz ~164 MB) + ffmpeg/ffprobe statis arm64 dari martin-riedl.de di `bin/`. Saat frozen, `local_cli` menaruh shim `yt-dlp` (memanggil binary yang sama dengan `--yt-dlp`) dan `bin/` di PATH, `FONTS_DIR` = font bundel, `SSL_CERT_FILE=/etc/ssl/cert.pem` (OpenSSL ffmpeg statis tidak membaca keychain macOS; tanpa ini unduhan section gagal dan jatuh ke unduh video penuh), dan `MPLCONFIGDIR` tetap di `~/Library/Caches/DartClip` (kalau tidak, cache font matplotlib dibangun ulang tiap job).
- **Shell:** `apps/desktop` (Electron) memuat satu jendela (URL, rentang, encoder, tombol Render), menjalankan binary bundel lewat `spawn`, menampilkan progress/log, dan menautkan file hasil. Binary dicari di `DARTCLIP_WORKER_BIN`, `resources/dartclip-worker/`, lalu `worker/desktop/dist/`.

## Testing

- **Worker (Python):** Unit tests pytest untuk `parse_vtt` / deduplikasi rolling, `write_ass` (ASS karaoke), face tracking & pan clamp (`reframe`), parser JSON jawaban LLM, refinement pass-2 dengan LLM di-mock (`LLM_REFINE` aktif/nonaktif, hasil tidak valid, error), snap deterministik batas momen (`snap.py`), pembatalan job, batas pemindaian sumber `maxSourceSec` (parse toleran, potongan cue 0–limit, unduh section tunggal mode auto + fallback), dan unduhan section manual (`worker/tests/`).
- **API (Node):** Contract spec via `node --experimental-strip-types` untuk validasi DTO cancel, delete job, retry job (kepemilikan, status gate, salinan konfigurasi, jalur create yang sama), description, reframe, captions, aspect ratio (persistensi, normalisasi `twoSpeakers` ke `false` di luar 9:16, ukuran output worker), manual ranges/preservasi title-reason, batas pemindaian sumber `maxSourceSec`, pemulihan status job basi, preview momen, penghapusan klip, kriptografi scrypt, sanitasi caption/hashtag, AES-256-GCM token sosial, serta PKCE/URL OAuth (`apps/api/src/**/*.spec.ts`, dijalankan lewat `pnpm --filter api test`).
- **Verifikasi pipeline tanpa Redis:** `python -m clipper.selftest --url <url> --mode <auto|manual> [--ranges 12-40,90-130]` menjalankan pipeline penuh secara lokal (tanpa antrean) untuk uji cepat.
