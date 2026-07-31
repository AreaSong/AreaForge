-- v1.1 Migration 6: ReviewSchedule/Event, CheckIn v2, Recovery v2, bridge, archive

-- CheckIn v2 additive fields
ALTER TABLE "CheckIn" ADD COLUMN "reviewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CheckIn" ADD COLUMN "reviewSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CheckIn" ADD COLUMN "passedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CheckIn" ADD COLUMN "partialCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CheckIn" ADD COLUMN "failedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CheckIn" ADD COLUMN "minimumActionSource" TEXT NOT NULL DEFAULT 'NONE';

-- Note / Mistake archive
ALTER TABLE "Note" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Mistake" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Note_archivedAt_idx" ON "Note"("archivedAt");
CREATE INDEX "Mistake_archivedAt_idx" ON "Mistake"("archivedAt");

-- StudyTask bridge
ALTER TABLE "StudyTask" ADD COLUMN "reviewScheduleId" TEXT;
CREATE INDEX "StudyTask_reviewScheduleId_idx" ON "StudyTask"("reviewScheduleId");

-- RecoveryState v2
ALTER TABLE "RecoveryState" ADD COLUMN "userId" TEXT;
ALTER TABLE "RecoveryState" ADD COLUMN "currentStage" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RecoveryState" ADD COLUMN "windowStartDate" TIMESTAMP(3);
ALTER TABLE "RecoveryState" ADD COLUMN "windowEndDate" TIMESTAMP(3);
ALTER TABLE "RecoveryState" ADD COLUMN "lastProgressDate" TIMESTAMP(3);
ALTER TABLE "RecoveryState" ADD COLUMN "progressionVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RecoveryState" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "RecoveryState_userId_idx" ON "RecoveryState"("userId");
ALTER TABLE "RecoveryState" ADD CONSTRAINT "RecoveryState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one active recovery per (userId, workspaceId)
CREATE UNIQUE INDEX "RecoveryState_user_workspace_active_uidx"
  ON "RecoveryState"("userId", "workspaceId")
  WHERE "status" = 'ACTIVE' AND "userId" IS NOT NULL AND "workspaceId" IS NOT NULL;

-- ReviewSchedule
CREATE TABLE "ReviewSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "noteId" TEXT,
    "mistakeId" TEXT,
    "studyResourceId" TEXT,
    "syllabusNodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dueDate" TIMESTAMP(3),
    "pausedReason" TEXT,
    "consecutivePassCount" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReviewSchedule_target_exactly_one_check" CHECK (
      (
        ("targetType" = 'NOTE' AND "noteId" IS NOT NULL AND "mistakeId" IS NULL AND "studyResourceId" IS NULL AND "syllabusNodeId" IS NULL)
        OR ("targetType" = 'MISTAKE' AND "mistakeId" IS NOT NULL AND "noteId" IS NULL AND "studyResourceId" IS NULL AND "syllabusNodeId" IS NULL)
        OR ("targetType" = 'STUDY_RESOURCE' AND "studyResourceId" IS NOT NULL AND "noteId" IS NULL AND "mistakeId" IS NULL AND "syllabusNodeId" IS NULL)
        OR ("targetType" = 'SYLLABUS_NODE' AND "syllabusNodeId" IS NOT NULL AND "noteId" IS NULL AND "mistakeId" IS NULL AND "studyResourceId" IS NULL)
      )
    ),
    CONSTRAINT "ReviewSchedule_status_due_check" CHECK (
      ("status" = 'ACTIVE' AND "dueDate" IS NOT NULL)
      OR ("status" = 'PAUSED' AND "dueDate" IS NULL)
    )
);

CREATE UNIQUE INDEX "ReviewSchedule_noteId_uidx" ON "ReviewSchedule"("noteId") WHERE "noteId" IS NOT NULL;
CREATE UNIQUE INDEX "ReviewSchedule_mistakeId_uidx" ON "ReviewSchedule"("mistakeId") WHERE "mistakeId" IS NOT NULL;
CREATE UNIQUE INDEX "ReviewSchedule_studyResourceId_uidx" ON "ReviewSchedule"("studyResourceId") WHERE "studyResourceId" IS NOT NULL;
CREATE UNIQUE INDEX "ReviewSchedule_syllabusNodeId_uidx" ON "ReviewSchedule"("syllabusNodeId") WHERE "syllabusNodeId" IS NOT NULL;
CREATE INDEX "ReviewSchedule_workspaceId_status_dueDate_idx" ON "ReviewSchedule"("workspaceId", "status", "dueDate");
CREATE INDEX "ReviewSchedule_actorId_idx" ON "ReviewSchedule"("actorId");

ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "Mistake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_studyResourceId_fkey" FOREIGN KEY ("studyResourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bridge: at most one open task per schedule
CREATE UNIQUE INDEX "StudyTask_reviewSchedule_active_bridge_uidx"
  ON "StudyTask"("reviewScheduleId")
  WHERE "reviewScheduleId" IS NOT NULL AND "status" IN ('TODO', 'IN_PROGRESS', 'DEFERRED');

ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_reviewScheduleId_fkey" FOREIGN KEY ("reviewScheduleId") REFERENCES "ReviewSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ReviewEvent
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "reviewScheduleId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "appliedRevision" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "learningDate" TIMESTAMP(3) NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "consecutivePassDelta" INTEGER NOT NULL DEFAULT 0,
    "correctedEventId" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReviewEvent_result_check" CHECK ("result" IN ('PASSED', 'PARTIAL', 'FAILED')),
    CONSTRAINT "ReviewEvent_duration_check" CHECK ("durationSeconds" >= 1 AND "durationSeconds" <= 14400)
);

CREATE UNIQUE INDEX "ReviewEvent_reviewScheduleId_idempotencyKey_key" ON "ReviewEvent"("reviewScheduleId", "idempotencyKey");
CREATE INDEX "ReviewEvent_reviewScheduleId_confirmedAt_idx" ON "ReviewEvent"("reviewScheduleId", "confirmedAt");
CREATE INDEX "ReviewEvent_learningDate_idx" ON "ReviewEvent"("learningDate");
CREATE INDEX "ReviewEvent_correctedEventId_idx" ON "ReviewEvent"("correctedEventId");
CREATE INDEX "ReviewEvent_actorId_idx" ON "ReviewEvent"("actorId");

ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_reviewScheduleId_fkey" FOREIGN KEY ("reviewScheduleId") REFERENCES "ReviewSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_correctedEventId_fkey" FOREIGN KEY ("correctedEventId") REFERENCES "ReviewEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one direct correction successor per original event
CREATE UNIQUE INDEX "ReviewEvent_correctedEventId_uidx" ON "ReviewEvent"("correctedEventId") WHERE "correctedEventId" IS NOT NULL;

-- MasteryRetest link to ReviewEvent
ALTER TABLE "MasteryRetest" ADD COLUMN "reviewEventId" TEXT;
CREATE UNIQUE INDEX "MasteryRetest_reviewEventId_key" ON "MasteryRetest"("reviewEventId");
ALTER TABLE "MasteryRetest" ADD CONSTRAINT "MasteryRetest_reviewEventId_fkey" FOREIGN KEY ("reviewEventId") REFERENCES "ReviewEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
