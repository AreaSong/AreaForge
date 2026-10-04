import assert from "node:assert/strict";
import { loadQuotaFixture, quotaFixtureEnvironment, assertQuotaFixtureContainer, verifyQuotaFixtureLedger } from "./quota-fixture";
import { quotaRuntimeCode, retryQuotaFixture } from "./quota-runtime-support";

async function main() {
  const fixture = loadQuotaFixture(process.env.AREAFORGE_DATA_JOB_QUOTA_FIXTURE_ROOT ?? ""); assertQuotaFixtureContainer(fixture);
  const active = process.env.QUOTA_CHILD_ACTIVE; const exports = process.env.QUOTA_CHILD_EXPORTS;
  Object.assign(process.env, quotaFixtureEnvironment(fixture), { DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: active ?? "2", DATA_JOB_QUOTA_MAX_EXPORTS_24H: exports ?? "3" });
  const value = JSON.parse(process.env.QUOTA_PRODUCER_INPUT ?? "null") as { userId: string; workspaceId: string; kind: "EXPORT" | "SEARCH_INDEX_REBUILD" | "RANKING_REBUILD"; key: string };
  assert.deepEqual(Object.keys(value).sort(), ["key", "kind", "userId", "workspaceId"]);
  for (const id of [value.userId, value.workspaceId, value.key]) assert.match(id, /^[A-Za-z0-9_-]{1,191}$/);
  assert.ok(["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"].includes(value.kind));
  const pauseAt = process.env.QUOTA_PRODUCER_PAUSE_AT ?? "none"; assert.ok(["none", "counted", "written"].includes(pauseAt));
  const { createPrismaClient, enqueueDataJobInTransaction, Prisma } = await import("../../packages/db/src/index");
  const client = createPrismaClient(process.env.DATABASE_URL);
  async function checkpoint(point: string) {
    if (point !== pauseAt) return;
    process.send?.({ point });
    await new Promise<void>(resolve => { const listener = (message: unknown) => {
      if (message && typeof message === "object" && "action" in message && message.action === "continue") {
        process.off("message", listener); resolve();
      }
    }; process.on("message", listener); });
  }
  try {
    await verifyQuotaFixtureLedger(client, fixture);
    const run = () => client.$transaction(async tx => {
      const proxy = new Proxy(tx, { get(target, key) {
        if (key !== "$queryRaw") return Reflect.get(target, key);
        return async (sql: TemplateStringsArray | InstanceType<typeof Prisma.Sql>, ...values: unknown[]) => {
          const result = await target.$queryRaw(sql, ...values);
          const text = Array.isArray(sql) ? sql.join("?") : (sql as InstanceType<typeof Prisma.Sql>).sql;
          if (text.includes("COUNT(*) FILTER")) await checkpoint("counted");
          return result;
        };
      } });
      const row = await enqueueDataJobInTransaction(proxy, { kind: value.kind, scope: "WORKSPACE", requestedByUserId: value.userId,
        workspaceId: value.workspaceId, idempotencyKey: value.key, requestFingerprint: `sha256:${"a".repeat(64)}`, expiresAt: new Date(Date.now() + 60_000) });
      await checkpoint("written"); return row;
    }, { isolationLevel: "Serializable", timeout: 15_000 });
    try { const row = pauseAt === "none" ? await retryQuotaFixture(run) : await run(); process.send?.({ point: "result", status: "accepted", id: row.id }); }
    catch (error) { process.send?.({ point: "result", status: "rejected", code: quotaRuntimeCode(error) }); }
  } finally { await client.$disconnect(); }
}

main().catch(() => { process.send?.({ point: "failed", code: "QUOTA_CHILD_FAILED" }); process.exitCode = 1; })
  .finally(() => { if (process.connected) process.disconnect(); });
