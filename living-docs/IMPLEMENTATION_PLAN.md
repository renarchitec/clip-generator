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
| Antrean | Redis di Dokploy | Broker antrean BullMQ (`clip-jobs` dan `previews`), penyimpanan sinyal pembatalan, dan heartbeat status LLM. Worker menunggu Redis siap (ping, maks ~5 menit) sebelum membuat consumer; kalau gagal, proses keluar agar container di-restart |
| Database | PostgreSQL di Dokploy | Penyimpanan relasional pengguna, sesi, metadata job, dan klip |
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
│  └─ shared/                 # Tipe TypeScript: JobData, JobProgress, JobResult, ReframeMode, AspectRatio, PreviewJobData
├─ worker/                    # Python 3.12 pipeline
│  ├─ clipper/
│  │  ├─ pipeline.py          # Orkestrasi tahap: download, transcribe, select, render, save, run_preview
│  │  ├─ worker.py            # Consumer `clip-jobs` (concurrency 1) + `previews` (concurrency 2), heartbeat LLM
│  │  ├─ llm.py               # Pemanggilan OpenAI-compatible LLM & parsing momen + pass refinement
│  │  ├─ snap.py              # Snap deterministik batas momen ke cue/kalimat terdekat (murni)
│  │  ├─ reframe.py           # face_tracking / active speaker (FaceMesh), dua pembicara (2-means), crop filters
│  │  ├─ subtitles.py         # Parser VTT, deduplikasi rolling, takarir hook ASS per kata
│  │  └─ models.py            # Definisi dataclass & konversi data job
│  ├─ tests/                  # Pytest unit & integration tests
│  ├─ fonts/                  # Anton-Regular.ttf + OFL.txt (font caption hook)
│  ├─ requirements.txt
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

## Pipeline Pemrosesan Worker

Worker berjalan sebagai proses mandiri dengan dua consumer BullMQ: `clip-jobs` (render, concurrency 1) dan `previews` (pratinjau momen, concurrency 2). Keduanya berbagi koneksi Redis dan heartbeat status LLM.

### 1. Pengecekan Awal
Worker memeriksa sisa ruang pada volume `CLIPS_DIR`. Jika kurang dari `MIN_FREE_GB` (default 5.0 GB), job langsung digagalkan sebelum mengunduh media.

### 2. Tahap Download (`download`)
- Memanggil `yt-dlp` untuk mengunduh video format MP4 terbaik (`bv*[ext=mp4]+ba[ext=mp4]/b[ext=mp4]/b`).
- **Mode `auto`:** mengunduh video penuh ke `source.*` seperti biasa. Bila `maxSourceSec` diisi (60–36000 detik), hanya bagian `0–limit` yang diunduh sebagai satu section `--download-sections "*0.000-limit"` + `--force-keyframes-at-cuts` ke file `source.*` (offset 0, jadi timestamp identik dengan video asli dan file itu langsung dipakai render). Section tanpa stream video (format terbatas/429) atau gagal OpenCV → transcode H.264 (`_ensure_opencv_readable`), dan bila tetap tanpa video → fallback unduh video penuh. Bila video lebih pendek dari limit, hasilnya sama dengan durasi penuh.
- **Mode `manual`:** hanya mengunduh rentang terpilih — satu file `section-NN.*` per rentang valid, diurutkan `start`, via `--download-sections "*start-end"` + `--force-keyframes-at-cuts` (potongan tepat pada batas rentang, dengan biaya re-encode). Timestamp file section direset ke 0 oleh yt-dlp; offset awal rentang disimpan dan dipakai render untuk menggeser `-ss`/deteksi wajah ke timeline file section, sementara timestamp absolut asli tetap dilaporkan pada hasil klip. Rentang yang tumpang tindih diunduh dua kali (satu file per rentang, tanpa deduplikasi). Tanpa rentang valid, job manual gagal cepat sebelum unduh apa pun. Mode manual mengabaikan `maxSourceSec` — rentangnya sudah eksplisit.
- Mengunduh trek subtitle asli YouTube penuh (mengutamakan subtitle manual, fallback ke auto-subs) dalam format VTT — tetap video penuh untuk kebutuhan pemilihan momen, takarir, dan transkrip.
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
- **Refinement dua-pass (default aktif, `LLM_REFINE=0/false/no/off` untuk mematikan):** setelah validasi pass-1, satu panggilan LLM tambahan (klien/model/env yang sama, temperature 0.0, gaya validasi JSON + 1x retry yang sama) mengirim tiap kandidat: `index`, `title`, `start`/`end` saat ini, dan excerpt transkrip ber-timestamp dari `start-20s` sampai `end+20s`. LLM diminta menggeser `start`/`end` per kandidat agar klip dimulai di awal pemikiran/hook yang utuh dan berakhir setelah payoff/kalimat selesai. Validasi pass-2: angka finit, dalam jendela excerpt, `end > start`, durasi dalam batas target (0.6x–1.4x `targetDurationSec`); kandidat tidak valid/absen tetap memakai nilai pass-1. Error/timeout panggilan refinement -> semua kandidat tetap pakai pass-1 (job tidak gagal; kegagalan tidak menurunkan heartbeat status LLM).
- **Snap deterministik (`worker/clipper/snap.py`, fungsi murni):** hasil akhir (LLM refined maupun fallback rule-based) digeser: `start` ke awal cue terdekat <= start dan `end` ke akhir cue terdekat >= end (jendela ±3 detik, diutamakan batas "kuat": cue sebelumnya/sekarakter berakhir `.?!…` atau jeda antar-cue >= 0.4 detik), lalu bantalan `start - 0.15s`, `end + 0.25s` di-clamp ke `[0, akhir cue terakhir]`, durasi dijaga dalam batas target, dan tumpang tindih antar momen dirapikan (start momen berikutnya ditarik ke end momen sebelumnya).
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
- **Pembakaran Takarir ASS:**
  - Jika opsi `captions: true` dan terdapat teks subtitle pada durasi klip, dibuat file temporary `.ass` bergaya "hook": font Anton (OFL, di-vendor di `worker/fonts/`, terpasang ke `/usr/share/fonts/truetype/anton` + `fc-cache` di image; DejaVu tetap fallback fontconfig), UPPERCASE, putih, outline hitam 6px, bayangan semi-transparan. `PlayResX`/`PlayResY` mengikuti ukuran output nyata (1080x1920 / 1080x1080 / 1920x1080); ukuran font dan margin bawah diskalakan relatif tinggi output (referensi 9:16: font 80, margin 180; 1:1 dan 16:9 memakai font/margin lebih kecil — `round(nilai * height / 1920)`). Karaoke `\k` tidak dipakai; sebagai gantinya satu event `Dialogue` non-overlapping per jendela kata yang memuat seluruh teks chunk (9:16/1:1: maks 4 kata / 18 karakter; 16:9: maks 6 kata / 32 karakter) dengan kata aktif dibungkus `{\c&H0000FFFF&}...{\c&H00FFFFFF&}` (kuning) dan kata lain putih. Margin aman bawah >=18% tinggi frame (Alignment 2) pada mode satu pembicara; mode dua pembicara (hanya 9:16) memakai Alignment 5 (tengah, tepat pada sambungan panel) dengan MarginV 0.
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

### 8. Sinkronisasi Status Job (Queue Listener & Pemulihan Basi)

`QueueListener` (`apps/api/src/queue/queue.listener.ts`) adalah satu-satunya penulis status job selain endpoint create. Setiap update menulis ke database lalu mem-publish snapshot SSE, jadi kolom DB dan SSE tidak pernah berbeda. Sumber event utama adalah `QueueEvents` BullMQ (`progress`, `completed`, `failed`).

Event BullMQ bisa hilang saat Redis/worker restart (job selesai di worker, tetapi API tidak pernah menerima `completed`; klip sudah tersimpan sementara status DB tetap `running`). Karena itu listener juga menjalankan **pemulihan status basi**:

- Berjalan sekali saat module init (setelah `waitUntilReady`) lalu tiap 60 detik (`setInterval`, di-`unref` dan dibersihkan saat shutdown).
- Query semua job DB berstatus `queued`/`running`, lalu bandingkan dengan state job BullMQ:
  - `completed` → jalankan logika `onCompleted` yang sama dengan `job.returnvalue`.
  - `failed` → jalankan `onFailed` dengan `failedReason`.
  - Job tidak ada di Redis dan `createdAt` lebih tua dari 1 jam → ditandai `failed` dengan pesan `"Job hilang dari antrean (worker/redis restart). Jalankan ulang."`; job yang lebih muda dibiarkan (race dengan `queue.add`).
- **Idempoten:** `onCompleted` tidak menduplikasi clip (createMany hanya bila job belum punya clip) dan memakai update bersyarat `status in (queued, running)` sehingga job `done`/`failed`/`cancelled` tidak pernah ditimpa; `fail` juga hanya mengubah job yang masih `queued`/`running`. Job `cancelled` tidak pernah disentuh oleh pemulihan maupun event terlambat.

## Pratinjau Momen (Review Moments)

Fitur "tinjau momen sebelum memotong" memungkinkan pengguna memindai URL terlebih dahulu, melihat kandidat momen LLM dan transkrip penuh, lalu membuat job manual normal. Mode otomatis langsung dan mode manual yang sudah ada tidak berubah.

- **Endpoint:**
  - `POST /api/previews` (auth, sesi) — body `{ url, description? (maks 500), clipCount? (1–10, default 5), targetDurationSec? (15–180, default 45), maxSourceSec? (60–36000, default null = durasi penuh) }`. URL divalidasi dengan allowlist yang sama seperti job (`apps/api/src/jobs/validation.ts`). Respons `201 { id }`.
  - `GET /api/previews/:id` (auth, hanya pemilik) — `{ id, url, status: queued|running|done|failed, error: string|null, candidates: {start,end,title,reason}[]|null, cues: {start,end,text}[]|null }`. Mengembalikan 404 bila job tidak ada, sudah kedaluwarsa, atau milik pengguna lain.
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
| `clipper-api` | Application | Dockerfile `apps/api` | Bind `/srv/storage/clips` → `/data/clips` | `https://api-clipper.rencraft.site` | Menjalankan `prisma migrate deploy` saat boot |
| `clipper-web` | Application | Dockerfile `apps/web` | — | `https://clipper.rencraft.site` | Server srvx TanStack Start, reverse proxy `/api/*` |
| `clipper-worker` | Application | Dockerfile `worker` | Bind `/srv/storage/clips` → `/data/clips` | Tanpa domain eksternal | Python 3.12, mediapipe, ffmpeg; render concurrency 1, preview concurrency 2 |
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
| `LLM_MODEL` | Worker | Nama model LLM yang digunakan untuk pemilihan momen dan refinement batas |
| `LLM_REFINE` | Worker | Pass-2 refinement batas momen oleh LLM; default aktif, matikan dengan `0`/`false`/`no`/`off` |
| `MIN_FREE_GB` | Worker | Ambang batas ruang disk minimum (default `5.0`) |
| `LOG_LEVEL` | Worker | Tingkat logging (`INFO`, `DEBUG`, dsb.) |

## Testing

- **Worker (Python):** Unit tests pytest untuk `parse_vtt` / deduplikasi rolling, `write_ass` (ASS karaoke), face tracking & pan clamp (`reframe`), parser JSON jawaban LLM, refinement pass-2 dengan LLM di-mock (`LLM_REFINE` aktif/nonaktif, hasil tidak valid, error), snap deterministik batas momen (`snap.py`), pembatalan job, batas pemindaian sumber `maxSourceSec` (parse toleran, potongan cue 0–limit, unduh section tunggal mode auto + fallback), dan unduhan section manual (`worker/tests/`).
- **API (Node):** Contract spec via `node --experimental-strip-types` untuk validasi DTO cancel, description, reframe, captions, aspect ratio (persistensi, normalisasi `twoSpeakers` ke `false` di luar 9:16, ukuran output worker), manual ranges/preservasi title-reason, batas pemindaian sumber `maxSourceSec`, pemulihan status job basi, preview momen, penghapusan klip, dan kriptografi scrypt (`apps/api/src/**/*.spec.ts`, dijalankan lewat `pnpm --filter api test`).
- **Verifikasi pipeline tanpa Redis:** `python -m clipper.selftest --url <url> --mode <auto|manual> [--ranges 12-40,90-130]` menjalankan pipeline penuh secara lokal (tanpa antrean) untuk uji cepat.
