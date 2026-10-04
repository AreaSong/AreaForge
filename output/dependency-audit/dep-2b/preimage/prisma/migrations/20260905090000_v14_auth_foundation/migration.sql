-- v1.4 AUTH foundation: account/session revision, action tokens, memberships,
-- invitations, current workspace selection, and persistent auth throttling.

-- Fail before any schema/data write if the legacy owner preimage cannot produce
-- exactly one current Workspace selection per account. Prisma keeps a failed
-- migration in the ledger, so this guard must precede every additive DDL.
DO $$
BEGIN
    IF EXISTS (
        SELECT account."id"
        FROM "User" AS account
        LEFT JOIN "ExamWorkspace" AS workspace
            ON workspace."userId" = account."id"
            AND workspace."status" = 'ACTIVE'
        GROUP BY account."id"
        HAVING count(workspace."id") <> 1
    ) THEN
        RAISE EXCEPTION 'v1.4 active workspace preimage is ambiguous';
    END IF;
END $$;

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "AuthActionTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "WorkspaceMembershipRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "WorkspaceMembershipStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');
CREATE TYPE "WorkspaceInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');
CREATE TYPE "AuthThrottlePurpose" AS ENUM ('LOGIN', 'INVITATION', 'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'REAUTHENTICATION', 'PASSWORD_CHANGE');

ALTER TABLE "User"
    ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
    ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
    ADD COLUMN "authRevision" INTEGER NOT NULL DEFAULT 1;

UPDATE "User"
SET
    "emailVerifiedAt" = "createdAt",
    "passwordChangedAt" = "createdAt"
WHERE "emailVerifiedAt" IS NULL OR "passwordChangedAt" IS NULL;

ALTER TABLE "User"
    ALTER COLUMN "passwordChangedAt" SET NOT NULL,
    ALTER COLUMN "passwordChangedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "User"
    ADD CONSTRAINT "User_authRevision_check" CHECK ("authRevision" >= 1);

ALTER TABLE "AuthSession"
    ADD COLUMN "authRevision" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "deviceLabel" TEXT,
    ADD COLUMN "ipHash" TEXT,
    ADD COLUMN "userAgentHash" TEXT,
    ADD COLUMN "reauthenticatedAt" TIMESTAMP(3),
    ADD COLUMN "revokedReason" TEXT;

UPDATE "AuthSession" AS session
SET "authRevision" = account."authRevision"
FROM "User" AS account
WHERE account."id" = session."userId";

ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_authRevision_check" CHECK ("authRevision" >= 1);

CREATE TABLE "AuthActionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthActionTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthActionToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceMembershipRole" NOT NULL,
    "status" "WorkspaceMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "invitedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceMembership_revision_check" CHECK ("revision" >= 1)
);

CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "role" "WorkspaceMembershipRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "status" "WorkspaceInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceInvitation_role_check" CHECK ("role" = 'MEMBER'),
    CONSTRAINT "WorkspaceInvitation_revision_check" CHECK ("revision" >= 1)
);

CREATE TABLE "WorkspaceSelection" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSelection_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "WorkspaceSelection_revision_check" CHECK ("revision" >= 1)
);

CREATE TABLE "AuthThrottleBucket" (
    "id" TEXT NOT NULL,
    "purpose" "AuthThrottlePurpose" NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "windowExpiresAt" TIMESTAMP(3) NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthThrottleBucket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthThrottleBucket_failureCount_check" CHECK ("failureCount" >= 0),
    CONSTRAINT "AuthThrottleBucket_window_check" CHECK ("windowExpiresAt" > "windowStartedAt")
);

CREATE UNIQUE INDEX "AuthActionToken_tokenHash_key" ON "AuthActionToken"("tokenHash");
CREATE INDEX "AuthActionToken_userId_purpose_expiresAt_idx" ON "AuthActionToken"("userId", "purpose", "expiresAt");
CREATE INDEX "AuthActionToken_expiresAt_idx" ON "AuthActionToken"("expiresAt");

CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");
CREATE INDEX "WorkspaceMembership_userId_status_idx" ON "WorkspaceMembership"("userId", "status");
CREATE INDEX "WorkspaceMembership_workspaceId_status_role_idx" ON "WorkspaceMembership"("workspaceId", "status", "role");
CREATE INDEX "WorkspaceMembership_invitedByUserId_idx" ON "WorkspaceMembership"("invitedByUserId");

CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");
CREATE UNIQUE INDEX "WorkspaceInvitation_one_pending_per_workspace_email_idx"
    ON "WorkspaceInvitation"("workspaceId", "emailNormalized") WHERE "status" = 'PENDING';
CREATE INDEX "WorkspaceInvitation_workspaceId_emailNormalized_status_idx" ON "WorkspaceInvitation"("workspaceId", "emailNormalized", "status");
CREATE INDEX "WorkspaceInvitation_invitedByUserId_idx" ON "WorkspaceInvitation"("invitedByUserId");
CREATE INDEX "WorkspaceInvitation_acceptedByUserId_idx" ON "WorkspaceInvitation"("acceptedByUserId");
CREATE INDEX "WorkspaceInvitation_expiresAt_status_idx" ON "WorkspaceInvitation"("expiresAt", "status");

CREATE INDEX "WorkspaceSelection_workspaceId_idx" ON "WorkspaceSelection"("workspaceId");

CREATE UNIQUE INDEX "AuthThrottleBucket_purpose_keyHash_key" ON "AuthThrottleBucket"("purpose", "keyHash");
CREATE INDEX "AuthThrottleBucket_lockedUntil_idx" ON "AuthThrottleBucket"("lockedUntil");
CREATE INDEX "AuthThrottleBucket_windowExpiresAt_idx" ON "AuthThrottleBucket"("windowExpiresAt");

ALTER TABLE "AuthActionToken" ADD CONSTRAINT "AuthActionToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_acceptedByUserId_fkey"
    FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSelection" ADD CONSTRAINT "WorkspaceSelection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSelection" ADD CONSTRAINT "WorkspaceSelection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "WorkspaceMembership" (
    "id", "workspaceId", "userId", "role", "status", "revision", "joinedAt", "createdAt", "updatedAt"
)
SELECT
    'v14_owner_' || md5(workspace."id"),
    workspace."id",
    workspace."userId",
    'OWNER',
    'ACTIVE',
    1,
    workspace."createdAt",
    workspace."createdAt",
    workspace."updatedAt"
FROM "ExamWorkspace" AS workspace;

INSERT INTO "WorkspaceSelection" (
    "userId", "workspaceId", "revision", "selectedAt", "createdAt", "updatedAt"
)
SELECT
    workspace."userId",
    workspace."id",
    1,
    workspace."updatedAt",
    workspace."createdAt",
    workspace."updatedAt"
FROM "ExamWorkspace" AS workspace
WHERE workspace."status" = 'ACTIVE';

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
        RAISE EXCEPTION 'v1.4 owner membership backfill mismatch';
    END IF;

    IF EXISTS (
        SELECT account."id"
        FROM "User" AS account
        LEFT JOIN "ExamWorkspace" AS workspace
            ON workspace."userId" = account."id"
            AND workspace."status" = 'ACTIVE'
        GROUP BY account."id"
        HAVING count(workspace."id") <> 1
    ) THEN
        RAISE EXCEPTION 'v1.4 active workspace preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "ExamWorkspace" AS workspace
        LEFT JOIN "WorkspaceSelection" AS selection
            ON selection."userId" = workspace."userId"
            AND selection."workspaceId" = workspace."id"
        WHERE workspace."status" = 'ACTIVE' AND selection."userId" IS NULL
    ) THEN
        RAISE EXCEPTION 'v1.4 workspace selection backfill mismatch';
    END IF;
END $$;
