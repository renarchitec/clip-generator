ALTER TABLE "publications"
    ADD COLUMN "accountName" TEXT,
    ADD COLUMN "accountExternalId" TEXT;

UPDATE "publications" p
SET "accountName" = sa."displayName", "accountExternalId" = sa."externalId"
FROM "social_accounts" sa
WHERE p."socialAccountId" = sa."id";

ALTER TABLE "publications" DROP CONSTRAINT "publications_socialAccountId_fkey";
ALTER TABLE "publications" ALTER COLUMN "socialAccountId" DROP NOT NULL;
ALTER TABLE "publications" ADD CONSTRAINT "publications_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
