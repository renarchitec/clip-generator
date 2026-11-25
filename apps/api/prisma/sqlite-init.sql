-- AUTO-GENERATED dari prisma/schema.sqlite.prisma oleh scripts/generate-sqlite-schema.cjs.
PRAGMA foreign_keys = ON;

-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watermarkDefault" JSONB,
    "outroDefault" JSONB
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "mode" TEXT NOT NULL,
    "reframe" TEXT NOT NULL DEFAULT 'face_tracking',
    "captions" BOOLEAN NOT NULL DEFAULT true,
    "twoSpeakers" BOOLEAN NOT NULL DEFAULT false,
    "facecam" BOOLEAN NOT NULL DEFAULT false,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "captionLanguage" TEXT NOT NULL DEFAULT 'auto',
    "customHashtags" JSONB NOT NULL DEFAULT [],
    "captionStyle" JSONB,
    "clipCount" INTEGER NOT NULL,
    "targetDurationSec" INTEGER NOT NULL,
    "maxSourceSec" INTEGER,
    "ranges" JSONB,
    "watermark" JSONB,
    "outro" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "userId" TEXT,
    CONSTRAINT "jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "watermarks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watermarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "outros" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "durationSec" REAL NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outros_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "brief_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brief_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reference_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "brief" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "reframe" TEXT NOT NULL DEFAULT 'face_tracking',
    "captions" BOOLEAN NOT NULL DEFAULT true,
    "beatSync" BOOLEAN NOT NULL DEFAULT true,
    "referenceUrl" TEXT,
    "referenceFilePath" TEXT,
    "referenceDurationSec" REAL,
    "footage" JSONB NOT NULL DEFAULT [],
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "templateSlots" JSONB,
    "planSlots" JSONB,
    "outputFilePath" TEXT,
    "outputDurationSec" REAL,
    "caption" TEXT,
    "hashtags" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "reference_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "clips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "filePath" TEXT NOT NULL,
    "downloadedAt" DATETIME,
    "deletedAt" DATETIME,
    "caption" TEXT,
    "hashtags" JSONB NOT NULL DEFAULT [],
    "transcript" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clips_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" DATETIME,
    "scopes" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "social_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "publications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clipId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'direct',
    "title" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL,
    "privacy" TEXT NOT NULL,
    "options" JSONB,
    "madeForKids" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "publications_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "clips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "publications_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "jobs_userId_idx" ON "jobs"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "watermarks_userId_idx" ON "watermarks"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outros_userId_idx" ON "outros"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "brief_history_userId_lastUsedAt_idx" ON "brief_history"("userId", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "brief_history_userId_text_key" ON "brief_history"("userId", "text");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reference_jobs_userId_createdAt_idx" ON "reference_jobs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "clips_jobId_idx" ON "clips"("jobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "clips_createdAt_idx" ON "clips"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_accounts_userId_idx" ON "social_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_userId_platform_externalId_key" ON "social_accounts"("userId", "platform", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "publications_clipId_idx" ON "publications"("clipId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "publications_socialAccountId_idx" ON "publications"("socialAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "publications_status_idx" ON "publications"("status");

