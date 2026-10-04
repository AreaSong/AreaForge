-- v1.1 Migration 1: ExamWorkspace, SubjectGroup, Subject legacyCode, nullable workspace scope

CREATE TYPE "ExamWorkspaceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "ExamWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetExamDate" TIMESTAMP(3),
    "stageSummary" TEXT,
    "status" "ExamWorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubjectGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubjectGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamWorkspace_userId_stableKey_key" ON "ExamWorkspace"("userId", "stableKey");
CREATE INDEX "ExamWorkspace_userId_idx" ON "ExamWorkspace"("userId");
CREATE INDEX "ExamWorkspace_status_idx" ON "ExamWorkspace"("status");
CREATE UNIQUE INDEX "ExamWorkspace_one_active_per_user_idx" ON "ExamWorkspace"("userId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "SubjectGroup_workspaceId_stableKey_key" ON "SubjectGroup"("workspaceId", "stableKey");
CREATE INDEX "SubjectGroup_workspaceId_idx" ON "SubjectGroup"("workspaceId");

ALTER TABLE "ExamWorkspace" ADD CONSTRAINT "ExamWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectGroup" ADD CONSTRAINT "SubjectGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Subject: rename code -> legacyCode, make nullable, add workspace fields
ALTER TABLE "Subject" RENAME COLUMN "code" TO "legacyCode";
ALTER TABLE "Subject" ALTER COLUMN "legacyCode" DROP NOT NULL;
DROP INDEX IF EXISTS "Subject_code_key";

ALTER TABLE "Subject" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Subject" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Subject" ADD COLUMN "stableKey" TEXT;
ALTER TABLE "Subject" ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "Subject"
SET "stableKey" = lower(replace("legacyCode"::text, '_', '-'))
WHERE "stableKey" IS NULL AND "legacyCode" IS NOT NULL;

ALTER TABLE "Subject" ALTER COLUMN "stableKey" SET NOT NULL;

CREATE UNIQUE INDEX "Subject_legacyCode_uidx" ON "Subject"("legacyCode") WHERE "legacyCode" IS NOT NULL;
CREATE UNIQUE INDEX "Subject_workspace_stableKey_uidx" ON "Subject"("workspaceId", "stableKey") WHERE "workspaceId" IS NOT NULL;
CREATE UNIQUE INDEX "Subject_legacy_stableKey_uidx" ON "Subject"("stableKey") WHERE "workspaceId" IS NULL;
CREATE INDEX "Subject_workspaceId_idx" ON "Subject"("workspaceId");
CREATE INDEX "Subject_groupId_idx" ON "Subject"("groupId");
CREATE INDEX "Subject_stableKey_idx" ON "Subject"("stableKey");
CREATE INDEX "Subject_legacyCode_idx" ON "Subject"("legacyCode");

ALTER TABLE "Subject" ADD CONSTRAINT "Subject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SubjectGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DailyReview: nullable workspace + partial uniques
ALTER TABLE "DailyReview" ADD COLUMN "workspaceId" TEXT;
DROP INDEX IF EXISTS "DailyReview_reviewDate_key";
CREATE UNIQUE INDEX "DailyReview_legacy_reviewDate_uidx" ON "DailyReview"("reviewDate") WHERE "workspaceId" IS NULL;
CREATE UNIQUE INDEX "DailyReview_workspace_reviewDate_uidx" ON "DailyReview"("workspaceId", "reviewDate") WHERE "workspaceId" IS NOT NULL;
CREATE INDEX "DailyReview_workspaceId_idx" ON "DailyReview"("workspaceId");
CREATE INDEX "DailyReview_reviewDate_idx" ON "DailyReview"("reviewDate");
ALTER TABLE "DailyReview" ADD CONSTRAINT "DailyReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckIn: nullable workspace + partial uniques
ALTER TABLE "CheckIn" ADD COLUMN "workspaceId" TEXT;
DROP INDEX IF EXISTS "CheckIn_studyDate_key";
CREATE UNIQUE INDEX "CheckIn_legacy_studyDate_uidx" ON "CheckIn"("studyDate") WHERE "workspaceId" IS NULL;
CREATE UNIQUE INDEX "CheckIn_workspace_studyDate_uidx" ON "CheckIn"("workspaceId", "studyDate") WHERE "workspaceId" IS NOT NULL;
CREATE INDEX "CheckIn_workspaceId_idx" ON "CheckIn"("workspaceId");
CREATE INDEX "CheckIn_studyDate_idx" ON "CheckIn"("studyDate");
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RecoveryState
ALTER TABLE "RecoveryState" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "RecoveryState_workspaceId_idx" ON "RecoveryState"("workspaceId");
ALTER TABLE "RecoveryState" ADD CONSTRAINT "RecoveryState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SimulationExam
ALTER TABLE "SimulationExam" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "SimulationExam_workspaceId_idx" ON "SimulationExam"("workspaceId");
ALTER TABLE "SimulationExam" ADD CONSTRAINT "SimulationExam_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- StagePlan
ALTER TABLE "StagePlan" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "StagePlan" ADD COLUMN "stableKey" TEXT;
ALTER TABLE "StagePlan" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "StagePlan_workspaceId_idx" ON "StagePlan"("workspaceId");
ALTER TABLE "StagePlan" ADD CONSTRAINT "StagePlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- StageAdjustmentDraft
ALTER TABLE "StageAdjustmentDraft" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "StageAdjustmentDraft_workspaceId_idx" ON "StageAdjustmentDraft"("workspaceId");
ALTER TABLE "StageAdjustmentDraft" ADD CONSTRAINT "StageAdjustmentDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PeriodicReportDecision: nullable workspace + partial uniques
ALTER TABLE "PeriodicReportDecision" ADD COLUMN "workspaceId" TEXT;
DROP INDEX IF EXISTS "PeriodicReportDecision_kind_rangeStart_rangeEnd_key";
CREATE UNIQUE INDEX "PeriodicReportDecision_legacy_period_uidx" ON "PeriodicReportDecision"("kind", "rangeStart", "rangeEnd") WHERE "workspaceId" IS NULL;
CREATE UNIQUE INDEX "PeriodicReportDecision_workspace_period_uidx" ON "PeriodicReportDecision"("workspaceId", "kind", "rangeStart", "rangeEnd") WHERE "workspaceId" IS NOT NULL;
CREATE INDEX "PeriodicReportDecision_workspaceId_idx" ON "PeriodicReportDecision"("workspaceId");
ALTER TABLE "PeriodicReportDecision" ADD CONSTRAINT "PeriodicReportDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
