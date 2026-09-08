import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { claimQueuedDataJob, controlQueuedDataJob, prisma } from "../../packages/db/src/index";
import { executeDataJob } from "../workers/data-job-execution";
import { DataJobHandlerError } from "../workers/data-job-handler";
import { fixtureJob, syntheticQueueEffect, type WorkerFixture } from "./data-job-worker-runtime-fixture";

async function createLease(fixture: WorkerFixture, label: string, leaseMs = 30_000) {
  const job = await fixtureJob(fixture, label);
  const lease = await claimQueuedDataJob(prisma, {
    workerId: "execution-regression", kinds: ["NOTIFICATION"], leaseMs,
    partition: { requestedByUserId: fixture.owner.id },
  });
  assert.equal(lease?.jobId, job.id);
  assert.ok(lease);
  return lease;
}

export async function verifyFailureControlResult(fixture: WorkerFixture) {
  for (const action of ["PAUSE", "CANCEL"] as const) {
    const lease = await createLease(fixture, `failure-${action}`);
    const result = await executeDataJob({
      client: prisma, lease, leaseMs: 30_000, signal: new AbortController().signal,
      handler: { kind: "NOTIFICATION", prepare: async () => {
        const job = await prisma.dataJob.findUniqueOrThrow({ where: { id: lease.jobId } });
        await controlQueuedDataJob(prisma, {
          jobId: job.id, actorId: fixture.owner.id, expectedRevision: job.updatedAt.getTime(), action,
        });
        throw new Error("合成准备错误，不得覆盖已提交的控制请求");
      } },
    });
    const persisted = await prisma.dataJob.findUniqueOrThrow({ where: { id: lease.jobId } });
    assert.equal(persisted.status, action === "PAUSE" ? "PAUSED" : "CANCELLED");
    assert.equal(result, persisted.status, "执行结果必须对应失败结算事务真正提交的状态");
  }
}

export async function verifyHandlerCannotForgeControl(fixture: WorkerFixture) {
  for (const code of ["DATA_JOB_PAUSED", "DATA_JOB_CANCELLED"]) {
    const lease = await createLease(fixture, code);
    const result = await executeDataJob({
      client: prisma, lease, leaseMs: 30_000, signal: new AbortController().signal,
      handler: { kind: "NOTIFICATION", prepare: async () => { throw new DataJobHandlerError(code, false); } },
    });
    const persisted = await prisma.dataJob.findUniqueOrThrow({ where: { id: lease.jobId } });
    assert.equal(result, "FAILED");
    assert.equal(persisted.status, "FAILED");
    assert.ok(persisted.deadLetteredAt);
  }
}

export async function verifyCommitHeartbeatBoundary(fixture: WorkerFixture) {
  const leaseMs = 9_000;
  const lease = await createLease(fixture, "long-commit", leaseMs);
  const result = await executeDataJob({
    client: prisma, lease, leaseMs, signal: new AbortController().signal,
    handler: { kind: "NOTIFICATION", prepare: async ({ heartbeat }) => {
      // 未 await 的最后一条准备期心跳也必须在提交前排空。
      void heartbeat(0.4);
      return async (tx, job) => {
        await syntheticQueueEffect(tx, job);
        // 超过旧心跳的五秒事务等待时限，但仍小于任务租约。
        await delay(8_200);
      };
    } },
  });
  assert.equal(result, "SUCCEEDED");
  assert.equal((await prisma.dataJob.findUniqueOrThrow({ where: { id: lease.jobId } })).status, "SUCCEEDED");
  assert.equal(await prisma.auditEvent.count({ where: { id: `effect_${lease.jobId}` } }), 1);
}
