-- v1.1 Migration 2: Note kinds / related nodes, Task related nodes, Session goalMinutes/startSource

CREATE TYPE "NoteKind" AS ENUM ('GENERAL', 'CONCEPT', 'METHOD', 'EXAMPLE', 'JOURNAL', 'SUMMARY');
CREATE TYPE "StudySessionStartSource" AS ENUM ('TASK', 'SUBJECT_SHORTCUT', 'RECOVERY');

ALTER TABLE "Note" ADD COLUMN "kind" "NoteKind" NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "Note" ADD COLUMN "studyDate" TIMESTAMP(3);
ALTER TABLE "Note" ADD COLUMN "stableKey" TEXT;
ALTER TABLE "Note" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "Note_stableKey_idx" ON "Note"("stableKey");
CREATE INDEX "Note_kind_idx" ON "Note"("kind");

CREATE TABLE "NoteRelatedSyllabusNode" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteRelatedSyllabusNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NoteRelatedSyllabusNode_noteId_syllabusNodeId_key" ON "NoteRelatedSyllabusNode"("noteId", "syllabusNodeId");
CREATE INDEX "NoteRelatedSyllabusNode_syllabusNodeId_idx" ON "NoteRelatedSyllabusNode"("syllabusNodeId");
ALTER TABLE "NoteRelatedSyllabusNode" ADD CONSTRAINT "NoteRelatedSyllabusNode_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteRelatedSyllabusNode" ADD CONSTRAINT "NoteRelatedSyllabusNode_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- planMilestoneId without FK until Migration 3
ALTER TABLE "StudyTask" ADD COLUMN "planMilestoneId" TEXT;
CREATE INDEX "StudyTask_planMilestoneId_idx" ON "StudyTask"("planMilestoneId");

CREATE TABLE "StudyTaskRelatedSyllabusNode" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyTaskRelatedSyllabusNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyTaskRelatedSyllabusNode_taskId_syllabusNodeId_key" ON "StudyTaskRelatedSyllabusNode"("taskId", "syllabusNodeId");
CREATE INDEX "StudyTaskRelatedSyllabusNode_syllabusNodeId_idx" ON "StudyTaskRelatedSyllabusNode"("syllabusNodeId");
ALTER TABLE "StudyTaskRelatedSyllabusNode" ADD CONSTRAINT "StudyTaskRelatedSyllabusNode_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyTaskRelatedSyllabusNode" ADD CONSTRAINT "StudyTaskRelatedSyllabusNode_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySession" ADD COLUMN "goalMinutes" INTEGER;
ALTER TABLE "StudySession" ADD COLUMN "startSource" "StudySessionStartSource";
