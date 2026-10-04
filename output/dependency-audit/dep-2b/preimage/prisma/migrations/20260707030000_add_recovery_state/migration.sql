-- Add persistent recovery state ledger for Package B Batch 3.
CREATE TABLE "RecoveryState" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "targetMinutes" INTEGER NOT NULL,
    "visibleTaskLimit" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "exitCondition" TEXT,
    "metadata" JSONB,
    "actorId" TEXT,

    CONSTRAINT "RecoveryState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecoveryState_status_idx" ON "RecoveryState"("status");
CREATE INDEX "RecoveryState_startedAt_idx" ON "RecoveryState"("startedAt");
CREATE INDEX "RecoveryState_endedAt_idx" ON "RecoveryState"("endedAt");
CREATE INDEX "RecoveryState_actorId_idx" ON "RecoveryState"("actorId");

ALTER TABLE "RecoveryState" ADD CONSTRAINT "RecoveryState_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
