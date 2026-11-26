ALTER TYPE "PublicationStatus" ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TYPE "PublicationStatus" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "clips"
ADD COLUMN "platformCaptions" JSONB;

ALTER TABLE "publications"
ADD COLUMN "scheduledAt" TIMESTAMP(3);

CREATE INDEX "publications_scheduledAt_idx" ON "publications"("scheduledAt");
