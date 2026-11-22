# Clip worker

Pipeline Python: unduh, transkrip, pilih momen, render 9:16, simpan ke `CLIPS_DIR/<job_id>/`.

- Pasang: `pip install -r requirements-dev.txt` (runtime + pytest). `requirements.txt` adalah lock ber-hash; ubah dependency di `requirements.in` lalu regenerate (perintah ada di header `requirements.in`).
- Test (tanpa network/ffmpeg/Redis, dari folder `worker/`): `pytest`
- Gate Fase 0 tanpa Redis: `python -m clipper.selftest --url https://youtu.be/xxx --mode manual --ranges 12-40,90-130`
- Worker antrean: `python -m clipper.worker`

Env worker: `REDIS_URL`, `CLIPS_DIR` (`/data/clips`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `WHISPER_MODEL` (`small`), `MIN_FREE_GB`, opsional `TEMP_ROOT`.

Kontrak data `clipper/models.py` harus sama dengan `packages/shared/src/index.ts` (nama field camelCase, nilai stage/mode). Ubah keduanya dalam satu perubahan; jangan menyimpang.
