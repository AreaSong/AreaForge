-- Add daily CheckIn snapshots for Package B Batch 1.
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "studyDate" TIMESTAMP(3) NOT NULL,
    "completedMinimumAction" BOOLEAN NOT NULL DEFAULT false,
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "effectiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "effectiveSessionCount" INTEGER NOT NULL DEFAULT 0,
    "taskCompletionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "lowEfficiency" BOOLEAN NOT NULL DEFAULT false,
    "lowConversionCount" INTEGER NOT NULL DEFAULT 0,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckIn_studyDate_key" ON "CheckIn"("studyDate");
