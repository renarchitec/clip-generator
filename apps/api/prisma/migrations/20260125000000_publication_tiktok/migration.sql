-- Opsi publikasi TikTok (privacyLevel, disable*, brand*) disimpan sebagai JSON; baris YouTube NULL.
ALTER TABLE "publications" ADD COLUMN "options" JSONB;
