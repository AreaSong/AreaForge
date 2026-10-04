import assert from "node:assert/strict";
import { prisma } from "../../packages/db/src/index";
import { createDataExportHandler } from "../workers/data-export-handler";
import { runDataJobWorker } from "../workers/data-job-runner";
import { requireDataExportFixture } from "./data-export-runtime-fixture";

async function stopAt(point: string) {
  process.send?.({ state: point });
  await new Promise<never>(() => undefined);
}

try {
  await requireDataExportFixture();
  const requestedByUserId = process.env.AREAFORGE_EXPORT_FIXTURE_REQUESTER;
  const workspaceId = process.env.AREAFORGE_EXPORT_FIXTURE_WORKSPACE;
  const point = process.env.AREAFORGE_EXPORT_FIXTURE_CRASH;
  assert.match(requestedByUserId ?? "", /^exp_[a-z0-9_]+$/);
  assert.match(workspaceId ?? "", /^[A-Za-z0-9_-]+$/);
  assert.ok(point && ["intent", "record", "sealed", "commit"].includes(point));
  const handler = createDataExportHandler(prisma);
  await runDataJobWorker({
    enabled: true, client: prisma, workerId: `export-crash-${process.pid}`, leaseMs: 30_000,
    partition: { requestedByUserId, workspaceId }, signal: new AbortController().signal, once: true,
    handlers: [{ kind: "EXPORT", prepare: async context => {
      const effect = await handler.prepare({ ...context, heartbeat: async progress => {
        await context.heartbeat(progress);
        if ((point === "intent" && progress === 0.1) || (point === "record" && progress === 0.25)
          || (point === "sealed" && progress === 0.8)) await stopAt(point);
      } });
      return async (tx, job) => {
        await effect(tx, job);
        assert.equal(await tx.dataExportPackage.count({ where: { jobId: job.id } }), 1);
        if (point === "commit") await stopAt(point);
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
