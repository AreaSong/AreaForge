import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client";
import { checkDataJobQuotaAdmission } from "./data-job-quota";
import { enqueueDataJobInTransaction } from "./data-job-queue";
import type { DataQueueTransaction, EnqueueDataJobInput } from "./data-job-queue-types";

const env = { DATA_JOB_QUOTA_ENABLED: "true", DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "2", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "3" };
const input: EnqueueDataJobInput = { kind: "EXPORT", scope: "ACCOUNT", workspaceId: null, requestedByUserId: "quota-user",
  idempotencyKey: "quota-request", requestFingerprint: `sha256:${"a".repeat(64)}`, expiresAt: new Date("2099-01-01") };
const now = new Date("2026-09-16T00:00:00Z");

function fixture(options: { isolation?: string; acquired?: boolean; activeJobs?: bigint; exports24h?: bigint } = {}) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  function query(sql: TemplateStringsArray | Prisma.Sql, values: unknown[]) {
    const record = Array.isArray(sql) ? { sql: sql.join("?"), values } : { sql: (sql as Prisma.Sql).sql, values: (sql as Prisma.Sql).values };
    queries.push(record); return record.sql;
  }
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => { query(sql, values); return 0; },
    $queryRaw: async (sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const text = query(sql, values);
      if (text.includes("current_setting")) return [{ isolation: options.isolation ?? "serializable" }];
      if (text.includes("pg_try_advisory")) return [{ acquired: options.acquired ?? true }];
      if (text.includes("clock_timestamp")) return [{ now }];
      if (text.includes("COUNT(*)")) return [{ activeJobs: options.activeJobs ?? 0n, exports24h: options.exports24h ?? 0n }];
      throw new Error("UNEXPECTED_QUOTA_QUERY");
    },
  } as unknown as DataQueueTransaction;
  return { tx, queries };
}

test("关闭或非目标种类不读取额度与配置，坏额度仅在新增受控准入拒绝", async () => {
  const f = fixture();
  assert.equal(await checkDataJobQuotaAdmission(f.tx, input, {}), undefined);
  assert.equal(await checkDataJobQuotaAdmission(f.tx, { ...input, kind: "NOTIFICATION" }, { DATA_JOB_QUOTA_ENABLED: "bad" }), undefined);
  assert.equal(await checkDataJobQuotaAdmission(f.tx, { ...input, kind: "DELETE" }, env), undefined);
  await assert.rejects(checkDataJobQuotaAdmission(f.tx, input, { ...env, DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: undefined }), { code: "DATA_JOB_QUOTA_CONFIG_INVALID" });
  assert.deepEqual(f.queries, []);
});

test("受控事务拒绝非 Serializable，锁竞争不继续计数", async () => {
  for (const isolation of ["read committed", "repeatable read", "read uncommitted"]) {
    const f = fixture({ isolation });
    await assert.rejects(checkDataJobQuotaAdmission(f.tx, input, env), { code: "DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED" });
    assert.equal(f.queries.length, 1);
  }
  const busy = fixture({ acquired: false });
  await assert.rejects(checkDataJobQuotaAdmission(busy.tx, input, env), { code: "DATA_JOB_QUOTA_BUSY" });
  assert.equal(busy.queries.some(query => query.sql.includes("COUNT(*)")), false);
});

test("额度 SQL 绑定本人精确分区与三域，采用数据库准入时钟和失败保留名额", async () => {
  const f = fixture();
  assert.equal(await checkDataJobQuotaAdmission(f.tx, input, env), now);
  const count = f.queries.find(query => query.sql.includes("COUNT(*)"))!;
  assert.match(count.sql, /"queueVersion"=1[\s\S]*"requestedByUserId"=\?[\s\S]*scope=\?[\s\S]*"workspaceId" IS NOT DISTINCT FROM \?/);
  for (const value of [input.requestedByUserId, "ACCOUNT", null, "EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD", "FAILED", "PAUSED", "CANCEL_REQUESTED"]) {
    assert.ok(count.values.includes(value));
  }
  assert.ok(count.values.some(value => value instanceof Date && value.getTime() === now.getTime() - 86_400_000));
  assert.match(f.queries[1]!.sql, /lock_timeout = '250ms'/);
  assert.match(f.queries[2]!.sql, /statement_timeout = '2500ms'/);
});

test("容量拒绝有独立受控错误，导出耗尽不限制搜索", async () => {
  const active = fixture({ activeJobs: 2n });
  await assert.rejects(checkDataJobQuotaAdmission(active.tx, input, env), { code: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
  const exports = fixture({ exports24h: 3n });
  await assert.rejects(checkDataJobQuotaAdmission(exports.tx, input, env), { code: "DATA_JOB_QUOTA_EXPORT_LIMIT" });
  assert.equal(await checkDataJobQuotaAdmission(exports.tx, { ...input, kind: "SEARCH_INDEX_REBUILD", scope: "WORKSPACE", workspaceId: "workspace-a" }, env), now);
});

test("已接纳同键请求先复用，不因额度配置错误再次拒绝或重新计数", async () => {
  const row = { ...input, id: "already-admitted", queueVersion: 1 };
  const queries: string[] = [];
  const tx = { $queryRaw: async (sql: TemplateStringsArray) => { queries.push(sql.join("?")); return [{ status: "ACTIVE" }]; },
    dataJob: { findUnique: async () => row } } as unknown as DataQueueTransaction;
  assert.equal(await enqueueDataJobInTransaction(tx, input, { DATA_JOB_QUOTA_ENABLED: "invalid" }), row);
  assert.equal(queries.length, 1); assert.match(queries[0]!, /FROM "User"/);
  await assert.rejects(enqueueDataJobInTransaction(tx, { ...input, requestFingerprint: `sha256:${"b".repeat(64)}` }, env), /IDEMPOTENCY_CONFLICT/);
});
