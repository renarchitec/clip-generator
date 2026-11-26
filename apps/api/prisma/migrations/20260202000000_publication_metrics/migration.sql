-- AlterTable
ALTER TABLE "publications" ADD COLUMN "viewCount" INTEGER,
ADD COLUMN "likeCount" INTEGER,
ADD COLUMN "commentCount" INTEGER,
ADD COLUMN "metricsUpdatedAt" TIMESTAMP(3),
ADD COLUMN "metricsError" TEXT;
