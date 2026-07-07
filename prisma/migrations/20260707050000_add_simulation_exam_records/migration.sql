-- Add structured simulation exam records for Package B Batch 5.
CREATE TABLE "SimulationExam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "examDate" TIMESTAMP(3) NOT NULL,
    "isFirstSynchronized" BOOLEAN NOT NULL DEFAULT false,
    "targetDurationMinutes" INTEGER,
    "actualDurationMinutes" INTEGER,
    "targetScore" DOUBLE PRECISION,
    "actualScore" DOUBLE PRECISION,
    "blankQuestionCount" INTEGER NOT NULL DEFAULT 0,
    "lossReasons" JSONB,
    "mindset" TEXT,
    "summary" TEXT,
    "reviewText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationExam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SimulationSubjectResult" (
    "id" TEXT NOT NULL,
    "simulationExamId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "targetScore" DOUBLE PRECISION,
    "actualScore" DOUBLE PRECISION,
    "durationMinutes" INTEGER,
    "blankQuestionCount" INTEGER NOT NULL DEFAULT 0,
    "lossReasons" JSONB,
    "summary" TEXT,

    CONSTRAINT "SimulationSubjectResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SimulationExam_examDate_idx" ON "SimulationExam"("examDate");
CREATE INDEX "SimulationExam_isFirstSynchronized_idx" ON "SimulationExam"("isFirstSynchronized");

CREATE UNIQUE INDEX "SimulationSubjectResult_simulationExamId_subjectId_key" ON "SimulationSubjectResult"("simulationExamId", "subjectId");
CREATE INDEX "SimulationSubjectResult_simulationExamId_idx" ON "SimulationSubjectResult"("simulationExamId");
CREATE INDEX "SimulationSubjectResult_subjectId_idx" ON "SimulationSubjectResult"("subjectId");

ALTER TABLE "SimulationSubjectResult" ADD CONSTRAINT "SimulationSubjectResult_simulationExamId_fkey" FOREIGN KEY ("simulationExamId") REFERENCES "SimulationExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SimulationSubjectResult" ADD CONSTRAINT "SimulationSubjectResult_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
