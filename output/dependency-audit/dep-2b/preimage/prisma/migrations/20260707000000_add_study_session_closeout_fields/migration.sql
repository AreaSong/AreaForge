-- Add structured closeout fields for StudySession.
-- This migration is additive only: historical note text remains untouched and readable.
ALTER TABLE "StudySession"
  ADD COLUMN "understandingLevel" TEXT,
  ADD COLUMN "minimalOutput" TEXT,
  ADD COLUMN "nextAction" TEXT,
  ADD COLUMN "producedNote" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "producedMistake" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isLowConversion" BOOLEAN,
  ADD COLUMN "antiFakeReason" TEXT,
  ADD COLUMN "requiredOutput" TEXT,
  ADD COLUMN "closeoutVersion" INTEGER NOT NULL DEFAULT 1;
