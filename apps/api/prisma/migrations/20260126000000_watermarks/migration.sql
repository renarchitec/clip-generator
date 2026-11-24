-- Pustaka watermark per pengguna, default watermark pengguna, dan snapshot watermark per job.
ALTER TABLE "users" ADD COLUMN "watermarkDefault" JSONB;
ALTER TABLE "jobs" ADD COLUMN "watermark" JSONB;

CREATE TABLE "watermarks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watermarks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "watermarks_userId_idx" ON "watermarks"("userId");

ALTER TABLE "watermarks" ADD CONSTRAINT "watermarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
