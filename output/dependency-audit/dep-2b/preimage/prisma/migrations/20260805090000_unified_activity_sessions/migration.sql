-- Keep one persisted timer model while distinguishing free study, review,
-- retest and simulation activities for routing, themes and reporting.
CREATE TYPE "StudySessionActivityKind" AS ENUM ('STUDY', 'REVIEW', 'TEST');

CREATE TYPE "StudySessionActivityMode" AS ENUM ('FREE_STUDY', 'KNOWLEDGE_REVIEW', 'RETEST', 'SIMULATION');

ALTER TYPE "StudySessionStartSource" ADD VALUE 'KNOWLEDGE_REVIEW';
ALTER TYPE "StudySessionStartSource" ADD VALUE 'KNOWLEDGE_RETEST';
ALTER TYPE "StudySessionStartSource" ADD VALUE 'SIMULATION_EXAM';

ALTER TABLE "StudySession"
  ADD COLUMN "activityKind" "StudySessionActivityKind" NOT NULL DEFAULT 'STUDY',
  ADD COLUMN "activityMode" "StudySessionActivityMode" NOT NULL DEFAULT 'FREE_STUDY',
  ADD COLUMN "reviewScheduleId" TEXT,
  ADD COLUMN "knowledgeRetestId" TEXT,
  ADD COLUMN "simulationExamId" TEXT;

CREATE INDEX "StudySession_activityKind_startedAt_idx"
  ON "StudySession"("activityKind", "startedAt");

CREATE INDEX "StudySession_activityMode_startedAt_idx"
  ON "StudySession"("activityMode", "startedAt");

CREATE INDEX "StudySession_reviewScheduleId_idx"
  ON "StudySession"("reviewScheduleId");

CREATE INDEX "StudySession_knowledgeRetestId_idx"
  ON "StudySession"("knowledgeRetestId");

CREATE INDEX "StudySession_simulationExamId_idx"
  ON "StudySession"("simulationExamId");

ALTER TABLE "StudySession"
  ADD CONSTRAINT "StudySession_reviewScheduleId_fkey"
  FOREIGN KEY ("reviewScheduleId") REFERENCES "ReviewSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StudySession_knowledgeRetestId_fkey"
  FOREIGN KEY ("knowledgeRetestId") REFERENCES "KnowledgeRetest"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "StudySession_simulationExamId_fkey"
  FOREIGN KEY ("simulationExamId") REFERENCES "SimulationExam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
