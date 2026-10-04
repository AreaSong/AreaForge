-- Add report decision ledger for Package D Batch D1.
-- This migration is additive only: existing reports remain real-time readable.
CREATE TABLE "PeriodicReportDecision" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reportSnapshot" JSONB NOT NULL,
    "nextCycleDraft" JSONB,
    "canAutoApply" BOOLEAN NOT NULL DEFAULT false,
    "requiresUserConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "actorId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodicReportDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PeriodicReportDecision_kind_rangeStart_rangeEnd_key" ON "PeriodicReportDecision"("kind", "rangeStart", "rangeEnd");
CREATE INDEX "PeriodicReportDecision_kind_idx" ON "PeriodicReportDecision"("kind");
CREATE INDEX "PeriodicReportDecision_status_idx" ON "PeriodicReportDecision"("status");
CREATE INDEX "PeriodicReportDecision_decidedAt_idx" ON "PeriodicReportDecision"("decidedAt");
CREATE INDEX "PeriodicReportDecision_actorId_idx" ON "PeriodicReportDecision"("actorId");

ALTER TABLE "PeriodicReportDecision" ADD CONSTRAINT "PeriodicReportDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
