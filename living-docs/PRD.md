# PRD — Clipper (Generator Klip Vertikal)

**Status:** aktif · **Versi:** 2.0 · **Terakhir diperbarui:** 23 November 2026
**Dokumen terkait:** `IMPLEMENTATION_PLAN.md` (arsitektur, skema database, API contract, deployment)

---

## 1. Ringkasan

Clipper adalah alat internal untuk mengubah satu video panjang (podcast, wawancara, ceramah) menjadi beberapa klip vertikal 9:16 yang siap diunggah ke TikTok, Reels, dan Shorts.

Pengguna menempelkan URL video, memilih mode **otomatis** (AI memilih momen paling menarik berdasarkan subtitle dan instruksi brief opsional) atau **manual** (menentukan rentang waktu sendiri), lalu mengunduh hasilnya dari browser. Seluruh proses berat — unduh video, ekstraksi subtitle YouTube, pemilihan momen oleh LLM, pelacakan wajah atau pembingkaian potret, burning takarir kata per kata ASS, dan encoding video — berjalan di worker server milik sendiri, bukan di laptop pengguna.

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
- **Tidak mengedit video secara kreatif bebas.** Tidak ada timeline editor multi-track, transisi kompleks, musik latar kustom, atau b-roll.
- **Tidak melakukan transkripsi audio mandiri di server.** Worker tidak lagi menyertakan Whisper; pipeline mengandalkan subtitle resmi/auto YouTube. Video tanpa subtitle YouTube ditolak secara eksplisit.
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
3. **Buat job atau Tinjau Momen** — tempel URL video (YouTube, TikTok, Instagram):
   - **Mode otomatis langsung:** LLM memilih momen, lalu batas tiap momen dirapikan dua lapis — refinement LLM (`LLM_REFINE`, default aktif) dan snap deterministik ke batas cue/kalimat — sebelum worker memproses video sampai render. Rentang manual/transkrip pilihan pengguna tidak ikut dirapikan.
   - **Opsi "Tinjau Momen" (Review Moments):** sistem memindai URL terlebih dahulu (`POST /api/previews`), worker hanya mengunduh subtitle dan memanggil LLM (tanpa unduh video/render). Kandidat melewati rapian dua lapis yang sama dengan mode auto (refinement LLM + snap). Pengguna melihat daftar kandidat momen LLM dan transkrip penuh (`GET /api/previews/:id`). Pengguna memilih kandidat atau rentang transkrip untuk dijadikan job manual normal (`POST /api/jobs`); kandidat LLM membawa `title`/`reason` aslinya sehingga judul klip dipertahankan. Hasil preview otomatis kedaluwarsa setelah 1 jam.
     - **Draf bertahan saat berpindah halaman:** URL, mode, reframe, takarir, jumlah klip, durasi, deskripsi, rentang manual, status tinjau momen, `previewId`, pilihan kandidat, rentang transkrip, serta cue awal/akhir disimpan di `sessionStorage` per tab browser (tanpa token/sesi) dan dipulihkan saat pengguna kembali ke dashboard. Polling `GET /api/previews/:id` otomatis berlanjut dari `previewId` tersimpan.
     - Draf dihapus setelah job dibuat, saat pengguna mematikan opsi tinjau momen, atau bila preview sudah kedaluwarsa (404): dashboard menampilkan pesan "preview kedaluwarsa" dan tombol pindai ulang, sambil mempertahankan URL dan parameter lain.
   - **Mode manual langsung:** pengguna menentukan sendiri rentang waktu `{start, end}`.
   - Parameter auto: jumlah klip (1–10, default 3 untuk job, default 5 untuk preview), durasi target (15–180 detik, default 45), deskripsi/arahan konten singkat (opsional, maks 500 karakter), dan batas pemindaian sumber `maxSourceSec` (opsional, 60–36000 detik; kosong = durasi penuh). Bila diisi, hanya bagian 0–limit yang dipindai (preview) atau diunduh (job auto); mode manual mengabaikan nilai ini.
   - Rentang manual: daftar 1–10 rentang waktu `{start, end}` dalam detik; `title`/`reason` opsional hanya dikirim untuk kandidat hasil tinjauan LLM. Tanpa judul, worker memakai fallback `Clip mm:ss–mm:ss`.
   - Pilihan reframe: `face_tracking` (default), `blurred_fill`, atau `black_bars`. Berlaku untuk rasio 9:16 dan 1:1; diabaikan untuk 16:9.
   - Opsi takarir (`captions`): aktif (default) atau nonaktif.
   - Pilihan rasio output (`aspectRatio`): `9:16` (default, 1080x1920), `1:1` (1080x1080, reframe diterapkan ke target persegi), atau `16:9` (1920x1080 landscape; sumber di-skala pas dan di-pad hitam bila bukan 16:9 — reframe diabaikan).
   - Opsi dua pembicara (`twoSpeakers`): nonaktif (default) atau aktif; hanya berlaku untuk rasio 9:16 (API menormalkan ke `false` untuk 1:1/16:9). Bila aktif, klip 1080x1920 dibagi dua panel 1080x960 (atas/bawah) berisi dua pembicara dominan; pilihan reframe diabaikan.
   - Opsi layout streamer (`facecam`): nonaktif (default) atau aktif; hanya 9:16 dan eksklusif dengan `twoSpeakers` (API menormalkan ke `false` bila rasio bukan 9:16 atau `twoSpeakers` aktif). Bila aktif, facecam (wajah terkecil yang terdeteksi FaceMesh) di-crop ke panel atas 1080x640 dan gameplay (crop tengah) ke panel bawah 1080x1280; pilihan reframe diabaikan. Bila wajah tidak terdeteksi (<50% sampel), fallback ke reframe biasa.
4. **Pantau** — job masuk antrean `clip-jobs` di BullMQ; dashboard dan halaman detail menampilkan tahapan nyata secara real-time via Server-Sent Events (`download` → `transcribe` → `select` → `render` → `save`).
5. **Kontrol** — pengguna dapat membatalkan job yang sedang berjalan via tombol Batal (`POST /api/jobs/:id/cancel`), atau mengulang job `failed`/`cancelled` langsung (`POST /api/jobs/:id/retry` membuat job baru dari konfigurasi lama tanpa mengubah job lama).
6. **Tinjau & Putar** — buka detail job, putar klip di player 9:16 (`GET /api/clips/:id/stream` mendukung HTTP byte-range), salin judul klip.
7. **Buat Ulang (Regenerate)** — klik "Buat ulang" (`/?from=<jobId>`) untuk mengisi form dashboard dengan parameter job sebelumnya guna membuat job baru.
8. **Unduh atau Hapus** — unduh file video langsung via browser (`GET /api/clips/:id/download`), hapus klip seketika (`DELETE /api/clips/:id`), atau hapus keseluruhan job beserta klip dan file fisiknya (`DELETE /api/jobs/:id`).

## 7. Lingkup dan status fitur

Dashboard memakai shell dua kolom (sidebar sempit, satu header ringkas di mobile) dengan preferensi bahasa (EN/ID) dan tema di header, pencarian klien-side klip terbaru (`⌘K`), dan satu composer: URL sebagai jangkar, satu pilihan mode otomatis/manual, opsi bertanda teks (bukan ikon saja), serta tombol yang menyebut hasilnya ("Buat {n} klip"). Di bawahnya ada bagian **Sedang diproses** (job antre/berjalan dengan tahap, persen, dan bar progres; job gagal ditampilkan ringkas dengan alasannya) dan carousel **Klip terbaru** dengan dua kartu di ponsel hingga enam di desktop, frame pratinjau 9:16 hitam seragam (rasio sumber lain letterbox), judul dua baris dan metadata tetap sejajar, navigasi/paginasi mint, serta dialog player ber-kontrol dan tautan sekunder ke job. Halaman **Pekerjaan** (`/jobs/`) memuat semua job dalam baris responsif dengan sumber, status/tahap, progres aktif, jumlah klip dan umur relatif; tautan tersedia dari sidebar desktop maupun header ponsel. Halaman detail job menampilkan lima tahap berurutan (selesai/berjalan/menunggu), aksi lanjut untuk job gagal/dibatalkan, dan kartu klip dengan rank `#n`, durasi, rentang waktu sumber, unduh, dan hapus. Login/daftar berupa form ringkas tanpa dekorasi. Gaya visual mengacu ke produk clipper gelap: kanvas `#09090B`, surface `#121214`, garis tipis `#27272A`, tombol utama putih, aksen mint `#5CE1C4` hanya untuk state aktif/progres/fokus, radius kontrol 6px, tanpa shadow/gradient; angka dan durasi memakai font mono tabular. Tema terang memakai padanan putih/zinc dengan aksen teal `#087f68`.

| Prioritas | Fitur | Status |
| --- | --- | --- |
| **P0** | Multi-user auth (`users` + `sessions`, scrypt, httpOnly cookie `clipper_session`, claim legacy jobs) | Selesai |
| **P0** | Pipeline video vertikal (yt-dlp, YouTube VTT subtitles, LLM OpenAI-compatible, takarir ASS hook per kata, ffmpeg) | Selesai |
| **P0** | Akurasi potongan: refinement dua-pass LLM (`LLM_REFINE`) + snap deterministik ke batas cue/kalimat untuk momen auto & preview | Selesai |
| **P0** | Pilihan mode reframe (`face_tracking` / pembicara aktif via MediaPipe FaceMesh, `blurred_fill`, `black_bars`) | Selesai |
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
| FR-1.4 | Isolasi data per pengguna pada job dan klip | Request job/klip milik pengguna lain mengembalikan 404 Not Found |

### FR-2 Pembuatan Job (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-2.1 | Validasi URL sumber hanya untuk host yang didukung: YouTube, TikTok, Instagram | Host lain atau URL cacat → 400 Bad Request |
| FR-2.2 | Pilihan mode: `auto` (LLM) atau `manual` (rentang timestamp) | Parameter divalidasi sesuai mode yang dipilih |
| FR-2.3 | Parameter mode auto: `clipCount` (1–10, default 3), `targetDurationSec` (15–180 detik, default 45), dan `description` (brief arahan LLM, maks 500 karakter) | Parameter tersimpan di database dan diteruskan ke worker |
| FR-2.4 | Parameter mode manual: `ranges` berisi array 1–10 rentang `{start, end}` dengan `start >= 0` dan `end > start`, serta field opsional `title` (maks. 70 karakter) dan `reason` (maks. 200 karakter) yang diawetkan dari kandidat tinjauan LLM | Validasi gagal bila rentang kosong, durasi negatif, atau melebihi 10 rentang. Rentang manual murni/transkrip tanpa judul menggunakan judul fallback timestamp `Clip mm:ss–mm:ss` |
| FR-2.5 | Pilihan mode reframe: `face_tracking` (default), `black_bars`, `blurred_fill` | Nilai tersimpan di database dan memengaruhi filter ffmpeg |
| FR-2.6 | Pengaturan takarir (`captions`): boolean (default `true`) | Jika `false`, render klip melewatkan pembakaran subtitle ASS |
| FR-2.9 | Opsi dua pembicara (`twoSpeakers`): boolean (default `false`); hanya berlaku untuk `aspectRatio` 9:16 — dinormalisasi ke `false` oleh API untuk 1:1/16:9 | Nilai tersimpan di database, diteruskan ke antrean/worker, dan memengaruhi filter ffmpeg; bila `true` pada 9:16, output 1080x1920 dibagi dua panel 1080x960 (vstack) dan pilihan reframe diabaikan |
| FR-2.10 | Pilihan rasio output (`aspectRatio`): `9:16` (default) / `1:1` / `16:9` | Nilai divalidasi `@IsIn(ASPECT_RATIOS)`, tersimpan di database (default `9:16`), diteruskan ke antrean/worker, dan menentukan ukuran render: 9:16 = 1080x1920, 1:1 = 1080x1080 (mode reframe diterapkan ke target persegi), 16:9 = 1920x1080 (reframe diabaikan: skala pas + pad hitam bila sumber bukan 16:9). Ukuran font/margin takarir diskalakan relatif tinggi output; PlayResX/PlayResY ASS = ukuran output nyata |
| FR-2.11 | Batas pemindaian sumber (`maxSourceSec`): integer opsional 60–36000 detik; kosong/`null` = durasi penuh (default). Hanya berlaku untuk mode auto dan preview; mode manual mengabaikannya karena rentangnya sudah eksplisit | Nilai divalidasi `@IsInt @Min(60) @Max(36000)`, tersimpan di database (`Int?`, default NULL), dan diteruskan ke antrean/worker. Preview hanya memindai cue yang mulai sebelum limit (cue yang melintasi limit dipotong di limit) dan mengembalikan hanya cue itu; kandidat momen berakhir ≤ limit. Job auto hanya mengunduh 0–limit via `--download-sections` (satu section, offset 0) dengan fallback unduh penuh bila section tanpa stream video; momen berakhir ≤ limit. Bila video lebih pendek dari limit, perilakunya sama seperti durasi penuh |
| FR-2.7 | Tombol Buat Ulang (Regenerate) dari halaman detail job | Mengarahkan ke dashboard `/?from=<jobId>` dengan nilai form terisi otomatis dari job lama untuk membuat job baru |
| FR-2.8 | Opsi "Tinjau Momen" pada mode otomatis: memindai URL untuk mendapatkan kandidat momen LLM dan transkrip penuh sebelum membuat job | `POST /api/previews` mengembalikan `{id}`; `GET /api/previews/:id` menampilkan kandidat `{start,end,title,reason}` dan cue `{start,end,text}`; pengguna memilih kandidat/rentang lalu membuat job manual via `POST /api/jobs`. Pilihan kandidat LLM mengawetkan `title` dan `reason` ke dalam payload rentang manual sehingga judul klip tidak hilang saat dirender. Preview hanya tersimpan di Redis/BullMQ dan kedaluwarsa setelah 1 jam. Mode otomatis langsung dan mode manual tidak berubah |
| FR-2.12 | Pengulangan job (`POST /api/jobs/:id/retry`): membuat job **baru** dari konfigurasi job lama (URL, deskripsi, mode, reframe, captions, twoSpeakers, aspectRatio, captionLanguage, clipCount, targetDurationSec, rentang beserta `title`/`reason`, dan `maxSourceSec`) | Hanya untuk job berstatus `failed` atau `cancelled`; status lain → 400 Bad Request. Job non-pemilik → 404. Job baru dibuat lewat jalur create yang sama (validasi URL, normalisasi `twoSpeakers`/`maxSourceSec`/rentang, dan payload antrean BullMQ) lalu mengembalikan snapshot job baru; job lama tidak diubah |

### FR-3 Pemrosesan dan Pipeline Worker (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-3.1 | Worker terpisah berbasis Python 3.12 mengonsumsi antrean BullMQ `clip-jobs` (concurrency 1) | Job diproses satu per satu secara berurutan |
| FR-3.2 | Worker memverifikasi ruang disk minimum (`MIN_FREE_GB`, default 5 GB) sebelum memulai | Jika ruang disk di bawah ambang, job gagal cepat dengan pesan jelas |
| FR-3.3 | Pengunduhan video menggunakan `yt-dlp` format MP4 terbaik dan ekstraksi subtitle YouTube. Mode `auto` mengunduh video penuh, atau hanya 0–`maxSourceSec` via `--download-sections` (satu section, offset 0) bila batas pemindaian diisi; mode `manual` hanya mengunduh rentang terpilih via `--download-sections` (satu file per rentang). Subtitle asli YouTube (manual diutamakan, fallback auto-subs) tetap diunduh penuh. | Jika video tidak memiliki track subtitle YouTube, job gagal dengan pesan: `"Subtitle YouTube tidak tersedia untuk video ini."`. Job manual menghemat bandwidth/disk tanpa mengunduh segmen video di luar rentang. Section tanpa stream video jatuh ke unduhan video penuh; bila video lebih pendek dari limit, perilakunya sama seperti durasi penuh |
| FR-3.4 | Pemilihan momen mode otomatis mewajibkan konfigurasi LLM OpenAI-compatible (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) | Jika LLM gagal atau tidak dikonfigurasi, job langsung gagal (tanpa fallback berbasis aturan) |
| FR-3.4a | Akurasi potongan dua-pass: setelah pemilihan awal, satu panggilan LLM tambahan menggeser `start`/`end` tiap kandidat agar klip dimulai di awal pemikiran/hook yang utuh dan berakhir setelah payoff/kalimat selesai (konteks excerpt transkrip ±20 detik, durasi tetap dalam batas target). Brief/deskripsi pengguna diteruskan ke prompt pass-2 dalam blok `<preferensi>` dan LLM diminta menjaga relevansi tiap klip terhadapnya. Berlaku untuk job `auto` dan kandidat "Tinjau Momen" (`run_preview`). Flag `LLM_REFINE` default aktif; `0`/`false`/`no`/`off` mematikan pass-2 | Kandidat dengan hasil refinement tidak valid (angka bukan finit, di luar jendela excerpt, `end <= start`, durasi di luar batas) tetap memakai hasil pass-1; error/timeout LLM refinement tidak menggagalkan job — semua kandidat memakai pass-1 |
| FR-3.4b | Snap deterministik ke batas cue/kalimat setelah refinement: `start` digeser ke awal cue terdekat (<= start) dalam jendela 3 detik; `end` mengutamakan batas kalimat (`.?!…`) atau jeda >= 0,4 detik hingga 6 detik ke depan (lookahead end lebih jauh daripada start) agar tidak berhenti di cue arbitrer saat batas pemikiran ada di dekatnya, dengan fallback ke akhir cue terdekat dalam 3 detik bila tidak ada batas kuat; bantalan `start - 0,15s` / `end + 0,25s` di-clamp ke durasi video, durasi dijaga dalam batas target, dan tumpang tindih antar klip dirapikan | Klip tidak mulai/berhenti di tengah kata atau kalimat; rentang manual/transkrip pilihan pengguna tidak diubah oleh refinement maupun snap |
| FR-3.5 | Subtitle diubah menjadi takarir ASS kata per kata (*karaoke style*) dengan deduplikasi *rolling auto-sub* | Teks subtitle tidak bertumpuk dan muncul sinkron per kata |
| FR-3.8 | Gaya takarir "hook": font tebal kondensasi Anton (OFL, fallback DejaVu), teks UPPERCASE putih, outline hitam 6px, bayangan lembut, kata aktif disorot kuning via event non-overlapping per kata window. `PlayResX`/`PlayResY` ASS = ukuran output nyata per `aspectRatio`; ukuran font dan margin bawah diskalakan relatif tinggi output (nilai referensi 9:16: font 80, margin 180; 1:1/16:9 memakai font lebih kecil). Chunk 4 kata / 18 karakter untuk 9:16 dan 1:1; 16:9 memuat 6 kata / 32 karakter. Mode dua pembicara memakai Alignment 5 (tengah, pada sambungan panel), mode satu pembicara memakai Alignment 2 (bawah) | Takarir tampil kontras tinggi, ringkas, sinkron per jendela kata, dan proporsional di semua rasio |
| FR-3.6 | Reframe dieksekusi dengan `libx264` format piksel `yuv420p` sesuai `aspectRatio` (9:16 = 1080x1920 default; 1:1 = 1080x1080 dengan target persegi): <br>- `face_tracking` (UI: Pembicara aktif / Active speaker): deteksi wajah dan analisis gerak bibir MediaPipe FaceMesh pada proxy ~360p/5fps, pemilihan wajah aktif dengan hysteresis dan min hold 0.9s, dipotong statis per segmen pembicara (maks 16 cut) lewat filter crop ffmpeg (fallback crop tengah bila tanpa wajah). <br>- `black_bars`: letterbox dengan latar hitam. <br>- `blurred_fill`: latar belakang video diburamkan (`boxblur`) dengan video utama di tengah. <br>- 16:9 (1920x1080): reframe diabaikan — sumber di-skala pas dan di-pad hitam bila bukan 16:9 (mayoritas sumber YouTube sudah 16:9). <br>- `twoSpeakers` hanya berlaku untuk 9:16; worker juga mengabaikannya secara defensif untuk rasio lain | Hasil video dapat diputar di semua browser modern dan seluler tanpa kendala kompatibilitas piksel |
| FR-3.7 | Pembatalan job (`POST /api/jobs/:id/cancel`): worker memeriksa kunci Redis `worker:cancel:<job_id>` di batas tahapan proses | Worker menghentikan proses secara aman, membersihkan direktori kerja sementara, dan menandai job `cancelled` |

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
| FR-5.1 | Sistem menampilkan provider sosial dan daftar akun terhubung milik pengguna melalui `GET /api/social/providers` dan `GET /api/social/accounts` | YouTube tersedia dan berstatus `configured` hanya bila kredensial Google serta kunci enkripsi terisi; Instagram/TikTok belum tersedia. Respons akun hanya memuat profil, waktu koneksi/kedaluwarsa, dan `needsReconnect`, tanpa token |
| FR-5.2 | Pengguna menghubungkan akun YouTube melalui OAuth dengan PKCE S256, scope upload/readonly, dan state sekali pakai yang terikat ke pengguna | Connect mengalihkan ke Google atau `social_error=not_configured`; callback yang valid menyimpan channel sebagai akun sosial dengan token terenkripsi lalu mengalihkan ke `connected=youtube`; state salah/kedaluwarsa dan error lain menghasilkan kode error singkat tanpa membocorkan token |
| FR-5.3 | Pengguna memutuskan akun sosial miliknya melalui `DELETE /api/social/accounts/:id` | Akun valid mengembalikan 204, YouTube direvokasi best-effort, dan data lokal terhapus; akun bukan milik pengguna mengembalikan 404 |
| FR-5.4 | Worker LLM menghasilkan caption dan hashtag opsional untuk setiap klip; API menormalkan dan menyertakannya pada respons klip | Caption di-trim maksimal 2.200 karakter; hashtag tanpa awalan `#` hanya memuat huruf/angka Unicode/underscore, unik, maksimal 15. Nilai tersimpan pada klip dan muncul di klip terbaru, detail job, dan snapshot SSE; field opsional dapat absen bila LLM tidak tersedia |
| FR-5.4a | Pengguna memilih bahasa caption sosial per job lewat `captionLanguage` (`auto` / `id` / `en`, default `auto`) pada `POST /api/jobs` | `auto` menulis caption dalam bahasa yang sama dengan transkrip (perilaku lama); `id` menulis dalam Bahasa Indonesia; `en` menulis dalam bahasa Inggris; hashtag boleh mengikuti bahasa pilihan. Nilai divalidasi `@IsIn(CAPTION_LANGUAGES)`, tersimpan di kolom `jobs.captionLanguage`, dikirim di `JobData`, dipertahankan oleh retry/regenerate, dan muncul di respons daftar/detail job serta snapshot SSE. Worker memakai `auto` bila field absen atau tidak dikenal. Worker juga mengirim cuplikan transkrip tiap klip (`ClipResult.transcript`, ≤ 2.000 karakter, hanya bila tidak kosong) yang disimpan API di `clips.transcript` (trim, maks 2.000) |
| FR-5.4b | Pengguna meregenerasi caption satu klip dalam bahasa pilihan lewat `POST /api/clips/:id/caption` body `{ language }` | Hanya klip milik pengguna yang belum dihapus (lainnya → 404); `language` di luar `auto`/`id`/`en` → 400. API mengantrekan job ke antrean BullMQ `captions` (worker Python, concurrency 2) berisi judul, transkrip klip (boleh `null` untuk klip lama), caption saat ini, dan deskripsi job, lalu menunggu hasil maksimal 60 detik. Sukses → 200 `{ caption, hashtags }` yang sudah disanitasi seperti FR-5.4 dan tersimpan di klip. Klip lama tanpa transkrip ditulis ulang/diterjemahkan dari judul + caption lama. LLM tidak dikonfigurasi, gagal, jawaban tidak valid, atau timeout → 503 `{ message: 'caption_unavailable' }` tanpa mengubah klip. Job antrean `captions` dibuang otomatis saat selesai/gagal |
| FR-5.5 | Halaman `/settings` (menu akun → Settings) menampilkan akun terhubung per platform | YouTube/Instagram/TikTok tampil berurutan; platform belum tersedia diberi label Coming soon, YouTube tanpa kredensial server menampilkan tombol Connect nonaktif beserta petunjuk. Akun bisa lebih dari satu per platform, punya tombol Reconnect saat akses kedaluwarsa, dan Disconnect lewat konfirmasi. Hasil OAuth (`connected` / `social_error`) tampil sebagai toast lalu query dibersihkan |

### FR-5 Publikasi Sosial — Fase 2: Publish ke YouTube (P1)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-5.6 | Pengguna mempublikasikan klip selesai ke 1..5 akun YouTube terhubung melalui `POST /api/clips/:id/publish` | Setiap target memuat judul 1..100 karakter tanpa `<`/`>`, caption 0..5000, privasi `public`/`unlisted`/`private`, dan `madeForKids` opsional. Sistem membuat satu publikasi `queued` per target dan mengembalikan 201. Clip/akun bukan milik pengguna → 404; akun non-YouTube → 400 `platform_unavailable`; clip belum siap → 400; publikasi aktif ganda untuk clip+akun → 409 |
| FR-5.7 | Sistem mengunggah klip lewat resumable upload YouTube dan melaporkan status | Status berjalan `queued → uploading → processing → published` dengan progres unggah 0..100; unggahan di-stream per chunk 8 MiB dan dilanjutkan otomatis saat galat sementara; URL hasil berbentuk `https://youtube.com/shorts/<id>`; status pemrosesan dicek tiap 15 detik hingga ±20 menit |
| FR-5.8 | Kegagalan publikasi ditampilkan dengan alasan singkat dan dapat diulang | Galat Google (kuota, batas unggah, channel belum dibuat, akses ditolak, otorisasi kedaluwarsa → "Reconnect your account") disimpan sebagai pesan singkat tanpa token; `POST /api/publications/:id/retry` hanya menerima publikasi `failed` dan memasukkannya kembali ke antrean |
| FR-5.9 | Pengguna melihat riwayat dan badge publikasi klip | `GET /api/clips/:id/publications` mengembalikan riwayat terbaru dulu; klip terbaru, detail job, dan SSE menyertakan `publications: { platform, status, externalUrl }[]` (terbaru per akun) |
| FR-5.10 | Publikasi yang terputus dipulihkan saat API dinyalakan ulang | Publikasi `queued` tanpa job antrean dimasukkan ulang; `uploading` lebih tua dari 1 jam ditandai `failed` (interrupted); `processing` dicek ulang |

## 9. Model Data (Ringkas)

Database menggunakan PostgreSQL dengan Prisma ORM.

- **`users`** — `id` (UUID), `email` (unique), `name`, `passwordHash` (scrypt), `createdAt`.
- **`sessions`** — `id` (UUID), `userId` (FK ke `users`, cascade delete), `tokenHash` (SHA-256 unique), `expiresAt`, `createdAt`.
- **`jobs`** — `id` (UUID), `url`, `description` (opsional), `mode` (`auto` / `manual`), `reframe` (string, default `face_tracking`), `captions` (boolean, default `true`), `twoSpeakers` (boolean, default `false`, hanya berlaku untuk 9:16), `facecam` (boolean, default `false`, hanya 9:16 dan bila `twoSpeakers` nonaktif), `aspectRatio` (string, default `9:16`), `captionLanguage` (string, default `auto`; `auto`/`id`/`en`), `clipCount` (int), `targetDurationSec` (int), `maxSourceSec` (int opsional, 60–36000 detik, NULL = durasi penuh; hanya dipakai mode auto), `ranges` (JSON), `status` (`queued`, `running`, `done`, `failed`, `cancelled`), `stage`, `progress`, `message`, `error`, `userId` (FK ke `users`, set null), `createdAt`, `startedAt`, `finishedAt`.
- **`clips`** — `id` (UUID), `jobId` (FK ke `jobs`, cascade delete), `title`, `startSec` (float), `endSec` (float), `filePath`, `caption` (opsional), `hashtags` (array), `transcript` (cuplikan transkrip klip ≤ 2.000 karakter, opsional; NULL untuk klip lama), `downloadedAt` (timestamp opsional), `deletedAt` (timestamp opsional), `createdAt`.
- **`social_accounts`** — akun platform per pengguna dengan identitas eksternal, profil, scope, access/refresh token terenkripsi, dan waktu kedaluwarsa; unik per `(userId, platform, externalId)` dan cascade saat pengguna dihapus.
- **`publications`** — status unggah klip ke akun sosial (`queued`, `uploading`, `processing`, `published`, `failed`), `title`, caption/privacy, `madeForKids`, `progress` (persen unggah), ID/URL eksternal, error, jumlah percobaan, dan `publishedAt`. Diproses antrean BullMQ `publish` di API.

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
| `/api/previews` | POST | Memindai URL untuk preview momen: kandidat LLM + transkrip (tanpa render), body `{url, description?, clipCount? (1–10, default 5), targetDurationSec? (15–180, default 45), maxSourceSec? (60–36000, default null = durasi penuh)}` | Sesi |
| `/api/previews/:id` | GET | Status preview beserta `candidates` dan `cues` bila selesai; 404 bila tidak ada, kedaluwarsa, atau milik pengguna lain | Sesi (hanya pemilik) |
| `/api/clips/:id/stream` | GET | Streaming video klip (mendukung HTTP Range header) | Sesi (hanya pemilik) |
| `/api/clips/:id/download` | GET | Mengunduh file video klip dan mencatat `downloadedAt` | Sesi (hanya pemilik) |
| `/api/clips/:id/caption` | POST | Meregenerasi caption sosial klip dalam bahasa `{ language: 'auto' \| 'id' \| 'en' }` lewat antrean `captions`; 200 `{ caption, hashtags }` (tersimpan di klip), 404 bukan milik/terhapus, 503 `caption_unavailable` bila LLM gagal/timeout 60 detik | Sesi (hanya pemilik) |
| `/api/clips/:id` | DELETE | Menghapus file fisik klip dari disk dan menghapus baris DB | Sesi (hanya pemilik) |
| `/api/social/providers` | GET | Mengambil status konfigurasi/ketersediaan YouTube, Instagram, dan TikTok | Sesi |
| `/api/social/accounts` | GET | Mengambil akun sosial terhubung milik pengguna tanpa token | Sesi |
| `/api/social/accounts/:id` | DELETE | Memutuskan akun sosial; YouTube direvokasi best-effort | Sesi (hanya pemilik) |
| `/api/social/youtube/connect` | GET | Memulai OAuth YouTube dengan state dan PKCE | Sesi |
| `/api/social/youtube/callback` | GET | Menyelesaikan OAuth, menyimpan channel, lalu redirect ke settings | Sesi |
| `/api/clips/:id/publish` | POST | Mempublikasikan klip ke 1..5 akun YouTube; membuat publikasi `queued` dan mengembalikan `PublicationResponse[]` (201) | Sesi (hanya pemilik) |
| `/api/clips/:id/publications` | GET | Riwayat publikasi klip, terbaru dulu | Sesi (hanya pemilik) |
| `/api/publications/:id/retry` | POST | Mengulang publikasi `failed` | Sesi (hanya pemilik) |
| `/api/system/llm-status` | GET | Memeriksa status kesiapan LLM worker dari Redis | Sesi |

## 11. Kebutuhan Non-Fungsional

- **Kapasitas:** Worker render memproses 1 job video secara bergantian (concurrency 1) untuk menjaga kestabilan CPU/RAM. Consumer preview berjalan di proses yang sama dengan concurrency 2 karena hanya mengunduh subtitle dan memanggil LLM.
- **Penyimpanan:** Bind mount bersama `/srv/storage/clips` ke `/data/clips` pada kontainer API dan worker. File sementara dalam `temp_root` selalu dibersihkan di blok `finally`.
- **Keamanan:** Hash password menggunakan `scrypt`. Token sesi berupa string acak `base64url` yang disimpan dalam bentuk hash SHA-256. Semua path file di disk dibentuk dari ID database dan divalidasi tidak keluar dari direktori `CLIPS_DIR`.
- **UI/UX & Desain:** Antarmuka web modern dibangun dengan TanStack Start, TanStack Query, shadcn/ui, dan Tailwind v4. Mendukung dwibahasa (Inggris sebagai default, Bahasa Indonesia via cookie `clipper_language`), serta tema gelap, terang, dan sistem via cookie `clipper_theme`.
- **Standar library:** Fitur yang butuh library memakai produk TanStack lebih dulu bila tersedia (routing, state server, form + validasi, tabel, virtualisasi). Form dan validasi memakai `@tanstack/react-form`; validasi skema mengikuti aturan API (batas nilai, pesan error) agar pesan klien dan server konsisten.
- **Standar kerja UI:** Pembuatan atau perubahan UI wajib mengikuti skills Antislop (core + UI) — tanpa gradient dekoratif tanpa alasan, tanpa kartu berlebih, hierarki tipografi dan jarak yang konsisten.
- **Jaringan & Proksi:** Aplikasi web bertindak sebagai reverse proxy yang meneruskan permintaan `/api/*` ke `API_INTERNAL_URL`, menjaga cookie tetap berada di domain origin yang sama.

## 12. Batasan dan Dependensi Eksternal

- **Dokploy & Docker:** Lingkungan orkestrasi kontainer di VPS tunggal dengan database PostgreSQL dan Redis terkelola.
- **Cloudflare Tunnel:** Menyediakan akses publik HTTPS yang aman ke domain `clipper.rencraft.site` (Web) dan `api-clipper.rencraft.site` (API internal/eksternal).
- **yt-dlp:** Bergantung pada YouTube untuk video dan trek subtitle VTT.
- **OpenAI-compatible LLM:** Wajib terhubung ke penyedia LLM untuk menjalankan mode otomatis.
- **MediaPipe (0.10.14) & OpenCV:** Digunakan untuk deteksi wajah dan analisis gerak bibir FaceMesh pada mode reframe `face_tracking` (pembicara aktif).
- **ffmpeg:** Rendering video potret H.264 (`yuv420p`), audio AAC, dan pembakaran takarir ASS kata per kata.

## 13. Glosarium

| Istilah | Arti |
| --- | --- |
| **Job** | Satu permintaan pemrosesan video dari URL sumber |
| **Klip** | Potongan vertikal 9:16 hasil pemotongan dan pembingkaian video |
| **Mode Otomatis** | LLM memilih momen klip terbaik berdasarkan subtitle dan brief opsional |
| **Mode Manual** | Pengguna menentukan sendiri daftar timestamp mulai dan selesai |
| **Reframe** | Metode transformasi video lanskap ke format potret 9:16 (`face_tracking`, `blurred_fill`, `black_bars`) |
| **Captions** | Takarir kata per kata (gaya karaoke) yang dibakar langsung ke video |
| **Regenerate** | Mengisi ulang formulir dashboard dengan konfigurasi job sebelumnya untuk membuat job baru |
| **Retry** | Membuat job baru dari konfigurasi job lama yang `failed`/`cancelled` lewat `POST /api/jobs/:id/retry`; job lama tetap utuh |
| **Preview / Tinjau Momen** | Pindai URL (subtitle + LLM, tanpa render) untuk menampilkan kandidat momen dan transkrip penuh sebelum membuat job manual; kedaluwarsa setelah 1 jam |
| **Dokploy** | Panel orkestrasi deployment Docker di server VPS |
