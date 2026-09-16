import assert from "node:assert/strict";
import { enqueueDataJobInTransaction, enqueueWorkspaceSearchIndex, isDataJobScopeBusy, type PrismaClient } from "../../packages/db/src/index";
import { checkWorkspaceMemberQuotaAdmission } from "../../packages/db/src/workspace-member-quota";
import { acceptWorkspaceInvitation, leaveWorkspace } from "../../apps/web/lib/workspace/membership-service";
import { throwSearchIndexApiError } from "../../apps/web/lib/system/workspace-search-index-service";
import { throwRankingRebuildApiError } from "../../apps/web/lib/ranking/rebuild-service";
import { throwDataExportAdmissionApiError } from "../../apps/web/lib/system/data-export-runtime-service";
import { ApiError } from "../../apps/web/lib/api/responses";
import type { CapacityFixture } from "./capacity-fixture";
import { createCapacityCase, requestCapacityCase, seedCapacityInvitation, withCapacityPolicy, settleCapacityCase, capacityQueueInput,
  capacityRuntimeCode, retryCapacityFixture, createAdmissionActor } from "./capacity-runtime-data";
import { instrumentCapacityClient, capacitySignal, settleCapacityResults, waitCapacityBarrier } from "./capacity-transaction-fixture";

export async function capacityConcurrentDomains(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "domain-competition");
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "2", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "20",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "20" }, async () => {
    try {
      const attempts = (["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"] as const).map(kind =>
        retryCapacityFixture(() => requestCapacityCase(client, data, kind, { secondary: kind === "SEARCH_INDEX_REBUILD", account: kind === "EXPORT" })));
      const results = await Promise.allSettled(attempts);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
      for (const result of results) if (result.status === "rejected") assert.equal(capacityRuntimeCode(result.reason), "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT");
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 2);
    } finally { await settleCapacityCase(client, data); }
  });
}

export async function capacityConcurrentSameKey(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "same-key"); const key = `${data.prefix}-same`;
  try {
    const rows = await settleCapacityResults(Array.from({ length: 6 }, () => retryCapacityFixture(() => requestCapacityCase(client, data, "EXPORT", { key }))));
    assert.equal(new Set(rows.map(row => row.id)).size, 1);
    assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 1);
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "DATA_JOB_ENQUEUED" } }), 1);
  } finally { await settleCapacityCase(client, data); }
}

export async function capacityOldJobSnapshot(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "old-job-snapshot"); const ready = capacitySignal(); const resume = capacitySignal();
  let databaseCode = "";
  const observed = instrumentCapacityClient(client, { before: async tx => {
    await tx.$queryRaw`SELECT COUNT(*) FROM "DataJob"`; ready.release(); await resume.promise;
  }, onError: error => { databaseCode = capacityRuntimeCode(error); } });
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "20", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "20",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "1" }, async () => {
    const stale = enqueueWorkspaceSearchIndex(observed, { actorId: data.member.id, sessionId: data.member.sessionId!, workspaceId: data.workspace.id,
      expectedGeneration: 0, idempotencyKey: `${data.prefix}-old` }).then(() => "UNEXPECTED_SUCCESS", capacityRuntimeCode);
    try {
      await waitCapacityBarrier(ready.promise, stale); await requestCapacityCase(client, data, "EXPORT", { account: true }); resume.release();
      assert.notEqual(await stale, "UNEXPECTED_SUCCESS"); assert.ok(["40001", "P2034"].includes(databaseCode), `OLD_SNAPSHOT_MUST_ABORT_${databaseCode}`);
      assert.equal(await client.workspaceSearchPartition.count({ where: { userId: data.member.id } }), 0);
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: { in: [data.owner.id, data.member.id] } } }), 1);
    } finally { resume.release(); await stale; await settleCapacityCase(client, data); }
  });
}

export async function capacityOldMemberSnapshot(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "old-member-snapshot");
  const membership = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await leaveWorkspace(data.member, data.workspace.id, membership.revision);
  const first = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.stranger.email });
  const second = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.member.email });
  const ready = capacitySignal(); const resume = capacitySignal(); let databaseCode = "";
  const observed = instrumentCapacityClient(client, { before: async tx => {
    await tx.$queryRaw`SELECT COUNT(*) FROM "WorkspaceMembership" WHERE "workspaceId"=${data.workspace.id}`;
    ready.release(); await resume.promise;
  }, onError: error => { databaseCode = capacityRuntimeCode(error); } });
  const stale = acceptWorkspaceInvitation({ token: first.token, actor: data.stranger }, observed).then(() => "UNEXPECTED_SUCCESS", capacityRuntimeCode);
  try {
    await waitCapacityBarrier(ready.promise, stale); await acceptWorkspaceInvitation({ token: second.token, actor: data.member }); resume.release();
    assert.equal(await stale, "WORKSPACE_MEMBER_QUOTA_BUSY");
    assert.ok(["40001", "P2034"].includes(databaseCode), `OLD_MEMBER_SNAPSHOT_MUST_ABORT_${databaseCode}`);
    assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
    assert.equal((await client.workspaceInvitation.findUniqueOrThrow({ where: { id: first.invitation.id } })).status, "PENDING");
  } finally { resume.release(); await stale; }
}

export async function capacityConcurrentMembers(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "members-concurrent");
  const member = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await leaveWorkspace(data.member, data.workspace.id, member.revision);
  const actors = await Promise.all(Array.from({ length: 5 }, (_, i) => createAdmissionActor(client, `${data.prefix}-guest-${i}@example.test`, "synthetic-not-login")));
  const invitations = await Promise.all(actors.map(actor => seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: actor.email })));
  const results = await Promise.allSettled(actors.map((actor, i) => retryCapacityFixture(() => acceptWorkspaceInvitation({ token: invitations[i]!.token, actor }))));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.equal(capacityRuntimeCode(result.reason), "WORKSPACE_MEMBER_QUOTA_LIMIT");
  assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
  assert.equal(await client.workspaceInvitation.count({ where: { workspaceId: data.workspace.id, status: "ACCEPTED" } }), 1);
}

export async function capacityIsolationAndAtomicAbort(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "isolation-abort"); const input = capacityQueueInput(data);
  for (const isolationLevel of ["ReadCommitted", "RepeatableRead"] as const) {
    await assert.rejects(client.$transaction(tx => enqueueDataJobInTransaction(tx, input), { isolationLevel }), { code: "DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED" });
    await assert.rejects(client.$transaction(tx => checkWorkspaceMemberQuotaAdmission(tx, { workspaceId: data.workspace.id, userId: data.stranger.id }),
      { isolationLevel }), { code: "WORKSPACE_MEMBER_QUOTA_ISOLATION_UNSUPPORTED" });
  }
  await assert.rejects(client.$transaction(async tx => { await enqueueDataJobInTransaction(tx, input); throw new Error("CAPACITY_SYNTHETIC_ABORT"); },
    { isolationLevel: "Serializable" }), /CAPACITY_SYNTHETIC_ABORT/);
  assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 0);
  assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "DATA_JOB_ENQUEUED" } }), 0);
}

export async function capacityDatabaseErrorShapes(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "sql-errors");
  const timeout = await client.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '20ms'`; await tx.$queryRaw`SELECT pg_sleep(0.2)`;
  }).then(() => null, error => error);
  assert.equal(capacityRuntimeCode(timeout), "57014"); assert.equal(isDataJobScopeBusy(timeout), true);
  for (const mapper of [throwSearchIndexApiError, throwRankingRebuildApiError]) {
    assert.throws(() => mapper(timeout), error => error instanceof ApiError && error.status === 503);
  }
  assert.throws(() => throwDataExportAdmissionApiError(timeout, true), { code: "DATA_JOB_QUOTA_BUSY", status: 503 });
  assert.throws(() => throwDataExportAdmissionApiError(timeout, false), { status: 503 });
  const invitation = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.stranger.email });
  const timedOut = instrumentCapacityClient(client, { before: async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '20ms'`; await tx.$queryRaw`SELECT pg_sleep(0.2)`;
  } });
  await assert.rejects(acceptWorkspaceInvitation({ token: invitation.token, actor: data.stranger }, timedOut), { code: "WORKSPACE_MEMBER_QUOTA_BUSY", status: 503 });
  assert.equal((await client.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.invitation.id } })).status, "PENDING");
  const locked = capacitySignal(); const release = capacitySignal();
  const holder = client.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "User" WHERE id=${data.owner.id} FOR UPDATE`; locked.release(); await release.promise; });
  try {
    await waitCapacityBarrier(locked.promise, holder);
    const busy = await client.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '20ms'`; await tx.$queryRaw`SELECT id FROM "User" WHERE id=${data.owner.id} FOR UPDATE`;
    }).then(() => null, error => error);
    assert.equal(capacityRuntimeCode(busy), "55P03"); assert.equal(isDataJobScopeBusy(busy), true);
    assert.throws(() => throwDataExportAdmissionApiError(busy, true), { code: "DATA_JOB_QUOTA_BUSY", status: 503 });
    assert.throws(() => throwDataExportAdmissionApiError(busy, false), { code: "DATA_EXPORT_SCOPE_BUSY", status: 409 });
  } finally { release.release(); await holder; }
}
