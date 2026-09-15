import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getSafeRankingProjection, collectDataExportRecords, type PrismaClient } from "../../packages/db/src/index";
import { removeWorkspaceMember, transferWorkspaceOwnership } from "../../apps/web/lib/workspace/membership-service";
import { updateWorkspaceMemberRole } from "../../apps/web/lib/workspace/rbac-service";
import { updateOperatorAccountStatus } from "../../apps/web/lib/system/account-management-service";
import { updateRankingPreference } from "../../apps/web/lib/ranking/preference-service";
import { invitePrivateChallengeParticipant, transitionPrivateChallengeParticipantForActor, transferPrivateChallengeOwnership } from "../../apps/web/lib/ranking/challenge-service";
import { createRankingCase, requestRankingCase, consumeRankingCase, rankingSideEffects } from "./ranking-rebuild-runtime-data";
import type { RankingRebuildFixture } from "./ranking-rebuild-fixture";

export async function rankingRealMembershipChanges(client: PrismaClient, fixture: RankingRebuildFixture) {
  for (const action of ["remove", "role", "transfer-workspace", "transfer-challenge"] as const) {
    const data = await createRankingCase(client, fixture, action); const job = await requestRankingCase(client, data);
    const member = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
    if (action === "remove") await removeWorkspaceMember(data.owner, data.workspace.id, member.id, member.revision);
    if (action === "role") await updateWorkspaceMemberRole(data.owner, data.workspace.id, member.id, "VIEWER", member.revision);
    if (action === "transfer-workspace") {
      await client.examWorkspace.create({ data: { userId: data.owner.id, stableKey: `fallback-${randomUUID()}`, name: "合成保留个人空间",
        memberships: { create: { userId: data.owner.id, role: "OWNER" } } } });
      const owner = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.owner.id } } });
      await transferWorkspaceOwnership(data.owner, data.workspace.id, member.id, owner.revision, member.revision);
    }
    if (action === "transfer-challenge") {
      const participant = await client.privateChallengeParticipant.findUniqueOrThrow({ where: { challengeId_userId: { challengeId: data.challenge.id, userId: data.member.id } } });
      await transferPrivateChallengeOwnership(data.owner, data.challenge.id, participant.id, data.challenge.revision);
    }
    assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
    assert.equal((await rankingSideEffects(client, data)).effects, 0);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).retryable, false);
  }
}

export async function rankingRealAccountChange(client: PrismaClient, fixture: RankingRebuildFixture) {
  const operator = await client.user.upsert({ where: { email: fixture.operatorEmail },
    create: { email: fixture.operatorEmail, passwordHash: "synthetic-not-login", emailVerifiedAt: new Date() }, update: {} });
  const session = await client.authSession.create({ data: { userId: operator.id, authRevision: operator.authRevision, tokenHash: randomBytes(32).toString("hex"),
    reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
  const actor = { id: operator.id, email: operator.email, status: operator.status, emailVerifiedAt: operator.emailVerifiedAt,
    sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
  const data = await createRankingCase(client, fixture, "operator-state"); const job = await requestRankingCase(client, data);
  const suspended = await updateOperatorAccountStatus(actor, data.member.id, { status: "SUSPENDED", expectedAuthRevision: 1, reason: "SECURITY_REVIEW" });
  await updateOperatorAccountStatus(actor, data.member.id, { status: "ACTIVE", expectedAuthRevision: suspended.authRevision, reason: "USER_REQUEST" });
  assert.ok((await client.authSession.findUniqueOrThrow({ where: { id: data.member.sessionId } })).revokedAt);
  assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
  assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "RANKING_REBUILD_SNAPSHOT_CHANGED");
}

export async function rankingConsentHistory(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "consent-history"); await requestRankingCase(client, data);
  assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
  const old = await requestRankingCase(client, data);
  const preference = await updateRankingPreference(data.member, data.workspace.id, { enabled: false, timezone: "UTC", authorizedFields: ["score"], expectedRevision: 1 });
  const hidden = await getSafeRankingProjection(client, data.owner.id, data.challenge.id);
  assert.equal(hidden.entries.length, 0); assert.equal(hidden.stale, true);
  await updateRankingPreference(data.member, data.workspace.id, { enabled: true, timezone: "UTC", authorizedFields: ["score"], expectedRevision: preference.revision });
  await invitePrivateChallengeParticipant(data.owner, data.challenge.id, { userId: data.member.id, authorizedFields: ["score"], nickname: "合成 Member" });
  await transitionPrivateChallengeParticipantForActor(data.member, data.challenge.id, "join");
  assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
  assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: old.id } })).errorCode, "RANKING_REBUILD_SNAPSHOT_CHANGED");
  await requestRankingCase(client, data); assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
  assert.equal((await getSafeRankingProjection(client, data.owner.id, data.challenge.id)).entries.length, 2);
}

export async function rankingExportRedaction(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "export-metadata"); const job = await requestRankingCase(client, data);
  const records = await collectDataExportRecords(client, { actor: data.owner, workspaceIds: [data.workspace.id], scope: "ACCOUNT", includeData: true });
  const record = records.find(row => row.kind === "dataJob" && row.id === job.id); assert.ok(record);
  const encoded = JSON.stringify(record);
  assert.equal(encoded.includes("authorization"), false); assert.equal(encoded.includes("membershipRevision"), false);
  assert.equal(encoded.includes("private-session-body-sentinel"), false);
}
