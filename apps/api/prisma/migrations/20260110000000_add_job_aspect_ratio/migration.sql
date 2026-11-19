-- Rasio output klip: 9:16 (default), 1:1, 16:9.
ALTER TABLE "jobs" ADD COLUMN "aspectRatio" TEXT NOT NULL DEFAULT '9:16';
