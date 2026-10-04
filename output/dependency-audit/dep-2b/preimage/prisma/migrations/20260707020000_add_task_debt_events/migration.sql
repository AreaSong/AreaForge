-- Add task parent links and debt event ledger for Package B Batch 2.
ALTER TABLE "StudyTask" ADD COLUMN "parentTaskId" TEXT;

CREATE TABLE "TaskDebtEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "fromDebtStatus" TEXT,
    "toDebtStatus" TEXT,
    "relatedTaskId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDebtEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudyTask_parentTaskId_idx" ON "StudyTask"("parentTaskId");
CREATE INDEX "TaskDebtEvent_taskId_idx" ON "TaskDebtEvent"("taskId");
CREATE INDEX "TaskDebtEvent_relatedTaskId_idx" ON "TaskDebtEvent"("relatedTaskId");
CREATE INDEX "TaskDebtEvent_createdAt_idx" ON "TaskDebtEvent"("createdAt");

ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskDebtEvent" ADD CONSTRAINT "TaskDebtEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskDebtEvent" ADD CONSTRAINT "TaskDebtEvent_relatedTaskId_fkey" FOREIGN KEY ("relatedTaskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskDebtEvent" ADD CONSTRAINT "TaskDebtEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
