-- v1.1 Migration 8: structured simulation loss and legacy totals compatibility

ALTER TABLE "SimulationExam"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SimulationSubjectResult"
  ADD COLUMN "paperFullScore" DOUBLE PRECISION,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SimulationLossItem" (
    "id" TEXT NOT NULL,
    "simulationSubjectResultId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "syllabusNodeId" TEXT,
    "lostScore" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SimulationLossItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SimulationLossItem_reason_check" CHECK (
      "reason" IN ('CONCEPT_GAP', 'MEMORY_FORMULA', 'METHOD_ERROR', 'CALCULATION_CARELESS', 'TIME_ALLOCATION', 'READING_COMPREHENSION', 'UNFAMILIAR_PATTERN', 'MINDSET', 'UNANSWERED', 'OTHER')
    ),
    CONSTRAINT "SimulationLossItem_lostScore_positive_half_step_check" CHECK (
      "lostScore" > 0 AND "lostScore" <= 1000 AND mod(("lostScore" * 2)::numeric, 1) = 0
    )
);

ALTER TABLE "SimulationSubjectResult"
  ADD CONSTRAINT "SimulationSubjectResult_paperFullScore_half_step_check"
  CHECK ("paperFullScore" IS NULL OR ("paperFullScore" > 0 AND mod(("paperFullScore" * 2)::numeric, 1) = 0)) NOT VALID,
  ADD CONSTRAINT "SimulationSubjectResult_targetScore_half_step_check"
  CHECK ("targetScore" IS NULL OR ("targetScore" >= 0 AND mod(("targetScore" * 2)::numeric, 1) = 0)) NOT VALID,
  ADD CONSTRAINT "SimulationSubjectResult_actualScore_half_step_check"
  CHECK ("actualScore" IS NULL OR ("actualScore" >= 0 AND mod(("actualScore" * 2)::numeric, 1) = 0)) NOT VALID,
  ADD CONSTRAINT "SimulationSubjectResult_score_bounds_check"
  CHECK ("paperFullScore" IS NULL OR (("targetScore" IS NULL OR "targetScore" <= "paperFullScore") AND ("actualScore" IS NULL OR "actualScore" <= "paperFullScore"))) NOT VALID;

CREATE INDEX "SimulationLossItem_simulationSubjectResultId_archivedAt_idx" ON "SimulationLossItem"("simulationSubjectResultId", "archivedAt");
CREATE INDEX "SimulationLossItem_reason_archivedAt_idx" ON "SimulationLossItem"("reason", "archivedAt");
CREATE INDEX "SimulationLossItem_syllabusNodeId_archivedAt_idx" ON "SimulationLossItem"("syllabusNodeId", "archivedAt");

ALTER TABLE "SimulationLossItem" ADD CONSTRAINT "SimulationLossItem_simulationSubjectResultId_fkey" FOREIGN KEY ("simulationSubjectResultId") REFERENCES "SimulationSubjectResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SimulationLossItem" ADD CONSTRAINT "SimulationLossItem_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
