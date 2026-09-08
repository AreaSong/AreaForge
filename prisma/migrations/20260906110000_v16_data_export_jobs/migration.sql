-- v1.6 DATA-EXPORT: durable export jobs and one-time package metadata.
-- This migration is additive. It does not delete or rewrite existing data.

ALTER TABLE "MotivationVault" ADD COLUMN "userId" TEXT;

DO $$
DECLARE
    existing_user_count INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM "MotivationVault") THEN
        SELECT COUNT(*) INTO existing_user_count FROM "User";
        IF existing_user_count <> 1 THEN
            RAISE EXCEPTION 'v1.6 cannot infer MotivationVault owner unless exactly one User exists';
        END IF;
        UPDATE "MotivationVault"
        SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
        WHERE "userId" IS NULL;
    END IF;
END $$;

ALTER TABLE "MotivationVault" ALTER COLUMN "userId" SET NOT NULL;
CREATE UNIQUE INDEX "MotivationVault_userId_key" ON "MotivationVault"("userId");
ALTER TABLE "MotivationVault"
    ADD CONSTRAINT "MotivationVault_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "DataJobKind" AS ENUM ('EXPORT', 'DELETE', 'RANKING_REBUILD', 'NOTIFICATION');
CREATE TYPE "DataJobScope" AS ENUM ('ACCOUNT', 'WORKSPACE');
CREATE TYPE "DataJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'CANCEL_REQUESTED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "DataJob" (
    "id" TEXT NOT NULL,
    "kind" "DataJobKind" NOT NULL,
    "scope" "DataJobScope" NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "status" "DataJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "resultJson" JSONB,
    "errorCode" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataExportPackage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "archiveSha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "attachmentCount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExportPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataExportDownloadGrant" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataExportDownloadGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataJob_requestedByUserId_idempotencyKey_key" ON "DataJob"("requestedByUserId", "idempotencyKey");
CREATE INDEX "DataJob_status_kind_createdAt_idx" ON "DataJob"("status", "kind", "createdAt");
CREATE INDEX "DataJob_leaseExpiresAt_status_idx" ON "DataJob"("leaseExpiresAt", "status");
CREATE INDEX "DataJob_workspaceId_createdAt_idx" ON "DataJob"("workspaceId", "createdAt");
CREATE INDEX "DataJob_requestedByUserId_createdAt_idx" ON "DataJob"("requestedByUserId", "createdAt");
CREATE UNIQUE INDEX "DataExportPackage_jobId_key" ON "DataExportPackage"("jobId");
CREATE UNIQUE INDEX "DataExportPackage_objectKey_key" ON "DataExportPackage"("objectKey");
CREATE INDEX "DataExportPackage_expiresAt_idx" ON "DataExportPackage"("expiresAt");
CREATE UNIQUE INDEX "DataExportDownloadGrant_tokenHash_key" ON "DataExportDownloadGrant"("tokenHash");
CREATE INDEX "DataExportDownloadGrant_packageId_expiresAt_idx" ON "DataExportDownloadGrant"("packageId", "expiresAt");
CREATE INDEX "DataExportDownloadGrant_requestedByUserId_createdAt_idx" ON "DataExportDownloadGrant"("requestedByUserId", "createdAt");

ALTER TABLE "DataJob"
    ADD CONSTRAINT "DataJob_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DataJob"
    ADD CONSTRAINT "DataJob_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataExportPackage"
    ADD CONSTRAINT "DataExportPackage_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "DataJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataExportDownloadGrant"
    ADD CONSTRAINT "DataExportDownloadGrant_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "DataExportPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataExportDownloadGrant"
    ADD CONSTRAINT "DataExportDownloadGrant_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
