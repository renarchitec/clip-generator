-- Hashtag kustom per job; bila diisi, di-inject ke caption klip tanpa generate hashtag otomatis.
ALTER TABLE "jobs" ADD COLUMN "customHashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
