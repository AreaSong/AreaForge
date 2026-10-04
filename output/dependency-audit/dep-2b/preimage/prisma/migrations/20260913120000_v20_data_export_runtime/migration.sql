-- 每次租约先登记独立文件意图；旧预览包没有 sourceArtifactId，不获得真实下载资格。
CREATE TYPE "DataExportArtifactState" AS ENUM ('STAGING', 'PUBLISHED', 'RECLAIMING', 'RECLAIMED');

CREATE TABLE "DataExportArtifact" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "leaseVersion" INTEGER NOT NULL,
  "state" "DataExportArtifactState" NOT NULL DEFAULT 'STAGING',
  "objectKey" TEXT NOT NULL,
  "snapshotAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "reclaimedAt" TIMESTAMP(3),
  "reclaimErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataExportArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataExportArtifact_lease_check" CHECK ("leaseVersion" > 0),
  CONSTRAINT "DataExportArtifact_key_check" CHECK ("objectKey" ~ '^export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT "DataExportArtifact_published_check" CHECK ("state" <> 'PUBLISHED' OR ("publishedAt" IS NOT NULL AND "snapshotAt" IS NOT NULL)),
  CONSTRAINT "DataExportArtifact_reclaimed_check" CHECK (("state" = 'RECLAIMED') = ("reclaimedAt" IS NOT NULL)),
  CONSTRAINT "DataExportArtifact_error_check" CHECK ("reclaimErrorCode" IS NULL OR "reclaimErrorCode" ~ '^DATA_EXPORT_[A-Z_]{1,70}$'),
  CONSTRAINT "DataExportArtifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DataJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DataExportArtifact_objectKey_key" ON "DataExportArtifact"("objectKey");
CREATE UNIQUE INDEX "DataExportArtifact_jobId_leaseVersion_key" ON "DataExportArtifact"("jobId", "leaseVersion");
CREATE INDEX "DataExportArtifact_state_expiresAt_idx" ON "DataExportArtifact"("state", "expiresAt");

ALTER TABLE "DataExportPackage" ADD COLUMN "sourceArtifactId" TEXT;
CREATE UNIQUE INDEX "DataExportPackage_sourceArtifactId_key" ON "DataExportPackage"("sourceArtifactId");
ALTER TABLE "DataExportPackage" ADD CONSTRAINT "DataExportPackage_sourceArtifactId_fkey"
  FOREIGN KEY ("sourceArtifactId") REFERENCES "DataExportArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 短期预留限制同一凭证的并行校验，不把预留当作已消费或已交付。
ALTER TABLE "DataExportDownloadGrant"
  ADD COLUMN "reservationId" TEXT,
  ADD COLUMN "reservedAt" TIMESTAMP(3),
  ADD COLUMN "reservationExpiresAt" TIMESTAMP(3);
ALTER TABLE "DataExportDownloadGrant" ADD CONSTRAINT "DataExportDownloadGrant_reservation_check" CHECK (
  ("reservationId" IS NULL AND "reservedAt" IS NULL AND "reservationExpiresAt" IS NULL)
  OR ("reservationId" IS NOT NULL AND "reservedAt" IS NOT NULL AND "reservationExpiresAt" IS NOT NULL
    AND "reservedAt" < "reservationExpiresAt" AND "reservationExpiresAt" <= "expiresAt" AND "consumedAt" IS NULL)
);
