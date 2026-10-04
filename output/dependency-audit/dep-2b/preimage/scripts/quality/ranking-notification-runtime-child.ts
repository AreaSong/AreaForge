import assert from "node:assert/strict";
import { prisma } from "../../packages/db/src/index";
import { runDataJobWorker } from "../workers/data-job-runner";
import { createRankingNotificationHandler } from "../workers/ranking-notification-handler";
import { requireDataJobWorkerFixture } from "./data-job-worker-runtime-fixture";

try {
  assert.equal(process.env.AREAFORGE_RANKING_NOTIFICATION_ISOLATED_DB, "1");
  await requireDataJobWorkerFixture();
  const requestedByUserId = process.env.AREAFORGE_WORKER_FIXTURE_REQUESTER;
  const workspaceId = process.env.AREAFORGE_WORKER_FIXTURE_WORKSPACE;
  assert.match(requestedByUserId ?? "", /^v20w_[a-z0-9_]+$/);
  assert.match(workspaceId ?? "", /^v20w_[a-z0-9_]+$/);
  const point = process.env.AREAFORGE_WORKER_FIXTURE_CRASH;
  assert.ok(point === "prepare" || point === "commit");
  const handler = createRankingNotificationHandler();
  await runDataJobWorker({
    enabled: true, client: prisma, workerId: `notification-crash-${process.pid}`, leaseMs: 1_000,
    partition: { requestedByUserId, workspaceId }, signal: new AbortController().signal, once: true,
    handlers: [{ kind: "NOTIFICATION", prepare: async context => {
      const effect = await handler.prepare(context);
      process.send?.({ state: "CLAIMED" });
      if (point === "prepare") await new Promise(() => undefined);
      return async (tx, job) => {
        await effect(tx, job);
        process.send?.({ state: "EFFECT_STAGED" });
        await new Promise(() => undefined);
      };
    } }],
    onResult: result => process.send?.({ state: result }),
  });
} catch {
  process.send?.({ state: "FAILED" });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
