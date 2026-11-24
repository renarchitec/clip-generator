-- Riwayat brief per pengguna: teks unik per user, jumlah pemakaian, dan batas 30 entri per user.
CREATE TABLE "brief_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brief_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brief_history_userId_lastUsedAt_idx" ON "brief_history"("userId", "lastUsedAt");

CREATE UNIQUE INDEX "brief_history_userId_text_key" ON "brief_history"("userId", "text");

ALTER TABLE "brief_history" ADD CONSTRAINT "brief_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
