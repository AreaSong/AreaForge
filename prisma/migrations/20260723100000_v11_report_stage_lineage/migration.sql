-- Additive lineage fields for report-derived stage adjustment drafts.
ALTER TABLE "StageAdjustmentDraft"
ADD COLUMN "sourceReportDecisionId" TEXT,
ADD COLUMN "sourceReportRevision" INTEGER,
ADD COLUMN "originVersion" INTEGER;

CREATE INDEX "StageAdjustmentDraft_sourceReportDecisionId_idx"
ON "StageAdjustmentDraft"("sourceReportDecisionId");

CREATE INDEX "StageAdjustmentDraft_workspaceId_originVersion_idx"
ON "StageAdjustmentDraft"("workspaceId", "originVersion");
