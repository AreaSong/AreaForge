-- OPS-007 attachment staging/write-intent additive migration.
-- Legacy rows become READY/protocolVersion=0 compatibility rows without any data UPDATE;
-- new-protocol defaults (PENDING/protocolVersion=1) are applied immediately afterwards.
-- Unique indexes fail closed when historical storedName/uri duplicates exist; duplicates
-- must be resolved manually before deploy (no automatic repair here).

CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

ALTER TABLE "Attachment"
  ADD COLUMN "status" "AttachmentStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stagingName" TEXT,
  ADD COLUMN "finalizedAt" TIMESTAMP(3),
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "failurePhase" TEXT,
  ADD COLUMN "reconciliationClaimId" TEXT,
  ADD COLUMN "reconciliationClaimedAt" TIMESTAMP(3),
  ADD COLUMN "reconciliationLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reconciliationAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Attachment" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "Attachment" ALTER COLUMN "protocolVersion" SET DEFAULT 1;

CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");
CREATE UNIQUE INDEX "Attachment_uri_key" ON "Attachment"("uri");
CREATE UNIQUE INDEX "Attachment_stagingName_key" ON "Attachment"("stagingName");

CREATE INDEX "Attachment_status_createdAt_idx" ON "Attachment"("status", "createdAt");
