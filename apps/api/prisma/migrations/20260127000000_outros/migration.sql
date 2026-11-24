-- Pustaka outro per pengguna, default outro pengguna, dan snapshot outro per job.
ALTER TABLE "users" ADD COLUMN "outroDefault" JSONB;
ALTER TABLE "jobs" ADD COLUMN "outro" JSONB;

CREATE TABLE "outros" (
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

    CONSTRAINT "outros_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outros_userId_idx" ON "outros"("userId");

ALTER TABLE "outros" ADD CONSTRAINT "outros_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
