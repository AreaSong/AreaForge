import assert from "node:assert/strict";
import test from "node:test";
import { assertQueueLease, partitionWhere, queueIdentifier, validateQueueKinds } from "./data-job-queue-store";
import type { DataJobLease, QueuedDataJob } from "./data-job-queue-types";

const now = new Date("2026-09-08T00:00:00Z");
const lease: DataJobLease = {
  jobId: "job-1", kind: "NOTIFICATION", scope: "WORKSPACE", requestedByUserId: "user-1", workspaceId: "workspace-1",
  workerId: "worker-1", leaseVersion: 2, attempt: 2, leaseExpiresAt: new Date(now.getTime() + 30_000),
  payloadJson: null,
};
const row = {
  id: lease.jobId, kind: lease.kind, scope: lease.scope, requestedByUserId: lease.requestedByUserId, workspaceId: lease.workspaceId,
  leaseOwner: lease.workerId, leaseVersion: lease.leaseVersion, leaseExpiresAt: lease.leaseExpiresAt,
  expiresAt: new Date(now.getTime() + 60_000), status: "RUNNING",
} as QueuedDataJob;

test("租约 fence 绑定任务、代次、执行者和完整 scope，不信任客户端 expiry", () => {
  assert.doesNotThrow(() => assertQueueLease(row, lease, now));
  for (const forged of [
    { ...lease, leaseVersion: 1 }, { ...lease, workerId: "other" }, { ...lease, jobId: "other" },
    { ...lease, workspaceId: "other" }, { ...lease, requestedByUserId: "other" }, { ...lease, scope: "ACCOUNT" as const },
  ]) assert.throws(() => assertQueueLease(row, forged, now), /DATA_JOB_LEASE_LOST/);
  assert.throws(() => assertQueueLease({ ...row, status: "SUCCEEDED" }, lease, now));
  assert.throws(() => assertQueueLease({ ...row, leaseExpiresAt: now }, { ...lease, leaseExpiresAt: new Date("2099-01-01") }, now));
  assert.throws(() => assertQueueLease({ ...row, expiresAt: now }, lease, now));
});

test("队列分区和处理器种类拒绝自由路径及空列表", () => {
  for (const value of ["", "../escape", "x y"]) assert.throws(() => queueIdentifier(value));
  assert.throws(() => validateQueueKinds([]));
  assert.throws(() => validateQueueKinds(["NOTIFICATION", "NOTIFICATION"]));
  assert.throws(() => validateQueueKinds(["SHELL"]));
  assert.deepEqual(partitionWhere({ workspaceId: null }), { workspaceId: null, requestedByUserId: undefined });
  assert.throws(() => partitionWhere({ workspaceId: "../other" }));
});
