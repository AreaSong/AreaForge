import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { getWorkspaceCapabilities, updateWorkspaceMemberRole } from "../../apps/web/lib/workspace/rbac-service";
import {
  createWorkspaceShareGrant,
  revokeWorkspaceShareGrant,
  updateWorkspaceShareGrant,
} from "../../apps/web/lib/workspace/share-grant-service";
import { getSharedResourceDetail } from "../../apps/web/lib/workspace/shared-resource-service";
import { requireSharedResourceAccess, requireWorkspacePolicy } from "../../apps/web/lib/workspace/policy-service";
import {
  createCoachSuggestion,
  decideCoachSuggestion,
} from "../../apps/web/lib/coach/coach-suggestion-service";
import {
  listOperatorAccounts,
  revokeOperatorTargetSessions,
  updateOperatorAccountStatus,
} from "../../apps/web/lib/system/account-management-service";
import {
  resetRbacRuntimeFixture,
  seedRbacRuntimeFixture,
  type RbacRuntimeFixture,
} from "./v15-rbac-runtime-fixture";

const root = process.cwd();
const migrationPath = path.join(root, "prisma/migrations/20260905100001_v15_rbac_foundation/migration.sql");
const checks: RuntimeCheck[] = [];

interface RuntimeCheck {
  id: string;
  status: "pass";
  details: Record<string, string | number | boolean>;
}

const migrationSql = readFileSync(migrationPath, "utf8").trim();

try {
  configureSyntheticEnvironment();
  await assertIsolatedDatabase();
  await verifyMigrationContract();
  await resetRbacRuntimeFixture();
  const fixture = await seedRbacRuntimeFixture();
  await verifyRoleMatrixAndWorkspaceIsolation(fixture);
  await verifyShareGrantLifecycle(fixture);
  await verifyCoachSuggestionLineageAndCas(fixture);
  await verifyFailureMatrix(fixture);
  await verifyRoleAndMemberStateInvalidation(fixture);
  await verifyOperatorRedactionAndAudit(fixture);

  console.log(JSON.stringify({
    schemaVersion: "v15-rbac-runtime-selftest-v1",
    status: "pass",
    checks,
    doesNotProve: [
      "production migration or production data safety",
      "production account operations",
      "browser experience",
      "signed Release readiness",
    ],
    safetyFacts: {
      isolatedDatabaseRequired: true,
      isolatedDatabaseWriteAttempted: true,
      productionWriteAttempted: false,
      physicalDeleteAttempted: false,
      serverCommandAttempted: false,
      secretsOperationAttempted: false,
    },
  }, null, 2));
  console.log("PASS v1.5 RBAC isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}

function configureSyntheticEnvironment(): void {
  process.env.AUTH_MULTI_USER_ENABLED = "true";
  process.env.AUTH_RBAC_ENABLED = "true";
  process.env.AUTH_SESSION_SECRET = process.env.AUTH_SESSION_SECRET ?? "v15-rbac-isolated-session-secret-20260905";
  process.env.AUTH_ACTION_TOKEN_SECRET = process.env.AUTH_ACTION_TOKEN_SECRET ?? "v15-rbac-isolated-action-secret-20260905";
  process.env.AUTH_REAUTH_MAX_AGE_SECONDS = process.env.AUTH_REAUTH_MAX_AGE_SECONDS ?? "600";
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V15_RBAC_ISOLATED_DB !== "1") {
    throw new Error("v1.5 RBAC runtime selftest requires AREAFORGE_V15_RBAC_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const database = rows[0]?.current_database ?? "";
  const expected = process.env.AREAFORGE_V15_RBAC_EXPECTED_DATABASE ?? "";
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!database.includes("v15rbac")) throw new Error("runtime selftest refused a database without the v15rbac marker");
  if (expected && (database !== expected || databaseUrl.pathname.slice(1) !== expected)) {
    throw new Error("runtime selftest database identity does not match the expected isolated database");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) {
    throw new Error("v1.5 RBAC runtime selftest requires a loopback database host");
  }
  checks.push({ id: "isolated_database_guard", status: "pass", details: { database, loopbackOnly: true } });
}

async function verifyMigrationContract(): Promise<void> {
  const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; is_nullable: string }>>`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name IN ('Note', 'Mistake', 'DailyReview', 'Attachment', 'StudyResource', 'PlanInboxItem')
        AND column_name = 'ownerUserId')
        OR table_name IN ('WorkspaceShareGrant', 'CoachSuggestion'))
    ORDER BY table_name, column_name
  `;
  const ownerColumns = columns.filter((column) => column.column_name === "ownerUserId");
  assert.deepEqual(ownerColumns.map((column) => column.table_name).sort(), [
    "Attachment",
    "DailyReview",
    "Mistake",
    "Note",
    "PlanInboxItem",
    "StudyResource",
  ]);
  assert.equal(ownerColumns.every((column) => column.is_nullable === "NO"), true);
  assert.equal(columns.some((column) => column.table_name === "WorkspaceShareGrant"), true);
  assert.equal(columns.some((column) => column.table_name === "CoachSuggestion"), true);

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'PlanInboxItem_workspaceId_ownerUserId_originKey_originVersion_key',
        'PlanInboxItem_workspaceId_ownerUserId_stableKey_key',
        'WorkspaceShareGrant_active_user_uidx',
        'WorkspaceShareGrant_active_role_uidx',
        'WorkspaceShareGrant_active_workspace_uidx'
      )
    ORDER BY indexname
  `;
  assert.equal(indexes.length, 5);

  const repeated = await Promise.allSettled([
    prisma.$transaction(async (tx) => tx.$executeRawUnsafe(migrationSql)),
  ]);
  assert.equal(repeated[0]?.status, "rejected", "repeated v1.5 migration apply must fail closed");

  await verifyMigrationSandboxApply();
  await verifyOwnerBackfillFailClosed();
  checks.push({
    id: "migration.deploy_repeat_and_owner_backfill_fail_closed",
    status: "pass",
    details: { publicSchemaApplied: true, repeatRejected: true, sandboxApplyPassed: true, dirtyOwnerPreimageRejected: true },
  });
}

async function verifyMigrationSandboxApply(): Promise<void> {
  const schema = "v15_rbac_valid_migration_fixture";
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await createMigrationPreimage(tx, { dirtyOwner: false });
    await tx.$executeRawUnsafe(migrationSql);
  });
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; is_nullable: string }>>(`
    SELECT table_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = '${schema}' AND column_name = 'ownerUserId'
    ORDER BY table_name
  `);
  assert.deepEqual(rows.map((row) => row.table_name), ["Attachment", "DailyReview", "Mistake", "Note", "PlanInboxItem", "StudyResource"]);
  assert.equal(rows.every((row) => row.is_nullable === "NO"), true);
  await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
}

async function verifyOwnerBackfillFailClosed(): Promise<void> {
  const schema = "v15_rbac_dirty_owner_fixture";
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  const result = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await createMigrationPreimage(tx, { dirtyOwner: true });
      await tx.$executeRawUnsafe(migrationSql);
    }),
  ]);
  assert.equal(result[0]?.status, "rejected", "ambiguous owner backfill must reject before DDL");
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

async function createMigrationPreimage(
  tx: { $executeRawUnsafe: (query: string) => Promise<unknown> },
  options: { dirtyOwner: boolean },
): Promise<void> {
  await tx.$executeRawUnsafe(`
    CREATE TYPE "WorkspaceMembershipRole" AS ENUM ('OWNER', 'MEMBER');
    CREATE TABLE "User" ("id" text PRIMARY KEY, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "ExamWorkspace" ("id" text PRIMARY KEY, "userId" text NOT NULL);
    CREATE TABLE "WorkspaceMembership" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "userId" text NOT NULL, "role" "WorkspaceMembershipRole" NOT NULL, "status" text NOT NULL);
    CREATE TABLE "WorkspaceInvitation" (
      "id" text PRIMARY KEY,
      "role" "WorkspaceMembershipRole" NOT NULL DEFAULT 'MEMBER',
      CONSTRAINT "WorkspaceInvitation_role_check" CHECK ("role" = 'MEMBER')
    );
    CREATE TABLE "Subject" ("id" text PRIMARY KEY, "workspaceId" text);
    CREATE TABLE "Note" ("id" text PRIMARY KEY, "subjectId" text NOT NULL, "archivedAt" timestamp(3), "title" text NOT NULL, "content" text NOT NULL);
    CREATE TABLE "Mistake" ("id" text PRIMARY KEY, "subjectId" text NOT NULL, "archivedAt" timestamp(3), "title" text NOT NULL);
    CREATE TABLE "DailyReview" ("id" text PRIMARY KEY, "workspaceId" text, "reviewDate" timestamp(3) NOT NULL);
    CREATE TABLE "StudyResource" ("id" text PRIMARY KEY, "actorId" text, "workspaceId" text, "attachmentId" text, "archivedAt" timestamp(3), "stableKey" text NOT NULL, "title" text NOT NULL, "sourceType" text NOT NULL);
    CREATE TABLE "PlanInboxItem" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "actorId" text, "originKey" text NOT NULL, "originVersion" integer NOT NULL, "stableKey" text NOT NULL, "status" text NOT NULL, "title" text NOT NULL);
    CREATE TABLE "Attachment" ("id" text PRIMARY KEY, "noteId" text, "status" text NOT NULL, "storedName" text NOT NULL, "uri" text NOT NULL, "hash" text NOT NULL, "sizeBytes" integer NOT NULL);
    CREATE UNIQUE INDEX "PlanInboxItem_workspaceId_originKey_originVersion_key" ON "PlanInboxItem" ("workspaceId", "originKey", "originVersion");
    CREATE UNIQUE INDEX "PlanInboxItem_workspaceId_stableKey_key" ON "PlanInboxItem" ("workspaceId", "stableKey");
  `);
  await tx.$executeRawUnsafe(`
    INSERT INTO "User" ("id") VALUES ('owner');
    ${options.dirtyOwner ? "INSERT INTO \"User\" (\"id\") VALUES ('second-owner');" : ""}
    INSERT INTO "ExamWorkspace" ("id", "userId") VALUES ('workspace', 'owner');
    INSERT INTO "WorkspaceMembership" ("id", "workspaceId", "userId", "role", "status") VALUES ('membership', 'workspace', 'owner', 'OWNER', 'ACTIVE');
    INSERT INTO "Subject" ("id", "workspaceId") VALUES ('subject', ${options.dirtyOwner ? "NULL" : "'workspace'"});
    INSERT INTO "Note" ("id", "subjectId", "title", "content") VALUES ('note', 'subject', 'fixture', 'fixture');
    INSERT INTO "Mistake" ("id", "subjectId", "title") VALUES ('mistake', 'subject', 'fixture');
    INSERT INTO "DailyReview" ("id", "workspaceId", "reviewDate") VALUES ('review', 'workspace', CURRENT_TIMESTAMP);
    INSERT INTO "StudyResource" ("id", "actorId", "workspaceId", "stableKey", "title", "sourceType") VALUES ('resource', 'owner', 'workspace', 'resource', 'fixture', 'LINK');
    INSERT INTO "PlanInboxItem" ("id", "workspaceId", "actorId", "originKey", "originVersion", "stableKey", "status", "title") VALUES ('inbox', 'workspace', 'owner', 'origin', 1, 'stable', 'OPEN', 'fixture');
    INSERT INTO "Attachment" ("id", "noteId", "status", "storedName", "uri", "hash", "sizeBytes") VALUES ('attachment', 'note', 'READY', 'stored', 'uri', 'hash', 1);
  `);
}

async function verifyRoleMatrixAndWorkspaceIsolation(fixture: RbacRuntimeFixture): Promise<void> {
  const expected: Array<[keyof RbacRuntimeFixture["users"], string]> = [
    ["owner", "OWNER"],
    ["admin", "ADMIN"],
    ["coach", "COACH"],
    ["member", "MEMBER"],
    ["viewer", "VIEWER"],
  ];
  for (const [key, role] of expected) {
    const capabilities = await getWorkspaceCapabilities(fixture.users[key].userId, fixture.workspaceIds.primary);
    assert.equal(capabilities.role, role);
    assert.equal(capabilities.workspaceId, fixture.workspaceIds.primary);
  }
  const ownerCapabilities = await getWorkspaceCapabilities(fixture.users.owner.userId, fixture.workspaceIds.primary);
  assert.equal(ownerCapabilities.capabilities.includes("member:role"), true);
  const memberCapabilities = await getWorkspaceCapabilities(fixture.users.member.userId, fixture.workspaceIds.primary);
  assert.equal(memberCapabilities.capabilities.includes("member:role"), false);
  await expectApiError(
    () => getWorkspaceCapabilities(fixture.users.coach.userId, fixture.workspaceIds.secondary),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  await expectApiError(
    () => getSharedResourceDetail(fixture.users.coach.userId, "NOTE", fixture.notes.secondary),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  checks.push({ id: "dual_workspace_five_role_matrix_and_cross_tenant_isolation", status: "pass", details: { workspaces: 2, roles: 5 } });
}

async function verifyShareGrantLifecycle(fixture: RbacRuntimeFixture): Promise<void> {
  const expiresAt = new Date(Date.now() + 90_000);
  const userGrant = await createWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, {
    resourceType: "NOTE",
    resourceId: fixture.notes.userGrant,
    scope: "USER",
    granteeUserId: fixture.users.member.userId,
    access: "VIEW",
    expiresAt,
  });
  const memberDetail = await getSharedResourceDetail(fixture.users.member.userId, "NOTE", fixture.notes.userGrant);
  assert.equal(memberDetail.resourceType, "NOTE");
  await expectApiError(
    () => requireSharedResourceAccess(prisma, {
      actorId: fixture.users.member.userId,
      workspaceId: fixture.workspaceIds.primary,
      resourceType: "NOTE",
      resourceId: fixture.notes.userGrant,
      now: new Date(expiresAt.getTime() + 1_000),
    }),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  const updated = await updateWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, userGrant.id, {
    expectedRevision: userGrant.revision,
    expiresAt: new Date(Date.now() + 120_000),
  });
  await expectApiError(
    () => updateWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, userGrant.id, {
      expectedRevision: userGrant.revision,
      access: "COACH",
    }),
    "WORKSPACE_SHARE_GRANT_CONFLICT",
  );
  const revoked = await revokeWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, userGrant.id, updated.revision);
  assert.ok(revoked.revokedAt);
  await expectApiError(
    () => getSharedResourceDetail(fixture.users.member.userId, "NOTE", fixture.notes.userGrant),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );

  const workspaceGrant = await createWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, {
    resourceType: "NOTE",
    resourceId: fixture.notes.workspaceGrant,
    scope: "WORKSPACE",
    access: "VIEW",
  });
  assert.equal((await getSharedResourceDetail(fixture.users.viewer.userId, "NOTE", fixture.notes.workspaceGrant)).resourceType, "NOTE");
  await revokeWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, workspaceGrant.id, workspaceGrant.revision);
  await expectApiError(
    () => getSharedResourceDetail(fixture.users.viewer.userId, "NOTE", fixture.notes.workspaceGrant),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  checks.push({ id: "grant_user_workspace_scope_expiry_cas_and_revoke", status: "pass", details: { scopes: 2, expiryChecked: true, revokeImmediate: true } });
}

async function verifyCoachSuggestionLineageAndCas(fixture: RbacRuntimeFixture): Promise<void> {
  const coachGrant = await createWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, {
    resourceType: "NOTE",
    resourceId: fixture.notes.roleGrant,
    scope: "ROLE",
    granteeRole: "COACH",
    access: "COACH",
  });
  const suggestion = await createCoachSuggestion(fixture.users.coach.actor, {
    workspaceId: fixture.workspaceIds.primary,
    resourceType: "NOTE",
    resourceId: fixture.notes.roleGrant,
    payload: {
      title: "Coach 建议草稿",
      plannedDate: null,
      estimatedMinutes: 25,
      priority: "HIGH",
      type: "study",
      subjectId: fixture.subjects.primary,
      primaryNodeId: null,
    },
  });
  assert.equal(suggestion.sourceGrantId, coachGrant.id);
  const accepted = await decideCoachSuggestion(fixture.users.owner.userId, suggestion.id, "accept", suggestion.revision);
  assert.equal(accepted.status, "ACCEPTED");
  assert.ok(accepted.planInboxItemId);
  const item = await prisma.planInboxItem.findUniqueOrThrow({ where: { id: accepted.planInboxItemId! } });
  assert.equal(item.ownerUserId, fixture.users.owner.userId);
  assert.equal(item.originType, "COACH_SUGGESTION");
  const origin = item.originSnapshot as Record<string, unknown>;
  assert.equal(origin.coachSuggestionId, suggestion.id);
  assert.equal(origin.sourceGrantId, coachGrant.id);
  await expectApiError(
    () => decideCoachSuggestion(fixture.users.owner.userId, suggestion.id, "accept", suggestion.revision),
    "COACH_SUGGESTION_CONFLICT",
  );
  checks.push({ id: "coach_confirm_only_plan_inbox_lineage_and_cas", status: "pass", details: { accepted: true, planInboxLinked: true, staleRevisionRejected: true } });
}

async function verifyFailureMatrix(fixture: RbacRuntimeFixture): Promise<void> {
  await expectApiError(
    () => getWorkspaceCapabilities(fixture.users.operator.userId, fixture.workspaceIds.primary),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  await expectApiError(
    () => updateWorkspaceMemberRole(
      fixture.users.admin.actor,
      fixture.workspaceIds.primary,
      fixture.memberships.member,
      "VIEWER",
      1,
    ),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  await expectApiError(
    () => updateWorkspaceMemberRole(
      fixture.users.member.actor,
      fixture.workspaceIds.primary,
      fixture.memberships.viewer,
      "MEMBER",
      1,
    ),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  await expectApiError(
    () => createWorkspaceShareGrant(fixture.users.viewer.userId, fixture.workspaceIds.primary, {
      resourceType: "NOTE",
      resourceId: fixture.notes.userGrant,
      scope: "USER",
      granteeUserId: fixture.users.member.userId,
      access: "VIEW",
    }),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  await expectApiError(
    () => createWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, {
      resourceType: "NOTE",
      resourceId: fixture.notes.userGrant,
      scope: "USER",
      granteeUserId: fixture.users.owner.userId,
      access: "VIEW",
    }),
    "WORKSPACE_SHARE_GRANT_TARGET_INVALID",
  );
  await expectApiError(
    () => createWorkspaceShareGrant(fixture.users.owner.userId, fixture.workspaceIds.primary, {
      resourceType: "NOTE",
      resourceId: fixture.notes.userGrant,
      scope: "WORKSPACE",
      access: "COACH",
    }),
    "WORKSPACE_SHARE_GRANT_COACH_SCOPE_INVALID",
  );
  await expectApiError(
    () => updateWorkspaceMemberRole(
      fixture.users.owner.actor,
      fixture.workspaceIds.primary,
      fixture.memberships.member,
      "VIEWER",
      999,
    ),
    "WORKSPACE_MEMBERSHIP_CONFLICT",
  );
  await expectApiError(
    () => updateOperatorAccountStatus(fixture.users.owner.actor, fixture.users.viewer.userId, {
      status: "SUSPENDED",
      expectedAuthRevision: 0,
      reason: "SECURITY_REVIEW",
    }),
    "PLATFORM_ACCOUNT_NOT_FOUND",
  );
  const previousMultiUser = process.env.AUTH_MULTI_USER_ENABLED;
  const previousRbac = process.env.AUTH_RBAC_ENABLED;
  process.env.AUTH_MULTI_USER_ENABLED = "false";
  process.env.AUTH_RBAC_ENABLED = "false";
  try {
    await expectApiError(
      () => getWorkspaceCapabilities(fixture.users.owner.userId, fixture.workspaceIds.primary),
      "RBAC_DISABLED",
    );
  } finally {
    process.env.AUTH_MULTI_USER_ENABLED = previousMultiUser;
    process.env.AUTH_RBAC_ENABLED = previousRbac;
  }
  checks.push({
    id: "authorization_failure_matrix_and_feature_gate",
    status: "pass",
    details: {
      outsiderDenied: true,
      nonOwnerRoleDenied: true,
      selfGrantDenied: true,
      invalidCoachScopeDenied: true,
      staleRevisionDenied: true,
      operatorBoundaryDenied: true,
      disabledGateDenied: true,
    },
  });
}

async function verifyRoleAndMemberStateInvalidation(fixture: RbacRuntimeFixture): Promise<void> {
  const coachMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: fixture.memberships.coach } });
  const changed = await updateWorkspaceMemberRole(
    fixture.users.owner.actor,
    fixture.workspaceIds.primary,
    coachMembership.id,
    "MEMBER",
    coachMembership.revision,
  );
  assert.equal(changed.role, "MEMBER");
  await expectApiError(
    () => requireWorkspacePolicy(prisma, fixture.users.coach.userId, fixture.workspaceIds.primary, "coach:suggest"),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );

  const viewerMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: fixture.memberships.viewer } });
  await prisma.workspaceMembership.update({ where: { id: viewerMembership.id }, data: { status: "REMOVED", removedAt: new Date() } });
  await expectApiError(
    () => getWorkspaceCapabilities(fixture.users.viewer.userId, fixture.workspaceIds.primary),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  await prisma.workspaceMembership.update({ where: { id: viewerMembership.id }, data: { status: "ACTIVE", removedAt: null } });

  await prisma.user.update({ where: { id: fixture.users.member.userId }, data: { status: "SUSPENDED" } });
  await expectApiError(
    () => getWorkspaceCapabilities(fixture.users.member.userId, fixture.workspaceIds.primary),
    "WORKSPACE_RESOURCE_NOT_FOUND",
  );
  await prisma.user.update({ where: { id: fixture.users.member.userId }, data: { status: "ACTIVE" } });
  checks.push({ id: "role_member_and_account_status_immediate_invalidation", status: "pass", details: { roleChange: true, membershipRemoval: true, accountSuspension: true } });
}

async function verifyOperatorRedactionAndAudit(fixture: RbacRuntimeFixture): Promise<void> {
  process.env.AUTH_ADMIN_EMAIL = fixture.users.operator.email;
  const listed = await listOperatorAccounts(fixture.users.operator.actor);
  assert.equal(listed.length, 6);
  const serialized = JSON.stringify(listed);
  assert.doesNotMatch(serialized, new RegExp(fixture.users.owner.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serialized, /passwordHash|content|storedName|uri/);
  assert.equal(listed.every((account) => account.maskedEmail.includes("*") && !account.maskedEmail.includes(fixture.privateMarker)), true);

  const target = await prisma.user.findUniqueOrThrow({ where: { id: fixture.users.viewer.userId }, select: { authRevision: true } });
  const changed = await updateOperatorAccountStatus(fixture.users.operator.actor, fixture.users.viewer.userId, {
    status: "SUSPENDED",
    expectedAuthRevision: target.authRevision,
    reason: "SECURITY_REVIEW",
  });
  assert.equal(changed.status, "SUSPENDED");
  const audit = await prisma.auditEvent.findFirstOrThrow({
    where: { action: "PLATFORM_ACCOUNT_STATUS_CHANGED", entityId: fixture.users.viewer.userId },
    orderBy: { createdAt: "desc" },
  });
  const metadata = (audit.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.reason, "SECURITY_REVIEW");
  assert.doesNotMatch(JSON.stringify(metadata), new RegExp(fixture.privateMarker));
  await prisma.user.update({ where: { id: fixture.users.viewer.userId }, data: { status: "ACTIVE" } });
  const revoked = await revokeOperatorTargetSessions(fixture.users.operator.actor, fixture.users.member.userId, "USER_REQUEST");
  assert.equal(revoked.revokedSessionCount >= 1, true);
  checks.push({ id: "operator_redacted_directory_status_action_and_audit_metadata", status: "pass", details: { accounts: listed.length, redacted: true, auditMetadataMinimal: true } });
}

async function expectApiError(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof ApiError && error.code === code);
}
