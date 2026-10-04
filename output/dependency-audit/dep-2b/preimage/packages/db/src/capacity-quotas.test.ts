import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client";
import { checkDataJobQuotaAdmission } from "./data-job-quota";
import { checkDataJobTotalQuotaAdmission } from "./data-job-total-quota";
import { checkWorkspaceMemberQuotaAdmission } from "./workspace-member-quota";
import { enqueueDataJob, enqueueDataJobInTransaction } from "./data-job-queue";
import type { DataQueueClient, DataQueueTransaction, EnqueueDataJobInput } from "./data-job-queue-types";

const total = { DATA_JOB_TOTAL_QUOTA_ENABLED: "true", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "2",
  DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "3", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "4" };
const member = { WORKSPACE_MEMBER_QUOTA_ENABLED: "true", WORKSPACE_MEMBER_QUOTA_MAX_SEATS: "2" };
const input: EnqueueDataJobInput = { kind: "EXPORT", scope: "ACCOUNT", workspaceId: null, requestedByUserId: "capacity-user",
  idempotencyKey: "request", requestFingerprint: `sha256:${"a".repeat(64)}`, expiresAt: new Date("2099-01-01") };
const now = new Date("2026-09-16T00:00:00Z");
type Options = { occupied?: boolean; seats?: bigint; userJobs?: bigint; workspaceJobs?: bigint; instanceJobs?: bigint;
  isolation?: string; acquired?: boolean; workspaceStatus?: string; missingUsage?: boolean };

function fixture(options: Options = {}) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const record = (sql: TemplateStringsArray | Prisma.Sql, values: unknown[]) => {
    const row = Array.isArray(sql) ? { sql: sql.join("?"), values } : { sql: (sql as Prisma.Sql).sql, values: (sql as Prisma.Sql).values };
    queries.push(row); return row.sql;
  };
  const tx = { $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => { record(sql, values); return 0; },
    $queryRaw: async (sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const text = record(sql, values);
      if (text.includes(" AS occupied")) return [{ occupied: options.occupied ?? false }];
      if (text.includes("current_setting")) return [{ isolation: options.isolation ?? "serializable" }];
      if (text.includes("pg_try_advisory")) return [{ acquired: options.acquired ?? true }];
      if (text.includes("clock_timestamp")) return [{ now }];
      if (text.includes("SELECT \"userId\",status")) return [{ userId: "owner", status: options.workspaceStatus ?? "ACTIVE" }];
      if (text.includes("COUNT(*)")) return options.missingUsage ? [] : [{ occupiedSeats: options.seats ?? 1n,
        userJobs: options.userJobs ?? 0n, workspaceJobs: options.workspaceJobs ?? 0n, instanceJobs: options.instanceJobs ?? 0n }];
      throw new Error("UNEXPECTED_CAPACITY_QUERY");
    } } as unknown as DataQueueTransaction;
  return { tx, queries };
}

test("总量关闭和非三域不读取数据库，不把配额扩大到删除与通知", async () => {
  const f = fixture();
  assert.equal(await checkDataJobTotalQuotaAdmission(f.tx, input, {}), undefined);
  for (const kind of ["DELETE", "NOTIFICATION"] as const) {
    assert.equal(await checkDataJobTotalQuotaAdmission(f.tx, { ...input, kind }, { DATA_JOB_TOTAL_QUOTA_ENABLED: "bad" }), undefined);
  }
  await assert.rejects(checkDataJobTotalQuotaAdmission(f.tx, input, { DATA_JOB_TOTAL_QUOTA_ENABLED: "true" }), /CONFIG_INVALID/);
  assert.deepEqual(f.queries, []);
});

test("总量聚合使用原始三域未过期记录，先全局锁，不按可见性遗漏冻结记录", async () => {
  const f = fixture(); assert.equal(await checkDataJobQuotaAdmission(f.tx, input, total), now);
  const count = f.queries.find(query => query.sql.includes("COUNT(*)"))!;
  assert.match(count.sql, /FILTER \(WHERE "requestedByUserId"=/);
  assert.match(count.sql, /FROM "DataJob" WHERE "queueVersion"=1 AND "expiresAt">/);
  assert.doesNotMatch(count.sql, /DataDeletionFence|JOIN|"User"|createdAt|LIMIT/);
  for (const value of ["capacity-user", null, "PAUSED", "CANCEL_REQUESTED", "FAILED", "EXPORT", "RANKING_REBUILD", "SEARCH_INDEX_REBUILD"]) {
    assert.ok(count.values.includes(value));
  }
  const lock = f.queries.find(query => query.sql.includes("pg_try_advisory"))!;
  assert.deepEqual(lock.values, ["areaforge:data-job-total-quota:v1"]);
  assert.ok(f.queries.indexOf(lock) < f.queries.indexOf(count));
});

test("三个总量阈值独立拒绝，ACCOUNT跳过工作区上限但保留本人和实例上限", async () => {
  for (const [options, code] of [[{ userJobs: 2n }, "USER"], [{ workspaceJobs: 3n }, "WORKSPACE"], [{ instanceJobs: 4n }, "INSTANCE"]] as const) {
    await assert.rejects(checkDataJobTotalQuotaAdmission(fixture(options).tx,
      { ...input, scope: "WORKSPACE", workspaceId: "workspace" }, total), { code: `DATA_JOB_QUOTA_${code}_ACTIVE_LIMIT` });
  }
  assert.equal(await checkDataJobTotalQuotaAdmission(fixture().tx, input, { ...total, DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "0" }), now);
  await assert.rejects(checkDataJobTotalQuotaAdmission(fixture({ instanceJobs: BigInt(Number.MAX_SAFE_INTEGER) + 1n }).tx, input, total), /USAGE_UNAVAILABLE/);
  await assert.rejects(checkDataJobTotalQuotaAdmission(fixture({ missingUsage: true }).tx, input, total), /USAGE_UNAVAILABLE/);
});

test("总量和席位必须可序列化；锁忙拒绝且不继续计数", async () => {
  for (const options of [{ isolation: "read committed" }, { acquired: false }]) {
    const jobs = fixture(options);
    await assert.rejects(checkDataJobTotalQuotaAdmission(jobs.tx, input, total), /ISOLATION_UNSUPPORTED|BUSY/);
    assert.equal(jobs.queries.some(query => query.sql.includes("COUNT(*)")), false);
    const members = fixture(options);
    await assert.rejects(checkWorkspaceMemberQuotaAdmission(members.tx, { workspaceId: "w", userId: "u" }, member), /ISOLATION_UNSUPPORTED|BUSY/);
    assert.equal(members.queries.some(query => query.sql.includes("COUNT(*)")), false);
  }
});

test("成员原始占用固定Owner一席，不因停用/冻结/归档或角色变化释放", async () => {
  const f = fixture(); await checkWorkspaceMemberQuotaAdmission(f.tx, { workspaceId: "w", userId: "u" }, member);
  const count = f.queries.find(query => query.sql.includes("COUNT(*)"))!;
  assert.match(count.sql, /1\+COUNT\(\*\)[\s\S]*status='ACTIVE'[\s\S]*"userId"<>/);
  assert.deepEqual(count.values, ["w", "owner"]);
  assert.doesNotMatch(count.sql, /"User"|DataDeletionFence|role|archivedAt/);
  await assert.rejects(checkWorkspaceMemberQuotaAdmission(fixture({ seats: 2n }).tx, { workspaceId: "w", userId: "u" }, member), /QUOTA_LIMIT/);
  await assert.rejects(checkWorkspaceMemberQuotaAdmission(fixture({ workspaceStatus: "ARCHIVED" }).tx,
    { workspaceId: "w", userId: "u" }, member), /SCOPE_INVALID/);
});

test("关闭不查席位，已占位成员/Owner不新增占用，坏限额不重新计量", async () => {
  const off = fixture(); await checkWorkspaceMemberQuotaAdmission(off.tx, { workspaceId: "w", userId: "u" }, {});
  assert.deepEqual(off.queries, []);
  const existing = fixture({ occupied: true });
  await checkWorkspaceMemberQuotaAdmission(existing.tx, { workspaceId: "w", userId: "u" }, { WORKSPACE_MEMBER_QUOTA_ENABLED: "true" });
  assert.equal(existing.queries.length, 2);
  await assert.rejects(checkWorkspaceMemberQuotaAdmission(fixture().tx, { workspaceId: "w", userId: "u" },
    { WORKSPACE_MEMBER_QUOTA_ENABLED: "true" }), /CONFIG_INVALID/);
});

test("同键回执先复用，新增总量开关也强制队列外层事务为Serializable", async () => {
  const row = { ...input, id: "existing", queueVersion: 1 };
  const tx = { $queryRaw: async () => [{ status: "ACTIVE" }], dataJob: { findUnique: async () => row } } as unknown as DataQueueTransaction;
  assert.equal(await enqueueDataJobInTransaction(tx, input, { DATA_JOB_TOTAL_QUOTA_ENABLED: "invalid" }), row);
  let options: unknown;
  const client = { $transaction: async (fn: (value: DataQueueTransaction) => unknown, value: unknown) => { options = value; return fn(tx); } } as unknown as DataQueueClient;
  assert.equal(await enqueueDataJob(client, input, total), row);
  assert.deepEqual(options, { isolationLevel: "Serializable" });
});
