# Project Rules

## Standar library: TanStack-first

- Kalau sebuah fitur butuh library, pakai produk TanStack lebih dulu bila ada padanannya: Router/Start (routing), Query (state server & cache), Form (form + validasi), Table (tabel), Virtual (virtualisasi).
- Form dan validasi memakai `@tanstack/react-form`. Saat ini belum ter-install — install sebelum memigrasi form pertama (`apps/web/src/components/login-form.tsx`, `apps/web/src/routes/register.tsx`, kartu pembuatan job di `apps/web/src/routes/index.tsx`).
- Jangan tambahkan dependency lain untuk fungsi yang sudah dicakup library TanStack yang terpasang.

## Standar kerja UI: Antislop

- Sebelum membuat atau mengubah UI, muat skills Antislop: `antislop` (core) + `antislop-ui`. Tambahkan `antislop-layoutmobile` untuk layout responsif, `antislop-human` untuk aksesibilitas/kontras, `antislop-copywriting` untuk teks antarmuka.
- Review copy user-facing setelah UI jadi, tanpa mengubah visual.

## Living docs

- Every feature addition or behavior change must update `living-docs/` in the same commit.
  - `living-docs/PRD.md`: product behavior, user-facing features, decisions.
  - `living-docs/IMPLEMENTATION_PLAN.md`: architecture, API contract, schema/migrations, deployment, worker pipeline.
- Docs describe the current state, not history. Replace outdated statements; don't append contradictions.
- A change is not done until docs match the code.
