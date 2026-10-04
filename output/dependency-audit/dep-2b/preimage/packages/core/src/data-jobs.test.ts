import assert from "node:assert/strict";
import test from "node:test";
import { createQueuedDataJobState, transitionDataJob } from "./data-jobs";

const claim = {
  type: "CLAIM" as const,
  workerId: "worker-1",
  now: "2026-09-06T00:00:00.000Z",
  leaseExpiresAt: "2026-09-06T00:05:00.000Z",
};

test("data job lease lifecycle is deterministic and terminal transitions are fenced", () => {
  const claimed = transitionDataJob(createQueuedDataJobState(), claim);
  assert.equal(claimed.error, null);
  assert.equal(claimed.state.status, "RUNNING");
  const done = transitionDataJob(claimed.state, { type: "SUCCEED", workerId: "worker-1", now: claim.now });
  assert.equal(done.error, null);
  assert.equal(done.state.status, "SUCCEEDED");
  assert.equal(done.state.progress, 1);
  assert.equal(transitionDataJob(done.state, { type: "SUCCEED", workerId: "worker-1", now: claim.now }).error, "INVALID_STATUS");
  const failed = transitionDataJob(claimed.state, { type: "FAIL", workerId: "worker-1", errorCode: "TRANSIENT", retryable: true, now: claim.now });
  assert.equal(transitionDataJob(failed.state, claim).error, null);
  const permanent = transitionDataJob(claimed.state, { type: "FAIL", workerId: "worker-1", errorCode: "PERMANENT", retryable: false, now: claim.now });
  assert.equal(transitionDataJob(permanent.state, claim).error, "RETRY_NOT_ALLOWED");
});

test("wrong worker and expired lease fail closed", () => {
  const claimed = transitionDataJob(createQueuedDataJobState(), claim);
  assert.equal(transitionDataJob(claimed.state, { type: "HEARTBEAT", workerId: "worker-2", now: claim.now, leaseExpiresAt: claim.leaseExpiresAt, progress: 0.5 }).error, "LEASE_OWNER_MISMATCH");
  assert.equal(transitionDataJob(claimed.state, { type: "EXPIRE", now: "2026-09-06T00:06:00.000Z" }).error, null);
  assert.equal(transitionDataJob(claimed.state, { type: "SUCCEED", workerId: "worker-1", now: "2026-09-06T00:06:00.000Z" }).error, "LEASE_EXPIRED");
  assert.equal(transitionDataJob(transitionDataJob(claimed.state, { type: "EXPIRE", now: "2026-09-06T00:06:00.000Z" }).state, claim).error, null);
});

test("cancel, pause, resume and progress enforce the state machine", () => {
  const claimed = transitionDataJob(createQueuedDataJobState(), claim);
  const paused = transitionDataJob(claimed.state, { type: "PAUSE", workerId: "worker-1", now: claim.now });
  assert.equal(paused.state.status, "PAUSED");
  const resumed = transitionDataJob(paused.state, { type: "RESUME" });
  assert.equal(resumed.state.status, "QUEUED");
  const reclaimed = transitionDataJob(resumed.state, claim);
  assert.equal(transitionDataJob(reclaimed.state, { type: "HEARTBEAT", workerId: "worker-1", now: claim.now, leaseExpiresAt: claim.leaseExpiresAt, progress: 2 }).error, "INVALID_PROGRESS");
  const requested = transitionDataJob(reclaimed.state, { type: "REQUEST_CANCEL" });
  assert.equal(requested.state.status, "CANCEL_REQUESTED");
  assert.equal(transitionDataJob(requested.state, { type: "CANCEL", workerId: "worker-1", now: claim.now }).state.status, "CANCELLED");
});
