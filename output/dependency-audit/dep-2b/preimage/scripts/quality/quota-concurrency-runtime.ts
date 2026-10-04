import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { enqueueDataJob, enqueueDataJobInTransaction, type EnqueueDataJobInput, type PrismaClient } from "../../packages/db/src/index";
import { createQuotaCase, requestQuotaCase, withQuotaPolicy, quotaKinds, type QuotaCase, type QuotaKind } from "./quota-runtime-data";
import type { QuotaFixture } from "./quota-fixture";
import { quotaRuntimeCode, retryQuotaFixture } from "./quota-runtime-support";

export function quotaTestInput(data: QuotaCase, kind: QuotaKind, key = randomUUID()): EnqueueDataJobInput {
  return { kind, scope: "WORKSPACE", requestedByUserId: data.owner.id, workspaceId: data.workspace.id,
    idempotencyKey: key, requestFingerprint: `sha256:${"a".repeat(64)}`, expiresAt: new Date(Date.now() + 60_000) };
}

async function assertAccepted(client: PrismaClient, data: QuotaCase, expected: number) {
  assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), expected);
  assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "DATA_JOB_ENQUEUED" } }), expected);
}

export async function quotaConcurrentDomains(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "parallel-domains");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "2" }, async () => {
    const results = await Promise.allSettled(quotaKinds.map(kind => {
      const key = randomUUID(); return retryQuotaFixture(() => requestQuotaCase(client, data, kind, { key }));
    }));
    assert.equal(results.filter(row => row.status === "fulfilled").length, 2);
    for (const row of results) if (row.status === "rejected") assert.equal(quotaRuntimeCode(row.reason), "DATA_JOB_QUOTA_ACTIVE_LIMIT");
    await assertAccepted(client, data, 2);
  });
}

export async function quotaConcurrentKeys(client: PrismaClient, fixture: QuotaFixture, sameKey: boolean) {
  const data = await createQuotaCase(client, fixture, sameKey ? "same-key" : "different-keys"); const shared = randomUUID();
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: sameKey ? "1" : "3", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "100" }, async () => {
    const requests = Array.from({ length: 8 }, (_, index) => quotaTestInput(data, sameKey ? "EXPORT" : quotaKinds[index % 3]!, sameKey ? shared : randomUUID()));
    const results = await Promise.allSettled(requests.map(input => retryQuotaFixture(() => enqueueDataJob(client, input))));
    const accepted = results.flatMap(row => row.status === "fulfilled" ? [row.value] : []);
    assert.equal(accepted.length, sameKey ? 8 : 3); assert.equal(new Set(accepted.map(row => row.id)).size, sameKey ? 1 : 3);
    for (const row of results) if (row.status === "rejected") assert.equal(quotaRuntimeCode(row.reason), "DATA_JOB_QUOTA_ACTIVE_LIMIT");
    await assertAccepted(client, data, sameKey ? 1 : 3);
    if (sameKey) await assert.rejects(enqueueDataJob(client, { ...requests[0]!, workspaceId: data.secondary.workspace.id }), /IDEMPOTENCY_CONFLICT/);
  });
}

export async function quotaConcurrentExportWindow(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "export-burst");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "100", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "2" }, async () => {
    const requests = Array.from({ length: 6 }, () => quotaTestInput(data, "EXPORT"));
    const results = await Promise.allSettled(requests.map(input => retryQuotaFixture(() => enqueueDataJob(client, input))));
    assert.equal(results.filter(row => row.status === "fulfilled").length, 2);
    for (const row of results) if (row.status === "rejected") assert.equal(quotaRuntimeCode(row.reason), "DATA_JOB_QUOTA_EXPORT_LIMIT");
    await assertAccepted(client, data, 2);
  });
}

export async function quotaOldSnapshot(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "old-snapshot");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "100" }, async () => {
    let ready!: () => void; let resume!: () => void;
    const snapshot = new Promise<void>(resolve => { ready = resolve; }); const release = new Promise<void>(resolve => { resume = resolve; });
    const input = quotaTestInput(data, "SEARCH_INDEX_REBUILD");
    const older = client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${data.owner.id}`;
      ready(); await release; return enqueueDataJobInTransaction(tx, input);
    }, { isolationLevel: "Serializable", timeout: 15_000 }).then(() => "UNEXPECTED_SUCCESS", quotaRuntimeCode);
    await snapshot;
    try { await enqueueDataJob(client, quotaTestInput(data, "EXPORT")); } finally { resume(); }
    const result = await older;
    console.log(`OBSERVE quota-old-snapshot:${result}`);
    assert.ok(["P2034", "40001"].includes(result), "QUOTA_OLD_SNAPSHOT_MUST_ABORT");
    await assert.rejects(enqueueDataJob(client, input), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    await assertAccepted(client, data, 1);
  });
}

export async function quotaIsolationAndRollback(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "transaction-contract"); const input = quotaTestInput(data, "EXPORT");
  for (const isolationLevel of ["ReadCommitted", "RepeatableRead"] as const) {
    await assert.rejects(client.$transaction(tx => enqueueDataJobInTransaction(tx, input), { isolationLevel }), { code: "DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED" });
  }
  await assertAccepted(client, data, 0);
  await assert.rejects(client.$transaction(async tx => {
    await enqueueDataJobInTransaction(tx, input); throw new Error("QUOTA_SIMULATED_ABORT");
  }, { isolationLevel: "Serializable" }), /QUOTA_SIMULATED_ABORT/);
  await assertAccepted(client, data, 0);
  assert.equal((await enqueueDataJob(client, input)).status, "QUEUED"); await assertAccepted(client, data, 1);
}

export async function quotaAdmissionClock(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "admission-clock");
  for (const enabled of ["true", "false"]) await withQuotaPolicy({ DATA_JOB_QUOTA_ENABLED: enabled }, async () => {
    await client.$transaction(async tx => {
      const [start] = await tx.$queryRaw<Array<{ value: Date }>>`SELECT transaction_timestamp() AS value`;
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.05)`;
      const row = await enqueueDataJobInTransaction(tx, quotaTestInput(data, "EXPORT"));
      const age = row.createdAt.getTime() - start!.value.getTime();
      if (enabled === "true") assert.ok(age >= 30, "QUOTA_ADMISSION_CLOCK_REQUIRED");
      else assert.ok(Math.abs(age) <= 1, "QUOTA_DISABLED_CLOCK_CHANGED");
    }, { isolationLevel: "Serializable" });
  });
}
