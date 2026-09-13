import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prisma, commitQueuedDataJob, deliverRankingNotificationJob, recoverQueuedDataJobs } from "../../packages/db/src/index";
import { toDataJobLease } from "../../packages/db/src/data-job-queue-store";
import { makeFixtureRetryDue, waitForFixture } from "./data-job-worker-runtime-fixture";
import { consumeEvent, enqueueEvent, notificationCount, notificationFixture, readJob } from "./ranking-notification-runtime-fixture";

export async function notificationProcessCrashRecovery() {
  for (const point of ["prepare", "commit"] as const) await verifyCrashPoint(point);
}

async function verifyCrashPoint(point: "prepare" | "commit") {
  const { event } = await notificationFixture();
  const job = await enqueueEvent(event); assert.ok(job);
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./ranking-notification-runtime-child.ts", import.meta.url))], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: {
      PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL,
      AREAFORGE_DATA_JOB_WORKER_ISOLATED_DB: "1", AREAFORGE_RANKING_NOTIFICATION_ISOLATED_DB: "1",
      PLATFORM_NOTIFICATIONS_ENABLED: "true", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "true",
      AREAFORGE_WORKER_FIXTURE_REQUESTER: event.actorUserId, AREAFORGE_WORKER_FIXTURE_WORKSPACE: event.workspaceId,
      AREAFORGE_WORKER_FIXTURE_CRASH: point,
    },
  });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  try { await waitForChild(child, point === "prepare" ? "CLAIMED" : "EFFECT_STAGED"); }
  finally { child.kill("SIGKILL"); await exited; }
  const abandoned = await readJob(job.id);
  assert.equal(abandoned.status, "RUNNING"); assert.equal(await notificationCount(event), 0);
  const oldLease = toDataJobLease(abandoned);
  await waitForFixture(async () => (await readJob(job.id)).leaseExpiresAt!.getTime() <= Date.now());
  await waitForFixture(async () => {
    await recoverQueuedDataJobs(prisma, { kinds: ["NOTIFICATION"], partition: { requestedByUserId: event.actorUserId, workspaceId: event.workspaceId } });
    return (await readJob(job.id)).status === "FAILED";
  });
  await makeFixtureRetryDue(job.id);
  const successor = await consumeEvent(event);
  assert.equal(successor.result, "SUCCEEDED"); assert.equal(successor.job.attempt, 2);
  assert.ok(successor.job.leaseVersion > abandoned.leaseVersion); assert.equal(await notificationCount(event), 1);
  await assert.rejects(commitQueuedDataJob(prisma, { lease: oldLease, effect: deliverRankingNotificationJob }), /DATA_JOB_LEASE_LOST/);
  assert.equal(await notificationCount(event), 1);
}

function waitForChild(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("NOTIFICATION_CRASH_FIXTURE_TIMEOUT")), 20_000);
    const message = (value: unknown) => {
      if (value && typeof value === "object" && "state" in value && value.state === expected) finish();
    };
    const exited = () => finish(new Error("NOTIFICATION_CHILD_EXITED_EARLY"));
    const finish = (error?: Error) => {
      clearTimeout(timer); child.off("message", message); child.off("exit", exited); child.off("error", finish);
      if (error) reject(error); else resolve();
    };
    child.on("message", message); child.once("exit", exited); child.once("error", finish);
  });
}
