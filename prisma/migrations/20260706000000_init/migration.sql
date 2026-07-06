-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubjectCode" AS ENUM ('MATH', 'ENGLISH', 'POLITICS', 'DATA_STRUCTURE', 'COMPUTER_ORGANIZATION', 'OPERATING_SYSTEM', 'COMPUTER_NETWORK');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskDebtStatus" AS ENUM ('NONE', 'ACCEPTABLE', 'NEEDS_RECOVERY', 'STAGE_IMPACT', 'PLAN_BREAKING');

-- CreateEnum
CREATE TYPE "StudySessionStatus" AS ENUM ('RUNNING', 'PAUSED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SyllabusNodeKind" AS ENUM ('SUBJECT', 'CHAPTER', 'TOPIC', 'PROBLEM_TYPE');

-- CreateEnum
CREATE TYPE "SyllabusNodeStatus" AS ENUM ('NOT_STARTED', 'LEARNING', 'COVERED', 'NEEDS_REVIEW', 'MASTERED', 'WEAK', 'DEFERRED');

-- CreateEnum
CREATE TYPE "MasteryLevel" AS ENUM ('SEEN', 'LEARNED', 'BASIC_EXERCISES', 'CAN_EXPLAIN', 'RETEST_PASSED', 'EXAM_STABLE');

-- CreateEnum
CREATE TYPE "MistakeCause" AS ENUM ('UNKNOWN', 'CONCEPT_CONFUSION', 'FORMULA_UNFAMILIAR', 'WRONG_APPROACH', 'CARELESS', 'TIME_PRESSURE', 'UNFAMILIAR_PATTERN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "code" "SubjectCode" NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusNode" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "kind" "SyllabusNodeKind" NOT NULL,
    "status" "SyllabusNodeStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "masteryLevel" "MasteryLevel",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "targetMinutes" INTEGER NOT NULL DEFAULT 0,
    "actualMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyTask" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "syllabusNodeId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "debtStatus" "TaskDebtStatus" NOT NULL DEFAULT 'NONE',
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "actualMinutes" INTEGER NOT NULL DEFAULT 0,
    "reviewText" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "taskId" TEXT,
    "syllabusNodeId" TEXT,
    "status" "StudySessionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "accumulatedPauseSeconds" INTEGER NOT NULL DEFAULT 0,
    "effectiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" INTEGER,
    "isEffective" BOOLEAN,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReview" (
    "id" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "effectiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "lostControl" TEXT,
    "keepAction" TEXT,
    "tomorrowMinimum" TEXT,
    "mood" TEXT,
    "aiSuggestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "syllabusNodeId" TEXT,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "masteryStatus" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "noteId" TEXT,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mistake" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "syllabusNodeId" TEXT,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "cause" "MistakeCause" NOT NULL DEFAULT 'UNKNOWN',
    "correctIdea" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mistake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationVault" (
    "id" TEXT NOT NULL,
    "whyStarted" TEXT,
    "neverReturnTo" TEXT,
    "futureSelf" TEXT,
    "messageToFuture" TEXT,
    "firstSimulationDiary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivationVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");

-- CreateIndex
CREATE INDEX "SyllabusNode_subjectId_idx" ON "SyllabusNode"("subjectId");

-- CreateIndex
CREATE INDEX "SyllabusNode_parentId_idx" ON "SyllabusNode"("parentId");

-- CreateIndex
CREATE INDEX "StudyTask_plannedDate_idx" ON "StudyTask"("plannedDate");

-- CreateIndex
CREATE INDEX "StudyTask_subjectId_idx" ON "StudyTask"("subjectId");

-- CreateIndex
CREATE INDEX "StudyTask_syllabusNodeId_idx" ON "StudyTask"("syllabusNodeId");

-- CreateIndex
CREATE INDEX "StudySession_status_idx" ON "StudySession"("status");

-- CreateIndex
CREATE INDEX "StudySession_startedAt_idx" ON "StudySession"("startedAt");

-- CreateIndex
CREATE INDEX "StudySession_subjectId_idx" ON "StudySession"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReview_reviewDate_key" ON "DailyReview"("reviewDate");

-- CreateIndex
CREATE INDEX "Note_subjectId_idx" ON "Note"("subjectId");

-- CreateIndex
CREATE INDEX "Note_syllabusNodeId_idx" ON "Note"("syllabusNodeId");

-- CreateIndex
CREATE INDEX "Attachment_hash_idx" ON "Attachment"("hash");

-- CreateIndex
CREATE INDEX "Attachment_noteId_idx" ON "Attachment"("noteId");

-- CreateIndex
CREATE INDEX "Mistake_subjectId_idx" ON "Mistake"("subjectId");

-- CreateIndex
CREATE INDEX "Mistake_syllabusNodeId_idx" ON "Mistake"("syllabusNodeId");

-- CreateIndex
CREATE INDEX "Mistake_nextReviewAt_idx" ON "Mistake"("nextReviewAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "SyllabusNode" ADD CONSTRAINT "SyllabusNode_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusNode" ADD CONSTRAINT "SyllabusNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SyllabusNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mistake" ADD CONSTRAINT "Mistake_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mistake" ADD CONSTRAINT "Mistake_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
