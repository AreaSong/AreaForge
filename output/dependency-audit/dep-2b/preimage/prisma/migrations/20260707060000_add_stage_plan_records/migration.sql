-- Add persistent stage plans and confirm-only adjustment drafts for Package B Batch 6.
CREATE TABLE "StagePlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "goal" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StageAdjustmentDraft" (
    "id" TEXT NOT NULL,
    "stagePlanId" TEXT,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "riskConclusion" TEXT NOT NULL,
    "focusSubjects" JSONB NOT NULL,
    "taskIntensity" TEXT NOT NULL,
    "taskAdjustmentActions" JSONB NOT NULL,
    "nextStageEmphasis" TEXT NOT NULL,
    "canAutoApply" BOOLEAN NOT NULL DEFAULT false,
    "requiresUserConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "actorId" TEXT,

    CONSTRAINT "StageAdjustmentDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StagePlan_status_idx" ON "StagePlan"("status");
CREATE INDEX "StagePlan_startDate_idx" ON "StagePlan"("startDate");
CREATE INDEX "StagePlan_endDate_idx" ON "StagePlan"("endDate");

CREATE INDEX "StageAdjustmentDraft_stagePlanId_idx" ON "StageAdjustmentDraft"("stagePlanId");
CREATE INDEX "StageAdjustmentDraft_status_idx" ON "StageAdjustmentDraft"("status");
CREATE INDEX "StageAdjustmentDraft_createdAt_idx" ON "StageAdjustmentDraft"("createdAt");
CREATE INDEX "StageAdjustmentDraft_actorId_idx" ON "StageAdjustmentDraft"("actorId");

ALTER TABLE "StageAdjustmentDraft" ADD CONSTRAINT "StageAdjustmentDraft_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StageAdjustmentDraft" ADD CONSTRAINT "StageAdjustmentDraft_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
