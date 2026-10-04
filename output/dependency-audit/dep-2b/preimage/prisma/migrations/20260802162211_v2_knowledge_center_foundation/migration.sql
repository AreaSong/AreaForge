-- CreateEnum
CREATE TYPE "KnowledgeMasteryState" AS ENUM ('UNTOUCHED', 'LEARNING', 'INITIAL_MASTERY', 'STABLE_MASTERY', 'NEEDS_RETEST');

-- CreateEnum
CREATE TYPE "KnowledgeRelationType" AS ENUM ('PREREQUISITE', 'COMPOSES', 'RELATED', 'CONFUSABLE', 'APPLIES_TO');

-- CreateEnum
CREATE TYPE "LearningArrangementStatus" AS ENUM ('PLANNED', 'OCCURRED', 'ADJUSTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "KnowledgeRetestStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW', 'CLOSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "KnowledgeRetestResult" AS ENUM ('PASSED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SessionUnderstanding" AS ENUM ('NO_PROGRESS', 'SOME_PROGRESS', 'UNDERSTOOD', 'CAN_APPLY');

-- CreateEnum
CREATE TYPE "SessionEfficiency" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- AlterTable
ALTER TABLE "StudySession" ADD COLUMN     "userId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- Bind legacy sessions to their existing subject workspace before switching
-- the active-session invariant from the old single-user index to a user scope.
UPDATE "StudySession" AS session
SET
  "workspaceId" = subject."workspaceId",
  "userId" = workspace."userId"
FROM "Subject" AS subject
JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
WHERE session."subjectId" = subject."id"
  AND session."workspaceId" IS NULL
  AND subject."workspaceId" IS NOT NULL;

DROP INDEX IF EXISTS "StudySession_one_active_idx";
CREATE UNIQUE INDEX "StudySession_one_active_per_user_idx"
ON "StudySession" ("userId")
WHERE "status" IN ('RUNNING', 'PAUSED') AND "userId" IS NOT NULL;
CREATE UNIQUE INDEX "StudySession_one_legacy_active_idx"
ON "StudySession" ((1))
WHERE "status" IN ('RUNNING', 'PAUSED') AND "userId" IS NULL;

-- CreateTable
CREATE TABLE "TerminalGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminalGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT,
    "parentId" TEXT,
    "stableKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "primarySubjectId" TEXT NOT NULL,
    "primaryGroupId" TEXT,
    "stableKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "boundary" TEXT,
    "masteryState" "KnowledgeMasteryState" NOT NULL DEFAULT 'UNTOUCHED',
    "nextRetestAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePointSubject" (
    "id" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RELATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePointSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePointRelation" (
    "id" TEXT NOT NULL,
    "fromPointId" TEXT NOT NULL,
    "toPointId" TEXT NOT NULL,
    "type" "KnowledgeRelationType" NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePointRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSyllabusLink" (
    "id" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSyllabusLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageGoalLink" (
    "id" TEXT NOT NULL,
    "stagePlanId" TEXT NOT NULL,
    "terminalGoalId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SUPPORTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageGoalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageKnowledgeTarget" (
    "id" TEXT NOT NULL,
    "stagePlanId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "targetState" "KnowledgeMasteryState" NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "feedback" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageKnowledgeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningArrangement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stagePlanId" TEXT,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "intent" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "LearningArrangementStatus" NOT NULL DEFAULT 'PLANNED',
    "estimatedMin" INTEGER,
    "estimatedMax" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningArrangement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningArrangementKnowledgePoint" (
    "id" TEXT NOT NULL,
    "arrangementId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningArrangementKnowledgePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySessionCloseout" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "understanding" "SessionUnderstanding" NOT NULL,
    "efficiency" "SessionEfficiency" NOT NULL,
    "lowReasons" JSONB,
    "focusLevel" INTEGER,
    "energyLevel" INTEGER,
    "summary" TEXT,
    "nextDisposition" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "StudySessionCloseout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySessionKnowledgePoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "understanding" "SessionUnderstanding",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySessionKnowledgePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRetest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" "KnowledgeRetestStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "KnowledgeRetestResult",
    "scheduledAt" TIMESTAMP(3),
    "testedAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3),
    "summary" TEXT,
    "reviewText" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRetest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRetestPoint" (
    "id" TEXT NOT NULL,
    "retestId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "result" "KnowledgeRetestResult" NOT NULL,
    "score" DOUBLE PRECISION,
    "understanding" INTEGER,
    "note" TEXT,

    CONSTRAINT "KnowledgeRetestPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sessionId" TEXT,
    "retestPointId" TEXT,
    "summary" TEXT,
    "dimensions" JSONB,
    "confidence" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TerminalGoal_userId_status_idx" ON "TerminalGoal"("userId", "status");

-- CreateIndex
CREATE INDEX "TerminalGoal_workspaceId_status_idx" ON "TerminalGoal"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TerminalGoal_workspaceId_stableKey_key" ON "TerminalGoal"("workspaceId", "stableKey");

-- CreateIndex
CREATE INDEX "KnowledgeGroup_workspaceId_archivedAt_idx" ON "KnowledgeGroup"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "KnowledgeGroup_parentId_idx" ON "KnowledgeGroup"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGroup_workspaceId_stableKey_key" ON "KnowledgeGroup"("workspaceId", "stableKey");

-- CreateIndex
CREATE INDEX "KnowledgePoint_workspaceId_masteryState_archivedAt_idx" ON "KnowledgePoint"("workspaceId", "masteryState", "archivedAt");

-- CreateIndex
CREATE INDEX "KnowledgePoint_primarySubjectId_idx" ON "KnowledgePoint"("primarySubjectId");

-- CreateIndex
CREATE INDEX "KnowledgePoint_primaryGroupId_idx" ON "KnowledgePoint"("primaryGroupId");

-- CreateIndex
CREATE INDEX "KnowledgePoint_nextRetestAt_idx" ON "KnowledgePoint"("nextRetestAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePoint_workspaceId_stableKey_key" ON "KnowledgePoint"("workspaceId", "stableKey");

-- CreateIndex
CREATE INDEX "KnowledgePointSubject_subjectId_idx" ON "KnowledgePointSubject"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePointSubject_knowledgePointId_subjectId_key" ON "KnowledgePointSubject"("knowledgePointId", "subjectId");

-- CreateIndex
CREATE INDEX "KnowledgePointRelation_toPointId_type_idx" ON "KnowledgePointRelation"("toPointId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePointRelation_fromPointId_toPointId_type_key" ON "KnowledgePointRelation"("fromPointId", "toPointId", "type");

-- CreateIndex
CREATE INDEX "KnowledgeSyllabusLink_syllabusNodeId_idx" ON "KnowledgeSyllabusLink"("syllabusNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSyllabusLink_knowledgePointId_syllabusNodeId_key" ON "KnowledgeSyllabusLink"("knowledgePointId", "syllabusNodeId");

-- CreateIndex
CREATE INDEX "StageGoalLink_terminalGoalId_role_idx" ON "StageGoalLink"("terminalGoalId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "StageGoalLink_stagePlanId_terminalGoalId_key" ON "StageGoalLink"("stagePlanId", "terminalGoalId");

-- CreateIndex
CREATE INDEX "StageKnowledgeTarget_knowledgePointId_targetState_idx" ON "StageKnowledgeTarget"("knowledgePointId", "targetState");

-- CreateIndex
CREATE UNIQUE INDEX "StageKnowledgeTarget_stagePlanId_knowledgePointId_key" ON "StageKnowledgeTarget"("stagePlanId", "knowledgePointId");

-- CreateIndex
CREATE INDEX "LearningArrangement_workspaceId_startDate_endDate_idx" ON "LearningArrangement"("workspaceId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "LearningArrangement_stagePlanId_status_idx" ON "LearningArrangement"("stagePlanId", "status");

-- CreateIndex
CREATE INDEX "LearningArrangementKnowledgePoint_knowledgePointId_idx" ON "LearningArrangementKnowledgePoint"("knowledgePointId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningArrangementKnowledgePoint_arrangementId_knowledgePo_key" ON "LearningArrangementKnowledgePoint"("arrangementId", "knowledgePointId");

-- CreateIndex
CREATE UNIQUE INDEX "StudySessionCloseout_sessionId_key" ON "StudySessionCloseout"("sessionId");

-- CreateIndex
CREATE INDEX "StudySessionCloseout_actorId_submittedAt_idx" ON "StudySessionCloseout"("actorId", "submittedAt");

-- CreateIndex
CREATE INDEX "StudySessionKnowledgePoint_knowledgePointId_idx" ON "StudySessionKnowledgePoint"("knowledgePointId");

-- CreateIndex
CREATE UNIQUE INDEX "StudySessionKnowledgePoint_sessionId_knowledgePointId_key" ON "StudySessionKnowledgePoint"("sessionId", "knowledgePointId");

-- CreateIndex
CREATE INDEX "KnowledgeRetest_workspaceId_status_scheduledAt_idx" ON "KnowledgeRetest"("workspaceId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "KnowledgeRetest_nextDueAt_idx" ON "KnowledgeRetest"("nextDueAt");

-- CreateIndex
CREATE INDEX "KnowledgeRetestPoint_knowledgePointId_result_idx" ON "KnowledgeRetestPoint"("knowledgePointId", "result");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRetestPoint_retestId_knowledgePointId_key" ON "KnowledgeRetestPoint"("retestId", "knowledgePointId");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_workspaceId_knowledgePointId_occurredAt_idx" ON "KnowledgeEvidence"("workspaceId", "knowledgePointId", "occurredAt");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_sessionId_idx" ON "KnowledgeEvidence"("sessionId");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_retestPointId_idx" ON "KnowledgeEvidence"("retestPointId");

-- CreateIndex
CREATE INDEX "StudySession_userId_workspaceId_status_idx" ON "StudySession"("userId", "workspaceId", "status");

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalGoal" ADD CONSTRAINT "TerminalGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalGoal" ADD CONSTRAINT "TerminalGoal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGroup" ADD CONSTRAINT "KnowledgeGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGroup" ADD CONSTRAINT "KnowledgeGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGroup" ADD CONSTRAINT "KnowledgeGroup_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGroup" ADD CONSTRAINT "KnowledgeGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePoint" ADD CONSTRAINT "KnowledgePoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePoint" ADD CONSTRAINT "KnowledgePoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePoint" ADD CONSTRAINT "KnowledgePoint_primarySubjectId_fkey" FOREIGN KEY ("primarySubjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePoint" ADD CONSTRAINT "KnowledgePoint_primaryGroupId_fkey" FOREIGN KEY ("primaryGroupId") REFERENCES "KnowledgeGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointSubject" ADD CONSTRAINT "KnowledgePointSubject_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointSubject" ADD CONSTRAINT "KnowledgePointSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointRelation" ADD CONSTRAINT "KnowledgePointRelation_fromPointId_fkey" FOREIGN KEY ("fromPointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointRelation" ADD CONSTRAINT "KnowledgePointRelation_toPointId_fkey" FOREIGN KEY ("toPointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointRelation" ADD CONSTRAINT "KnowledgePointRelation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSyllabusLink" ADD CONSTRAINT "KnowledgeSyllabusLink_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSyllabusLink" ADD CONSTRAINT "KnowledgeSyllabusLink_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageGoalLink" ADD CONSTRAINT "StageGoalLink_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageGoalLink" ADD CONSTRAINT "StageGoalLink_terminalGoalId_fkey" FOREIGN KEY ("terminalGoalId") REFERENCES "TerminalGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageKnowledgeTarget" ADD CONSTRAINT "StageKnowledgeTarget_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageKnowledgeTarget" ADD CONSTRAINT "StageKnowledgeTarget_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningArrangement" ADD CONSTRAINT "LearningArrangement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningArrangement" ADD CONSTRAINT "LearningArrangement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningArrangement" ADD CONSTRAINT "LearningArrangement_stagePlanId_fkey" FOREIGN KEY ("stagePlanId") REFERENCES "StagePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningArrangement" ADD CONSTRAINT "LearningArrangement_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningArrangementKnowledgePoint" ADD CONSTRAINT "LearningArrangementKnowledgePoint_arrangementId_fkey" FOREIGN KEY ("arrangementId") REFERENCES "LearningArrangement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningArrangementKnowledgePoint" ADD CONSTRAINT "LearningArrangementKnowledgePoint_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySessionCloseout" ADD CONSTRAINT "StudySessionCloseout_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySessionCloseout" ADD CONSTRAINT "StudySessionCloseout_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySessionKnowledgePoint" ADD CONSTRAINT "StudySessionKnowledgePoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySessionKnowledgePoint" ADD CONSTRAINT "StudySessionKnowledgePoint_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRetest" ADD CONSTRAINT "KnowledgeRetest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRetest" ADD CONSTRAINT "KnowledgeRetest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRetestPoint" ADD CONSTRAINT "KnowledgeRetestPoint_retestId_fkey" FOREIGN KEY ("retestId") REFERENCES "KnowledgeRetest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRetestPoint" ADD CONSTRAINT "KnowledgeRetestPoint_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_retestPointId_fkey" FOREIGN KEY ("retestPointId") REFERENCES "KnowledgeRetestPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
