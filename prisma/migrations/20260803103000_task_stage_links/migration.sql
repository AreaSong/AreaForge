-- A task may support several stages; the primary milestone remains a separate
-- planning convenience and is not the complete stage membership.
CREATE TABLE "StudyTaskStageLink" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stagePlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyTaskStageLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyTaskStageLink_taskId_stagePlanId_key"
ON "StudyTaskStageLink" ("taskId", "stagePlanId");
CREATE INDEX "StudyTaskStageLink_stagePlanId_idx"
ON "StudyTaskStageLink" ("stagePlanId");
CREATE INDEX "StudyTaskStageLink_taskId_idx"
ON "StudyTaskStageLink" ("taskId");

ALTER TABLE "StudyTaskStageLink"
ADD CONSTRAINT "StudyTaskStageLink_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyTaskStageLink"
ADD CONSTRAINT "StudyTaskStageLink_stagePlanId_fkey"
FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
