CREATE TABLE IF NOT EXISTS "media_assets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "media_assets_userId_createdAt_idx" ON "media_assets"("userId", "createdAt");

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'media_assets_userId_fkey' AND conrelid = '"media_assets"'::regclass
    ) THEN
        ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "primarySource" JSONB;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "splitScreen" JSONB;
