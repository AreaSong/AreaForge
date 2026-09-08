import { prisma } from "../../packages/db/src/index";
import { runDataJobWorker } from "../workers/data-job-runner";
import { requireDataJobWorkerFixture, syntheticQueueEffect } from "./data-job-worker-runtime-fixture";

const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
try {
  await requireDataJobWorkerFixture();
  const requestedByUserId = process.env.AREAFORGE_WORKER_FIXTURE_REQUESTER;
  if (!requestedByUserId?.startsWith("v20w_")) throw new Error("FIXTURE_REQUESTER_REQUIRED");
  await runDataJobWorker({
    enabled: true, client: prisma, workerId: `fixture-process-${process.pid}`, leaseMs: 1_000,
    partition: { requestedByUserId }, signal: controller.signal, once: true,
    handlers: [{ kind: "NOTIFICATION", prepare: async () => {
      process.send?.({ state: "CLAIMED" });
      if (process.env.AREAFORGE_WORKER_FIXTURE_CRASH === "prepare") await new Promise(() => undefined);
      if (process.env.AREAFORGE_WORKER_FIXTURE_CRASH === "commit") return async (tx, job) => {
        await syntheticQueueEffect(tx, job);
        process.send?.({ state: "EFFECT_STAGED" });
        await new Promise(() => undefined);
      };
      return syntheticQueueEffect;
    } }],
    onResult: (result) => process.send?.({ state: result }),
  });
} catch {
  process.send?.({ state: "FAILED" });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
