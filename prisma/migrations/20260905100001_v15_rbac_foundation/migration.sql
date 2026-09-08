-- v1.5 RBAC foundation: stable resource ownership, fixed workspace roles,
-- explicit share grants, and confirm-only Coach suggestions.

-- Every ownership backfill must be uniquely derivable before any DDL runs.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "ExamWorkspace" AS workspace
        LEFT JOIN "WorkspaceMembership" AS membership
          ON membership."workspaceId" = workspace."id"
         AND membership."userId" = workspace."userId"
         AND membership."role" = 'OWNER'
         AND membership."status" = 'ACTIVE'
        WHERE membership."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'v1.5 owner pointer and active OWNER membership disagree';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "Note" AS resource
        LEFT JOIN "Subject" AS subject ON subject."id" = resource."subjectId"
        LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
        WHERE workspace."userId" IS NULL
    ) THEN
        RAISE EXCEPTION 'v1.5 Note owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "Mistake" AS resource
        LEFT JOIN "Subject" AS subject ON subject."id" = resource."subjectId"
        LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
        WHERE workspace."userId" IS NULL
    ) THEN
        RAISE EXCEPTION 'v1.5 Mistake owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "DailyReview" AS resource
        LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = resource."workspaceId"
        WHERE workspace."userId" IS NULL
    ) THEN
        RAISE EXCEPTION 'v1.5 DailyReview owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "StudyResource" AS resource
        LEFT JOIN "User" AS actor ON actor."id" = resource."actorId"
        LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = resource."workspaceId"
        WHERE (resource."actorId" IS NOT NULL AND actor."id" IS NULL)
           OR (resource."actorId" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM "WorkspaceMembership" AS membership
                WHERE membership."workspaceId" = resource."workspaceId"
                  AND membership."userId" = resource."actorId"
              ))
           OR (resource."actorId" IS NULL AND workspace."userId" IS NULL)
    ) THEN
        RAISE EXCEPTION 'v1.5 StudyResource owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PlanInboxItem" AS item
        LEFT JOIN "User" AS actor ON actor."id" = item."actorId"
        LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = item."workspaceId"
        WHERE (item."actorId" IS NOT NULL AND actor."id" IS NULL)
           OR (item."actorId" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM "WorkspaceMembership" AS membership
                WHERE membership."workspaceId" = item."workspaceId"
                  AND membership."userId" = item."actorId"
              ))
           OR (item."actorId" IS NULL AND workspace."userId" IS NULL)
    ) THEN
        RAISE EXCEPTION 'v1.5 PlanInboxItem owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "Attachment" AS attachment
        LEFT JOIN "Note" AS note ON note."id" = attachment."noteId"
        LEFT JOIN "Subject" AS note_subject ON note_subject."id" = note."subjectId"
        LEFT JOIN "ExamWorkspace" AS note_workspace ON note_workspace."id" = note_subject."workspaceId"
        LEFT JOIN "StudyResource" AS study_resource ON study_resource."attachmentId" = attachment."id"
        LEFT JOIN "User" AS resource_actor ON resource_actor."id" = study_resource."actorId"
        LEFT JOIN "ExamWorkspace" AS resource_workspace ON resource_workspace."id" = study_resource."workspaceId"
        WHERE COALESCE(note_workspace."userId", resource_actor."id", resource_workspace."userId") IS NULL
    ) THEN
        RAISE EXCEPTION 'v1.5 Attachment owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "Attachment" AS attachment
        JOIN "Note" AS note ON note."id" = attachment."noteId"
        JOIN "Subject" AS note_subject ON note_subject."id" = note."subjectId"
        JOIN "ExamWorkspace" AS note_workspace ON note_workspace."id" = note_subject."workspaceId"
        JOIN "StudyResource" AS study_resource ON study_resource."attachmentId" = attachment."id"
        WHERE study_resource."workspaceId" <> note_workspace."id"
           OR (study_resource."actorId" IS NOT NULL AND study_resource."actorId" <> note_workspace."userId")
    ) THEN
        RAISE EXCEPTION 'v1.5 Attachment ownership paths disagree';
    END IF;
END $$;

-- PostgreSQL does not allow a freshly-added enum value to be used by a
-- constraint in the same transaction. Replace the enum atomically instead of
-- ALTER TYPE ... ADD VALUE, so the new labels are visible to all following
-- DDL while the Prisma migration remains transactional.
ALTER TABLE "WorkspaceInvitation" DROP CONSTRAINT IF EXISTS "WorkspaceInvitation_role_check";
ALTER TYPE "WorkspaceMembershipRole" RENAME TO "WorkspaceMembershipRole_legacy";
CREATE TYPE "WorkspaceMembershipRole" AS ENUM ('OWNER', 'MEMBER', 'ADMIN', 'COACH', 'VIEWER');
ALTER TABLE "WorkspaceInvitation" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "WorkspaceMembership"
    ALTER COLUMN "role" TYPE "WorkspaceMembershipRole"
    USING "role"::text::"WorkspaceMembershipRole";
ALTER TABLE "WorkspaceInvitation"
    ALTER COLUMN "role" TYPE "WorkspaceMembershipRole"
    USING "role"::text::"WorkspaceMembershipRole";
ALTER TABLE "WorkspaceInvitation" ALTER COLUMN "role" SET DEFAULT 'MEMBER';
ALTER TABLE "WorkspaceInvitation"
    ADD CONSTRAINT "WorkspaceInvitation_role_check" CHECK ("role" IN ('MEMBER', 'ADMIN', 'COACH', 'VIEWER'));
DROP TYPE "WorkspaceMembershipRole_legacy";

CREATE TYPE "WorkspaceShareGrantScope" AS ENUM ('USER', 'ROLE', 'WORKSPACE');
CREATE TYPE "WorkspaceShareGrantAccess" AS ENUM ('VIEW', 'COACH');
CREATE TYPE "WorkspaceShareGrantResource" AS ENUM ('NOTE', 'MISTAKE', 'ATTACHMENT', 'DAILY_REVIEW', 'MOTIVATION', 'AI_DRAFT');
CREATE TYPE "CoachSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED');

ALTER TABLE "Note" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Mistake" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "DailyReview" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "StudyResource" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "PlanInboxItem" ADD COLUMN "ownerUserId" TEXT;

UPDATE "Note" AS resource
SET "ownerUserId" = workspace."userId"
FROM "Subject" AS subject
LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
WHERE subject."id" = resource."subjectId";

UPDATE "Mistake" AS resource
SET "ownerUserId" = workspace."userId"
FROM "Subject" AS subject
LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
WHERE subject."id" = resource."subjectId";

UPDATE "DailyReview" AS resource
SET "ownerUserId" = COALESCE(
    (SELECT workspace."userId" FROM "ExamWorkspace" AS workspace WHERE workspace."id" = resource."workspaceId")
);

UPDATE "StudyResource" AS resource
SET "ownerUserId" = COALESCE(
    (SELECT actor."id" FROM "User" AS actor WHERE actor."id" = resource."actorId"),
    (SELECT workspace."userId" FROM "ExamWorkspace" AS workspace WHERE workspace."id" = resource."workspaceId")
);

UPDATE "PlanInboxItem" AS item
SET "ownerUserId" = COALESCE(
    (SELECT actor."id" FROM "User" AS actor WHERE actor."id" = item."actorId"),
    (SELECT workspace."userId" FROM "ExamWorkspace" AS workspace WHERE workspace."id" = item."workspaceId")
);

UPDATE "Attachment" AS attachment
SET "ownerUserId" = COALESCE(
    (
        SELECT note_workspace."userId"
        FROM "Note" AS note
        JOIN "Subject" AS note_subject ON note_subject."id" = note."subjectId"
        JOIN "ExamWorkspace" AS note_workspace ON note_workspace."id" = note_subject."workspaceId"
        WHERE note."id" = attachment."noteId"
    ),
    (
        SELECT resource_actor."id"
        FROM "StudyResource" AS study_resource
        JOIN "User" AS resource_actor ON resource_actor."id" = study_resource."actorId"
        WHERE study_resource."attachmentId" = attachment."id"
    ),
    (
        SELECT resource_workspace."userId"
        FROM "StudyResource" AS study_resource
        JOIN "ExamWorkspace" AS resource_workspace ON resource_workspace."id" = study_resource."workspaceId"
        WHERE study_resource."attachmentId" = attachment."id"
    )
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Note" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "Mistake" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "DailyReview" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "Attachment" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "StudyResource" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "PlanInboxItem" WHERE "ownerUserId" IS NULL) THEN
        RAISE EXCEPTION 'v1.5 resource owner backfill mismatch';
    END IF;
END $$;

ALTER TABLE "Note" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "Mistake" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "DailyReview" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "Attachment" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "StudyResource" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "PlanInboxItem" ALTER COLUMN "ownerUserId" SET NOT NULL;

-- PlanInbox is private member state. The old workspace-wide uniqueness would
-- make one member's source identity block another member in the same workspace.
DROP INDEX "PlanInboxItem_workspaceId_originKey_originVersion_key";
DROP INDEX "PlanInboxItem_workspaceId_stableKey_key";
CREATE UNIQUE INDEX "PlanInboxItem_workspaceId_ownerUserId_originKey_originVersion_key"
    ON "PlanInboxItem"("workspaceId", "ownerUserId", "originKey", "originVersion");
CREATE UNIQUE INDEX "PlanInboxItem_workspaceId_ownerUserId_stableKey_key"
    ON "PlanInboxItem"("workspaceId", "ownerUserId", "stableKey");

CREATE TABLE "WorkspaceShareGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceOwnerUserId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "scope" "WorkspaceShareGrantScope" NOT NULL,
    "granteeUserId" TEXT,
    "granteeRole" "WorkspaceMembershipRole",
    "resourceType" "WorkspaceShareGrantResource" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "access" "WorkspaceShareGrantAccess" NOT NULL DEFAULT 'VIEW',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceShareGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceShareGrant_resourceId_check" CHECK (length(btrim("resourceId")) BETWEEN 1 AND 191),
    CONSTRAINT "WorkspaceShareGrant_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "WorkspaceShareGrant_scope_target_check" CHECK (
        ("scope" = 'USER' AND "granteeUserId" IS NOT NULL AND "granteeRole" IS NULL)
        OR ("scope" = 'ROLE' AND "granteeUserId" IS NULL AND "granteeRole" = 'COACH')
        OR ("scope" = 'WORKSPACE' AND "granteeUserId" IS NULL AND "granteeRole" IS NULL)
    ),
    CONSTRAINT "WorkspaceShareGrant_coach_scope_check" CHECK ("access" <> 'COACH' OR "scope" IN ('USER', 'ROLE')),
    CONSTRAINT "WorkspaceShareGrant_expiry_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "createdAt")
);

CREATE TABLE "CoachSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "sourceGrantId" TEXT NOT NULL,
    "sourceResourceType" "WorkspaceShareGrantResource" NOT NULL,
    "sourceResourceId" TEXT NOT NULL,
    "sourceSnapshotHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "CoachSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "decidedAt" TIMESTAMP(3),
    "planInboxItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachSuggestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoachSuggestion_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "CoachSuggestion_source_id_check" CHECK (length(btrim("sourceResourceId")) BETWEEN 1 AND 191),
    CONSTRAINT "CoachSuggestion_snapshot_hash_check" CHECK ("sourceSnapshotHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "CoachSuggestion_decision_check" CHECK (
        ("status" = 'PENDING' AND "decidedAt" IS NULL AND "planInboxItemId" IS NULL)
        OR ("status" = 'ACCEPTED' AND "decidedAt" IS NOT NULL AND "planInboxItemId" IS NOT NULL)
        OR ("status" IN ('REJECTED', 'REVOKED') AND "decidedAt" IS NOT NULL AND "planInboxItemId" IS NULL)
    )
);

CREATE INDEX "Note_ownerUserId_archivedAt_idx" ON "Note"("ownerUserId", "archivedAt");
CREATE INDEX "Mistake_ownerUserId_archivedAt_idx" ON "Mistake"("ownerUserId", "archivedAt");
CREATE INDEX "DailyReview_ownerUserId_reviewDate_idx" ON "DailyReview"("ownerUserId", "reviewDate");
CREATE INDEX "Attachment_ownerUserId_status_idx" ON "Attachment"("ownerUserId", "status");
CREATE INDEX "StudyResource_ownerUserId_archivedAt_idx" ON "StudyResource"("ownerUserId", "archivedAt");
CREATE INDEX "PlanInboxItem_ownerUserId_status_idx" ON "PlanInboxItem"("ownerUserId", "status");

CREATE INDEX "WorkspaceShareGrant_workspaceId_resourceType_resourceId_idx" ON "WorkspaceShareGrant"("workspaceId", "resourceType", "resourceId");
CREATE INDEX "WorkspaceShareGrant_resourceOwnerUserId_revokedAt_idx" ON "WorkspaceShareGrant"("resourceOwnerUserId", "revokedAt");
CREATE INDEX "WorkspaceShareGrant_granteeUserId_revokedAt_expiresAt_idx" ON "WorkspaceShareGrant"("granteeUserId", "revokedAt", "expiresAt");
CREATE INDEX "WorkspaceShareGrant_granteeRole_revokedAt_expiresAt_idx" ON "WorkspaceShareGrant"("granteeRole", "revokedAt", "expiresAt");
CREATE INDEX "WorkspaceShareGrant_grantedByUserId_idx" ON "WorkspaceShareGrant"("grantedByUserId");
CREATE INDEX "WorkspaceShareGrant_revokedByUserId_idx" ON "WorkspaceShareGrant"("revokedByUserId");
CREATE UNIQUE INDEX "WorkspaceShareGrant_active_user_uidx"
    ON "WorkspaceShareGrant"("workspaceId", "resourceType", "resourceId", "granteeUserId", "access")
    WHERE "revokedAt" IS NULL AND "scope" = 'USER';
CREATE UNIQUE INDEX "WorkspaceShareGrant_active_role_uidx"
    ON "WorkspaceShareGrant"("workspaceId", "resourceType", "resourceId", "granteeRole", "access")
    WHERE "revokedAt" IS NULL AND "scope" = 'ROLE';
CREATE UNIQUE INDEX "WorkspaceShareGrant_active_workspace_uidx"
    ON "WorkspaceShareGrant"("workspaceId", "resourceType", "resourceId", "access")
    WHERE "revokedAt" IS NULL AND "scope" = 'WORKSPACE';

CREATE UNIQUE INDEX "CoachSuggestion_planInboxItemId_key" ON "CoachSuggestion"("planInboxItemId");
CREATE INDEX "CoachSuggestion_workspaceId_recipientUserId_status_idx" ON "CoachSuggestion"("workspaceId", "recipientUserId", "status");
CREATE INDEX "CoachSuggestion_workspaceId_authorUserId_status_idx" ON "CoachSuggestion"("workspaceId", "authorUserId", "status");
CREATE INDEX "CoachSuggestion_sourceGrantId_idx" ON "CoachSuggestion"("sourceGrantId");
CREATE INDEX "CoachSuggestion_sourceResourceType_sourceResourceId_idx" ON "CoachSuggestion"("sourceResourceType", "sourceResourceId");

ALTER TABLE "Note" ADD CONSTRAINT "Note_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mistake" ADD CONSTRAINT "Mistake_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyReview" ADD CONSTRAINT "DailyReview_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanInboxItem" ADD CONSTRAINT "PlanInboxItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceShareGrant" ADD CONSTRAINT "WorkspaceShareGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceShareGrant" ADD CONSTRAINT "WorkspaceShareGrant_resourceOwnerUserId_fkey" FOREIGN KEY ("resourceOwnerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceShareGrant" ADD CONSTRAINT "WorkspaceShareGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceShareGrant" ADD CONSTRAINT "WorkspaceShareGrant_granteeUserId_fkey" FOREIGN KEY ("granteeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceShareGrant" ADD CONSTRAINT "WorkspaceShareGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CoachSuggestion" ADD CONSTRAINT "CoachSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachSuggestion" ADD CONSTRAINT "CoachSuggestion_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoachSuggestion" ADD CONSTRAINT "CoachSuggestion_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoachSuggestion" ADD CONSTRAINT "CoachSuggestion_sourceGrantId_fkey" FOREIGN KEY ("sourceGrantId") REFERENCES "WorkspaceShareGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoachSuggestion" ADD CONSTRAINT "CoachSuggestion_planInboxItemId_fkey" FOREIGN KEY ("planInboxItemId") REFERENCES "PlanInboxItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
