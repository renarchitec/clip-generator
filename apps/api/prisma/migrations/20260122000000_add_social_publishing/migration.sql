-- Tambahkan metadata caption dan hashtag hasil LLM pada klip.
ALTER TABLE "clips"
ADD COLUMN "caption" TEXT,
ADD COLUMN "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Buat enum platform sosial yang didukung.
CREATE TYPE "SocialPlatform" AS ENUM ('youtube', 'instagram', 'tiktok');

-- Buat enum status publikasi klip.
CREATE TYPE "PublicationStatus" AS ENUM ('queued', 'uploading', 'processing', 'published', 'failed');

-- Buat tabel akun sosial milik pengguna dengan token terenkripsi.
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- Buat tabel publikasi; proses unggah diimplementasikan pada fase berikutnya.
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'direct',
    "caption" TEXT NOT NULL,
    "privacy" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'queued',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- Buat indeks kepemilikan, keunikan akun, dan pencarian publikasi.
CREATE UNIQUE INDEX "social_accounts_userId_platform_externalId_key" ON "social_accounts"("userId", "platform", "externalId");
CREATE INDEX "social_accounts_userId_idx" ON "social_accounts"("userId");
CREATE INDEX "publications_clipId_idx" ON "publications"("clipId");
CREATE INDEX "publications_socialAccountId_idx" ON "publications"("socialAccountId");

-- Tambahkan relasi dengan penghapusan berantai.
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publications" ADD CONSTRAINT "publications_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publications" ADD CONSTRAINT "publications_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
