-- v1.1 Migration 7: KnowledgeCanvas layout, Motivation/Notification schema, AiDraftOperation

CREATE TYPE "MotivationItemType" AS ENUM ('QUOTE', 'VIDEO_LINK', 'VAULT_EXCERPT');
CREATE TYPE "AiDraftOperationStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'EXPIRED');
CREATE TYPE "KnowledgeCanvasEntityType" AS ENUM (
  'WORKSPACE',
  'SUBJECT_GROUP',
  'SUBJECT',
  'SYLLABUS_NODE',
  'NOTE',
  'MISTAKE',
  'STUDY_RESOURCE',
  'TASK',
  'MILESTONE',
  'STUDY_SESSION',
  'REVIEW_SCHEDULE'
);

CREATE TABLE "KnowledgeCanvasLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "viewportX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewportY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewportZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCanvasLayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeCanvasNodeLayout" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "entityType" "KnowledgeCanvasEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCanvasNodeLayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MotivationItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MotivationItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "externalUrl" TEXT,
    "vaultSourceId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "actorId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivationItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MotivationItem_type_payload_check" CHECK (
      (
        ("type" = 'QUOTE' AND "body" IS NOT NULL AND "externalUrl" IS NULL AND "vaultSourceId" IS NULL)
        OR ("type" = 'VIDEO_LINK' AND "externalUrl" IS NOT NULL AND "vaultSourceId" IS NULL)
        OR ("type" = 'VAULT_EXCERPT' AND "body" IS NOT NULL AND "vaultSourceId" IS NOT NULL AND "externalUrl" IS NULL)
      )
    )
);

CREATE TABLE "MotivationReminderState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastAutoShowAt" TIMESTAMP(3),
    "learningDay" TIMESTAMP(3),
    "dailyCount" INTEGER NOT NULL DEFAULT 0,
    "recentItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotivationReminderState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewDueEnabled" BOOLEAN NOT NULL DEFAULT true,
    "planStartEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eveningReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reviewDueWindowStart" INTEGER NOT NULL DEFAULT 8,
    "reviewDueWindowEnd" INTEGER NOT NULL DEFAULT 22,
    "planStartWindowStart" INTEGER NOT NULL DEFAULT 7,
    "planStartWindowEnd" INTEGER NOT NULL DEFAULT 21,
    "eveningReviewWindowStart" INTEGER NOT NULL DEFAULT 20,
    "eveningReviewWindowEnd" INTEGER NOT NULL DEFAULT 23,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiDraftOperation" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "status" "AiDraftOperationStatus" NOT NULL DEFAULT 'PENDING',
    "resultReference" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDraftOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeCanvasLayout_userId_workspaceId_key" ON "KnowledgeCanvasLayout"("userId", "workspaceId");
CREATE INDEX "KnowledgeCanvasLayout_workspaceId_idx" ON "KnowledgeCanvasLayout"("workspaceId");

CREATE UNIQUE INDEX "KnowledgeCanvasNodeLayout_layoutId_entityType_entityId_key" ON "KnowledgeCanvasNodeLayout"("layoutId", "entityType", "entityId");
CREATE INDEX "KnowledgeCanvasNodeLayout_entityType_entityId_idx" ON "KnowledgeCanvasNodeLayout"("entityType", "entityId");

CREATE INDEX "MotivationItem_userId_enabled_sortOrder_idx" ON "MotivationItem"("userId", "enabled", "sortOrder");
CREATE INDEX "MotivationItem_archivedAt_idx" ON "MotivationItem"("archivedAt");

CREATE UNIQUE INDEX "MotivationReminderState_userId_key" ON "MotivationReminderState"("userId");

CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

CREATE UNIQUE INDEX "AiDraftOperation_workspaceId_operationId_key" ON "AiDraftOperation"("workspaceId", "operationId");
CREATE UNIQUE INDEX "AiDraftOperation_workspaceId_endpoint_nonce_key" ON "AiDraftOperation"("workspaceId", "endpoint", "nonce");
CREATE INDEX "AiDraftOperation_actorId_idx" ON "AiDraftOperation"("actorId");
CREATE INDEX "AiDraftOperation_status_expiresAt_idx" ON "AiDraftOperation"("status", "expiresAt");

ALTER TABLE "KnowledgeCanvasLayout" ADD CONSTRAINT "KnowledgeCanvasLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeCanvasLayout" ADD CONSTRAINT "KnowledgeCanvasLayout_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeCanvasNodeLayout" ADD CONSTRAINT "KnowledgeCanvasNodeLayout_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "KnowledgeCanvasLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MotivationItem" ADD CONSTRAINT "MotivationItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MotivationReminderState" ADD CONSTRAINT "MotivationReminderState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiDraftOperation" ADD CONSTRAINT "AiDraftOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDraftOperation" ADD CONSTRAINT "AiDraftOperation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
