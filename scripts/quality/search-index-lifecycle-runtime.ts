import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { captureSearchScope, collectDataExportRecords, controlWorkspaceSearchIndex, type PrismaClient } from "../../packages/db/src/index";
import { searchSourceRows } from "../../packages/db/src/workspace-search-source";
import { assertSearchScopeTime } from "../../packages/db/src/workspace-search-scope";
import { removeWorkspaceMember, transferWorkspaceOwnership } from "../../apps/web/lib/workspace/membership-service";
import { updateWorkspaceMemberRole } from "../../apps/web/lib/workspace/rbac-service";
import { updateOperatorAccountStatus } from "../../apps/web/lib/system/account-management-service";
import { createSearchCase, requestSearchCase, consumeSearchCase, querySearchCase } from "./search-index-runtime-data";
import { runDataJobWorker } from "../workers/data-job-runner";
import { DataJobHandlerError } from "../workers/data-job-handler";
import type { SearchIndexFixture } from "./search-index-fixture";

export async function searchRealPermissions(client: PrismaClient, fixture: SearchIndexFixture) {
  for (const action of ["remove-rejoin", "role-restore", "transfer"] as const) {
    const data = await createSearchCase(client, fixture, action); const actor = action === "transfer" ? data.owner : data.viewer;
    const job = await requestSearchCase(client, data, actor);
    const member = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.viewer.id } } });
    if (action === "remove-rejoin") {
      await removeWorkspaceMember(data.owner, data.workspace.id, member.id, member.revision);
      await assert.rejects(querySearchCase(data, actor), /NOT_FOUND/);
      await client.workspaceMembership.update({ where: { id: member.id }, data: { status: "ACTIVE", removedAt: null, revision: { increment: 1 } } });
    }
    if (action === "role-restore") {
      const changed = await updateWorkspaceMemberRole(data.owner, data.workspace.id, member.id, "COACH", member.revision);
      await updateWorkspaceMemberRole(data.owner, data.workspace.id, member.id, "VIEWER", changed.revision);
    }
    if (action === "transfer") {
      const target = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
      const owner = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.owner.id } } });
      await transferWorkspaceOwnership(data.owner, data.workspace.id, target.id, owner.revision, target.revision);
    }
    assert.deepEqual(await consumeSearchCase(client, data), ["FAILED"]);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "SEARCH_INDEX_SNAPSHOT_CHANGED");
  }
}

export async function searchAccountRevocation(client: PrismaClient, fixture: SearchIndexFixture) {
  const operator = await client.user.upsert({ where: { email: fixture.operatorEmail },
    create: { email: fixture.operatorEmail, passwordHash: "synthetic-not-login", emailVerifiedAt: new Date() }, update: {} });
  const session = await client.authSession.create({ data: { userId: operator.id, authRevision: operator.authRevision, tokenHash: randomBytes(32).toString("hex"),
    reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
  const actor = { id: operator.id, email: operator.email, status: operator.status, emailVerifiedAt: operator.emailVerifiedAt,
    sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
  const data = await createSearchCase(client, fixture, "account-revocation"); const job = await requestSearchCase(client, data, data.viewer);
  const suspended = await updateOperatorAccountStatus(actor, data.viewer.id, { status: "SUSPENDED", expectedAuthRevision: 1, reason: "SECURITY_REVIEW" });
  await updateOperatorAccountStatus(actor, data.viewer.id, { status: "ACTIVE", expectedAuthRevision: suspended.authRevision, reason: "USER_REQUEST" });
  await assert.rejects(querySearchCase(data, data.viewer), /SESSION_REVOKED/);
  assert.deepEqual(await consumeSearchCase(client, data), ["FAILED"]);
  assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "SEARCH_INDEX_SNAPSHOT_CHANGED");
}

export async function searchGrantTargets(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "grant-targets");
  await client.workspaceShareGrant.updateMany({ where: { workspaceId: data.workspace.id }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
  const base = { workspaceId: data.workspace.id, resourceOwnerUserId: data.member.id, grantedByUserId: data.member.id, resourceType: "NOTE" as const, resourceId: data.foreign.note.id };
  for (const [scope, access, expected] of [["USER", "VIEW", true], ["USER", "COACH", true], ["ROLE", "VIEW", false], ["WORKSPACE", "VIEW", true]] as const) {
    const grant = await client.workspaceShareGrant.create({ data: { ...base, scope, access,
      granteeUserId: scope === "USER" ? data.viewer.id : null, granteeRole: scope === "ROLE" ? "COACH" : null } });
    for (const enabled of ["true", "false"]) {
      process.env.SEARCH_INDEX_ENABLED = enabled;
      assert.equal((await querySearchCase(data, data.viewer)).results.some(row => row.id === data.foreign.note.id), expected);
    }
    await client.workspaceShareGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
  }
  process.env.SEARCH_INDEX_ENABLED = "true";
  const wrongOwner = await client.workspaceShareGrant.create({ data: { ...base, resourceOwnerUserId: data.owner.id, scope: "USER", granteeUserId: data.viewer.id, access: "VIEW" } });
  for (const enabled of ["true", "false"]) {
    process.env.SEARCH_INDEX_ENABLED = enabled;
    assert.equal((await querySearchCase(data, data.viewer)).results.some(row => row.id === data.foreign.note.id), false);
  }
  process.env.SEARCH_INDEX_ENABLED = "true";
  await client.workspaceShareGrant.update({ where: { id: wrongOwner.id }, data: { revokedAt: new Date() } });
  const membership = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.viewer.id } } });
  const coach = await updateWorkspaceMemberRole(data.owner, data.workspace.id, membership.id, "COACH", membership.revision);
  for (const access of ["VIEW", "COACH"] as const) {
    const grant = await client.workspaceShareGrant.create({ data: { ...base, scope: "ROLE", granteeRole: "COACH", access } });
    for (const enabled of ["true", "false"]) {
      process.env.SEARCH_INDEX_ENABLED = enabled;
      assert.ok((await querySearchCase(data, data.viewer)).results.some(row => row.id === data.foreign.note.id));
    }
    await client.workspaceShareGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  }
  process.env.SEARCH_INDEX_ENABLED = "true";
  await updateWorkspaceMemberRole(data.owner, data.workspace.id, membership.id, "VIEWER", coach.revision);
}

export async function searchGrantExpiryAtReturn(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "expiry-return"); const expiresAt = new Date(Date.now() + 500);
  await client.workspaceShareGrant.update({ where: { id: data.grants[0]!.id }, data: { expiresAt, revision: { increment: 1 } } });
  await client.$transaction(async tx => {
    const scope = await captureSearchScope(tx, data.viewer.id, data.workspace.id, { env: process.env, sessionId: data.viewer.sessionId, sourceOnly: true });
    const rows = await searchSourceRows(tx, scope, "NOTE", { take: 31, titles: true, query: "SEARCH 他人笔记" });
    assert.equal(rows.length, 1); assert.equal(scope.validUntil?.getTime(), expiresAt.getTime());
    await delay(Math.max(0, expiresAt.getTime() - Date.now()) + 20);
    await assert.rejects(assertSearchScopeTime(tx, scope), /AUTHORIZATION_EXPIRED/);
  }, { isolationLevel: "Serializable", timeout: 15_000 });
}

export async function searchExportRedaction(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "export-redaction"); const job = await requestSearchCase(client, data);
  assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
  for (const scope of ["ACCOUNT", "WORKSPACE"] as const) {
    const records = await collectDataExportRecords(client, { actor: data.owner, workspaceIds: [data.workspace.id], scope, includeData: true });
    const encoded = JSON.stringify(records);
    for (const forbidden of [data.foreign.note.title, data.foreign.mistake.title, "workspaceSearchPartition", "workspaceSearchDocument", "sourceFingerprint", "sourceRevision"]) assert.equal(encoded.includes(forbidden), false);
    assert.ok(encoded.includes(data.own.note.title)); assert.ok(records.some(row => row.kind === "dataJob" && row.id === job.id));
  }
}

export async function searchDeadLetterReplay(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "dead-letter"); const job = await requestSearchCase(client, data);
  await client.dataJob.update({ where: { id: job.id }, data: { maxAttempts: 1 } });
  await runDataJobWorker({ enabled: true, client, workerId: `search-failure-${randomUUID()}`, once: true, signal: new AbortController().signal,
    partition: { workspaceId: data.workspace.id }, handlers: [{ kind: "SEARCH_INDEX_REBUILD", prepare: async () => { throw new DataJobHandlerError("SEARCH_SYNTHETIC_RETRY", true); } }] });
  const failed = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } }); assert.ok(failed.deadLetteredAt); assert.equal(failed.attempt, 1);
  assert.deepEqual(await consumeSearchCase(client, data), []);
  await controlWorkspaceSearchIndex(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, workspaceId: data.workspace.id,
    jobId: job.id, expectedRevision: failed.updatedAt.getTime(), action: "REPLAY" });
  assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
}
