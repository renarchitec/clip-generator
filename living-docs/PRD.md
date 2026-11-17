# PRD — Clipper (Generator Klip Vertikal)

**Status:** draf · **Versi:** 1.0 · **Terakhir diperbarui:** 18 November 2026
**Dokumen terkait:** `IMPLEMENTATION_PLAN.md` (rencana teknis, fase, dan gate)

---

## 1. Ringkasan

Clipper adalah alat internal untuk mengubah satu video panjang (podcast, wawancara, ceramah) menjadi beberapa klip vertikal 9:16 yang siap diunggah ke TikTok, Reels, dan Shorts.

Pengguna menempelkan URL video, memilih mode **otomatis** (AI memilih momen paling menarik) atau **manual** (menentukan timestamp sendiri), lalu mengunduh hasilnya dari browser. Seluruh proses berat — unduh video, transkrip, pemilihan momen, render — berjalan di server milik sendiri, bukan di laptop pengguna.

Produk ini dipakai oleh satu orang (pemilik akun), di-deploy sendiri di VPS dengan Dokploy, dan dioptimalkan untuk video berbahasa Indonesia.

## 2. Masalah

Membuat klip dari video panjang saat ini manual dan memakan waktu:

1. Menonton ulang video untuk menemukan momen yang layak.
2. Memotong video, mengubah rasio ke 9:16, dan memastikan subjek tetap di frame.
3. Membuat subtitle yang terbaca di layar HP (bukan subtitle YouTube mentah).
4. Mengulang semuanya untuk setiap klip.

Satu video berdurasi satu jam bisa memakan beberapa jam kerja hanya untuk menghasilkan 3 klip. Pekerjaan ini berulang, tidak menambah nilai kreatif, dan mudah ditinggalkan karena membosankan.

## 3. Tujuan

| # | Tujuan | Ukuran |
| --- | --- | --- |
| G1 | Satu video panjang menghasilkan klip yang layak unggah tanpa diedit lagi | Gate 1: 3 klip dari 1 video lolos pengecekan di HP |
| G2 | Seluruh alur bisa dijalankan dari browser, tanpa terminal | Gate 3: login → buat job → pantau → preview → download, semuanya di HP |
| G3 | Job berjalan tanpa pengawasan dan hasilnya tidak menumpuk di disk | File terhapus otomatis sesuai kebijakan retensi |
| G4 | Biaya operasional tetap satu VPS | RAM worker dibatasi dari hasil pengukuran, bukan asumsi |

## 4. Non-tujuan

- **Bukan SaaS multi-pengguna.** Tidak ada registrasi, langganan, kuota, atau isolasi data antar pengguna.
- **Tidak mengedit video secara kreatif.** Tidak ada timeline editor, transisi, musik, atau b-roll.
- **Tidak menggantikan platform distribusi.** Auto-posting hanya membuka pintu unggah; penjadwalan kampanye dan analitik tetap di platform masing-masing.
- **Tidak menjamin lolos Content ID atau klaim hak cipta.** Pengguna bertanggung jawab atas materi yang diproses.
- **Bukan aplikasi mobile native.** Web responsif sudah cukup.

## 5. Pengguna

**Pemilik akun (satu-satunya peran).** Kreator konten solo yang mengelola channel sendiri, paham istilah teknis secukupnya, dan mengakses aplikasi dari desktop saat menyiapkan konten serta dari HP saat mengecek hasil.

Kebutuhan utama:

- Menghasilkan banyak klip dalam satu sesi kerja tanpa mengawasi prosesnya.
- Memastikan hasilnya benar sebelum diunggah (preview vertikal, subtitle terbaca).
- Tidak memikirkan penyimpanan: file lama dibersihkan sendiri.

## 6. Alur utama

1. **Masuk** — buka `clipper.rencraft.site`, login dengan username dan password pemilik.
2. **Buat job** — tempel URL video, pilih mode (otomatis / manual), atur parameter (mis. jumlah klip, durasi target), atau isi timestamp manual.
3. **Pantau** — job muncul di daftar dengan progres per tahap: unduh → transkrip → pilih momen → render → simpan.
4. **Tinjau** — buka detail job, putar tiap klip di player 9:16, salin judul yang diusulkan.
5. **Unduh** — unduh klip yang dipakai; klip yang tidak diunduh tetap tersedia sampai batas waktu.
6. **Bersih-bersih** — file dihapus otomatis setelah diunduh (melewati masa tenggang) atau setelah TTL habis.

## 7. Lingkup dan prioritas

| Prioritas | Isi | Rilis |
| --- | --- | --- |
| **P0** | Pipeline CLI terbukti di VPS, job lewat API, web MVP (login, buat job, daftar, detail, preview, download), retensi otomatis | MVP |
| **P1** | Retry job gagal, ubah timestamp satu klip (re-render), hapus job beserta filenya | Setelah MVP stabil |
| **P2** | Auto-posting ke TikTok dan Instagram | Setelah riset izin platform |
| **Di luar lingkup** | Multi-user, editor video, analitik, watermark/branding otomatis | — |

## 8. Kebutuhan fungsional

Prioritas memakai MoSCoW; setiap kebutuhan P0 punya kriteria penerimaan yang bisa diuji.

### FR-1 Autentikasi (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-1.1 | Login dengan satu akun pemilik; kredensial disimpan sebagai hash di environment, bukan di tabel pengguna | Username/password benar → sesi aktif; salah → pesan error generik |
| FR-1.2 | Sesi disimpan di cookie httpOnly + Secure + SameSite; semua endpoint kecuali login dilindungi | Request tanpa sesi ke endpoint mana pun → 401 |
| FR-1.3 | Login dibatasi laju percobaannya | Percobaan berulang dalam waktu singkat → 429 |

### FR-2 Membuat job (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-2.1 | Pengguna mengirim URL video; server memvalidasi bahwa URL didukung sebelum job dibuat | URL tidak valid/didukung → 400 dengan pesan jelas; valid → job berstatus antre |
| FR-2.2 | Mode **otomatis**: AI memilih momen dari transkrip | Job selesai menghasilkan klip tanpa input timestamp dari pengguna |
| FR-2.3 | Mode **manual**: pengguna menentukan sendiri rentang waktu klip | Setiap timestamp yang diberikan menghasilkan tepat satu klip |
| FR-2.4 | Pengguna bisa mengatur parameter job (jumlah klip, durasi target) | Parameter tersimpan pada job dan memengaruhi hasil |
| FR-2.5 | Form pembuatan job menampilkan pengingat tanggung jawab hak cipta | Pengingat terlihat sebelum job dikirim |

### FR-3 Pemrosesan (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-3.1 | Pipeline berjalan sebagai worker terpisah dari API, satu job pada satu waktu | Job kedua menunggu sampai job pertama selesai |
| FR-3.2 | Video diunduh ke ruang sementara, diproses, dan ruang sementara selalu dibersihkan meski job gagal | Setelah job selesai/gagal, tidak ada sisa file sementara |
| FR-3.3 | Transkrip memakai subtitle yang tersedia; bila tidak ada, jatuh ke Whisper | Video tanpa subtitle tetap menghasilkan klip bersubtitle |
| FR-3.4 | Klip dirender 9:16 dengan subtitle yang terbakar di video dan terbaca di layar HP | Pratinjau di HP menunjukkan subtitle tidak terpotong dan tidak menutupi wajah berlebihan |
| FR-3.5 | Hasil ditulis ke direktori per job di volume bersama, dengan nama file yang aman | Nama folder selalu `<job_id>`, tidak pernah memakai input pengguna mentah |
| FR-3.6 | Worker menolak mulai bila ruang disk di bawah ambang minimum | Job gagal cepat dengan pesan yang menyebut sisa ruang disk |
| FR-3.7 | Worker memberi tahu API setiap pergantian tahap dan saat selesai/gagal | Status dan progres di UI sesuai tahap nyata |

### FR-4 Status dan progres (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-4.1 | Daftar job menampilkan status terkini tanpa refresh manual | Perubahan status muncul di UI dalam hitungan detik |
| FR-4.2 | Detail job menampilkan tahap yang sedang berjalan | Tahap yang tampil cocok dengan progres yang dilaporkan worker |
| FR-4.3 | Job gagal menyimpan pesan error yang bisa dibaca manusia dan ditampilkan di UI | Job gagal tidak pernah "diam" tanpa penjelasan |

### FR-5 Hasil klip (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-5.1 | Setiap klip punya judul usulan yang bisa disalin dengan satu klik | Tombol salin menyalin judul ke clipboard |
| FR-5.2 | Klip bisa diputar di browser sebagai preview vertikal | Preview berjalan tanpa harus mengunduh file |
| FR-5.3 | Klip bisa diunduh; unduhan tercatat waktunya | Setelah unduh, `downloaded_at` terisi dan file mengikuti kebijakan retensi |
| FR-5.4 | Hanya file milik job yang bisa diakses; path selalu diturunkan dari ID di database | Menebak ID/path klip lain → 404 |

### FR-6 Retensi file (P0)

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| FR-6.1 | File dihapus setelah diunduh dan masa tenggang lewat | File hilang dari disk, metadata klip tetap ada |
| FR-6.2 | File yang tidak pernah diunduh dihapus setelah TTL habis | Sama seperti FR-6.1 |
| FR-6.3 | Galeri menandai klip yang filenya sudah dihapus, bukan menyembunyikannya | Klip lama tampil dengan penanda "file dihapus" |
| FR-6.4 | Pembersihan berjalan terjadwal, tidak bergantung pada kunjungan pengguna | File kedaluwarsa terhapus tanpa membuka aplikasi |

### FR-7 Operasi lanjutan (P1)

| ID | Kebutuhan |
| --- | --- |
| FR-7.1 | Job gagal bisa diulang dengan parameter yang sama |
| FR-7.2 | Timestamp satu klip bisa diubah; hanya klip itu yang dirender ulang |
| FR-7.3 | Job bisa dihapus beserta seluruh folder filenya |

### FR-8 Auto-posting (P2)

| ID | Kebutuhan |
| --- | --- |
| FR-8.1 | Riset syarat TikTok Content Posting API dan Instagram Graph API (jenis akun, app review, batas posting) dimulai sebelum fitur dibangun |
| FR-8.2 | Akun terhubung lewat OAuth; token disimpan terenkripsi |
| FR-8.3 | Instagram mengambil video dari URL publik bertanda tangan yang cepat kedaluwarsa |
| FR-8.4 | Posting berjalan di antrean terpisah dengan status per klip |
| FR-8.5 | Halaman detail job menyediakan form caption dan pilihan platform |

## 9. Model data (ringkas)

**`jobs`** — id, url, mode (otomatis/manual), parameter, status, tahap/progres, pesan error, waktu dibuat, waktu selesai.

**`clips`** — id, job_id, judul usulan, rentang waktu (mulai/selesai), path file, `downloaded_at`, `deleted_at`.

Catatan: `downloaded_at` dan `deleted_at` adalah tambahan dari rencana implementasi untuk mendukung FR-5.3 dan FR-6.x. Bentuk pasti skema ada di `IMPLEMENTATION_PLAN.md` / Prisma schema.

## 10. Permukaan API

| Endpoint | Fungsi |
| --- | --- |
| `POST /api/auth/login` | Membuat sesi |
| `POST /api/jobs` | Membuat job |
| `GET /api/jobs` | Daftar job |
| `GET /api/jobs/:id` | Detail job + klipnya |
| `GET /api/jobs/:id/events` | Aliran progres (SSE) |
| `GET /api/clips/:id/stream` | Preview video (mendukung Range) |
| `GET /api/clips/:id/download` | Unduh + catat `downloaded_at` |

## 11. Kebutuhan non-fungsional

| Area | Kebutuhan |
| --- | --- |
| **Kapasitas** | Satu job pada satu waktu per worker; batas RAM worker ditetapkan dari hasil pengukuran Fase 0, bukan tebakan |
| **Ketahanan** | Worker memperpanjang lock job selama langkah panjang agar job tidak diklaim ulang; kegagalan satu job tidak menghentikan worker |
| **Penyimpanan** | Volume bersama antara API dan worker; file sementara selalu dibersihkan; ambang ruang disk dicek sebelum mulai |
| **Keamanan** | Kredensial hanya di environment (hash argon2), JWT di cookie httpOnly, path file tidak pernah dibentuk dari input pengguna, login dibatasi laju |
| **Privasi** | Video dan klip tidak keluar dari VPS; satu-satunya panggilan keluar adalah ke endpoint LLM dan sumber video |
| **Ketersediaan** | Cukup untuk satu pengguna; tidak ada target SLA formal, tapi gagal job harus terlihat, bukan senyap |
| **Keteramatan** | Status job, tahap, dan error tersimpan di database dan bisa dilihat di UI |
| **Kompatibilitas** | Browser modern di desktop dan HP; tampilan responsif |
| **Bahasa** | UI dan subtitle dalam bahasa Indonesia; istilah teknis boleh tetap Inggris |

## 12. Batasan dan dependensi eksternal

- **VPS tunggal** dengan Dokploy, Redis, Postgres, dan volume Docker — bukan cluster.
- **yt-dlp** untuk pengunduhan; perubahan aturan platform dapat mematahkannya kapan saja.
- **Endpoint LLM OpenAI-compatible** untuk pemilihan momen; jawaban tidak valid ditangani dengan validasi JSON dan satu kali retry.
- **Whisper** untuk video tanpa subtitle; kebutuhan RAM-nya menentukan batas worker.
- **ffmpeg** untuk render dan pembakaran subtitle.
- **Cloudflare Tunnel** dan domain `clipper.rencraft.site` untuk akses publik; `/api` dan web berada di origin yang sama agar cookie tetap jalan.
- **Persetujuan platform** (TikTok/Instagram) adalah jalur kritis untuk P2 dan bisa memakan waktu berminggu-minggu.

## 13. Metrik keberhasilan

| Metrik | Target | Cara ukur |
| --- | --- | --- |
| Klip layak unggah per video | ≥ 3 tanpa diedit | Uji manual Gate 1, ditonton di HP |
| Waktu dari kirim job sampai klip siap | Dicatat pada Fase 0 sebagai baseline, lalu tidak memburuk | Log worker |
| Puncak RAM worker | Di bawah limit yang ditetapkan pada Fase 0 | Pengukuran saat uji video panjang |
| File yatim (tidak terpakai, tidak terhapus) | 0 | Audit disk berkala |
| Job gagal tanpa pesan error | 0 | Query database |
| Alur penuh dari HP | Berhasil dalam satu sesi tanpa terminal | Uji manual Gate 3 |

## 14. Risiko

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Video panjang menghabiskan RAM/disk | Job gagal, worker mati | Uji >1 jam di Fase 0, tetapkan limit dan `MIN_FREE_GB`, cek disk sebelum mulai |
| yt-dlp patah karena perubahan platform | Tidak bisa membuat job baru | Rilis worker sering; error jelas di UI; retry (P1) |
| Jawaban LLM tidak konsisten | Momen tidak layak / parsing gagal | Validasi JSON + satu retry + fallback ke pemilihan berbasis aturan |
| Subtitle otomatis buruk pada audio berisik | Klip tidak layak | Prioritaskan subtitle resmi; Whisper `small` sebagai default yang bisa dinaikkan |
| File menumpuk dan disk penuh | Semua job gagal | Retensi otomatis (FR-6) + ambang disk |
| App review platform ditolak | P2 tertunda | Riset lebih awal, P2 tidak memblokir MVP |
| Klaim hak cipta atas klip | Konten diturunkan | Pengingat di form, tanggung jawab pengguna |

## 15. Pertanyaan terbuka

1. Berapa durasi video maksimum yang didukung secara resmi? (butuh angka dari Fase 0)
2. Berapa jumlah klip default dan batas atasnya per job?
3. Apakah judul klip dihasilkan LLM, atau hanya potongan transkrip? Perlu keputusan sebelum FR-5.1 diuji.
4. Batas `CLIP_TTL_HOURS` dan `DOWNLOAD_GRACE_MINUTES` — nilai awal berapa?
5. Apakah diperlukan tampilan "riwayat biaya LLM"? Belum masuk lingkup, tapi relevan bila pemakaian naik.
6. Untuk P2, apakah caption ikut dibuat otomatis atau diketik manual?

## 16. Glosarium

| Istilah | Arti |
| --- | --- |
| **Job** | Satu permintaan pemrosesan atas satu URL video |
| **Klip** | Satu potongan vertikal hasil render, milik sebuah job |
| **Mode otomatis** | LLM memilih momen dari transkrip |
| **Mode manual** | Pengguna menentukan timestamp sendiri |
| **TTL** | Batas umur file klip sebelum dihapus otomatis |
| **Masa tenggang** | Jeda setelah unduhan sebelum file dihapus |
| **Gate** | Kriteria kelulusan satu fase di `IMPLEMENTATION_PLAN.md` |
