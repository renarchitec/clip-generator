# DartClip

Buat klip vertikal bersubtitel dari video panjang. Pilih instalasi desktop untuk memproses video di komputer sendiri, atau self-host untuk mengakses DartClip lewat browser. Panduan berikut memakai tag [`desktop-v0.1.0`](https://github.com/renarchitec/clip-generator/tree/desktop-v0.1.0), bukan branch `main`.

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
