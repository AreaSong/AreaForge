-- Add explicit mastery proof records for Package B Batch 4.
CREATE TABLE "MasteryConditionRecord" (
    "id" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasteryConditionRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MasteryEvidence" (
    "id" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "taskId" TEXT,
    "sessionId" TEXT,
    "noteId" TEXT,
    "mistakeId" TEXT,
    "retestId" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "MasteryEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MasteryRetest" (
    "id" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "testedAt" TIMESTAMP(3) NOT NULL,
    "result" TEXT NOT NULL,
    "score" TEXT,
    "summary" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MasteryRetest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MasteryConditionRecord_syllabusNodeId_condition_key" ON "MasteryConditionRecord"("syllabusNodeId", "condition");
CREATE INDEX "MasteryConditionRecord_syllabusNodeId_idx" ON "MasteryConditionRecord"("syllabusNodeId");
CREATE INDEX "MasteryConditionRecord_actorId_idx" ON "MasteryConditionRecord"("actorId");

CREATE INDEX "MasteryEvidence_syllabusNodeId_idx" ON "MasteryEvidence"("syllabusNodeId");
CREATE INDEX "MasteryEvidence_evidenceType_idx" ON "MasteryEvidence"("evidenceType");
CREATE INDEX "MasteryEvidence_taskId_idx" ON "MasteryEvidence"("taskId");
CREATE INDEX "MasteryEvidence_sessionId_idx" ON "MasteryEvidence"("sessionId");
CREATE INDEX "MasteryEvidence_noteId_idx" ON "MasteryEvidence"("noteId");
CREATE INDEX "MasteryEvidence_mistakeId_idx" ON "MasteryEvidence"("mistakeId");
CREATE INDEX "MasteryEvidence_retestId_idx" ON "MasteryEvidence"("retestId");
CREATE INDEX "MasteryEvidence_actorId_idx" ON "MasteryEvidence"("actorId");
CREATE INDEX "MasteryEvidence_createdAt_idx" ON "MasteryEvidence"("createdAt");

CREATE INDEX "MasteryRetest_syllabusNodeId_idx" ON "MasteryRetest"("syllabusNodeId");
CREATE INDEX "MasteryRetest_testedAt_idx" ON "MasteryRetest"("testedAt");
CREATE INDEX "MasteryRetest_result_idx" ON "MasteryRetest"("result");
CREATE INDEX "MasteryRetest_nextReviewAt_idx" ON "MasteryRetest"("nextReviewAt");
CREATE INDEX "MasteryRetest_actorId_idx" ON "MasteryRetest"("actorId");

ALTER TABLE "MasteryConditionRecord" ADD CONSTRAINT "MasteryConditionRecord_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryConditionRecord" ADD CONSTRAINT "MasteryConditionRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "Mistake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_retestId_fkey" FOREIGN KEY ("retestId") REFERENCES "MasteryRetest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MasteryRetest" ADD CONSTRAINT "MasteryRetest_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MasteryRetest" ADD CONSTRAINT "MasteryRetest_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
