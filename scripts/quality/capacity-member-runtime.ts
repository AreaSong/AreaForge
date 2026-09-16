import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma, type PrismaClient } from "../../packages/db/src/index";
import { acceptWorkspaceInvitation, createWorkspaceInvitation, leaveWorkspace, removeWorkspaceMember,
  transferWorkspaceOwnership } from "../../apps/web/lib/workspace/membership-service";
import { createExamWorkspace, updateExamWorkspace } from "../../apps/web/lib/study/exam-workspace-service";
import { updateOperatorAccountStatus } from "../../apps/web/lib/system/account-management-service";
import type { CapacityFixture } from "./capacity-fixture";
import { createCapacityCase, seedCapacityInvitation, withCapacityPolicy } from "./capacity-runtime-data";
import { withCapacityFrozenRows } from "./capacity-frozen-fixture";

export async function capacityMemberLifecycle(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "member-lifecycle");
  const pending = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.stranger.email });
  const accept = () => acceptWorkspaceInvitation({ token: pending.token, actor: data.stranger });
  await assert.rejects(accept(), { code: "WORKSPACE_MEMBER_QUOTA_LIMIT", status: 429 });
  assert.equal((await client.workspaceInvitation.findUniqueOrThrow({ where: { id: pending.invitation.id } })).status, "PENDING");
  const original = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await leaveWorkspace(data.member, data.workspace.id, original.revision);
  assert.equal((await accept()).createdAccount, false);
  await assert.rejects(accept(), { code: "WORKSPACE_INVITATION_CONTINUATION_REQUIRED", status: 409 });
  const joined = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.stranger.id } } });
  await removeWorkspaceMember(data.owner, data.workspace.id, joined.id, joined.revision);
  const rejoin = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.member.email });
  await acceptWorkspaceInvitation({ token: rejoin.token, actor: data.member });
  assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
}

export async function capacityRegistrationRollback(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "registration");
  const email = `${data.prefix}-new@example.test`; const password = `Capacity-${randomBytes(12).toString("hex")}9!`;
  const pending = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email });
  const before = await registrationCounts(client);
  await assert.rejects(acceptWorkspaceInvitation({ token: pending.token, actor: null, password }), { code: "WORKSPACE_MEMBER_QUOTA_LIMIT", status: 429 });
  assert.deepEqual(await registrationCounts(client), before);
  assert.equal(await client.user.count({ where: { email } }), 0);
  assert.equal((await client.workspaceInvitation.findUniqueOrThrow({ where: { id: pending.invitation.id } })).status, "PENDING");
  const member = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await removeWorkspaceMember(data.owner, data.workspace.id, member.id, member.revision);
  const joined = await acceptWorkspaceInvitation({ token: pending.token, actor: null, password });
  assert.equal(joined.createdAccount, true);
  const personal = await client.examWorkspace.findFirstOrThrow({ where: { userId: joined.user.id, stableKey: "personal" } });
  assert.equal(await client.workspaceMembership.count({ where: { workspaceId: personal.id, userId: joined.user.id, role: "OWNER" } }), 1);
  assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
}

export async function capacityMemberSuspensionAndFreeze(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "member-retention");
  const pending = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.stranger.email });
  const rejected = () => assert.rejects(acceptWorkspaceInvitation({ token: pending.token, actor: data.stranger }), { code: "WORKSPACE_MEMBER_QUOTA_LIMIT" });
  await withCapacityPolicy({ AUTH_ADMIN_EMAIL: data.owner.email }, async () => {
    const before = await client.user.findUniqueOrThrow({ where: { id: data.member.id } });
    await updateOperatorAccountStatus(data.owner, before.id, { status: "SUSPENDED", expectedAuthRevision: before.authRevision, reason: "SECURITY_REVIEW" });
    await rejected();
    const suspended = await client.user.findUniqueOrThrow({ where: { id: before.id } });
    await updateOperatorAccountStatus(data.owner, before.id, { status: "ACTIVE", expectedAuthRevision: suspended.authRevision, reason: "USER_REQUEST" });
    await rejected();
  });
  const membership = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await withCapacityFrozenRows(client, { id: data.owner.id, sessionId: data.owner.sessionId! }, [{ model: "WorkspaceMembership", id: membership.id }], async () => {
    assert.equal(await prisma.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 1);
    await rejected();
  });
  assert.equal(await prisma.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
  await rejected();
}

export async function capacityMemberArchiveAndOwner(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "member-owner");
  const archived = await updateExamWorkspace(data.owner.id, data.workspace.id, { expectedRevision: data.workspace.revision, archived: true });
  assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
  await updateExamWorkspace(data.owner.id, data.workspace.id, { expectedRevision: archived.revision, archived: false });
  const owner = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.owner.id } } });
  const member = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await transferWorkspaceOwnership(data.owner, data.workspace.id, member.id, owner.revision, member.revision);
  assert.equal((await client.examWorkspace.findUniqueOrThrow({ where: { id: data.workspace.id } })).userId, data.member.id);
  const pending = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.member, email: data.stranger.email });
  await assert.rejects(acceptWorkspaceInvitation({ token: pending.token, actor: data.stranger }), { code: "WORKSPACE_MEMBER_QUOTA_LIMIT" });
  await withCapacityPolicy({ WORKSPACE_MEMBER_QUOTA_MAX_SEATS: "1" }, async () => {
    await leaveWorkspace(data.owner, data.workspace.id, owner.revision + 1);
    assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 1);
    await assert.rejects(leaveWorkspace(data.member, data.workspace.id, member.revision + 1), { code: "LAST_OWNER_CANNOT_LEAVE" });
  });
}

export async function capacityMemberPolicyAndPersonal(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "member-policy");
  const pending = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.stranger.email });
  for (const patch of [{ WORKSPACE_MEMBER_QUOTA_ENABLED: "true", WORKSPACE_MEMBER_QUOTA_MAX_SEATS: undefined },
    { WORKSPACE_MEMBER_QUOTA_ENABLED: "INVALID" }, { WORKSPACE_MEMBER_QUOTA_MAX_SEATS: "0" }]) {
    await withCapacityPolicy(patch, async () => {
      await assert.rejects(acceptWorkspaceInvitation({ token: pending.token, actor: data.stranger }), { code: "WORKSPACE_MEMBER_QUOTA_CONFIG_INVALID", status: 503 });
      const personal = await createExamWorkspace(data.owner.id, { stableKey: `capacity-${randomUUID()}`, name: "合成个人空间", activate: false });
      assert.equal(await client.workspaceMembership.count({ where: { workspaceId: personal.id, userId: data.owner.id, role: "OWNER" } }), 1);
    });
  }
  await withCapacityPolicy({ WORKSPACE_MEMBER_QUOTA_ENABLED: "false" }, async () => {
    await acceptWorkspaceInvitation({ token: pending.token, actor: data.stranger });
    assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 3);
  });
  const existing = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.member.email });
  await withCapacityPolicy({ WORKSPACE_MEMBER_QUOTA_MAX_SEATS: "bad" }, () => acceptWorkspaceInvitation({ token: existing.token, actor: data.member }));
  assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 3);
}

export async function capacityMemberAuthorizationAndMail(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "member-auth");
  for (const options of [{ expired: true }, { revoked: true }, {}]) {
    const invalidToken = options.expired || options.revoked;
    const pending = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner,
      email: invalidToken ? data.stranger.email : data.member.email }, options);
    await assert.rejects(acceptWorkspaceInvitation({ token: pending.token, actor: data.stranger }),
      { code: "WORKSPACE_INVITATION_CONTINUATION_REQUIRED", status: 409 });
  }
  await withCapacityPolicy({ APP_ENV: "production" }, () => assert.rejects(
    createWorkspaceInvitation(data.owner, data.workspace.id, `${data.prefix}-mail@example.test`), { code: "AUTH_MAIL_DELIVERY_FAILED", status: 503 }));
  assert.equal(await client.workspaceInvitation.count({ where: { workspaceId: data.workspace.id, emailNormalized: `${data.prefix}-mail@example.test`, status: "REVOKED" } }), 1);
  assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
}

async function registrationCounts(client: PrismaClient) {
  return Promise.all([client.user.count(), client.examWorkspace.count(), client.workspaceMembership.count(), client.auditEvent.count()]);
}
