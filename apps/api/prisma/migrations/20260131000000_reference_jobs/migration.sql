-- Reference Edit: job edit video berdasarkan referensi + footage pengguna.
CREATE TABLE "reference_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "brief" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "reframe" TEXT NOT NULL DEFAULT 'face_tracking',
    "captions" BOOLEAN NOT NULL DEFAULT true,
    "beatSync" BOOLEAN NOT NULL DEFAULT true,
    "referenceUrl" TEXT,
    "referenceFilePath" TEXT,
    "referenceDurationSec" DOUBLE PRECISION,
    "footage" JSONB NOT NULL DEFAULT '[]',
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "templateSlots" JSONB,
    "planSlots" JSONB,
    "outputFilePath" TEXT,
    "outputDurationSec" DOUBLE PRECISION,
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "reference_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reference_jobs_userId_createdAt_idx" ON "reference_jobs"("userId", "createdAt");

ALTER TABLE "reference_jobs" ADD CONSTRAINT "reference_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
