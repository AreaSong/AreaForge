ALTER TABLE "StageAdjustmentDraft"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SimulationExam"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "confirmedAt" TIMESTAMP(3);

UPDATE "SimulationExam" AS exam
SET
  "status" = 'CONFIRMED',
  "confirmedAt" = exam."updatedAt"
WHERE
  exam."actualScore" IS NOT NULL
  OR exam."reviewText" IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM "SimulationSubjectResult" AS result
    WHERE result."simulationExamId" = exam."id"
  );

CREATE INDEX "SimulationExam_workspaceId_status_idx"
ON "SimulationExam"("workspaceId", "status");
