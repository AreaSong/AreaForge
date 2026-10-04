import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { claimQueuedDataJob, failQueuedDataJob, heartbeatQueuedDataJob, enqueueDataJob,
  type Prisma, type PrismaClient } from "../../packages/db/src/index";
import { checkDataJobQuotaAdmission } from "../../packages/db/src/data-job-quota";
import { createQuotaCase, requestQuotaCase, controlQuotaCase, withQuotaPolicy, quotaKinds, type QuotaCase, type QuotaKind } from "./quota-runtime-data";
import type { QuotaFixture } from "./quota-fixture";

export async function quotaDomainAdmission(client: PrismaClient, fixture: QuotaFixture, kind: QuotaKind) {
  const data = await createQuotaCase(client, fixture, `domain-${kind}`);
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1" }, async () => {
    const key = randomUUID(); const first = await requestQuotaCase(client, data, kind, { key });
    assert.equal(first.status, "QUEUED");
    const duplicate = await requestQuotaCase(client, data, kind, { key, generation: 0 }); assert.equal(duplicate.id, first.id);
    await assert.rejects(requestQuotaCase(client, data, kind), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 1);
    if (kind === "SEARCH_INDEX_REBUILD") {
      const partition = await client.workspaceSearchPartition.findUniqueOrThrow({ where: { userId_workspaceId: { userId: data.owner.id, workspaceId: data.workspace.id } } });
      assert.equal(partition.generation, 1);
    }
    await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "0", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "0" }, async () => {
      assert.equal((await requestQuotaCase(client, data, kind, { key, generation: 0 })).id, first.id);
      assert.equal((await controlQuotaCase(client, data, first.id, "PAUSE")).status, "PAUSED");
      assert.equal((await controlQuotaCase(client, data, first.id, "RESUME")).status, "QUEUED");
      assert.equal((await controlQuotaCase(client, data, first.id, "CANCEL")).status, "CANCELLED");
    });
    assert.equal((await requestQuotaCase(client, data, kind)).status, "QUEUED");
    assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 2);
  });
}

export async function quotaPartitions(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "partitions");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1" }, async () => {
    await requestQuotaCase(client, data, "EXPORT", { account: true });
    await requestQuotaCase(client, data, "EXPORT");
    await requestQuotaCase(client, data, "SEARCH_INDEX_REBUILD", { actor: data.member });
    await requestQuotaCase(client, data, "SEARCH_INDEX_REBUILD", { secondary: true });
    await assert.rejects(requestQuotaCase(client, data, "EXPORT", { account: true }), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    await assert.rejects(requestQuotaCase(client, data, "RANKING_REBUILD"), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    await assert.rejects(requestQuotaCase(client, data, "SEARCH_INDEX_REBUILD", { secondary: true }), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    assert.equal(await client.dataJob.count({ where: { requestedByUserId: { in: [data.owner.id, data.member.id] } } }), 4);
  });
}

export async function quotaDisabledAndInvalid(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "configuration");
  const accepted = await withQuotaPolicy({ DATA_JOB_QUOTA_ENABLED: "false", DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "0", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "0" },
    async () => { const rows = []; for (const kind of quotaKinds) rows.push(await requestQuotaCase(client, data, kind)); return rows; });
  for (const patch of [{ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: undefined }, { DATA_JOB_QUOTA_MAX_EXPORTS_24H: "1e3" }, { DATA_JOB_QUOTA_ENABLED: "TRUE" }]) {
    await withQuotaPolicy(patch, async () => {
      for (const kind of quotaKinds) await assert.rejects(requestQuotaCase(client, data, kind), { code: "DATA_JOB_QUOTA_CONFIG_INVALID" });
      for (const row of accepted) assert.equal((await requestQuotaCase(client, data, row.kind as QuotaKind, { key: row.idempotencyKey, generation: 0 })).id, row.id);
    });
  }
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "bad" }, async () => {
    for (const row of accepted) assert.equal((await controlQuotaCase(client, data, row.id, "CANCEL")).status, "CANCELLED");
  });
  assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 3);
}

export async function quotaAuthorizationFirst(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "authorization");
  const denied = (error: unknown) => error instanceof Error && !error.message.startsWith("DATA_JOB_QUOTA_");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "0", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "0" }, async () => {
    await assert.rejects(requestQuotaCase(client, data, "EXPORT", { actor: data.member }), denied);
    await assert.rejects(requestQuotaCase(client, data, "SEARCH_INDEX_REBUILD", { actor: data.stranger }), denied);
    await assert.rejects(requestQuotaCase(client, data, "RANKING_REBUILD", { actor: data.member }), denied);
  });
  assert.equal(await client.dataJob.count({ where: { workspaceId: data.workspace.id } }), 0);
  assert.equal(await client.workspaceSearchPartition.count({ where: { workspaceId: data.workspace.id } }), 0);
}

export async function quotaExportWindow(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "export-window");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "10", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "2" }, async () => {
    for (let count = 0; count < 2; count++) {
      const job = await requestQuotaCase(client, data, "EXPORT");
      await controlQuotaCase(client, data, job.id, "CANCEL");
    }
    await assert.rejects(requestQuotaCase(client, data, "EXPORT"), { code: "DATA_JOB_QUOTA_EXPORT_LIMIT" });
    assert.equal((await requestQuotaCase(client, data, "SEARCH_INDEX_REBUILD")).status, "QUEUED");
  });
}

/** 仅种植计数边界，不是可交付的领域成功记录，也不会被消费者执行。 */
export function seedQuotaCount(client: PrismaClient, data: QuotaCase,
  patch: Partial<Pick<Prisma.DataJobUncheckedCreateInput, "kind" | "status" | "createdAt" | "expiresAt" | "queueVersion" | "deadLetteredAt" | "retryable">> = {}) {
  return client.dataJob.create({ data: { kind: "EXPORT", scope: "WORKSPACE", workspaceId: data.workspace.id, requestedByUserId: data.owner.id,
    queueVersion: 1, idempotencyKey: randomUUID(), requestFingerprint: `sha256:${randomBytes(32).toString("hex")}`,
    expiresAt: new Date(Date.now() + 3_600_000), ...patch } });
}

export async function quotaTimeBoundary(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "clock-window"); const now = new Date();
  await seedQuotaCount(client, data, { status: "SUCCEEDED", createdAt: new Date(now.getTime() - 86_400_000) });
  const inside = await seedQuotaCount(client, data, { status: "CANCELLED", createdAt: new Date(now.getTime() - 86_400_000 + 1) });
  await seedQuotaCount(client, data, { status: "FAILED", expiresAt: new Date(now.getTime() - 1), createdAt: new Date(now.getTime() + 3_600_000) });
  const input = { kind: "EXPORT" as const, scope: "WORKSPACE" as const, workspaceId: data.workspace.id, requestedByUserId: data.owner.id };
  const env = { ...process.env, DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "2" };
  const check = () => client.$transaction(tx => checkDataJobQuotaAdmission(fixedClock(tx, now), input, env), { isolationLevel: "Serializable" });
  await assert.rejects(check(), { code: "DATA_JOB_QUOTA_EXPORT_LIMIT" });
  await client.dataJob.update({ where: { id: inside.id }, data: { createdAt: new Date(now.getTime() - 86_400_000) } });
  assert.equal((await check())?.getTime(), now.getTime());
}

function fixedClock(tx: Prisma.TransactionClient, now: Date): Prisma.TransactionClient {
  return new Proxy(tx, { get(target, key) {
    if (key !== "$queryRaw") return Reflect.get(target, key);
    return (sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const text = Array.isArray(sql) ? sql.join("?") : (sql as Prisma.Sql).sql;
      return text.includes('SELECT clock_timestamp() AS "now"') ? Promise.resolve([{ now }]) : target.$queryRaw(sql, ...values);
    };
  } });
}

export async function quotaActiveStates(client: PrismaClient, fixture: QuotaFixture) {
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "100" }, async () => {
    for (const status of ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED", "FAILED"] as const) {
      const data = await createQuotaCase(client, fixture, `state-${status}`);
      await seedQuotaCount(client, data, { status, deadLetteredAt: status === "FAILED" ? new Date() : null });
      await assert.rejects(requestQuotaCase(client, data, "SEARCH_INDEX_REBUILD"), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    }
    for (const patch of [{ status: "SUCCEEDED" as const }, { status: "CANCELLED" as const }, { expiresAt: new Date(Date.now() - 1000) }, { queueVersion: 0 }]) {
      const data = await createQuotaCase(client, fixture, "released"); await seedQuotaCount(client, data, patch);
      assert.equal((await requestQuotaCase(client, data, "SEARCH_INDEX_REBUILD")).status, "QUEUED");
    }
  });
}

export async function quotaFailureReplayAndCancel(client: PrismaClient, fixture: QuotaFixture, kind: QuotaKind) {
  const data = await createQuotaCase(client, fixture, `replay-${kind}`);
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1" }, async () => {
    const job = await requestQuotaCase(client, data, kind);
    const claim = () => claimQueuedDataJob(client, { workerId: "quota-fixture-state", kinds: [kind], leaseMs: 30_000,
      partition: { workspaceId: data.workspace.id, requestedByUserId: data.owner.id } });
    const lease = await claim(); assert.ok(lease);
    assert.equal(await failQueuedDataJob(client, { lease, errorCode: "QUOTA_FIXTURE_FAILURE", retryable: false }), "FAILED");
    await assert.rejects(requestQuotaCase(client, data, kind), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    assert.equal((await controlQuotaCase(client, data, job.id, "REPLAY")).status, "QUEUED");
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).createdAt.getTime(), job.createdAt.getTime());
    const replayed = await claim(); assert.ok(replayed);
    assert.equal((await controlQuotaCase(client, data, job.id, "CANCEL")).status, "CANCEL_REQUESTED");
    await assert.rejects(requestQuotaCase(client, data, kind), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
    assert.equal(await heartbeatQueuedDataJob(client, { lease: replayed, leaseMs: 30_000 }), "CANCELLED");
    assert.equal((await requestQuotaCase(client, data, kind)).status, "QUEUED");
  });
}

export async function quotaNonTarget(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "non-target");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "0", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "0" }, async () => {
    for (const kind of ["NOTIFICATION", "DELETE"] as const) assert.equal((await enqueueDataJob(client, { kind, scope: "WORKSPACE",
      workspaceId: data.workspace.id, requestedByUserId: data.owner.id, idempotencyKey: randomUUID(), requestFingerprint: `sha256:${"a".repeat(64)}`,
      expiresAt: new Date(Date.now() + 60_000) })).status, "QUEUED");
  });
}

export async function quotaNoDomainEffects(client: PrismaClient, fixture: QuotaFixture) {
  for (const model of [client.dataExportPackage, client.dataExportArtifact, client.workspaceSearchDocument, client.rankingProjection, client.attachment]) {
    assert.equal(await (model.count as () => Promise<number>)(), 0);
  }
  assert.deepEqual(readdirSync(path.join(fixture.root, "uploads")), []); assert.deepEqual(readdirSync(path.join(fixture.root, "exports")), []);
  assert.equal(await client.auditEvent.count({ where: { action: { in: ["SEARCH_INDEX_REBUILT", "RANKING_PROJECTION_REBUILT"] } } }), 0);
}
