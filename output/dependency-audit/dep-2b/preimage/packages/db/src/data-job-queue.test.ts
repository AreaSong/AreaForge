import assert from "node:assert/strict";
import test from "node:test";
import { assertQueueLease, partitionWhere, queueIdentifier, validateQueueKinds } from "./data-job-queue-store";
import { derivedQueueVisibleSql, guardDerivedQueueTransaction } from "./data-job-derived-guard";
import type { DataJobLease, DataQueueTransaction, QueuedDataJob } from "./data-job-queue-types";

const now = new Date("2026-09-08T00:00:00Z");
const lease: DataJobLease = {
  jobId: "job-1", kind: "NOTIFICATION", scope: "WORKSPACE", requestedByUserId: "user-1", workspaceId: "workspace-1",
  workerId: "worker-1", leaseVersion: 2, attempt: 2, leaseExpiresAt: new Date(now.getTime() + 30_000),
  payloadJson: null,
};
const row = {
  id: lease.jobId, kind: lease.kind, scope: lease.scope, requestedByUserId: lease.requestedByUserId, workspaceId: lease.workspaceId,
  leaseOwner: lease.workerId, leaseVersion: lease.leaseVersion, leaseExpiresAt: lease.leaseExpiresAt,
  expiresAt: new Date(now.getTime() + 60_000), status: "RUNNING",
} as QueuedDataJob;

test("租约 fence 绑定任务、代次、执行者和完整 scope，不信任客户端 expiry", () => {
  assert.doesNotThrow(() => assertQueueLease(row, lease, now));
  for (const forged of [
    { ...lease, leaseVersion: 1 }, { ...lease, workerId: "other" }, { ...lease, jobId: "other" },
    { ...lease, workspaceId: "other" }, { ...lease, requestedByUserId: "other" }, { ...lease, scope: "ACCOUNT" as const },
  ]) assert.throws(() => assertQueueLease(row, forged, now), /DATA_JOB_LEASE_LOST/);
  assert.throws(() => assertQueueLease({ ...row, status: "SUCCEEDED" }, lease, now));
  assert.throws(() => assertQueueLease({ ...row, leaseExpiresAt: now }, { ...lease, leaseExpiresAt: new Date("2099-01-01") }, now));
  assert.throws(() => assertQueueLease({ ...row, expiresAt: now }, lease, now));
});

test("队列分区和处理器种类拒绝自由路径及空列表", () => {
  for (const value of ["", "../escape", "x y"]) assert.throws(() => queueIdentifier(value));
  assert.throws(() => validateQueueKinds([]));
  assert.throws(() => validateQueueKinds(["NOTIFICATION", "NOTIFICATION"]));
  assert.throws(() => validateQueueKinds(["SHELL"]));
  assert.deepEqual(partitionWhere({ workspaceId: null }), { workspaceId: null, requestedByUserId: undefined });
  assert.throws(() => partitionWhere({ workspaceId: "../other" }));
});

function derivedGuardFixture(options: { acquired?: boolean; frozen?: number } = {}) {
  const calls: string[] = [];
  const fenceQueries: unknown[] = [];
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray) => { calls.push(sql.join("?")); return 0; },
    $queryRaw: async (sql: TemplateStringsArray) => {
      calls.push(sql.join("?"));
      return [{ acquired: options.acquired ?? true }];
    },
    dataDeletionFence: { count: async (query: unknown) => {
      calls.push("fence"); fenceQueries.push(query); return options.frozen ?? 0;
    } },
  } as unknown as DataQueueTransaction;
  return { tx, calls, fenceQueries };
}

for (const kind of ["RANKING_REBUILD", "SEARCH_INDEX_REBUILD"]) {
  test(`${kind} 在读取任务冻结前获取有界删除共享屏障`, async () => {
    const fixture = derivedGuardFixture();
    await guardDerivedQueueTransaction(fixture.tx, [kind], "job-1");
    assert.equal(fixture.calls.length, 3);
    assert.match(fixture.calls[0]!, /SET LOCAL lock_timeout = '250ms'/);
    assert.match(fixture.calls[1]!, /pg_try_advisory_xact_lock_shared/);
    assert.equal(fixture.calls[2], "fence");
    assert.deepEqual(fixture.fenceQueries, [{ where: { model: "DataJob", keyJson: { path: ["id"], equals: "job-1" } } }]);
  });

  test(`${kind} 在屏障占用或任务被冻结时拒绝继续`, async () => {
    const busy = derivedGuardFixture({ acquired: false });
    await assert.rejects(guardDerivedQueueTransaction(busy.tx, [kind], "job-1"), { code: "DATA_JOB_SCOPE_BUSY" });
    assert.equal(busy.calls.length, 2);
    assert.deepEqual(busy.fenceQueries, []);
    const frozen = derivedGuardFixture({ frozen: 1 });
    await assert.rejects(guardDerivedQueueTransaction(frozen.tx, [kind], "job-1"), { code: "DATA_JOB_SCOPE_BUSY" });
  });

  test(`${kind} 领取与恢复查询排除被冻结的派生任务`, () => {
    const filter = derivedQueueVisibleSql([kind]);
    assert.match(filter.sql, /NOT EXISTS[\s\S]*DataDeletionFence[\s\S]*DataJob/);
    assert.deepEqual(filter.values, ["RANKING_REBUILD", "SEARCH_INDEX_REBUILD"]);
  });
}

test("非派生任务保留原路径，混合队列仍启用派生屏障", async () => {
  const unrelated = derivedGuardFixture();
  await guardDerivedQueueTransaction(unrelated.tx, ["NOTIFICATION", "EXPORT"], "job-1");
  assert.deepEqual(unrelated.calls, []);
  assert.equal(derivedQueueVisibleSql(["NOTIFICATION", "EXPORT"]).sql, "");
  const mixed = derivedGuardFixture();
  await guardDerivedQueueTransaction(mixed.tx, ["NOTIFICATION", "SEARCH_INDEX_REBUILD"]);
  assert.equal(mixed.calls.length, 2);
  assert.deepEqual(mixed.fenceQueries, []);
});
