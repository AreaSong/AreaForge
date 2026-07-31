-- v1.1 Migration 3: PlanMilestone, TaskDependency, PlanInboxItem, PlanInboxDependencyRef

CREATE TYPE "TaskDependencyType" AS ENUM ('SOFT', 'HARD');
CREATE TYPE "PlanInboxItemStatus" AS ENUM ('OPEN', 'DISMISSED', 'CONVERTED');
CREATE TYPE "PlanInboxDependencyTargetType" AS ENUM ('TASK', 'INBOX_STABLE_REF');

CREATE TABLE "PlanMilestone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stagePlanId" TEXT NOT NULL,
    "subjectId" TEXT,
    "stableKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanMilestone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanMilestone_workspaceId_stableKey_key" ON "PlanMilestone"("workspaceId", "stableKey");
CREATE INDEX "PlanMilestone_stagePlanId_idx" ON "PlanMilestone"("stagePlanId");
CREATE INDEX "PlanMilestone_subjectId_idx" ON "PlanMilestone"("subjectId");
CREATE INDEX "PlanMilestone_status_idx" ON "PlanMilestone"("status");

ALTER TABLE "PlanMilestone" ADD CONSTRAINT "PlanMilestone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanMilestone" ADD CONSTRAINT "PlanMilestone_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanMilestone" ADD CONSTRAINT "PlanMilestone_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_planMilestoneId_fkey" FOREIGN KEY ("planMilestoneId") REFERENCES "PlanMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" "TaskDependencyType" NOT NULL DEFAULT 'SOFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskDependency_no_self_loop_check" CHECK ("predecessorId" <> "successorId")
);

CREATE UNIQUE INDEX "TaskDependency_predecessorId_successorId_key" ON "TaskDependency"("predecessorId", "successorId");
CREATE INDEX "TaskDependency_successorId_idx" ON "TaskDependency"("successorId");
CREATE INDEX "TaskDependency_actorId_idx" ON "TaskDependency"("actorId");

ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "StudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "StudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlanInboxItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "originKey" TEXT NOT NULL,
    "originVersion" INTEGER NOT NULL,
    "originType" TEXT NOT NULL,
    "originSnapshot" JSONB NOT NULL,
    "status" "PlanInboxItemStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "subjectId" TEXT,
    "plannedDate" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "priority" TEXT,
    "type" TEXT,
    "planMilestoneId" TEXT,
    "primaryNodeId" TEXT,
    "relatedNodeIds" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "convertedTaskId" TEXT,
    "supersededByItemId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "PlanInboxItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanInboxItem_converted_task_check" CHECK (
      ("status" = 'CONVERTED' AND "convertedTaskId" IS NOT NULL)
      OR ("status" <> 'CONVERTED' AND "convertedTaskId" IS NULL)
    )
);

CREATE UNIQUE INDEX "PlanInboxItem_workspaceId_originKey_originVersion_key" ON "PlanInboxItem"("workspaceId", "originKey", "originVersion");
CREATE UNIQUE INDEX "PlanInboxItem_workspaceId_stableKey_key" ON "PlanInboxItem"("workspaceId", "stableKey");
CREATE UNIQUE INDEX "PlanInboxItem_convertedTaskId_key" ON "PlanInboxItem"("convertedTaskId");
CREATE INDEX "PlanInboxItem_workspaceId_status_idx" ON "PlanInboxItem"("workspaceId", "status");
CREATE INDEX "PlanInboxItem_planMilestoneId_idx" ON "PlanInboxItem"("planMilestoneId");
CREATE INDEX "PlanInboxItem_actorId_idx" ON "PlanInboxItem"("actorId");
CREATE INDEX "PlanInboxItem_supersededByItemId_idx" ON "PlanInboxItem"("supersededByItemId");

ALTER TABLE "PlanInboxItem" ADD CONSTRAINT "PlanInboxItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanInboxItem" ADD CONSTRAINT "PlanInboxItem_planMilestoneId_fkey" FOREIGN KEY ("planMilestoneId") REFERENCES "PlanMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanInboxItem" ADD CONSTRAINT "PlanInboxItem_convertedTaskId_fkey" FOREIGN KEY ("convertedTaskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanInboxItem" ADD CONSTRAINT "PlanInboxItem_supersededByItemId_fkey" FOREIGN KEY ("supersededByItemId") REFERENCES "PlanInboxItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanInboxItem" ADD CONSTRAINT "PlanInboxItem_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlanInboxDependencyRef" (
    "id" TEXT NOT NULL,
    "inboxItemId" TEXT NOT NULL,
    "targetType" "PlanInboxDependencyTargetType" NOT NULL,
    "dependencyType" "TaskDependencyType" NOT NULL DEFAULT 'SOFT',
    "taskId" TEXT,
    "importBatchId" TEXT,
    "planStableKey" TEXT,
    "planOriginVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanInboxDependencyRef_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanInboxDependencyRef_inboxItemId_idx" ON "PlanInboxDependencyRef"("inboxItemId");
CREATE INDEX "PlanInboxDependencyRef_taskId_idx" ON "PlanInboxDependencyRef"("taskId");
CREATE INDEX "PlanInboxDependencyRef_importBatchId_planStableKey_idx" ON "PlanInboxDependencyRef"("importBatchId", "planStableKey");

ALTER TABLE "PlanInboxDependencyRef" ADD CONSTRAINT "PlanInboxDependencyRef_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "PlanInboxItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanInboxDependencyRef" ADD CONSTRAINT "PlanInboxDependencyRef_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
