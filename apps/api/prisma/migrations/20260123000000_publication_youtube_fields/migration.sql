-- Tambahkan metadata YouTube dan progres unggah pada publikasi.
ALTER TABLE "publications"
    ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "madeForKids" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Indeks untuk pemulihan publikasi aktif saat API boot.
CREATE INDEX "publications_status_idx" ON "publications"("status");
