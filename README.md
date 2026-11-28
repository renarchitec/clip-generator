# DartClip

Buat klip vertikal bersubtitel dari video panjang. Pilih instalasi desktop untuk memproses video di komputer sendiri, atau self-host untuk mengakses DartClip lewat browser. Panduan berikut memakai tag [`desktop-v0.1.0`](https://github.com/renarchitec/clip-generator/tree/desktop-v0.1.0), bukan branch `main`.

## Instalasi dengan bantuan AI

Salin blok berikut ke asisten AI pilihan Anda, bukan ke Terminal. Jika memakai asisten di editor, buka folder kosong untuk instalasi. Anda juga bisa memakai chat biasa dan menjalankan sendiri perintah yang dijelaskan. Panduan manual tetap tersedia di bawah.

```text
Bantu saya memasang DartClip dari kode sumber. Saya baru pertama kali memasangnya. Mulai dengan menanyakan pilihan saya: aplikasi desktop di Mac, aplikasi desktop di Windows x64, atau self-host agar DartClip bisa dibuka lewat browser. Tanyakan versi OS, jenis prosesor, dan folder tujuan jika belum diketahui. Ikuti hanya jalur yang saya pilih.

Gunakan repo resmi https://github.com/renarchitec/clip-generator dan tag desktop-v0.1.0. Baca panduan instalasi di README utama, lalu cocokkan perintah dengan file pada tag tersebut. Jika kamu tidak bisa mengakses repo, minta saya menyalin bagian panduan yang relevan. Jangan menebak perintah atau menyarankan installer dari Assets.

1. Periksa alat yang sudah ada sebelum meminta saya memasang sesuatu. Beri perintah yang sesuai dengan shell saya, sebutkan dari folder mana perintah dijalankan, dan jelaskan hasil yang seharusnya terlihat. Jika kamu hanya punya akses chat, tunggu hasil dari saya sebelum lanjut. Jika kamu punya akses terminal, tunjukkan rencana sebelum mengubah komputer saya. Jangan timpa folder yang sudah ada.
2. Untuk desktop, periksa Git, Node.js 22, versi pnpm yang diminta repo, dan Rust stable. Clone tag tadi ke folder baru dan pastikan tag checkout benar. Pasang dependensi dari root dengan lockfile repo. Di Mac, periksa Xcode Command Line Tools dan ikuti apps/desktop-tauri/build-macos.sh; tunjukkan lokasi DartClip.app hasil build dan cara menyalinnya ke Applications. Di Windows x64, gunakan PowerShell, periksa Rust MSVC, Visual Studio Build Tools dengan C++ dan Windows SDK, serta WebView2. Ikuti langkah build web desktop dan bundel NSIS di README, lalu tunjukkan setup.exe yang benar-benar dihasilkan.
3. Untuk self-host, tanyakan apakah saya ingin mencoba di localhost atau memakai domain. Periksa Docker, baca Dockerfile web, API, dan worker serta .env.example pada tag itu. Jelaskan cara menghubungkan PostgreSQL dan Redis di jaringan privat, menyimpan data saat container dimulai ulang, serta memasang volume klip yang sama ke API dan worker. Jangan menganggap repo menyediakan file Compose. Tunjukkan nama pengaturan yang perlu saya isi sendiri secara lokal. Jangan minta kata sandi, API key, atau isi file rahasia di chat. Minta izin sebelum membuka akses publik atau memakai layanan berbayar.
4. Minta persetujuan sebelum memakai hak administrator. Jangan menonaktifkan Gatekeeper, SmartScreen, atau antivirus. Jika langkah gagal, berhenti di situ: jelaskan pesan error pertama yang relevan, usulkan satu pemeriksaan, dan minta hasilnya tanpa kredensial.
5. Bantu saya membuka aplikasi desktop atau alamat web lokal. Untuk mengecek alur lengkap, gunakan video pendek pilihan saya, render satu klip, lalu pastikan hasilnya bisa dibuka. Minta izin sebelum mengirim video atau transkrip ke penyedia eksternal. Akhiri dengan lokasi aplikasi atau URL, cara membukanya kembali, dan catatan tentang langkah yang berhasil atau belum diuji.
```

## Install DartClip Desktop dari source

Untuk macOS dan Windows, clone tag rilis ini lalu build di komputer sendiri. Tidak perlu mengunduh installer dari bagian Assets, mematikan proteksi sistem, atau memiliki akun Apple Developer berbayar.

Siapkan Git, Node.js 22, pnpm dan Rust stable. **macOS:** pasang Xcode Command Line Tools (`xcode-select --install`). **Windows x64:** gunakan Rust MSVC, Visual Studio Build Tools dengan workload **Desktop development with C++** dan Windows SDK, serta Microsoft Edge WebView2 Runtime.

Di Terminal (Mac) atau PowerShell (Windows):

```sh
git clone --branch desktop-v0.1.0 --depth 1 https://github.com/renarchitec/clip-generator.git
cd clip-generator
pnpm install --frozen-lockfile
```

**macOS:** jalankan `bash apps/desktop-tauri/build-macos.sh`. Salin `DartClip.app` dari lokasi hasil build yang ditampilkan ke Applications.

**Windows x64:** jalankan dari folder `clip-generator`:

```powershell
pnpm --filter web build:desktop
cd apps/desktop-tauri/src-tauri
pnpm dlx @tauri-apps/cli@2 build --bundles nsis --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Jalankan `*-setup.exe` yang dihasilkan di folder `bundle/nsis` pada lokasi output build. Koneksi internet diperlukan untuk mengunduh dependensi.


## Self-host DartClip di server sendiri

Pilih cara ini jika pengguna ingin membuka DartClip lewat browser sementara server Anda memproses video. Tidak perlu memasang aplikasi desktop di setiap komputer.

1. Clone tag `desktop-v0.1.0` dengan perintah di atas. Di server Docker, siapkan PostgreSQL dan Redis pada jaringan privat. Tag ini menyediakan Dockerfile per layanan, bukan paket Docker Compose siap pakai.
2. Dari root repo, build image web dan API dengan `docker build -f apps/web/Dockerfile -t dartclip-web .` dan `docker build -f apps/api/Dockerfile -t dartclip-api .`. Build worker Python dari root yang sama: `docker build -f worker/Dockerfile -t dartclip-worker .`.
3. Gunakan [daftar konfigurasi versi ini](https://github.com/renarchitec/clip-generator/blob/desktop-v0.1.0/.env.example). Atur `DATABASE_URL` dan `REDIS_URL` ke alamat layanan internal, bukan `localhost` di dalam container. Isi `PUBLIC_WEB_URL` dengan alamat instalasi Anda, buat `JWT_SECRET` acak, dan isi `ADMIN_PASSWORD_HASH` dengan hash Argon2 dari kata sandi admin Anda. Konfigurasikan penyedia transkripsi dan model bahasa untuk fitur yang membutuhkannya. Jangan simpan kredensial di Git.
4. Jalankan API, web, dan satu worker. Pasang volume persisten yang sama pada API dan worker di `CLIPS_DIR` (default `/data/clips`) agar hasil render bisa diunduh. Simpan data PostgreSQL pada volume persisten juga. Gunakan reverse proxy HTTPS untuk web dan rute API; jangan buka port PostgreSQL dan Redis ke internet.
5. Uji dari browser: login, kirim satu video pendek, tunggu job selesai, lalu unduh klipnya. Jika job tetap mengantre, cek koneksi Redis worker; jika selesai tetapi klip tidak bisa diunduh, cek volume bersama dan izin aksesnya.

## Struktur

```text
apps/api        NestJS + Prisma, REST + SSE
apps/web        (Fase 2) TanStack Start
packages/shared kontrak data job (sumber kebenaran)
worker          Python: pipeline ffmpeg/yt-dlp + consumer BullMQ
```

## Catatan pengembangan branch main

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
