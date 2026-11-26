# Clip worker

Pipeline Python: unduh, transkrip, pilih momen, render 9:16, simpan ke `CLIPS_DIR/<job_id>/`.

- Pasang: `pip install -r requirements-dev.txt` (runtime + pytest). `requirements.txt` adalah lock ber-hash; ubah dependency di `requirements.in` lalu regenerate (perintah ada di header `requirements.in`).
- Test (tanpa network/ffmpeg/Redis, dari folder `worker/`): `pytest`
- Gate Fase 0 tanpa Redis: `python -m clipper.selftest --url https://youtu.be/xxx --mode manual --ranges 12-40,90-130`
- Worker antrean: `python -m clipper.worker`

Env worker: `REDIS_URL`, `CLIPS_DIR` (`/data/clips`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `MIN_FREE_GB`, opsional `TEMP_ROOT`.

## Sumber transkrip

Payload render dan preview menerima `transcriptSource` (atau `transcript_source`):

- `youtube` (default): pakai subtitle YouTube; job gagal jika subtitle tidak tersedia.
- `auto`: coba subtitle YouTube dahulu; jika tidak ada dialog yang bisa digunakan, transkripsikan audio (STT).
- `live_chat_stt`: langsung transkripsikan audio. Pada video panjang tanpa kandidat live chat atau heatmap, coba subtitle YouTube sebelum melaporkan kegagalan.

Untuk preview dan render otomatis, worker mencari kandidat dari sampel live chat replay, lalu heatmap YouTube. Preview hanya mengunduh audio pada jendela yang dipilih. Tanpa keduanya, STT hanya memindai seluruh sumber bila durasi efektif (setelah `maxSourceSec`) paling lama 20 menit. Job manual yang memakai STT hanya mentranskripsikan rentang yang dipilih, tanpa memindai live chat.

Whisper memakai `STT_BASE_URL` dan `STT_API_KEY`, yang masing-masing mengikuti `LLM_BASE_URL` dan `LLM_API_KEY` jika kosong. Model default untuk 9router adalah `groq/whisper-large-v3-turbo` (`/audio/transcriptions`).

**Sinkronisasi per kata (~50 ms):** 9router hingga versi `0.5.123` menghapus `timestamp_granularities[]` saat meneruskan permintaan ke Groq. Untuk mendapatkan timestamp per kata, arahkan Whisper langsung ke Groq: set `STT_BASE_URL=https://api.groq.com/openai/v1`, `STT_API_KEY=<groq-key>`, dan `STT_MODEL=whisper-large-v3-turbo`. Jika hanya timestamp segmen yang tersedia, worker memperkirakan waktu per kata setelah memangkas jeda awal pada segmen Whisper yang terlalu panjang.

Gemini (`ag/gemini-4-hydrogen-low` secara default) memakai `LLM_BASE_URL` dan `LLM_API_KEY` untuk tetap lewat 9router saat Whisper diarahkan langsung ke Groq. Bila endpoint LLM bukan 9router, isi `STT_FALLBACK_BASE_URL` dan `STT_FALLBACK_API_KEY` dengan URL 9router berakhiran `/v1` dan API key-nya. Untuk tiap nilai, urutan prioritasnya adalah override fallback → setelan LLM → setelan Whisper. Gemini menerima audio WAV melalui `/chat/completions`; set `STT_FALLBACK_MODEL` ke string kosong untuk menonaktifkannya.

Kontrak data bersama mengikuti `packages/shared/src/index.ts` (nama field camelCase, nilai stage/mode).
