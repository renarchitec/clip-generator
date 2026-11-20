# Design References

Kumpulan referensi UI sebagai dasar revamp UI Clip Generator.

Cara pakai:

1. Simpan screenshot/mockup ke folder ini, format `NN-short-name.webp` (urut sesuai urutan masuk).
2. Daftarkan di tabel bawah: apa fokusnya dan elemen UI mana yang mau diambil.

## Daftar referensi

| File | Fokus | Catatan |
| --- | --- | --- |
| `01-layout.webp` | Layout | Struktur/shell halaman (sidebar, header, composer, grid) — acuan penataan, bukan detail visual. |
| `02-color-palette.webp` | Warna + form | Palet gelap teal/mint, segmented control, form bertumpuk vertikal. |

---

## 01-layout.webp — analisis struktur

Shell dua kolom, konten dalam kartu putih membulat di atas kanvas abu terang.

- **Sidebar kiri (~215px, fixed)**: brand di atas + tombol collapse; grup nav utama (Library aktif = pill abu-abu, Recently deleted); grup "Projects" dengan ikon folder berwarna per platform (YouTube oranye, TikTok ungu, IG Reels biru); blok upgrade plan di kaki sidebar; Feedback + Help paling bawah.
- **Header (~56px, sticky, hanya selebar kolom konten)**: judul halaman kiri, search di tengah (`⌘K` hint di kanan input), user chip kanan (avatar + nama, background biru muda).
- **Area konten**: satu kolom, padding ~32px, section dipisah garis tipis.
  - **Composer card** (lebar ~570px, centered): gradient halo lembut di belakang kartu, tab segmented di atas kartu (AI Clips aktif / Record a Video / Blank Project), textarea placeholder, footer action: "Upload from device" (outline, kiri) + tombol submit bulat gelap (kanan).
  - **Recent Videos**: label section, grid 4 kolom kartu video — thumbnail 16:9, badge avatar streamer kiri-bawah, badge durasi kanan-bawah (pill hitam transparan), judul 1 baris tebal, baris meta: chip platform berwarna + umur ("2 days ago") rata kanan.
  - Footer copyright centered, kecil, abu.

Pola yang layak diambil: sidebar nav bergrup dengan ikon berwarna, header search-centered dengan shortcut hint, composer sebagai kartu tunggal dengan tab di atasnya, kartu video dengan badge overlay + chip platform.

## 02-color-palette.webp — analisis warna & form

- **Kanvas** hitam netral (`#000`–`#0B0B0C`), **surface** kartu `#141517`-ish, border tipis `#24262A`.
- **Aksen utama** mint/teal terang (≈`#5CE1C4`–`#4FE0C0`) untuk: state aktif segmented control (border + teks mint, background transparan), tombol primer full-width (teks hitam di atas mint), chip kredit (mint solid, teks hitam, ikon kilau).
- **Teks**: primer putih, sekunder abu (`#8A8F98`), placeholder abu gelap.
- **Kontrol**: dropdown select dengan chevron kanan, area upload dashed-border besar dengan ikon `+` bulat, segmented control 3 opsi (Resolution 480p/720p/1080p, Video Length 5/10 seconds) — aktif = border mint, tidak aktif = teks abu.
- **Tombol Generate** sticky di dasar form, full-width, disabled state = mint pudar.
- Layout form: satu kolom, label kecil di atas tiap field, jarak antar-field konsisten ~16px.
