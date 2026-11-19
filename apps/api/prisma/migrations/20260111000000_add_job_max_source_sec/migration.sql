-- Batas pemindaian sumber (detik, 60-36000); NULL = durasi penuh.
ALTER TABLE "jobs" ADD COLUMN "maxSourceSec" INTEGER;
