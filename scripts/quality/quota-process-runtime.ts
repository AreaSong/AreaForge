import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { enqueueDataJob, type PrismaClient } from "../../packages/db/src/index";
import { createQuotaCase, withQuotaPolicy, quotaKinds, type QuotaCase, type QuotaKind } from "./quota-runtime-data";
import { quotaFixtureEnvironment, type QuotaFixture } from "./quota-fixture";
import { quotaTestInput } from "./quota-concurrency-runtime";
import { retryQuotaFixture } from "./quota-runtime-support";

export function startQuotaProducer(fixture: QuotaFixture, data: QuotaCase, kind: QuotaKind, pauseAt: "none" | "counted" | "written" = "none") {
  const key = randomUUID();
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./quota-producer-child.ts", import.meta.url))], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...quotaFixtureEnvironment(fixture), TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      QUOTA_PRODUCER_INPUT: JSON.stringify({ userId: data.owner.id, workspaceId: data.workspace.id, kind, key }), QUOTA_PRODUCER_PAUSE_AT: pauseAt,
      QUOTA_CHILD_ACTIVE: process.env.DATA_JOB_QUOTA_MAX_ACTIVE_JOBS, QUOTA_CHILD_EXPORTS: process.env.DATA_JOB_QUOTA_MAX_EXPORTS_24H },
  });
  const events: Array<{ point: string; status?: string; id?: string; code?: string }> = []; let exited = false;
  child.on("message", message => { if (message && typeof message === "object" && "point" in message) events.push(message as typeof events[number]); });
  const done = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  return { child, key, events, done, async waitFor(point: string) {
    const end = Date.now() + 20_000;
    while (!events.some(event => event.point === point)) {
      if (exited || Date.now() > end || events.some(event => event.point === "failed")) throw new Error(`QUOTA_CHILD_POINT_MISSING_${point}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, stop() { if (!exited) child.kill("SIGKILL"); } };
}

export async function quotaMultiProcess(client: PrismaClient, fixture: QuotaFixture) {
  const data = await createQuotaCase(client, fixture, "multiprocess");
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "2", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "100" }, async () => {
    const children = Array.from({ length: 6 }, (_, index) => startQuotaProducer(fixture, data, quotaKinds[index % 3]!));
    try {
      for (const result of await Promise.all(children.map(child => child.done))) assert.equal(result.code, 0);
      const results = children.map(child => child.events.find(event => event.point === "result")!);
      assert.equal(results.filter(row => row?.status === "accepted").length, 2);
      for (const row of results) if (row.status !== "accepted") assert.equal(row.code, "DATA_JOB_QUOTA_ACTIVE_LIMIT");
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 2);
    } finally { for (const child of children) child.stop(); await Promise.all(children.map(child => child.done)); }
  });
}

export async function quotaProducerCrashes(client: PrismaClient, fixture: QuotaFixture) {
  await withQuotaPolicy({ DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "1", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "100" }, async () => {
    for (const point of ["counted", "written"] as const) {
      const data = await createQuotaCase(client, fixture, `kill-${point}`); const child = startQuotaProducer(fixture, data, "EXPORT", point);
      try {
        await child.waitFor(point); assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 0);
        await assert.rejects(enqueueDataJob(client, quotaTestInput(data, "RANKING_REBUILD")), { code: "DATA_JOB_QUOTA_BUSY" });
      } finally { child.stop(); assert.equal((await child.done).signal, "SIGKILL"); }
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 0);
      assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "DATA_JOB_ENQUEUED" } }), 0);
      assert.equal((await retryQuotaFixture(() => enqueueDataJob(client, quotaTestInput(data, "EXPORT", child.key)))).status, "QUEUED");
    }
  });
}
