# PRD — Clipper (Generator Klip Vertikal)

**Status:** aktif · **Versi:** 2.0 · **Terakhir diperbarui:** 28 November 2026
**Dokumen terkait:** `IMPLEMENTATION_PLAN.md` (arsitektur, skema database, API contract, deployment)

---

## 1. Ringkasan

Clipper adalah alat internal untuk mengubah satu video panjang (podcast, wawancara, ceramah) menjadi beberapa klip vertikal 9:16 yang siap diunggah ke TikTok, Reels, dan Shorts.

Di Workspace (`/`), pengguna memilih sumber utama dari URL, pustaka unggahan lokal, atau klip DartClip miliknya. Momen dipilih secara **otomatis** (AI berdasarkan transkrip dan brief opsional) atau **manual** (rentang dari pengguna). Mode Split Screen menambahkan panel B-roll. Pemrosesan media, AI, dan encoding berjalan di worker server; hasil dapat diunduh dari browser.

Produk ini mendukung autentikasi multi-pengguna dengan isolasi data per akun, di-deploy di VPS dengan Dokploy project `clipper`, dan dioptimalkan untuk video berbahasa Indonesia maupun Inggris.

## 2. Masalah

Membuat klip dari video panjang secara manual memakan waktu:

1. Menonton ulang video untuk menemukan momen yang layak.
2. Memotong video, mengubah rasio ke 9:16, dan memastikan subjek tetap di frame.
3. Membuat subtitle yang terbaca jelas di layar HP (takarir kata per kata yang sinkron).
4. Mengulang semuanya untuk setiap klip.

Satu video berdurasi satu jam bisa memakan beberapa jam kerja hanya untuk menghasilkan beberapa klip. Pekerjaan ini berulang, tidak menambah nilai kreatif, dan mudah ditinggalkan karena membosankan.

## 3. Tujuan

| # | Tujuan | Ukuran |
| --- | --- | --- |
| G1 | Satu video panjang menghasilkan klip 9:16 yang layak unggah tanpa diedit lagi | Klip 1080x1920 terbingkai rapi (face tracking/blurred fill/black bars) dengan takarir terbakar |
| G2 | Seluruh alur bisa dijalankan dari browser, tanpa terminal | Register/login → buat job → pantau progres real-time → preview 9:16 → download / regenerate |
| G3 | Job berjalan tanpa pengawasan dan data klip terisolasi per pengguna | Setiap pengguna hanya dapat melihat, mengunduh, membatalkan, atau menghapus job & klip miliknya |
| G4 | Biaya operasional tetap satu VPS | Worker berjalan terisolasi dengan batas RAM dan pengecekan ruang disk minimum (`MIN_FREE_GB`) |

## 4. Non-tujuan

- **Bukan platform SaaS publik terbuka.** Pendaftaran baru otomatis terkunci setelah pengguna pertama mendaftar, kecuali variabel `ALLOW_REGISTRATION=true` diaktifkan secara eksplisit.
- **Tidak mengedit video secara kreatif bebas.** Editor timeline dibatasi pada penempatan B-roll di Split Screen; tidak ada editor multi-track umum, transisi kompleks, atau musik latar kustom.
- **Tidak menyediakan transkripsi sebagai produk terpisah.** Worker memakai subtitle atau layanan STT untuk pembuatan klip, termasuk Whisper STT untuk sumber lokal.
- **Tidak menggantikan analitik platform distribusi.** Pengguna mengunggah dan memantau analitik di platform masing-masing.
- **Bukan aplikasi mobile native.** Web responsif (PWA/mobile web di browser HP) sudah cukup.

## 5. Pengguna

**Kreator konten & pemilik akun.** Pengguna mendaftar dan masuk ke dashboard personal. Pengguna pertama otomatis mengklaim legacy jobs (tanpa pemilik) di sistem. Pengguna mengakses aplikasi dari desktop saat menyiapkan pekerjaan atau dari HP saat memantau progres dan mengunduh hasil klip.

Kebutuhan utama:
- Menghasilkan banyak klip dalam satu sesi tanpa mengawasi proses di terminal.
- Memilih metode reframe (mengikuti wajah pembicara, latar buram, atau bilah hitam).
- Memberikan brief/arahan konten opsional agar LLM memprioritaskan momen tertentu.
- Membatalkan job yang sedang berjalan atau membuat ulang job dari konfigurasi yang ada.
- Menghapus klip yang tidak diinginkan secara langsung dari disk dan database.

## 6. Alur utama

1. **Masuk / Daftar** — buka `clipper.rencraft.site`, daftar akun pertama atau masuk dengan email dan password. Sesi disimpan di cookie `clipper_session` (httpOnly, 30 hari).
2. **Cek Kesiapan LLM** — dashboard menampilkan indikator status LLM (online/offline, model, keberhasilan panggilan terakhir).
3. **Buat job atau Tinjau Momen** — pilih Video A (utama/komentator) di Workspace (`/`): URL YouTube, TikTok, atau Instagram; unggahan baru atau video dari pustaka lokal; atau klip DartClip milik sendiri. Pustaka menerima MP4, MOV, dan WebM hingga 100 MiB (104.857.600 byte), maksimal 60 menit per video dan 50 file per pengguna:
   - **Mode otomatis langsung:** LLM memilih momen yang langsung memberi hook dan konteks dalam 3 detik pertama serta selesai setelah payoff. Klip dengan skor viral tertinggi tampil lebih dulu di hasil worker. Batas tiap momen dirapikan dua lapis — refinement LLM (`LLM_REFINE`, default aktif) dan snap deterministik ke batas cue/kalimat — sebelum worker memproses video sampai render. Rentang manual/transkrip pilihan pengguna tidak ikut dirapikan.
   - **Opsi "Tinjau Momen" (Review Moments):** `POST /api/previews` memindai sumber tanpa merender klip. `GET /api/previews/:id` mengembalikan kandidat yang melewati refinement dan snap, serta transkrip yang dipindai. Pengguna memilih kandidat atau rentang transkrip untuk job manual (`POST /api/jobs`); `title`/`reason` kandidat dipertahankan. Hasil preview disimpan selama 1 jam.
     - **Draf bertahan saat berpindah halaman:** sumber utama, pengaturan Split Screen, mode, reframe, takarir, jumlah klip, durasi, deskripsi, rentang manual, status tinjau momen, `previewId`, pilihan kandidat, rentang transkrip, serta cue awal/akhir disimpan di `sessionStorage` per tab browser (tanpa token/sesi) dan dipulihkan saat pengguna kembali ke dashboard. Polling `GET /api/previews/:id` otomatis berlanjut dari `previewId` tersimpan.
     - Draf dihapus setelah job dibuat, saat pengguna mematikan opsi tinjau momen, atau bila preview sudah kedaluwarsa (404): dashboard menampilkan pesan "preview kedaluwarsa" dan tombol pindai ulang, sambil mempertahankan pilihan sumber dan parameter lain.
   - **Mode manual langsung:** pengguna menentukan sendiri rentang waktu `{start, end}`.
   - Parameter auto: jumlah klip (1–10, default 3 untuk job, default 5 untuk preview), durasi target (15–180 detik, default 45), deskripsi/arahan konten singkat (opsional, maks 500 karakter), dan batas pemindaian sumber `maxSourceSec` (opsional, 60–36000 detik; kosong = durasi penuh). Bila diisi, hanya bagian 0–limit yang dipindai (preview) atau diunduh (job auto dengan sumber URL); mode manual mengabaikan nilai ini.
   - Rentang manual: daftar 1–10 rentang waktu `{start, end}` dalam detik; `title`/`reason` opsional hanya dikirim untuk kandidat hasil tinjauan LLM. Tanpa judul, worker memakai fallback `Clip mm:ss–mm:ss`.
   - Pilihan reframe: `center_crop` (default), `face_tracking`, `blurred_fill`, atau `black_bars`. Berlaku untuk rasio 9:16 dan 1:1; diabaikan untuk 16:9.
   - Opsi takarir (`captions`): aktif (default) atau nonaktif.
   - Pilihan rasio output (`aspectRatio`): `9:16` (default, 1080x1920), `1:1` (1080x1080, reframe diterapkan ke target persegi), atau `16:9` (1920x1080 landscape; sumber di-skala pas dan di-pad hitam bila bukan 16:9 — reframe diabaikan).
   - Opsi dua pembicara (`twoSpeakers`): nonaktif (default) atau aktif; hanya berlaku untuk rasio 9:16 (API menormalkan ke `false` untuk 1:1/16:9). Bila aktif, klip 1080x1920 dibagi dua panel 1080x960 (atas/bawah) berisi dua pembicara dominan; pilihan reframe diabaikan.
   - Opsi layout streamer (`facecam`): nonaktif (default) atau aktif; hanya 9:16 dan eksklusif dengan `twoSpeakers` (API menormalkan ke `false` bila rasio bukan 9:16 atau `twoSpeakers` aktif). Bila aktif, facecam (area facecam kecil yang terdeteksi) di-crop ke panel atas 1080x640 dan gameplay (crop tengah) ke panel bawah 1080x1280; pilihan reframe diabaikan. Bila facecam tidak terdeteksi, fallback ke reframe biasa.
   - **Split Screen:** hanya 9:16, eksklusif dengan Two Speakers dan Facecam; fit panel menggantikan reframe biasa. Video B berisi 1–10 klip B-roll dengan pilihan sumber yang sama seperti Video A. Klip dapat diurutkan ulang. Pilih rasio atas:bawah `50:50` (default), `40:60`, atau `60:40`, tukar isi panel atas↔bawah, dan pilih fit tiap panel: `cover` (crop untuk mengisi panel) atau `contain_blur` (video utuh dengan latar blur). Slider audio B-roll `0–100%` default bisu; B-roll dicampur jika audio utama tersedia.
     - **Penempatan:** `Auto AI` (default) mencocokkan topik transkrip komentator dengan B-roll, memakai Vision AI untuk klip berlabel generik tanpa deskripsi. `Sequential` mengikuti urutan klip dan menjadi fallback jika pencocokan AI tidak menghasilkan rencana. B-roll mengisi panel tanpa celah sepanjang isi klip, dengan pengulangan bila perlu.
     - **Pratinjau:** monitor Workspace menampilkan garis sambungan dan posisi panel secara langsung; pratinjau frame memakai B-roll pertama, bukan playback timeline. Pada **Tinjau Momen**, kartu kandidat `ReviewPanel` menampilkan timeline B-roll yang bisa diedit sebelum render (ganti klip, atur waktu/offset, tambah, bagi, atau hapus segmen).
4. **Pantau** — job masuk antrean `clip-jobs` di BullMQ; dashboard dan halaman detail menampilkan tahapan nyata secara real-time via Server-Sent Events (`download` → `transcribe` → `select` → `render` → `save`).
5. **Kontrol** — pengguna dapat membatalkan job yang sedang berjalan via tombol Batal (`POST /api/jobs/:id/cancel`), atau mengulang job `failed`/`cancelled` langsung (`POST /api/jobs/:id/retry` membuat job baru dari konfigurasi lama tanpa mengubah job lama).
6. **Tinjau & Putar** — buka detail job, putar klip di player 9:16 (`GET /api/clips/:id/stream` mendukung HTTP byte-range), salin judul klip.
7. **Buat Ulang (Regenerate)** — klik "Buat ulang" (`/?from=<jobId>`) untuk mengisi form dashboard dengan parameter job sebelumnya guna membuat job baru.
8. **Unduh atau Hapus** — unduh file video langsung via browser (`GET /api/clips/:id/download`), hapus klip seketika (`DELETE /api/clips/:id`), atau hapus keseluruhan job beserta klip dan file fisiknya (`DELETE /api/jobs/:id`).

## 7. Lingkup dan status fitur

Dashboard memakai shell dua kolom (sidebar sempit, satu header ringkas di mobile) dengan preferensi bahasa (EN/ID) dan tema di header, pencarian klien-side klip terbaru (`⌘K`), dan satu composer: pemilih sumber utama, satu pilihan mode otomatis/manual, opsi bertanda teks (bukan ikon saja), serta tombol yang menyebut hasilnya ("Buat {n} klip"). Di bawahnya ada bagian **Sedang diproses** (job antre/berjalan dengan tahap, persen, dan bar progres; job gagal ditampilkan ringkas dengan alasannya) dan carousel **Klip terbaru** dengan dua kartu di ponsel hingga enam di desktop, frame pratinjau 9:16 hitam seragam (rasio sumber lain letterbox), judul dua baris dan metadata tetap sejajar, navigasi/paginasi mint, serta dialog player ber-kontrol dan tautan sekunder ke job. Halaman **Pekerjaan** (`/jobs/`) memuat semua job dalam baris responsif dengan sumber, status/tahap, progres aktif, jumlah klip dan umur relatif; tautan tersedia dari sidebar desktop maupun header ponsel. Halaman detail job menampilkan lima tahap berurutan (selesai/berjalan/menunggu), aksi lanjut untuk job gagal/dibatalkan, dan kartu klip dengan rank `#n`, durasi, rentang waktu sumber, unduh, dan hapus. Login/daftar berupa form ringkas tanpa dekorasi. Gaya visual mengacu ke produk clipper gelap: kanvas `#09090B`, surface `#121214`, garis tipis `#27272A`, tombol utama putih, aksen mint `#5CE1C4` hanya untuk state aktif/progres/fokus, radius kontrol 6px, tanpa shadow/gradient; angka dan durasi memakai font mono tabular. Tema terang memakai padanan putih/zinc dengan aksen teal `#087f68`.

| Prioritas | Fitur | Status |
| --- | --- | --- |
| **P0** | Multi-user auth (`users` + `sessions`, scrypt, httpOnly cookie `clipper_session`, claim legacy jobs) | Selesai |
| **P0** | Pipeline video vertikal (yt-dlp, subtitle YouTube atau STT, LLM OpenAI-compatible, takarir ASS hook per kata, ffmpeg) | Selesai |
| **P0** | Akurasi potongan: refinement dua-pass LLM (`LLM_REFINE`) + snap deterministik ke batas cue/kalimat untuk momen auto & preview | Selesai |
| **P0** | Pilihan mode reframe (`center_crop`, `face_tracking`, `blurred_fill`, `black_bars`) | Selesai |
| **P0** | Web UI TanStack Start + Query + shadcn/ui + Tailwind v4 + i18n (EN/ID) + Dark/Light theme | Selesai |
| **P0** | Real-time progress SSE (`GET /api/jobs/:id/events`) dan streaming klip byte-range | Selesai |
| **P0** | Pembatalan job (`POST /api/jobs/:id/cancel`), penghapusan job (`DELETE /api/jobs/:id`), penghapusan klip (`DELETE /api/clips/:id`), dan pengulangan job (`POST /api/jobs/:id/retry`) | Selesai |
| **P0** | Regenerate job via prefill form (`/?from=<jobId>`) | Selesai |
| **P0** | Indikator status LLM worker (`GET /api/system/llm-status` + Redis heartbeat `worker:status:llm`) | Selesai |
| **P0** | Tinjau momen sebelum memotong (`POST /api/previews` + `GET /api/previews/:id`: kandidat LLM + transkrip penuh → job manual) | Selesai |
| **P0** | Gaya takarir "hook" (Anton, UPPERCASE, kata aktif kuning) dan tata letak dua pembicara (`twoSpeakers`: panel atas/bawah 1080x960) | Selesai |
| **P0** | Layout streamer (`facecam`): facecam 1080x640 di atas, gameplay 1080x1280 di bawah | Selesai |
| **P0** | Pilihan rasio output (`aspectRatio`): 9:16 (default) / 1:1 / 16:9 dengan takarir terskala per format | Selesai |
| **P0** | Batas pemindaian sumber (`maxSourceSec`, 60–36000 detik, opsional): hanya bagian 0–limit yang dipindai/diunduh | Selesai |
| **P0** | Pemulihan status job basi (rekonsiliasi DB ↔ state BullMQ tiap 60 detik, onCompleted idempoten) | Selesai |
| **P0** | Pustaka unggahan lokal dan penggunaan ulang klip DartClip untuk Video A maupun B | Selesai |
| **P0** | Split Screen multi-klip, Auto AI/Vision dan Sequential, serta timeline yang dapat diedit pada Tinjau Momen | Selesai |
| **P1** | Fondasi publikasi sosial: akun YouTube per pengguna via OAuth, token terenkripsi, caption/hashtag AI, dan model publikasi | Fase 1 selesai |
| **P1** | Retensi otomatis terjadwal via background cron (`downloaded_at` / TTL) | Dalam antrean |
| **P1** | Publish klip ke YouTube (resumable upload, status & progres, retry, badge kartu) | Fase 2 API selesai |
| **P2** | Auto-posting ke Instagram dan TikTok | Masa depan |

## 8. Kebutuhan fungsional

### FR-1 Autentikasi dan Kepemilikan (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-1.1 | Pendaftaran akun multi-pengguna; pendaftaran otomatis ditutup setelah pengguna pertama kecuali `ALLOW_REGISTRATION=true` | Registrasi pertama berhasil dan mengklaim legacy jobs; registrasi kedua tanpa flag env → 403 Forbidden |
| FR-1.2 | Password di-hash menggunakan algoritma aman `scrypt` dengan salt acak 16-byte | Password mentah tidak pernah disimpan di database |
| FR-1.3 | Sesi disimpan di database (`sessions`) dengan token opaque acak 32-byte (hash SHA-256 tersimpan di DB) dan dikirim lewat cookie `clipper_session` (30 hari, httpOnly, Lax/Secure) atau header `Authorization: Bearer` | Sesi valid dapat mengakses endpoint; token kadaluwarsa/salah → 401 Unauthorized |
| FR-1.4 | Isolasi data per pengguna pada job, klip, dan media lokal | Permintaan untuk data milik pengguna lain → 404 Not Found |

### FR-2 Pembuatan Job (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-2.1 | Sumber utama dan B-roll menerima URL YouTube/TikTok/Instagram, unggahan lokal, atau klip DartClip milik pengguna | URL cacat/host lain → 400; media/klip tidak ditemukan atau bukan milik pengguna → 404 |
| FR-2.2 | Pilihan mode: `auto` (LLM) atau `manual` (rentang timestamp) | Parameter divalidasi sesuai mode yang dipilih |
| FR-2.3 | Parameter mode auto: `clipCount` (1–10, default 3), `targetDurationSec` (15–180 detik, default 45), dan `description` (brief arahan LLM, maks 500 karakter) | Parameter tersimpan di database dan diteruskan ke worker |
| FR-2.4 | Parameter mode manual: `ranges` berisi array 1–10 rentang `{start, end}` dengan `start >= 0` dan `end > start`, serta field opsional `title` (maks. 70 karakter) dan `reason` (maks. 200 karakter) yang diawetkan dari kandidat tinjauan LLM, serta `hookText` opsional (maks. 80 karakter) | Validasi gagal bila rentang kosong, durasi negatif, atau melebihi 10 rentang. Rentang manual murni/transkrip tanpa judul menggunakan judul fallback timestamp `Clip mm:ss–mm:ss` |
| FR-2.5 | Pilihan mode reframe: `center_crop` (default), `face_tracking`, `black_bars`, `blurred_fill` | Nilai tersimpan di database dan memengaruhi filter ffmpeg |
| FR-2.6 | Pengaturan takarir (`captions`): boolean (default `true`) | Jika `false`, takarir tidak dibakar; banner hook tetap bisa tampil sendiri |
| FR-2.9 | Opsi dua pembicara (`twoSpeakers`): boolean (default `false`); hanya berlaku untuk `aspectRatio` 9:16 — dinormalisasi ke `false` oleh API untuk 1:1/16:9 | Nilai tersimpan di database, diteruskan ke antrean/worker, dan memengaruhi filter ffmpeg; bila `true` pada 9:16, output 1080x1920 dibagi dua panel 1080x960 (vstack) dan pilihan reframe diabaikan |
| FR-2.10 | Pilihan rasio output (`aspectRatio`): `9:16` (default) / `1:1` / `16:9` | Nilai divalidasi `@IsIn(ASPECT_RATIOS)`, tersimpan di database (default `9:16`), diteruskan ke antrean/worker, dan menentukan ukuran render: 9:16 = 1080x1920, 1:1 = 1080x1080 (mode reframe diterapkan ke target persegi), 16:9 = 1920x1080 (reframe diabaikan: skala pas + pad hitam bila sumber bukan 16:9). Ukuran font/margin takarir diskalakan relatif tinggi output; PlayResX/PlayResY ASS = ukuran output nyata |
| FR-2.11 | Batas pemindaian sumber (`maxSourceSec`): integer opsional 60–36000 detik; kosong/`null` = durasi penuh (default). Hanya berlaku untuk mode auto dan preview; mode manual mengabaikannya karena rentangnya sudah eksplisit | Nilai divalidasi `@IsInt @Min(60) @Max(36000)`, tersimpan di database (`Int?`, default NULL), dan diteruskan ke antrean/worker. Preview hanya memindai cue yang mulai sebelum limit (cue yang melintasi limit dipotong di limit) dan mengembalikan hanya cue itu; kandidat momen berakhir ≤ limit. Job auto hanya mengunduh 0–limit via `--download-sections` (satu section, offset 0) dengan fallback unduh penuh bila section tanpa stream video; momen berakhir ≤ limit. Bila video lebih pendek dari limit, perilakunya sama seperti durasi penuh |
| FR-2.7 | Tombol Buat Ulang (Regenerate) dari halaman detail job | Mengarahkan ke dashboard `/?from=<jobId>` dengan nilai form terisi otomatis dari job lama untuk membuat job baru |
| FR-2.8 | Tinjau Momen menampilkan kandidat LLM dan transkrip sebelum render | `POST /api/previews` → `{id}`; `GET /api/previews/:id` memuat kandidat dan cue. Kandidat terpilih mempertahankan `title`, `reason`, dan timeline B-roll bila aktif; pengguna juga dapat memilih rentang transkrip. Render memakai `POST /api/jobs` mode manual. BullMQ/Redis menyimpan hasil preview selama 1 jam setelah selesai/gagal |
| FR-2.12 | Retry (`POST /api/jobs/:id/retry`) memakai konfigurasi job lama, termasuk sumber, Split Screen, dan timeline B-roll pada rentang manual | Hanya job `failed`/`cancelled` (status lain → 400; bukan pemilik → 404). Jalur create memvalidasi ulang akses sumber dan mengantrekan job baru; job lama tidak berubah |
| FR-2.13 | Opsi kualitas klip: `hookBanner` (default `false`), `normalizeAudio` (default `true`), dan animasi takarir `captionStyle.animate` | Hook menambahkan kartu intro 0,9 detik jika teks hook atau judul momen tersedia, walau takarir mati. Split Screen dapat memakai cover dari kedua panel; pratinjau frame tidak menampilkan kartu intro. Normalisasi menargetkan −14 LUFS jika ada audio. Skor viral dan teks hook yang tersedia tampil di detail job, SSE, dan daftar klip terbaru |
| FR-2.14 | Split Screen: Video A + 1–10 klip Video B; hanya 9:16, tanpa Two Speakers atau Facecam | Monitor menampilkan sambungan sesuai rasio; render mengisi kedua panel dan menerapkan timeline B-roll yang dipilih atau diedit di Tinjau Momen |
| FR-2.15 | Pustaka media dapat diunggah, dipilih ulang, diputar, dan dihapus | MP4/MOV/WebM valid, maks. 100 MiB dan 60 menit per file, maks. 50 file per pengguna |

### FR-3 Pemrosesan dan Pipeline Worker (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-3.1 | Worker Rust dengan bridge BullMQ mengonsumsi `clip-jobs` (concurrency 1) | Job render diproses satu per satu |
| FR-3.2 | Worker memverifikasi ruang disk minimum (`MIN_FREE_GB`, default 5 GB) sebelum memulai | Jika ruang disk di bawah ambang, job gagal cepat dengan pesan jelas |
| FR-3.3 | Sumber URL memakai `yt-dlp`, dengan unduhan section jika memungkinkan (`0–maxSourceSec` untuk auto berlimit, per rentang untuk manual). Sumber unggahan/klip memakai file yang sudah tersimpan | Sumber lokal memakai STT untuk auto dan preview, serta per rentang manual bila butuh takarir atau pencocokan AI. Sumber URL memakai jalur transkrip yang dipilih (`youtube`, `auto`, atau `live_chat_stt`); `youtube` mewajibkan subtitle untuk pemilihan momen otomatis |
| FR-3.4 | Pemilihan momen mode otomatis mewajibkan konfigurasi LLM OpenAI-compatible (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) | Jika LLM gagal atau tidak dikonfigurasi, job langsung gagal (tanpa fallback berbasis aturan) |
| FR-3.4a | Akurasi potongan dua-pass: setelah pemilihan awal, satu panggilan LLM tambahan menggeser `start`/`end` tiap kandidat agar klip dimulai di awal pemikiran/hook yang utuh dan berakhir setelah payoff/kalimat selesai (konteks excerpt transkrip ±20 detik, durasi tetap dalam batas target). Brief/deskripsi pengguna diteruskan ke prompt pass-2 dalam blok `<preferensi>` dan LLM diminta menjaga relevansi tiap klip terhadapnya. Berlaku untuk job `auto` dan kandidat "Tinjau Momen" (`run_preview`). Flag `LLM_REFINE` default aktif; `0`/`false`/`no`/`off` mematikan pass-2 | Kandidat dengan hasil refinement tidak valid (angka bukan finit, di luar jendela excerpt, `end <= start`, durasi di luar batas) tetap memakai hasil pass-1; error/timeout LLM refinement tidak menggagalkan job — semua kandidat memakai pass-1 |
| FR-3.4b | Snap deterministik ke batas cue/kalimat setelah refinement: `start` digeser ke awal cue terdekat (<= start) dalam jendela 3 detik; `end` mengutamakan batas kalimat (`.?!…`) atau jeda >= 0,4 detik hingga 6 detik ke depan (lookahead end lebih jauh daripada start) agar tidak berhenti di cue arbitrer saat batas pemikiran ada di dekatnya, dengan fallback ke akhir cue terdekat dalam 3 detik bila tidak ada batas kuat; bantalan `start - 0,15s` / `end + 0,25s` di-clamp ke durasi video, durasi dijaga dalam batas target, dan tumpang tindih antar klip dirapikan | Klip tidak mulai/berhenti di tengah kata atau kalimat; rentang manual/transkrip pilihan pengguna tidak diubah oleh refinement maupun snap |
| FR-3.5 | Subtitle diubah menjadi takarir ASS kata per kata (*karaoke style*) dengan deduplikasi *rolling auto-sub* | Teks subtitle tidak bertumpuk dan muncul sinkron per kata |
| FR-3.8 | Gaya takarir "hook": font tebal kondensasi Anton (OFL, fallback DejaVu), teks UPPERCASE putih, outline hitam 6px, bayangan lembut, kata aktif disorot kuning via event non-overlapping per kata window. `PlayResX`/`PlayResY` ASS = ukuran output nyata per `aspectRatio`; ukuran font dan margin bawah diskalakan relatif tinggi output (nilai referensi 9:16: font 80, margin 180; 1:1/16:9 memakai font lebih kecil). Chunk 4 kata / 18 karakter untuk 9:16 dan 1:1; 16:9 memuat 6 kata / 32 karakter. Mode dua pembicara memakai Alignment 5 (tengah, pada sambungan panel), Split Screen memakai sambungan panel bila tidak ada posisi Y eksplisit; layout biasa memakai Alignment 2 (bawah) | Takarir tampil kontras tinggi, ringkas, sinkron per jendela kata, dan proporsional di semua rasio |
| FR-3.6 | Reframe mengikuti rasio output, kecuali pada 16:9 (skala pas/padding hitam) dan layout khusus seperti Split Screen | `center_crop` memotong bagian tengah, `face_tracking` mengikuti pembicara aktif, `black_bars` menjaga video utuh dengan padding hitam, dan `blurred_fill` memakai latar buram |
| FR-3.7 | Pembatalan job (`POST /api/jobs/:id/cancel`) memakai kunci Redis `cancel:<job_id>` | Bridge menghentikan pemrosesan aktif ketika menerima sinyal pembatalan |

### FR-4 Status, Pemantauan, dan Pengelolaan Klip (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-4.1 | Worker memancarkan heartbeat status LLM setiap 30 detik ke Redis key `worker:status:llm` (TTL 90 detik) dan saat menyelesaikan pemanggilan LLM | API menyediakan status via `GET /api/system/llm-status`; UI menampilkan indikator kesiapan LLM di dashboard dan detail job |
| FR-4.2 | Progres tahapan dilaporkan real-time via Server-Sent Events (`GET /api/jobs/:id/events`) | Perubahan tahapan (`download`, `transcribe`, `select`, `render`, `save`) langsung diperbarui di UI |
| FR-4.3 | Pratinjau video di browser dengan dukungan HTTP byte-range (`GET /api/clips/:id/stream`) | Video dapat di-seek tanpa harus mengunduh keseluruhan file |
| FR-4.4 | Unduhan klip via `GET /api/clips/:id/download` mencatat cap waktu `downloadedAt` | File diunduh dengan nama bersih dari judul klip |
| FR-4.5 | Penghapusan klip via `DELETE /api/clips/:id` | Mengembalikan HTTP 204, menghapus file video fisik dari disk, dan menghapus baris dari tabel `clips` |
| FR-4.6 | Penghapusan job via `DELETE /api/jobs/:id` | Mengembalikan HTTP 204, menghapus semua file klip fisik dari disk, membatalkan job yang masih mengantre/berjalan (sinyal Redis + cabut dari BullMQ), dan menghapus baris job beserta klipnya (cascade). 404 bila bukan milik user |
| FR-4.7 | Pemulihan status job basi: saat init API dan tiap 60 detik, listener membandingkan status DB (`queued`/`running`) dengan state job BullMQ | State BullMQ `completed` → job ditandai `done` tanpa duplikasi clip (idempoten, update bersyarat hanya untuk job queued/running); `failed` → gagal dengan alasan yang sama; job hilang dari Redis dan lebih tua dari 1 jam → gagal dengan pesan `"Job hilang dari antrean (worker/redis restart). Jalankan ulang."`. Job `done`/`failed`/`cancelled` tidak pernah ditimpa |

### FR-5 Publikasi Sosial — Fase 1 (P1)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-5.1 | Sistem menampilkan provider sosial dan daftar akun terhubung milik pengguna melalui `GET /api/social/providers` dan `GET /api/social/accounts` | YouTube, TikTok, dan Instagram tersedia; masing-masing `configured` hanya bila kredensialnya serta kunci enkripsi terisi. Respons akun hanya memuat profil, waktu koneksi/kedaluwarsa, dan `needsReconnect`, tanpa token |
| FR-5.2 | Pengguna menghubungkan akun YouTube melalui OAuth dengan PKCE S256, scope upload/readonly, dan state sekali pakai yang terikat ke pengguna | Connect mengalihkan ke Google atau `social_error=not_configured`; callback yang valid menyimpan channel sebagai akun sosial dengan token terenkripsi lalu mengalihkan ke `connected=youtube`; state salah/kedaluwarsa dan error lain menghasilkan kode error singkat tanpa membocorkan token |
| FR-5.2b | Pengguna menghubungkan akun TikTok lewat OAuth web tanpa PKCE, scope `user.info.basic,video.upload,video.publish`, dan state sekali pakai | `GET /api/social/tiktok/connect` mengalihkan ke TikTok (atau `social_error=not_configured`); callback menyimpan `open_id` sebagai externalId dengan token terenkripsi, refresh token rotasi selalu disimpan, lalu `/settings?connected=tiktok`. Kegagalan → `/settings?social_error=<kode>` |
| FR-5.2c | Pengguna melihat pengaturan penerbitan TikTok akunnya lewat `GET /api/social/accounts/:id/tiktok/creator-info` | Hanya akun TikTok milik pengguna; mengembalikan nickname, username, avatar, daftar `privacyLevelOptions`, disable comment/duet/stitch, dan batas durasi video. Token tidak valid → 409 `needs_reconnect`; galat TikTok → 502 |
| FR-5.3 | Pengguna memutuskan akun sosial miliknya melalui `DELETE /api/social/accounts/:id` | Akun valid mengembalikan 204, YouTube/TikTok direvokasi best-effort, dan data lokal terhapus; akun bukan milik pengguna mengembalikan 404 |
| FR-5.4 | Worker LLM menghasilkan caption dan hashtag opsional untuk setiap klip; API menormalkan dan menyertakannya pada respons klip | Caption di-trim maksimal 2.200 karakter; hashtag tanpa awalan `#` hanya memuat huruf/angka Unicode/underscore, unik, maksimal 15. Nilai generik tetap tersedia; varian YouTube, TikTok, dan Instagram (judul opsional, caption, hashtag) disimpan di `platformCaptions` bila tersedia. Metadata muncul di klip terbaru, detail job, dan snapshot SSE. |
| FR-5.4a | Pengguna memilih bahasa caption sosial per job lewat `captionLanguage` (`auto` / `id` / `en`, default `auto`) pada `POST /api/jobs` | `auto` menulis caption dalam bahasa yang sama dengan transkrip (perilaku lama); `id` menulis dalam Bahasa Indonesia; `en` menulis dalam bahasa Inggris; hashtag boleh mengikuti bahasa pilihan. Nilai divalidasi `@IsIn(CAPTION_LANGUAGES)`, tersimpan di kolom `jobs.captionLanguage`, dikirim di `JobData`, dipertahankan oleh retry/regenerate, dan muncul di respons daftar/detail job serta snapshot SSE. Worker memakai `auto` bila field absen atau tidak dikenal. Worker juga mengirim cuplikan transkrip tiap klip (`ClipResult.transcript`, ≤ 2.000 karakter, hanya bila tidak kosong) yang disimpan API di `clips.transcript` (trim, maks 2.000) |
| FR-5.4c | Pengguna dapat mengisi hashtag kustom per job lewat `customHashtags` (array string atau string dipisah spasi/koma/`#`) pada `POST /api/jobs` | Dinormalisasi `normalizeCustomHashtags`: hanya huruf/angka Unicode/underscore, maks 50 karakter per tag, dedupe case-insensitive (penulisan pertama dipertahankan), maks 15 tag; DTO menolak string > 500 karakter atau array > 30 item / item > 100 karakter. Tersimpan di `jobs.customHashtags` (default `[]`), dikirim di `JobData`, dipertahankan retry, dan muncul di snapshot job/SSE. Bila diisi, worker LLM **tidak membuat hashtag otomatis** (prompt memerintahkan `hashtags: []`, hashtag hasil LLM diabaikan, hashtag inline di caption dibuang) dan `clip.hashtags` = hashtag kustom, baik saat pembuatan caption job maupun regenerasi caption satu klip (FR-5.4b); bila LLM tidak tersedia/gagal, klip tetap mendapat hashtag kustom. Kosong → perilaku hashtag otomatis lama |
| FR-5.4b | Pengguna meregenerasi caption satu klip dalam bahasa pilihan lewat `POST /api/clips/:id/caption` body `{ language }` | Hanya klip milik pengguna yang belum dihapus (lainnya → 404); `language` di luar `auto`/`id`/`en` → 400. API mengantrekan job ke antrean BullMQ `captions` (concurrency 2) berisi judul, transkrip klip (boleh `null` untuk klip lama), caption saat ini, dan deskripsi job, lalu menunggu hasil maksimal 60 detik. Sukses → 200 `{ caption, hashtags, platformCaptions }` yang sudah disanitasi (hashtag kustom job menggantikan hashtag generik dan per platform) seperti FR-5.4 dan tersimpan di klip. Klip lama tanpa transkrip ditulis ulang/diterjemahkan dari judul + caption lama. LLM tidak dikonfigurasi, gagal, jawaban tidak valid, atau timeout → 503 `{ message: 'caption_unavailable' }` tanpa mengubah klip. Job antrean `captions` dibuang otomatis saat selesai/gagal |
| FR-5.5 | Halaman `/settings` (menu akun → Settings) menampilkan akun terhubung per platform | YouTube/Instagram/TikTok tampil berurutan; platform belum tersedia diberi label Coming soon, YouTube tanpa kredensial server menampilkan tombol Connect nonaktif beserta petunjuk. Akun bisa lebih dari satu per platform, punya tombol Reconnect saat akses kedaluwarsa, dan Disconnect lewat konfirmasi. Hasil OAuth (`connected` / `social_error`) tampil sebagai toast lalu query dibersihkan |

### FR-5 Publikasi Sosial — Fase 2: Publish dan Penjadwalan (P1)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-5.6 | Pengguna mempublikasikan klip yang sudah dirender ke 1..5 akun terhubung melalui `POST /api/clips/:id/publish` | YouTube: judul 1..100 tanpa `<`/`>`, caption 0..5000, privasi `public`/`unlisted`/`private`, `madeForKids` opsional. Instagram: caption ≤ 2200 UTF-16, privasi selalu `public`. `scheduledAt` ISO opsional per permintaan atau per target (prioritas target) menentukan status awal `scheduled` atau `queued` (langsung). Klip/akun bukan milik pengguna → 404; publikasi aktif ganda untuk klip+akun → 409; sukses → 201. |
| FR-5.7 | Sistem mengunggah klip lewat resumable upload YouTube dan melaporkan status | Status berjalan `queued → uploading → processing → published` dengan progres unggah 0..100; unggahan di-stream per chunk 8 MiB dan dilanjutkan otomatis saat galat sementara; URL hasil berbentuk `https://youtube.com/shorts/<id>`; status pemrosesan dicek tiap 15 detik hingga ±20 menit |
| FR-5.8 | Kegagalan publikasi ditampilkan dengan alasan singkat dan dapat diulang | Galat Google (kuota, batas unggah, channel belum dibuat, akses ditolak, otorisasi kedaluwarsa → "Reconnect your account") disimpan sebagai pesan singkat tanpa token; `POST /api/publications/:id/retry` menerima publikasi `failed` atau `cancelled` dan memasukkannya kembali ke antrean langsung tanpa jadwal lama |
| FR-5.9 | Pengguna melihat riwayat dan badge publikasi klip | `GET /api/clips/:id/publications` mengembalikan riwayat terbaru dulu; klip terbaru, detail job, dan SSE menyertakan `publications: { platform, status, externalUrl, scheduledAt, … }[]` (terbaru per akun) |
| FR-5.10 | Publikasi yang terputus dipulihkan saat API dinyalakan ulang | Publikasi `queued` dan `scheduled` tanpa job antrean dimasukkan ulang (dengan sisa penundaan bila jadwal belum tiba); `uploading` lebih tua dari 1 jam ditandai `failed` (interrupted); `processing` dicek ulang |
| FR-5.11 | Pengguna mempublikasikan klip ke TikTok dalam dua mode lewat `POST /api/clips/:id/publish` | Target TikTok memuat `mode` (`direct` default / `inbox`), `title` opsional (boleh kosong), caption ≤ 2200 UTF-16, dan `tiktok: { privacyLevel, disableComment, disableDuet, disableStitch, brandContent, brandOrganic }` untuk direct; inbox mengabaikan opsi dan caption. YouTube tidak berubah (judul/privasi tetap wajib). `privacy` disimpan sebagai privacy level direct atau `inbox`; opsi tersimpan di `publications.options` (JSONB) |
| FR-5.12 | Sistem memvalidasi dan mengunggah ke TikTok secara aman | Sebelum init, `creator_info` segar dipakai untuk menolak privacy level yang tidak diizinkan dan durasi klip melebihi batas akun; `brandContent` + `SELF_ONLY` → 400. Chunk FILE_UPLOAD 5–64 MiB (minimal 64 MiB untuk file > 64 MiB), `total_chunk_count = floor(size/chunk_size)`, PUT berurutan dengan `Content-Range`. Status dicek tiap 5 detik maksimal 10 menit; `SEND_TO_USER_INBOX`/`PUBLISH_COMPLETE` → `published` untuk inbox, `PUBLISH_COMPLETE` untuk direct; URL hanya dibentuk bila ada post id dan username |
| FR-5.13 | Jadwalkan publikasi satu job sekaligus lewat `POST /api/jobs/:id/schedule-publish` | Klip dipilih berurutan atau diprioritaskan dari skor viral tertinggi. Semua akun pada klip yang sama berbagi slot; interval antarklip 0,5–168 jam. Pasangan yang aktif atau sudah dipublikasikan dilewati dan dilaporkan. Metadata per platform diutamakan; bila tidak ada, gunakan metadata generik. TikTok default inbox, YouTube default privat. |
| FR-5.14 | Batalkan publikasi lewat `POST /api/publications/:id/cancel` | Hanya publikasi milik pengguna yang masih `scheduled` atau `queued` dapat menjadi `cancelled`; setelah unggah dimulai, pembatalan ditolak. |

## 9. Model Data (Ringkas)

Database menggunakan PostgreSQL dengan Prisma ORM.

- **`users`** — `id` (UUID), `email` (unique), `name`, `passwordHash` (scrypt), `createdAt`.
- **`sessions`** — `id` (UUID), `userId` (FK ke `users`, cascade delete), `tokenHash` (SHA-256 unique), `expiresAt`, `createdAt`.
- **`jobs`** — `id` (UUID), `url`, `primarySource` (JSON opsional), `splitScreen` (JSON opsional), `description` (opsional), `mode` (`auto` / `manual`), `reframe` (string, default `center_crop`), `captions` (boolean, default `true`), `hookBanner` (boolean, default `false`), `normalizeAudio` (boolean, default `true`), `twoSpeakers` (boolean, default `false`, hanya berlaku untuk 9:16), `facecam` (boolean, default `false`, hanya 9:16 dan bila `twoSpeakers` nonaktif), `aspectRatio` (string, default `9:16`), `captionLanguage` (string, default `auto`; `auto`/`id`/`en`), `customHashtags` (array string, default `[]`; hashtag kustom, maks 15), `clipCount` (int), `targetDurationSec` (int), `maxSourceSec` (int opsional, 60–36000 detik, NULL = durasi penuh; hanya dipakai mode auto), `ranges` (JSON), `status` (`queued`, `running`, `done`, `failed`, `cancelled`), `stage`, `progress`, `message`, `error`, `userId` (FK ke `users`, set null), `createdAt`, `startedAt`, `finishedAt`.
- **`media_assets`** — unggahan milik pengguna dengan nama, path relatif, MIME, durasi, dimensi, ukuran, dan waktu unggah.
- **`clips`** — `id` (UUID), `jobId` (FK ke `jobs`, cascade delete), `title`, `startSec` (float), `endSec` (float), `filePath`, `caption` (opsional), `hashtags` (array), `platformCaptions` (JSON opsional), `transcript` (cuplikan transkrip klip ≤ 2.000 karakter, opsional; NULL untuk klip lama), `viralScore` (integer 0–100 atau NULL), `hookText` (teks hook ≤ 80 karakter atau NULL), `downloadedAt` (timestamp opsional), `deletedAt` (timestamp opsional), `createdAt`.
- **`social_accounts`** — akun platform per pengguna dengan identitas eksternal, profil, scope, access/refresh token terenkripsi, dan waktu kedaluwarsa; unik per `(userId, platform, externalId)` dan cascade saat pengguna dihapus.
- **`publications`** — status unggah klip ke akun sosial (`scheduled`, `queued`, `uploading`, `processing`, `published`, `failed`, `cancelled`), `scheduledAt` (timestamp opsional), `title`, caption/privacy, `madeForKids`, `progress` (persen unggah), ID/URL eksternal, error, jumlah percobaan, dan `publishedAt`. Diproses antrean BullMQ `publish` di API.

Preview momen **tidak** memakai tabel database. Data preview hidup di antrean BullMQ/Redis (`previews`); job preview yang selesai/gagal dibuang otomatis setelah 1 jam.

## 10. Permukaan API

Semua endpoint berawalan `/api`. Sesi diautentikasi lewat cookie `clipper_session` atau header `Authorization: Bearer <token>`.

| Endpoint | Method | Fungsi | Akses |
| --- | --- | --- | --- |
| `/api/auth/register` | POST | Mendaftar akun baru (hanya jika pengguna pertama atau `ALLOW_REGISTRATION=true`) | Publik |
| `/api/auth/login` | POST | Masuk dan menerbitkan sesi cookie | Publik |
| `/api/auth/logout` | POST | Menghapus sesi dari DB dan mengosongkan cookie | Sesi |
| `/api/auth/me` | GET | Mendapatkan informasi profil pengguna yang sedang login | Sesi |
| `/api/auth/config` | GET | Cek apakah pendaftaran pengguna baru sedang terbuka | Publik |
| `/api/jobs` | POST | Membuat job baru | Sesi |
| `/api/jobs` | GET | Mengambil daftar job milik pengguna | Sesi |
| `/api/jobs/:id` | GET | Mengambil detail job beserta daftar klip miliknya | Sesi (hanya pemilik) |
| `/api/jobs/:id` | DELETE | Menghapus job: membatalkan bila masih queued/running, menghapus semua file klip, lalu menghapus baris job (klip cascade) | Sesi (hanya pemilik) |
| `/api/jobs/:id/cancel` | POST | Membatalkan job yang sedang mengantre atau berjalan | Sesi (hanya pemilik) |
| `/api/jobs/:id/retry` | POST | Membuat job baru dari konfigurasi job lama; hanya job `failed`/`cancelled` (400 selain itu), job lama tidak diubah | Sesi (hanya pemilik) |
| `/api/jobs/:id/events` | GET | Aliran Server-Sent Events (SSE) status & progres job | Sesi (hanya pemilik) |
| `/api/previews` | POST | Memindai sumber untuk kandidat LLM + transkrip tanpa render; menerima `url` atau `primarySource`, `splitScreen` opsional, dan parameter pemindaian | Sesi |
| `/api/previews/:id` | GET | Status preview beserta `candidates` dan `cues` bila selesai; 404 bila tidak ada, kedaluwarsa, atau milik pengguna lain | Sesi (hanya pemilik) |
| `/api/media` | GET / POST | Daftar unggahan milik pengguna / unggah satu file multipart (`file`, `name` opsional) | Sesi |
| `/api/media/:id/file` | GET | Putar file unggahan (HTTP byte-range) | Sesi (hanya pemilik) |
| `/api/media/:id` | DELETE | Hapus unggahan (204) | Sesi (hanya pemilik) |
| `/api/clips/:id/stream` | GET | Streaming video klip (mendukung HTTP Range header) | Sesi (hanya pemilik) |
| `/api/clips/:id/download` | GET | Mengunduh file video klip dan mencatat `downloadedAt` | Sesi (hanya pemilik) |
| `/api/clips/:id/caption` | POST | Meregenerasi caption sosial klip dalam bahasa `{ language: 'auto' \| 'id' \| 'en' }` lewat antrean `captions`; 200 `{ caption, hashtags }` (tersimpan di klip), 404 bukan milik/terhapus, 503 `caption_unavailable` bila LLM gagal/timeout 60 detik | Sesi (hanya pemilik) |
| `/api/clips/:id` | DELETE | Menghapus file fisik klip dari disk dan menghapus baris DB | Sesi (hanya pemilik) |
| `/api/social/providers` | GET | Mengambil status konfigurasi/ketersediaan YouTube, Instagram, dan TikTok | Sesi |
| `/api/social/accounts` | GET | Mengambil akun sosial terhubung milik pengguna tanpa token | Sesi |
| `/api/social/accounts/:id` | DELETE | Memutuskan akun sosial; YouTube/TikTok direvokasi best-effort | Sesi (hanya pemilik) |
| `/api/social/youtube/connect` | GET | Memulai OAuth YouTube dengan state dan PKCE | Sesi |
| `/api/social/youtube/callback` | GET | Menyelesaikan OAuth, menyimpan channel, lalu redirect ke settings | Sesi |
| `/api/clips/:id/publish` | POST | Mempublikasikan klip ke 1..5 akun YouTube; membuat publikasi `queued` dan mengembalikan `PublicationResponse[]` (201) | Sesi (hanya pemilik) |
| `/api/clips/:id/publications` | GET | Riwayat publikasi klip, terbaru dulu | Sesi (hanya pemilik) |
| `/api/publications/:id/retry` | POST | Mengulang publikasi `failed` | Sesi (hanya pemilik) |
| `/api/system/llm-status` | GET | Memeriksa status kesiapan LLM worker dari Redis | Sesi |

## 11. Kebutuhan Non-Fungsional

- **Kapasitas:** Worker memproses satu job render sekaligus; consumer preview terpisah berjalan dengan concurrency 2.
- **Penyimpanan:** Bind mount bersama `/srv/storage/clips` → `/data/clips` di API dan worker menampung klip dan unggahan lokal. Rust membersihkan direktori kerja sementara setelah pemrosesan.
- **Keamanan:** Hash password menggunakan `scrypt`. Token sesi berupa string acak `base64url` yang disimpan dalam bentuk hash SHA-256. Semua path file di disk dibentuk dari ID database dan divalidasi tidak keluar dari direktori `CLIPS_DIR`.
- **UI/UX & Desain:** Antarmuka web modern dibangun dengan TanStack Start, TanStack Query, shadcn/ui, dan Tailwind v4. Mendukung dwibahasa (Inggris sebagai default, Bahasa Indonesia via cookie `clipper_language`), serta tema gelap, terang, dan sistem via cookie `clipper_theme`.
- **Standar library:** Fitur yang butuh library memakai produk TanStack lebih dulu bila tersedia (routing, state server, form + validasi, tabel, virtualisasi). Form dan validasi memakai `@tanstack/react-form`; validasi skema mengikuti aturan API (batas nilai, pesan error) agar pesan klien dan server konsisten.
- **Standar kerja UI:** Pembuatan atau perubahan UI wajib mengikuti skills Antislop (core + UI) — tanpa gradient dekoratif tanpa alasan, tanpa kartu berlebih, hierarki tipografi dan jarak yang konsisten.
- **Jaringan & Proksi:** Aplikasi web bertindak sebagai reverse proxy yang meneruskan permintaan `/api/*` ke `API_INTERNAL_URL`, menjaga cookie tetap berada di domain origin yang sama.

## 12. Batasan dan Dependensi Eksternal

- **Dokploy & Docker:** Lingkungan orkestrasi kontainer di VPS tunggal dengan database PostgreSQL dan Redis terkelola.
- **Cloudflare Tunnel:** Menyediakan akses publik HTTPS yang aman ke domain `clipper.rencraft.site` (Web) dan `api-clipper.rencraft.site` (API internal/eksternal).
- **yt-dlp dan STT:** yt-dlp mengambil media URL dan subtitle yang tersedia; sumber lokal dapat ditranskripsi melalui layanan STT yang kompatibel dengan API OpenAI.
- **OpenAI-compatible LLM:** Wajib terhubung ke penyedia LLM untuk menjalankan mode otomatis.
- **YuNet:** Worker Rust memakai deteksi wajah YuNet untuk mode berbasis wajah, termasuk `face_tracking`.
- **ffmpeg:** Rendering video potret H.264 (`yuv420p`), audio AAC, dan pembakaran takarir ASS kata per kata.

## 13. Glosarium

| Istilah | Arti |
| --- | --- |
| **Job** | Satu permintaan pemrosesan video utama, dengan B-roll opsional untuk Split Screen |
| **Klip** | Potongan vertikal 9:16 hasil pemotongan dan pembingkaian video |
| **Mode Otomatis** | LLM memilih momen klip terbaik berdasarkan subtitle dan brief opsional |
| **Mode Manual** | Pengguna menentukan sendiri daftar timestamp mulai dan selesai |
| **Reframe** | Metode transformasi video lanskap ke format potret 9:16 (`center_crop`, `face_tracking`, `blurred_fill`, `black_bars`) |
| **Captions** | Takarir kata per kata (gaya karaoke) yang dibakar langsung ke video |
| **Regenerate** | Mengisi ulang formulir dashboard dengan konfigurasi job sebelumnya untuk membuat job baru |
| **Retry** | Membuat job baru dari konfigurasi job lama yang `failed`/`cancelled` lewat `POST /api/jobs/:id/retry`; job lama tetap utuh |
| **Preview / Tinjau Momen** | Pindai sumber tanpa merender klip, lalu tinjau kandidat, transkrip, dan timeline B-roll bila aktif sebelum membuat job manual |
| **Dokploy** | Panel orkestrasi deployment Docker di server VPS |
