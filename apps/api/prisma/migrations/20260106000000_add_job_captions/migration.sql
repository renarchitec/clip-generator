-- Tambah flag caption (subtitle terbakar). Default true untuk job lama.
ALTER TABLE "jobs" ADD COLUMN "captions" BOOLEAN NOT NULL DEFAULT true;
