import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  hashPassword,
  hashSessionToken,
  hashWorkspaceInvitationToken,
} from "../../packages/auth/src/index";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import {
  changeAccountPassword,
  listDeviceSessions,
  revokeDeviceSession,
  revokeOtherDeviceSessions,
} from "../../apps/web/lib/auth/account-service";
import { requireRecentReauthentication } from "../../apps/web/lib/api/auth";
import {
  preparePasswordReset,
  resetPasswordWithToken,
} from "../../apps/web/lib/auth/action-token-service";
import {
  checkLoginRateLimit,
  clearAuthFailures,
  clearLoginFailures,
  recordLoginFailure,
  reserveAuthAttempts,
} from "../../apps/web/lib/auth/rate-limit";
import {
  activateExamWorkspace,
  createExamWorkspace,
  listExamWorkspaces,
  listWorkspaceSubjects,
  updateExamWorkspace,
} from "../../apps/web/lib/study/exam-workspace-service";
import {
  createStagePlan,
  updateStagePlan,
} from "../../apps/web/lib/study/stage-service";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  leaveWorkspace,
  listWorkspaceMembers,
  removeWorkspaceMember,
  rejectWorkspaceInvitation,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
} from "../../apps/web/lib/workspace/membership-service";
import { findUserBySessionToken, type CurrentUser } from "../../apps/web/lib/auth/session";

const checks: string[] = [];
const tokenSecret = process.env.AUTH_ACTION_TOKEN_SECRET ?? "";

try {
  await assertIsolatedDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
  const fixture = await seedFixture();
  await verifyWorkspaceSelection(fixture.owner, fixture.personalWorkspaceId, fixture.sharedWorkspaceId);
  await verifyFeatureFlagTransitionKeepsWorkspaceVisible(fixture.owner.id);
  await verifyActiveSessionBlocksWorkspaceSwitchAndCreate(fixture);
  await verifyWorkspaceLifecycle(fixture.owner, fixture.sharedWorkspaceId);
  await verifyStagePlanCurrentInvariant(fixture.owner);
  await verifyPersistentRateLimit();
  await verifyInvitationLifecycle(fixture);
  await verifyAccountSecurity(fixture.owner);
  await verifyAccountStatusInvalidation();
  await verifyPasswordReset(fixture.owner.id);
  await verifyAuditRedaction();
  console.log(JSON.stringify({
    schemaVersion: "v14-auth-runtime-selftest-v1",
    status: "pass",
    checks,
    doesNotProve: ["production migration", "production SMTP", "browser experience", "v1.5 RBAC"],
    safetyFacts: { isolatedDatabaseRequired: true, productionWriteAttempted: false, physicalDeleteAttempted: false },
  }, null, 2));
  console.log("PASS v1.4 AUTH isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V14_AUTH_ISOLATED_DB !== "1") throw new Error("isolated DB flag is required");
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const database = rows[0]?.current_database ?? "";
  const expectedDatabase = process.env.AREAFORGE_V14_AUTH_EXPECTED_DATABASE ?? "";
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!expectedDatabase || database !== expectedDatabase || databaseUrl.pathname.slice(1) !== expectedDatabase) {
    throw new Error("exact isolated database identity is required");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) {
    throw new Error("isolated database must use a loopback host");
  }
  if (!process.env.AUTH_MULTI_USER_ENABLED || process.env.AUTH_MULTI_USER_ENABLED !== "true") throw new Error("multi-user flag is required");
  if (tokenSecret.length < 32) throw new Error("synthetic action token secret is required");
  checks.push("isolated_database_guard");
}

async function verifyFeatureFlagTransitionKeepsWorkspaceVisible(actorId: string) {
  const previous = process.env.AUTH_MULTI_USER_ENABLED;
  process.env.AUTH_MULTI_USER_ENABLED = "false";
  const created = await createExamWorkspace(actorId, {
    stableKey: `flag-transition-${randomUUID()}`,
    name: "灰度切换工作区",
    activate: false,
  });
  process.env.AUTH_MULTI_USER_ENABLED = "true";
  try {
    const listed = await listExamWorkspaces(actorId);
    assert.equal(listed.find((workspace) => workspace.id === created.id)?.membershipRole, "OWNER");
  } finally {
    process.env.AUTH_MULTI_USER_ENABLED = previous;
  }
  checks.push("feature_flag_transition_keeps_workspace_ownership");
}

async function seedFixture() {
  const password = "AreaForge-Test-2026!";
  const passwordHash = await hashPassword(password);
  const owner = await prisma.user.create({
    data: { email: "owner-v14@example.test", passwordHash, emailVerifiedAt: new Date() },
  });
  const session = await prisma.authSession.create({
    data: {
      userId: owner.id,
      tokenHash: `session-${randomUUID()}`,
      authRevision: owner.authRevision,
      expiresAt: new Date(Date.now() + 86_400_000),
      reauthenticatedAt: new Date(),
    },
  });
  const personal = await createOwnedWorkspace(owner.id, "personal-owner");
  const shared = await createOwnedWorkspace(owner.id, "shared-study");
  await prisma.workspaceSelection.create({ data: { userId: owner.id, workspaceId: personal.id } });
  const actor: CurrentUser = {
    id: owner.id,
    email: owner.email,
    sessionId: session.id,
    status: "ACTIVE",
    emailVerifiedAt: owner.emailVerifiedAt,
    reauthenticatedAt: session.reauthenticatedAt,
  };
  return { owner: actor, password, personalWorkspaceId: personal.id, sharedWorkspaceId: shared.id };
}

async function createOwnedWorkspace(userId: string, stableKey: string) {
  const workspace = await prisma.examWorkspace.create({
    data: { userId, stableKey, name: stableKey, status: "ACTIVE" },
  });
  await prisma.workspaceMembership.create({ data: { workspaceId: workspace.id, userId, role: "OWNER" } });
  return workspace;
}

async function verifyWorkspaceSelection(actor: CurrentUser, personalWorkspaceId: string, sharedWorkspaceId: string) {
  const listed = await listExamWorkspaces(actor.id);
  assert.equal(listed.length, 2);
  const personal = listed.find((item) => item.id === personalWorkspaceId);
  assert.equal(personal?.current, true);
  const shared = listed.find((item) => item.id === sharedWorkspaceId);
  assert.ok(shared && personal);
  await activateExamWorkspace(actor.id, sharedWorkspaceId, shared.revision, shared.selectionRevision);
  assert.equal((await prisma.workspaceSelection.findUniqueOrThrow({ where: { userId: actor.id } })).workspaceId, sharedWorkspaceId);
  await expectApiError(
    () => activateExamWorkspace(actor.id, personalWorkspaceId, personal.revision, personal.selectionRevision),
    "WORKSPACE_SELECTION_CONFLICT",
  );
  assert.equal((await prisma.examWorkspace.count({ where: { userId: actor.id, status: "ACTIVE" } })), 2);
  checks.push("selection_does_not_archive_workspace");
}

async function verifyActiveSessionBlocksWorkspaceSwitchAndCreate(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
) {
  const subject = await prisma.subject.create({
    data: {
      workspaceId: fixture.personalWorkspaceId,
      stableKey: `active-session-${randomUUID()}`,
      name: "活动学习阻断夹具",
      color: "#14b8a6",
    },
  });
  const session = await prisma.studySession.create({
    data: {
      userId: fixture.owner.id,
      workspaceId: fixture.personalWorkspaceId,
      subjectId: subject.id,
      startedAt: new Date(),
      status: "RUNNING",
    },
  });
  const personal = await prisma.examWorkspace.findUniqueOrThrow({
    where: { id: fixture.personalWorkspaceId },
  });
  const selectionBefore = await prisma.workspaceSelection.findUniqueOrThrow({
    where: { userId: fixture.owner.id },
  });
  await expectApiError(
    () => activateExamWorkspace(fixture.owner.id, personal.id, personal.revision, selectionBefore.revision),
    "ACTIVE_SESSION_BLOCKS_WORKSPACE_SWITCH",
  );
  const blockedStableKey = `blocked-create-${randomUUID()}`;
  await expectApiError(
    () => createExamWorkspace(fixture.owner.id, {
      stableKey: blockedStableKey,
      name: "不应创建的工作区",
      subjects: [{ stableKey: "blocked-subject", name: "阻断科目", color: "#14b8a6" }],
    }),
    "ACTIVE_SESSION_BLOCKS_WORKSPACE_SWITCH",
  );
  assert.equal(
    (await prisma.workspaceSelection.findUniqueOrThrow({ where: { userId: fixture.owner.id } })).workspaceId,
    selectionBefore.workspaceId,
  );
  assert.equal(await prisma.examWorkspace.count({ where: { stableKey: blockedStableKey } }), 0);
  await prisma.studySession.update({ where: { id: session.id }, data: { status: "CANCELED", endedAt: new Date() } });
  checks.push("active_session_blocks_workspace_switch_and_create");
}

async function verifyWorkspaceLifecycle(actor: CurrentUser, fallbackWorkspaceId: string) {
  const workspace = await createOwnedWorkspace(actor.id, `lifecycle-${randomUUID()}`);
  const invitation = await createWorkspaceInvitation(actor, workspace.id, "archive-revokes-v14@example.test");
  const renamed = await updateExamWorkspace(actor.id, workspace.id, {
    expectedRevision: workspace.revision,
    name: "lifecycle-renamed",
  });
  assert.equal(renamed.name, "lifecycle-renamed");
  const archived = await updateExamWorkspace(actor.id, workspace.id, {
    expectedRevision: renamed.revision,
    archived: true,
  });
  assert.equal(archived.status, "ARCHIVED");
  assert.equal((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status, "REVOKED");
  assert.equal((await prisma.workspaceSelection.findUniqueOrThrow({ where: { userId: actor.id } })).workspaceId, fallbackWorkspaceId);
  const restored = await updateExamWorkspace(actor.id, workspace.id, {
    expectedRevision: archived.revision,
    archived: false,
  });
  assert.equal(restored.status, "ACTIVE");
  checks.push("workspace_rename_archive_restore");
}

async function verifyStagePlanCurrentInvariant(actor: CurrentUser) {
  const baseInput = {
    baseRevision: null,
    name: "v1.4 阶段计划并发夹具",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    goal: "验证同一 Workspace 只能保留一个当前阶段计划",
    status: "draft" as const,
  };
  const concurrent = await Promise.allSettled([
    createStagePlan({ ...baseInput, idempotencyKey: `stage-a-${randomUUID()}` }, actor.id),
    createStagePlan({ ...baseInput, idempotencyKey: `stage-b-${randomUUID()}` }, actor.id),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const rejected = concurrent.find((result) => result.status === "rejected");
  assert.ok(
    rejected?.status === "rejected"
      && rejected.reason instanceof ApiError
      && rejected.reason.code === "STAGE_PLAN_BASE_REVISION_CONFLICT",
  );
  const created = concurrent.find((result) => result.status === "fulfilled");
  assert.ok(created?.status === "fulfilled");

  const currentIndex = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'StagePlan_one_current_per_workspace_idx'
  `;
  assert.deepEqual(currentIndex.map((row) => row.indexname), ["StagePlan_one_current_per_workspace_idx"]);

  const workspace = await prisma.workspaceSelection.findUniqueOrThrow({ where: { userId: actor.id } });
  const archived = await prisma.stagePlan.create({
    data: {
      workspaceId: workspace.workspaceId,
      name: "待激活阶段",
      startDate: new Date("2027-01-01T00:00:00.000Z"),
      endDate: new Date("2027-06-30T00:00:00.000Z"),
      goal: "验证更新路径同样执行单当前计划约束",
      mode: "maintain",
      status: "archived",
    },
  });
  await expectApiError(
    () => updateStagePlan(archived.id, { expectedRevision: archived.revision, status: "active" }, actor.id),
    "STAGE_PLAN_BASE_REVISION_CONFLICT",
  );
  await updateStagePlan(
    created.value.id,
    { expectedRevision: created.value.revision, status: "completed" },
    actor.id,
  );
  const activated = await updateStagePlan(
    archived.id,
    { expectedRevision: archived.revision, status: "active" },
    actor.id,
  );
  assert.equal(activated.status, "active");
  assert.equal(await prisma.stagePlan.count({
    where: { workspaceId: workspace.workspaceId, status: { in: ["active", "draft"] } },
  }), 1);
  checks.push("stage_plan_single_current_on_create_and_update");
}

async function verifyPersistentRateLimit() {
  const key = `selftest-${randomUUID()}`;
  await clearLoginFailures(key);
  for (let index = 0; index < 5; index += 1) await recordLoginFailure(key);
  const blocked = await checkLoginRateLimit(key);
  assert.equal(blocked.allowed, false);
  assert.ok((blocked.retryAfterSeconds ?? 0) > 0);
  await clearLoginFailures(key);
  assert.equal((await checkLoginRateLimit(key)).allowed, true);
  const concurrentKey = `selftest-concurrent-${randomUUID()}`;
  const concurrentKeys = [concurrentKey, `${concurrentKey}-account`, `${concurrentKey}-ip`];
  const reservations = await Promise.all(Array.from({ length: 10 }, () => reserveAuthAttempts("LOGIN", concurrentKeys)));
  assert.equal(reservations.filter((result) => result.allowed).length, 5);
  assert.equal(reservations.filter((result) => !result.allowed).length, 5);
  await clearAuthFailures("LOGIN", concurrentKeys);
  for (const purpose of ["EMAIL_VERIFICATION", "REAUTHENTICATION", "PASSWORD_CHANGE"] as const) {
    const purposeKey = `${purpose.toLowerCase()}-${randomUUID()}`;
    assert.equal((await reserveAuthAttempts(purpose, [purposeKey])).allowed, true);
    await clearAuthFailures(purpose, purposeKey);
  }
  checks.push("persistent_login_throttle");
}

async function verifyInvitationLifecycle(fixture: Awaited<ReturnType<typeof seedFixture>>) {
  const created = await createWorkspaceInvitation(fixture.owner, fixture.sharedWorkspaceId, "pending-v14@example.test");
  assert.equal(created.status, "PENDING");
  const revoked = await revokeWorkspaceInvitation(fixture.owner, fixture.sharedWorkspaceId, created.id, created.revision);
  assert.equal(revoked.status, "REVOKED");

  const existing = await prisma.user.create({
    data: { email: "existing-v14@example.test", passwordHash: await hashPassword(fixture.password), emailVerifiedAt: new Date() },
  });
  const existingPersonal = await createOwnedWorkspace(existing.id, "existing-personal");
  await prisma.workspaceSelection.create({ data: { userId: existing.id, workspaceId: existingPersonal.id } });
  const existingSession = await prisma.authSession.create({
    data: { userId: existing.id, tokenHash: `session-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000), reauthenticatedAt: new Date() },
  });
  const existingActor: CurrentUser = {
    id: existing.id,
    email: existing.email,
    sessionId: existingSession.id,
    status: "ACTIVE",
    emailVerifiedAt: existing.emailVerifiedAt,
    reauthenticatedAt: existingSession.reauthenticatedAt,
  };
  const existingToken = await seedInvitation(fixture.sharedWorkspaceId, fixture.owner.id, existing.email);
  const existingAccepted = await acceptWorkspaceInvitation({ token: existingToken, actor: existingActor });
  assert.equal(existingAccepted.createdAccount, false);
  const memberVisibleDirectory = await listWorkspaceMembers(existing.id, fixture.sharedWorkspaceId);
  assert.deepEqual(memberVisibleDirectory.map((member) => member.userId), [existing.id]);
  const memberWorkspace = (await listExamWorkspaces(existing.id)).find((workspace) => workspace.id === fixture.sharedWorkspaceId);
  assert.equal(memberWorkspace?.targetExamDate, null);
  assert.equal(memberWorkspace?.stageSummary, null);
  await expectApiError(() => acceptWorkspaceInvitation({ token: existingToken, actor: existingActor }), "WORKSPACE_INVITATION_CONTINUATION_REQUIRED");
  const sharedRevision = (await prisma.examWorkspace.findUniqueOrThrow({ where: { id: fixture.sharedWorkspaceId } })).revision;
  const existingSelectionRevision = (await prisma.workspaceSelection.findUniqueOrThrow({
    where: { userId: existing.id },
  })).revision;
  await expectApiError(
    () => activateExamWorkspace(
      existing.id,
      fixture.sharedWorkspaceId,
      sharedRevision,
      existingSelectionRevision,
    ),
    "WORKSPACE_NOT_FOUND",
  );
  await expectApiError(() => listWorkspaceSubjects(existing.id, fixture.sharedWorkspaceId), "WORKSPACE_NOT_FOUND");

  const mismatchToken = await seedInvitation(fixture.sharedWorkspaceId, fixture.owner.id, "different-v14@example.test");
  await expectApiError(
    () => acceptWorkspaceInvitation({ token: mismatchToken, actor: existingActor }),
    "WORKSPACE_INVITATION_CONTINUATION_REQUIRED",
  );
  await expectApiError(
    () => rejectWorkspaceInvitation(existingActor, mismatchToken),
    "WORKSPACE_INVITATION_CONTINUATION_REQUIRED",
  );

  const concurrentToken = await seedInvitation(fixture.sharedWorkspaceId, fixture.owner.id, "concurrent-v14@example.test");
  const concurrent = await Promise.allSettled([
    acceptWorkspaceInvitation({ token: concurrentToken, actor: null, password: fixture.password }),
    acceptWorkspaceInvitation({ token: concurrentToken, actor: null, password: fixture.password }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const rejectedConcurrentAccept = concurrent.find((result) => result.status === "rejected");
  assert.ok(
    rejectedConcurrentAccept?.status === "rejected"
      && rejectedConcurrentAccept.reason instanceof ApiError
      && rejectedConcurrentAccept.reason.code === "WORKSPACE_INVITATION_CONTINUATION_REQUIRED",
  );

  const newToken = await seedInvitation(fixture.sharedWorkspaceId, fixture.owner.id, "new-v14@example.test");
  const newAccepted = await acceptWorkspaceInvitation({ token: newToken, actor: null, password: fixture.password });
  assert.equal(newAccepted.createdAccount, true);
  const newPersonal = await prisma.workspaceMembership.findFirstOrThrow({
    where: { userId: newAccepted.user.id, role: "OWNER", status: "ACTIVE" },
  });
  assert.notEqual(newPersonal.workspaceId, fixture.sharedWorkspaceId);
  const newMember = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: fixture.sharedWorkspaceId, userId: newAccepted.user.id } },
  });
  await removeWorkspaceMember(fixture.owner, fixture.sharedWorkspaceId, newMember.id, newMember.revision);
  assert.equal((await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: newMember.id } })).status, "REMOVED");
  await expectApiError(
    () => listWorkspaceMembers(newAccepted.user.id, fixture.sharedWorkspaceId),
    "WORKSPACE_NOT_FOUND",
  );

  const members = await listWorkspaceMembers(fixture.owner.id, fixture.sharedWorkspaceId);
  const target = members.find((item) => item.userId === existing.id);
  const owner = members.find((item) => item.userId === fixture.owner.id);
  assert.ok(target && owner);
  await transferWorkspaceOwnership(fixture.owner, fixture.sharedWorkspaceId, target.id, owner.revision, target.revision);
  assert.equal((await prisma.examWorkspace.findUniqueOrThrow({ where: { id: fixture.sharedWorkspaceId } })).userId, existing.id);
  assert.equal((await prisma.workspaceSelection.findUniqueOrThrow({ where: { userId: fixture.owner.id } })).workspaceId, fixture.personalWorkspaceId);
  const transferredOwner = await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: target.id } });
  await expectApiError(() => listWorkspaceSubjects(fixture.owner.id, fixture.sharedWorkspaceId), "WORKSPACE_NOT_FOUND");
  assert.deepEqual(await listWorkspaceSubjects(existing.id, fixture.sharedWorkspaceId), []);
  await expectApiError(() => leaveWorkspace(existingActor, fixture.sharedWorkspaceId, transferredOwner.revision), "LAST_OWNER_CANNOT_LEAVE");
  checks.push("invitation_replay_idor_membership_transfer_and_last_owner");
}

async function verifyAccountSecurity(actor: CurrentUser) {
  const authorizationProbe = await prisma.authSession.create({
    data: { userId: actor.id, tokenHash: `authorization-probe-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await prisma.authSession.update({
    where: { id: actor.sessionId },
    data: { reauthenticatedAt: new Date(Date.now() - 11 * 60 * 1000) },
  });
  await expectApiError(() => revokeOtherDeviceSessions(actor), "REAUTHENTICATION_REQUIRED");
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: authorizationProbe.id } })).revokedAt, null);

  await prisma.authSession.update({ where: { id: actor.sessionId }, data: { reauthenticatedAt: new Date() } });
  await prisma.user.update({ where: { id: actor.id }, data: { status: "SUSPENDED" } });
  await expectApiError(() => revokeOtherDeviceSessions(actor), "REAUTHENTICATION_REQUIRED");
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: authorizationProbe.id } })).revokedAt, null);

  await prisma.user.update({ where: { id: actor.id }, data: { status: "ACTIVE" } });
  await prisma.authSession.update({
    where: { id: actor.sessionId },
    data: { revokedAt: new Date(), revokedReason: "SELFTEST_CURRENT_SESSION_REVOKED" },
  });
  await expectApiError(() => revokeOtherDeviceSessions(actor), "REAUTHENTICATION_REQUIRED");
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: authorizationProbe.id } })).revokedAt, null);
  await prisma.authSession.update({
    where: { id: actor.sessionId },
    data: { revokedAt: null, revokedReason: null, reauthenticatedAt: new Date() },
  });
  await revokeDeviceSession(actor, authorizationProbe.id);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: authorizationProbe.id } })).revokedAt);

  const revocable = await prisma.authSession.create({
    data: { userId: actor.id, tokenHash: `other-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  assert.equal((await listDeviceSessions(actor)).some((session) => session.id === revocable.id), true);
  await revokeDeviceSession(actor, revocable.id);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: revocable.id } })).revokedAt);
  const revoked = await revokeOtherDeviceSessions(actor);
  assert.equal(revoked, 0);
  await prisma.authSession.create({
    data: { userId: actor.id, tokenHash: `other-${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await prisma.authSession.update({
    where: { id: actor.sessionId },
    data: { reauthenticatedAt: new Date(Date.now() - 11 * 60 * 1000) },
  });
  await expectApiError(() => requireRecentReauthentication(actor), "REAUTHENTICATION_REQUIRED");
  await prisma.authSession.update({ where: { id: actor.sessionId }, data: { reauthenticatedAt: new Date() } });
  await requireRecentReauthentication(actor);
  const nextToken = await changeAccountPassword(actor, "AreaForge-Test-2026!", "AreaForge-Changed-2026!");
  const account = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  const previous = await prisma.authSession.findUniqueOrThrow({ where: { id: actor.sessionId } });
  const current = await prisma.authSession.findUniqueOrThrow({
    where: { tokenHash: hashSessionToken(nextToken, process.env.AUTH_SESSION_SECRET ?? "") },
  });
  assert.equal(account.authRevision, 2);
  assert.ok(previous.revokedAt);
  assert.equal(current.authRevision, 2);
  assert.notEqual(current.id, actor.sessionId);
  assert.equal(await prisma.authSession.count({ where: { userId: actor.id, id: { not: current.id }, revokedAt: null } }), 0);
  checks.push("device_revocation_reauthentication_and_password_change");
}

async function verifyAccountStatusInvalidation() {
  const token = `account-status-${randomUUID()}-${randomUUID()}`;
  const user = await prisma.user.create({
    data: {
      email: "account-status-v14@example.test",
      passwordHash: await hashPassword("AreaForge-Status-2026!"),
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.authSession.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token, process.env.AUTH_SESSION_SECRET ?? ""),
      authRevision: user.authRevision,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const sessionSecret = process.env.AUTH_SESSION_SECRET ?? "";
  assert.equal((await findUserBySessionToken(token, sessionSecret))?.id, user.id);
  await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
  assert.equal(await findUserBySessionToken(token, sessionSecret), null);
  await prisma.user.update({
    where: { id: user.id },
    data: { status: "ACTIVE", authRevision: { increment: 1 } },
  });
  assert.equal(await findUserBySessionToken(token, sessionSecret), null);
  checks.push("account_suspension_and_auth_revision_invalidate_next_request");
}

async function verifyPasswordReset(userId: string) {
  const account = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  const rotations = await Promise.all([
    preparePasswordReset(account.email),
    preparePasswordReset(account.email),
  ]);
  assert.equal(rotations.every(Boolean), true);
  assert.equal(await prisma.authActionToken.count({
    where: { userId, purpose: "PASSWORD_RESET", consumedAt: null, revokedAt: null },
  }), 1);
  await prisma.authActionToken.updateMany({
    where: { userId, purpose: "PASSWORD_RESET", consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = `reset-${randomUUID()}-${randomUUID()}`;
  const tokenHash = (await import("../../packages/auth/src/index")).hashAuthActionToken(token, "PASSWORD_RESET", tokenSecret);
  await prisma.authActionToken.create({
    data: { userId, purpose: "PASSWORD_RESET", tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
  });
  await resetPasswordWithToken(token, "AreaForge-Reset-2026!");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).authRevision, 3);
  await expectApiError(() => resetPasswordWithToken(token, "AreaForge-Reset-Again-2026!"), "AUTH_ACTION_TOKEN_INVALID");
  checks.push("password_reset_single_use_and_auth_revision");
}

async function verifyAuditRedaction(): Promise<void> {
  const events = await prisma.auditEvent.findMany({ select: { metadata: true } });
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /AreaForge-(?:Test|Changed|Reset)/);
  assert.doesNotMatch(serialized, /(?:invite|reset)-[0-9a-f-]{20,}/i);
  assert.doesNotMatch(serialized, /synthetic-auth-(?:action-token|session)-secret/);
  checks.push("audit_metadata_redaction");
}

async function seedInvitation(workspaceId: string, inviterId: string, email: string): Promise<string> {
  const token = `invite-${randomUUID()}-${randomUUID()}`;
  await prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      emailNormalized: email,
      tokenHash: hashWorkspaceInvitationToken(token, tokenSecret),
      expiresAt: new Date(Date.now() + 3_600_000),
      invitedByUserId: inviterId,
    },
  });
  return token;
}

async function expectApiError(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof ApiError && error.code === code);
}
