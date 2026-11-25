# Desktop spike: macOS Apple Silicon (item 25, fase 1)

Mesin uji: Apple M4 (10 core), macOS, Python 3.12.13 (Homebrew), Electron 39.8.
Video uji: `https://www.youtube.com/watch?v=8S0FDjFBj8o` (TEDx, 1080p 23.976 fps, 5:55),
rentang 120–170 s (50 s), 9:16 face_tracking, takarir menyala.

## Cara build & jalan

```sh
worker/desktop/build-mac.sh                 # venv + PyInstaller + ffmpeg statis → worker/desktop/dist/dartclip-worker
worker/desktop/dist/dartclip-worker/dartclip-worker \
  --url "https://www.youtube.com/watch?v=..." --range 120-170 --encoder h264_videotoolbox
pnpm install --filter desktop && pnpm --filter desktop start   # jendela Electron
```

Tanpa bundel (dev): `cd worker && python -m clipper.local_cli --url ... --range 120-170`
(butuh ffmpeg dan yt-dlp di PATH).

## Ukuran bundel

| Bagian | Ukuran |
| --- | --- |
| `dist/dartclip-worker` total (onedir) | 357 MB |
| `bin/ffmpeg` + `bin/ffprobe` (statis, masing-masing ~64 MB) | 127 MB |
| `cv2` (opencv-contrib via mediapipe + opencv-headless) | 82 MB |
| `mediapipe` (termasuk model .tflite) | 67 MB |
| `matplotlib` (dependensi wajib mediapipe 0.10.14) | 15 MB |
| tar.gz seluruh bundel | 164 MB |

Electron sendiri ~250 MB lagi bila nanti dipaket.

## Waktu (detik)

Render saja (`worker/scripts/bench_render.py`, sumber section sama, tanpa takarir, 3x):

| Encoder | ffmpeg | Run 1 / 2 / 3 | Ukuran |
| --- | --- | --- | --- |
| libx264 veryfast crf 23 | statis 9.1 (bundel) | 10.2 / 8.3 / 9.3 | 8.1 MB |
| h264_videotoolbox q 65 | statis 9.1 (bundel) | 8.9 / 8.8 / 8.9 | 8.5 MB |
| libx264 | Homebrew 6.0 | 7.6 / 7.1 / 7.0 | 8.0 MB |
| h264_videotoolbox | Homebrew 6.0 | 8.5 / 8.5 / 8.7 | 8.4 MB |

Angka di atas termasuk deteksi wajah MediaPipe (~3.8 s, sama untuk keduanya).
Encode ffmpeg terisolasi (filter crop face_tracking yang sama):

| Encoder | real | user CPU |
| --- | --- | --- |
| libx264 | 3.8–3.9 s | 24.5 s |
| h264_videotoolbox | 5.2 s | 7.3 s |
| 3 render paralel, libx264 | 10.8 s | |
| 3 render paralel, videotoolbox | 15.3 s | |

VideoToolbox di M4 mentok ~230 fps untuk 1080x1920 (encode murni testsrc 50 s = 5.15 s),
sedangkan libx264 veryfast memakai 10 core dan lebih cepat dalam waktu nyata. Keunggulan
VideoToolbox: CPU ~3x lebih rendah (Mac tetap responsif, baterai/panas). Ukuran file ~5% lebih besar.

End-to-end lewat bundel (unduh subtitle + section + render + takarir, tanpa LLM):

| Encoder | Run | Total |
| --- | --- | --- |
| libx264 | 1 (cold) / 2 | 52.3 / 37.6 s |
| h264_videotoolbox | 1 / 2 | 38.3 / 37.3 s |

Lewat jendela Electron (VideoToolbox, cache font matplotlib masih dingin): 48.1 s.

Sebagian besar waktu end-to-end habis di unduhan section: yt-dlp `--download-sections
--force-keyframes-at-cuts` butuh ~26 s untuk 50 s video (re-encode di batas cut + unduh
lewat ffmpeg https), sedangkan unduh video penuh 5:55 hanya 3.5 s di jaringan ini.
Render sendiri ~9 s.

Homeserver: tidak ada data waktu render di repo (log/riwayat job tidak tersedia dari
worktree ini), jadi belum ada perbandingan langsung.

## Masalah yang ditemui (dan perbaikannya)

1. **ffmpeg statis tidak bisa https** ("certificate verify failed"): OpenSSL di build statis
   mencari CA di path build-nya. Akibatnya section gagal dan pipeline diam-diam jatuh ke
   unduh video penuh. Fix: `SSL_CERT_FILE=/etc/ssl/cert.pem` saat frozen. certifi tidak ikut
   terbundel oleh PyInstaller, jadi dipakai CA sistem.
2. **yt-dlp tidak ada sebagai executable** di bundel: pipeline memanggil `yt-dlp` lewat PATH.
   Fix: shim shell sementara yang memanggil binary bundel dengan `--yt-dlp` (modul yt_dlp
   dibundel, ~collect_submodules).
3. **Font Anton**: di Docker lewat fontconfig. Di Mac ditambahkan `FONTS_DIR` →
   `subtitles=...:fontsdir=...`; terverifikasi takarir ter-render dengan Anton.
4. **Cache font matplotlib dibangun ulang tiap start** (~5 s) karena hook PyInstaller memakai
   MPLCONFIGDIR temp. Fix: MPLCONFIGDIR tetap di `~/Library/Caches/DartClip/matplotlib`.
5. **Model mediapipe**: `collect_data_files` mengambil `.tflite`/`.binarypb`;
   face_detection & face_mesh jalan dari bundel (GL Metal context, XNNPACK CPU).
6. pnpm 10 memblok postinstall Electron; `apps/desktop` punya `postinstall` sendiri yang
   memanggil `electron/install.js`.
7. Sebelum perubahan ini, 2 test worker sudah gagal di main: `worker.py:36` memanggil
   `clips_dir()` sebelum fungsi itu didefinisikan (baris 45), jadi `import clipper.worker`
   gagal. Tidak disentuh di spike ini; jalur Docker yang sedang jalan perlu dicek terpisah.

## Belum dicek

- Mode auto dengan LLM nyata (9router menjawab 401 tanpa key, artinya bisa dijangkau; belum
  ada key yang diuji). Abstraksi endpoint ada di `local_cli.resolve_llm_env`.
- Two-speakers, facecam, watermark, outro, rasio 1:1/16:9 lewat bundel.
- Video panjang (>1 jam), banyak rentang, cookies YouTube / bot-check, 429.
- Membungkus Electron + bundel jadi `.app` (electron-builder) dan Gatekeeper tanpa signing
  (pemakaian pribadi: `xattr -dr com.apple.quarantine` cukup).
- Perbandingan dengan homeserver (data tidak ada).

## Rekomendasi fase 2

**Go**, dengan catatan:

- Pipeline Python + ffmpeg jalan penuh dari bundel di Mac arm64 tanpa homeserver, tanpa
  perubahan jalur server (encoder default tetap libx264, test lolos).
- Default encoder lokal: **libx264** untuk kecepatan; tawarkan VideoToolbox sebagai mode
  "hemat CPU/baterai". VideoToolbox bukan percepatan di M4 untuk klip 1080x1920.
- Bottleneck nyata adalah unduhan section yt-dlp, bukan render. Untuk lokal, pertimbangkan
  unduh video penuh sekali (cepat di jaringan rumah) lalu potong lokal untuk banyak rentang.
- Ukuran ~357 MB worker + Electron masih wajar untuk pemakaian pribadi; bisa dipangkas dengan
  ffmpeg build minimal dan membuang `opencv-contrib` duplikat.
- Fase 2 (NestJS di main process + SQLite + antrean lokal + SPA) layak; kontrak event JSON
  `local_cli` bisa langsung jadi adaptor antrean lokal pengganti BullMQ.
