-- CreateEnum
CREATE TYPE "JobMode" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mode" "JobMode" NOT NULL,
    "clipCount" INTEGER NOT NULL,
    "targetDurationSec" INTEGER NOT NULL,
    "ranges" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clips" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "filePath" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clips_jobId_idx" ON "clips"("jobId");

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
