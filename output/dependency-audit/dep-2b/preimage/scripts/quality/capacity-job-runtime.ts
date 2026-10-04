import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { enqueueDataJob, claimQueuedDataJob, failQueuedDataJob, prisma, type PrismaClient } from "../../packages/db/src/index";
import type { CapacityFixture } from "./capacity-fixture";
import { createCapacityCase, requestCapacityCase, controlCapacityCase, withCapacityPolicy, settleCapacityCase,
  capacityQueueInput, capacityRuntimeCode, type CapacityKind } from "./capacity-runtime-data";
import { withCapacityFrozenRows } from "./capacity-frozen-fixture";

export async function capacityUserTotal(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "user-total");
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "20", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "20" }, async () => {
    try {
      const first = await requestCapacityCase(client, data, "EXPORT", { account: true });
      await requestCapacityCase(client, data, "SEARCH_INDEX_REBUILD", { secondary: true });
      await assert.rejects(requestCapacityCase(client, data, "RANKING_REBUILD"), { code: "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" });
      await controlCapacityCase(client, data, first.id, "CANCEL");
      assert.equal((await requestCapacityCase(client, data, "RANKING_REBUILD")).status, "QUEUED");
    } finally { await settleCapacityCase(client, data); }
  });
}

export async function capacityWorkspaceTotal(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "workspace-total");
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "20", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "2",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "20" }, async () => {
    try {
      await requestCapacityCase(client, data, "EXPORT");
      await requestCapacityCase(client, data, "SEARCH_INDEX_REBUILD", { actor: data.member });
      await assert.rejects(requestCapacityCase(client, data, "RANKING_REBUILD"), { code: "DATA_JOB_QUOTA_WORKSPACE_ACTIVE_LIMIT" });
      assert.equal((await requestCapacityCase(client, data, "EXPORT", { account: true })).status, "QUEUED");
    } finally { await settleCapacityCase(client, data); }
  });
}

export async function capacityInstanceTotal(client: PrismaClient, fixture: CapacityFixture) {
  const first = await createCapacityCase(client, fixture, "instance-first"); const second = await createCapacityCase(client, fixture, "instance-second");
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "20", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "20",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "2" }, async () => {
    try {
      await requestCapacityCase(client, first, "EXPORT", { account: true });
      await requestCapacityCase(client, second, "RANKING_REBUILD");
      await assert.rejects(requestCapacityCase(client, first, "SEARCH_INDEX_REBUILD", { actor: first.member }), { code: "DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT" });
      assert.equal(await client.workspaceSearchPartition.count({ where: { userId: first.member.id } }), 0);
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: { in: [first.owner.id, first.member.id, second.owner.id] } } }), 2);
    } finally { await settleCapacityCase(client, first); await settleCapacityCase(client, second); }
  });
}

export async function capacitySwitchCombinations(client: PrismaClient, fixture: CapacityFixture) {
  for (const old of ["false", "true"]) for (const total of ["false", "true"]) {
    const data = await createCapacityCase(client, fixture, `switch-${old}-${total}`);
    await withCapacityPolicy({ DATA_JOB_QUOTA_ENABLED: old, DATA_JOB_TOTAL_QUOTA_ENABLED: total, DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1",
      DATA_JOB_QUOTA_MAX_EXPORTS_24H: "100", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "1", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "100",
      DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "100" }, async () => {
      try {
        await requestCapacityCase(client, data, "EXPORT");
        const second = () => requestCapacityCase(client, data, "RANKING_REBUILD");
        if (old === "false" && total === "false") assert.equal((await second()).status, "QUEUED");
        else await assert.rejects(second(), { code: total === "true" ? "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" : "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
      } finally { await settleCapacityCase(client, data); }
    });
  }
}

export async function capacityPartitionRollback(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "partition-rejection");
  await withCapacityPolicy({ DATA_JOB_QUOTA_ENABLED: "true", DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "0", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "100" }, async () => {
    await assert.rejects(requestCapacityCase(client, data, "SEARCH_INDEX_REBUILD"), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 0);
    assert.equal(await client.workspaceSearchPartition.count({ where: { userId: data.owner.id } }), 0);
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "DATA_JOB_ENQUEUED" } }), 0);
  });
}

export async function capacityInvalidAndExisting(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "invalid-existing"); const key = randomUUID();
  try {
    const row = await requestCapacityCase(client, data, "EXPORT", { key });
    for (const patch of [{ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "bad" }, { DATA_JOB_TOTAL_QUOTA_ENABLED: "INVALID" },
      { DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: undefined }]) {
      await withCapacityPolicy(patch, async () => {
        await assert.rejects(requestCapacityCase(client, data, "SEARCH_INDEX_REBUILD"), { code: "DATA_JOB_QUOTA_CONFIG_INVALID" });
        assert.equal((await requestCapacityCase(client, data, "EXPORT", { key })).id, row.id);
      });
    }
    await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "0" }, async () => {
      assert.equal((await requestCapacityCase(client, data, "EXPORT", { key })).id, row.id);
      await controlCapacityCase(client, data, row.id, "CANCEL");
      await assert.rejects(requestCapacityCase(client, data, "EXPORT"), { code: "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" });
    });
  } finally { await settleCapacityCase(client, data); }
}

export async function capacityStatesAndExpiry(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "states");
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "1", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "100",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "100" }, async () => {
    try {
      const row = await requestCapacityCase(client, data, "EXPORT");
      for (const status of ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED", "FAILED"] as const) {
        await client.dataJob.update({ where: { id: row.id }, data: { status, expiresAt: new Date(Date.now() + 3_600_000) } });
        await assert.rejects(requestCapacityCase(client, data, "SEARCH_INDEX_REBUILD"), { code: "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" });
      }
      await client.dataJob.update({ where: { id: row.id }, data: { expiresAt: new Date(0) } });
      assert.equal((await requestCapacityCase(client, data, "RANKING_REBUILD")).status, "QUEUED");
    } finally { await settleCapacityCase(client, data); }
  });
}

export async function capacityFrozenJobs(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "frozen-job");
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "1" }, async () => {
    try {
      const row = await requestCapacityCase(client, data, "EXPORT");
      await withCapacityFrozenRows(client, { id: data.owner.id, sessionId: data.owner.sessionId! }, [{ model: "DataJob", id: row.id }], async () => {
        assert.equal(await prisma.dataJob.count({ where: { id: row.id } }), 0);
        await assert.rejects(requestCapacityCase(client, data, "SEARCH_INDEX_REBUILD"), { code: "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" });
      });
      assert.equal(await prisma.dataJob.count({ where: { id: row.id } }), 1);
      await controlCapacityCase(client, data, row.id, "CANCEL");
      assert.equal((await requestCapacityCase(client, data, "RANKING_REBUILD")).status, "QUEUED");
    } finally { await settleCapacityCase(client, data); }
  });
}

export async function capacityExistingControls(client: PrismaClient, fixture: CapacityFixture, kind: CapacityKind) {
  const data = await createCapacityCase(client, fixture, `controls-${kind}`);
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "1" }, async () => {
    try {
      const row = await requestCapacityCase(client, data, kind);
      const claim = () => claimQueuedDataJob(client, { workerId: "capacity-control-fixture", kinds: [kind], leaseMs: 30_000,
        partition: { requestedByUserId: data.owner.id } });
      let lease = await claim(); assert.ok(lease);
      await controlCapacityCase(client, data, row.id, "PAUSE");
      assert.equal(await failQueuedDataJob(client, { lease, errorCode: "CAPACITY_SYNTHETIC_PAUSE", retryable: false }), "PAUSED");
      await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "bad" }, () => controlCapacityCase(client, data, row.id, "RESUME"));
      lease = await claim(); assert.ok(lease);
      assert.equal(await failQueuedDataJob(client, { lease, errorCode: "CAPACITY_SYNTHETIC_FAILURE", retryable: false }), "FAILED");
      await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "bad" }, () => controlCapacityCase(client, data, row.id, "REPLAY"));
      lease = await claim(); assert.ok(lease);
      await controlCapacityCase(client, data, row.id, "CANCEL");
      assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: row.id } })).status, "CANCEL_REQUESTED");
      await assert.rejects(requestCapacityCase(client, data, kind), { code: "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" });
      assert.equal(await failQueuedDataJob(client, { lease, errorCode: "CAPACITY_SYNTHETIC_CANCEL", retryable: false }), "CANCELLED");
      assert.equal((await requestCapacityCase(client, data, kind)).status, "QUEUED");
    } finally { await settleCapacityCase(client, data); }
  });
}

export async function capacityAuthorizationAndKinds(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "auth-kinds");
  try {
    await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "0" }, async () => {
      for (const kind of ["SEARCH_INDEX_REBUILD", "RANKING_REBUILD"] as const) {
        await assert.rejects(requestCapacityCase(client, data, kind, { actor: data.stranger }), error => !capacityRuntimeCode(error).startsWith("DATA_JOB_QUOTA_"));
      }
      for (const kind of ["NOTIFICATION", "DELETE"] as const) {
        assert.equal((await enqueueDataJob(client, { ...capacityQueueInput(data), kind })).kind, kind);
      }
    });
    await client.dataJob.create({ data: { ...capacityQueueInput(data), status: "QUEUED", queueVersion: 0 } });
    await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "1" }, async () => {
      assert.equal((await requestCapacityCase(client, data, "EXPORT")).status, "QUEUED");
    });
  } finally { await settleCapacityCase(client, data); }
}

export async function capacityNoConsumers(client: PrismaClient, fixture: CapacityFixture) {
  for (const directory of ["uploads", "exports"]) assert.deepEqual(readdirSync(path.join(fixture.root, directory)), []);
  assert.equal(await client.dataExportPackage.count(), 0); assert.equal(await client.dataExportArtifact.count(), 0);
  assert.equal(await client.workspaceSearchDocument.count(), 0); assert.equal(await client.rankingProjection.count(), 0);
  assert.equal(await client.dataDeletionFile.count(), 0); assert.equal(await client.dataDeletionLedger.count(), 0);
  assert.equal(await client.dataDeletionIntent.count({ where: { irreversibleAt: { not: null } } }), 0);
  assert.equal(await client.controlledOperationRequest.count(), 0);
}
