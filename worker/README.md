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

STT memakai endpoint OpenAI-compatible 9router. `STT_BASE_URL` dan `STT_API_KEY` opsional dan masing-masing mengikuti `LLM_BASE_URL` dan `LLM_API_KEY` jika kosong; bila endpoint LLM bukan 9router, set override STT dengan URL 9router berakhiran `/v1` dan API key-nya. `STT_MODEL` default `groq/whisper-large-v3-turbo` (`/audio/transcriptions`); jika panggilan Whisper gagal, worker mencoba `STT_FALLBACK_MODEL` (default `ag/gemini-4-hydrogen-low`, melalui `/chat/completions` dengan audio WAV). Set `STT_FALLBACK_MODEL` ke string kosong untuk menonaktifkan fallback. Audio pada rentang yang ditranskripsikan dikirim ke provider yang dipilih lewat 9router.

Kontrak data bersama mengikuti `packages/shared/src/index.ts` (nama field camelCase, nilai stage/mode).
