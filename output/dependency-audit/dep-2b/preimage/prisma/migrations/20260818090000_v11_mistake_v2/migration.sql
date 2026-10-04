-- v1.1 Mistake v2: question content, durable attempts, direct note links, simulation lineage

ALTER TABLE "Mistake" ADD COLUMN "questionText" TEXT;
ALTER TABLE "Mistake" ADD COLUMN "correctAnswer" TEXT;
ALTER TABLE "Mistake" ADD COLUMN "causeNote" TEXT;

ALTER TABLE "SimulationLossItem" ADD COLUMN "mistakeId" TEXT;
CREATE INDEX "SimulationLossItem_mistakeId_idx" ON "SimulationLossItem"("mistakeId");

CREATE TABLE "NoteMistakeLink" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "mistakeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteMistakeLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NoteMistakeLink_noteId_mistakeId_key" ON "NoteMistakeLink"("noteId", "mistakeId");
CREATE INDEX "NoteMistakeLink_mistakeId_idx" ON "NoteMistakeLink"("mistakeId");
ALTER TABLE "NoteMistakeLink" ADD CONSTRAINT "NoteMistakeLink_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteMistakeLink" ADD CONSTRAINT "NoteMistakeLink_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "Mistake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MistakeAttempt" (
    "id" TEXT NOT NULL,
    "mistakeId" TEXT NOT NULL,
    "reviewEventId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "answerMode" TEXT NOT NULL,
    "answerText" TEXT,
    "result" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "note" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "MistakeAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MistakeAttempt_answerMode_check" CHECK ("answerMode" IN ('TEXT', 'PAPER_OR_ORAL')),
    CONSTRAINT "MistakeAttempt_result_check" CHECK ("result" IN ('PASSED', 'PARTIAL', 'FAILED')),
    CONSTRAINT "MistakeAttempt_duration_check" CHECK ("durationSeconds" IS NULL OR ("durationSeconds" >= 1 AND "durationSeconds" <= 14400))
);

CREATE UNIQUE INDEX "MistakeAttempt_reviewEventId_key" ON "MistakeAttempt"("reviewEventId");
CREATE UNIQUE INDEX "MistakeAttempt_mistakeId_idempotencyKey_key" ON "MistakeAttempt"("mistakeId", "idempotencyKey");
CREATE INDEX "MistakeAttempt_mistakeId_attemptedAt_idx" ON "MistakeAttempt"("mistakeId", "attemptedAt");
CREATE INDEX "MistakeAttempt_actorId_idx" ON "MistakeAttempt"("actorId");
ALTER TABLE "MistakeAttempt" ADD CONSTRAINT "MistakeAttempt_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "Mistake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MistakeAttempt" ADD CONSTRAINT "MistakeAttempt_reviewEventId_fkey" FOREIGN KEY ("reviewEventId") REFERENCES "ReviewEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MistakeAttempt" ADD CONSTRAINT "MistakeAttempt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SimulationLossItem" ADD CONSTRAINT "SimulationLossItem_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "Mistake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
