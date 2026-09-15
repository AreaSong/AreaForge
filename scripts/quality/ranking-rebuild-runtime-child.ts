import assert from "node:assert/strict";
import { createPrismaClient } from "../../packages/db/src/index";
import { runDataJobWorker } from "../workers/data-job-runner";
import { createRankingRebuildHandler } from "../workers/ranking-rebuild-handler";
import { loadRankingFixture, rankingFixtureEnvironment, verifyRankingFixtureLedger } from "./ranking-rebuild-fixture";

async function main() {
  const fixture = loadRankingFixture(process.env.AREAFORGE_RANKING_REBUILD_FIXTURE_ROOT ?? "");
  const env = rankingFixtureEnvironment(fixture); Object.assign(process.env, env);
  const jobId = process.env.RANKING_FIXTURE_JOB_ID; const point = process.env.RANKING_FIXTURE_PAUSE_AT;
  const leaseMs = Number(process.env.RANKING_FIXTURE_LEASE_MS ?? 30_000);
  assert.ok(Number.isInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 30_000);
  assert.match(jobId ?? "", /^[A-Za-z0-9_-]{1,120}$/); assert.ok(["prepared", "written", "none"].includes(point ?? ""));
  const client = createPrismaClient(env.DATABASE_URL);
  const resume = async (checkpoint: string) => {
    process.send?.({ point: checkpoint });
    if (checkpoint !== point) return;
    await new Promise<void>(resolve => {
      const handle = (message: unknown) => {
        if (!message || typeof message !== "object" || !("action" in message)) return;
        if (message.action === "disable") env.DATA_JOB_WORKER_ENABLED = "false";
        if (message.action === "continue") { process.off("message", handle); resolve(); }
      };
      process.on("message", handle);
    });
  };
  try {
    await verifyRankingFixtureLedger(client, fixture);
    const row = await client.dataJob.findUniqueOrThrow({ where: { id: jobId! } });
    assert.equal(row.kind, "RANKING_REBUILD"); assert.ok(row.workspaceId);
    const handler = createRankingRebuildHandler(client, env);
    await runDataJobWorker({ enabled: true, client, workerId: `ranking-child-${process.pid}`, leaseMs,
      partition: { workspaceId: row.workspaceId, requestedByUserId: row.requestedByUserId }, signal: new AbortController().signal, once: true,
      handlers: [{ kind: "RANKING_REBUILD", prepare: async context => {
        assert.equal(context.lease.jobId, jobId); const effect = await handler.prepare(context); await resume("prepared");
        return async (tx, job) => { await effect(tx, job); await resume("written"); };
      } }], onResult: result => process.send?.({ point: "result", result }) });
  } finally { await client.$disconnect(); }
}

main().catch(error => { process.send?.({ point: "failed", code: error instanceof Error ? error.name : "unknown" }); process.exitCode = 1; })
  .finally(() => { if (process.connected) process.disconnect(); });
