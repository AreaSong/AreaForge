-- v1.8/v1.9 durable notification local candidate.
-- Additive only: no shared-test or production migration/apply is authorized.

CREATE TYPE "UserNotificationKind" AS ENUM (
  'RANKING_INVITATION',
  'RANKING_CHALLENGE_STATUS',
  'RANKING_APPEAL_SUBMITTED',
  'RANKING_APPEAL_STATUS',
  'RANKING_APPEAL_WITHDRAWN',
  'RANKING_OWNERSHIP_TRANSFERRED',
  'RANKING_PARTICIPANT_REMOVED',
  'RANKING_PARTICIPANT_STATUS'
);

CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceLabel" TEXT NOT NULL,
    "kind" "UserNotificationKind" NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserNotification_workspace_label_check" CHECK (length(btrim("workspaceLabel")) BETWEEN 1 AND 120),
    CONSTRAINT "UserNotification_source_type_check" CHECK ("sourceEntityType" ~ '^[A-Z][A-Z0-9_]{0,79}$'),
    CONSTRAINT "UserNotification_source_id_check" CHECK (length(btrim("sourceEntityId")) BETWEEN 1 AND 191),
    CONSTRAINT "UserNotification_event_key_check" CHECK (length(btrim("eventKey")) BETWEEN 1 AND 300),
    CONSTRAINT "UserNotification_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "UserNotification_dismissed_read_check" CHECK ("dismissedAt" IS NULL OR "readAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "UserNotification_recipientUserId_eventKey_key" ON "UserNotification"("recipientUserId", "eventKey");
CREATE INDEX "UserNotification_recipientUserId_dismissedAt_readAt_createdAt_idx" ON "UserNotification"("recipientUserId", "dismissedAt", "readAt", "createdAt");
CREATE INDEX "UserNotification_workspaceId_recipientUserId_createdAt_idx" ON "UserNotification"("workspaceId", "recipientUserId", "createdAt");
CREATE INDEX "UserNotification_kind_createdAt_idx" ON "UserNotification"("kind", "createdAt");

ALTER TABLE "UserNotification"
  ADD CONSTRAINT "UserNotification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserNotification"
  ADD CONSTRAINT "UserNotification_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
