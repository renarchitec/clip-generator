-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'member', 'demo');

-- Existing users are promoted to admin, then the default becomes demo for future signups.
ALTER TABLE "users"
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'admin',
  ADD COLUMN "googleId" TEXT,
  ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN "avatarUrl" TEXT,
  ADD COLUMN "signupSource" TEXT,
  ADD COLUMN "utmSource" TEXT,
  ADD COLUMN "utmCampaign" TEXT,
  ADD COLUMN "contentType" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'demo';
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateTable
CREATE TABLE "user_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_events_userId_event_idx" ON "user_events"("userId", "event");
CREATE INDEX "user_events_event_createdAt_idx" ON "user_events"("event", "createdAt");

ALTER TABLE "user_events" ADD CONSTRAINT "user_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
