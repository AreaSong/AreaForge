import assert from "node:assert/strict";
import test from "node:test";
import {
  createControlledOperationRequestState,
  transitionControlledOperationRequest,
} from "./controlled-operation-lifecycle";

const base = {
  risk: "HIGH_RISK" as const,
  requiresApproval: true,
  requestHash: "sha256:request",
  expectedBeforeHash: "sha256:before",
  idempotencyKey: "request-1",
  expiresAt: "2026-09-06T01:00:00.000Z",
};

test("high-risk request requires confirmation and approval before execution", () => {
  let state = createControlledOperationRequestState(base);
  assert.equal(state.status, "CONFIRMATION_REQUIRED");
  let result = transitionControlledOperationRequest(state, { type: "APPROVE", now: "2026-09-06T00:00:01.000Z" });
  assert.equal(result.error, "APPROVAL_REQUIRED");
  state = transitionControlledOperationRequest(state, { type: "CONFIRM", now: "2026-09-06T00:00:02.000Z" }).state;
  assert.equal(state.status, "APPROVAL_REQUIRED");
  state = transitionControlledOperationRequest(state, { type: "APPROVE", now: "2026-09-06T00:00:03.000Z" }).state;
  assert.equal(state.status, "QUEUED");
});

test("worker lease, hold, resume, and completion are fenced", () => {
  let state = createControlledOperationRequestState({
    ...base,
    risk: "READ_ONLY",
    requiresApproval: false,
  });
  state = transitionControlledOperationRequest(state, { type: "ACKNOWLEDGE_PREVIEW", now: "2026-09-06T00:00:01.000Z" }).state;
  state = transitionControlledOperationRequest(state, { type: "CLAIM", workerId: "agent-a", now: "2026-09-06T00:00:02.000Z", leaseExpiresAt: "2026-09-06T00:10:00.000Z" }).state;
  assert.equal(transitionControlledOperationRequest(state, { type: "SUCCEED", workerId: "agent-b", now: "2026-09-06T00:00:03.000Z" }).error, "LEASE_OWNER_MISMATCH");
  state = transitionControlledOperationRequest(state, { type: "HOLD", now: "2026-09-06T00:00:04.000Z" }).state;
  assert.equal(state.status, "HELD");
  state = transitionControlledOperationRequest(state, { type: "RESUME", now: "2026-09-06T00:00:05.000Z" }).state;
  assert.equal(state.status, "QUEUED");
  state = transitionControlledOperationRequest(state, { type: "CLAIM", workerId: "agent-a", now: "2026-09-06T00:00:06.000Z", leaseExpiresAt: "2026-09-06T00:10:00.000Z" }).state;
  state = transitionControlledOperationRequest(state, { type: "SUCCEED", workerId: "agent-a", now: "2026-09-06T00:00:07.000Z" }).state;
  assert.equal(state.status, "SUCCEEDED");
});

test("cancel, retry, and expiry do not permit unsafe resurrection", () => {
  let state = createControlledOperationRequestState({
    ...base,
    risk: "READ_ONLY",
    requiresApproval: false,
  });
  state = transitionControlledOperationRequest(state, { type: "ACKNOWLEDGE_PREVIEW", now: "2026-09-06T00:00:01.000Z" }).state;
  state = transitionControlledOperationRequest(state, { type: "CLAIM", workerId: "agent-a", now: "2026-09-06T00:00:02.000Z", leaseExpiresAt: "2026-09-06T00:10:00.000Z" }).state;
  state = transitionControlledOperationRequest(state, { type: "FAIL", workerId: "agent-a", now: "2026-09-06T00:00:03.000Z", failureCode: "TRANSIENT", retryable: true }).state;
  state = transitionControlledOperationRequest(state, { type: "RETRY", now: "2026-09-06T00:00:04.000Z" }).state;
  assert.equal(state.status, "QUEUED");
  state = transitionControlledOperationRequest(state, { type: "REQUEST_CANCEL", now: "2026-09-06T00:00:05.000Z" }).state;
  assert.equal(state.status, "CANCELLED");
  assert.equal(transitionControlledOperationRequest(state, { type: "RETRY", now: "2026-09-06T00:00:06.000Z" }).error, "RETRY_NOT_ALLOWED");
  const expiring = createControlledOperationRequestState({ ...base, risk: "READ_ONLY", requiresApproval: false, expiresAt: "2026-09-06T00:00:10.000Z" });
  assert.equal(transitionControlledOperationRequest(expiring, { type: "EXPIRE", now: "2026-09-06T00:00:09.000Z" }).error, "NOT_EXPIRED");
  assert.equal(transitionControlledOperationRequest(expiring, { type: "ACKNOWLEDGE_PREVIEW", now: "2026-09-06T00:00:11.000Z" }).error, "EXPIRED");
  assert.equal(transitionControlledOperationRequest(expiring, { type: "EXPIRE", now: "2026-09-06T00:00:11.000Z" }).state.status, "EXPIRED");
});

test("invalid lease timestamps fail closed", () => {
  let state = createControlledOperationRequestState({ ...base, risk: "READ_ONLY", requiresApproval: false });
  state = transitionControlledOperationRequest(state, { type: "ACKNOWLEDGE_PREVIEW", now: "2026-09-06T00:00:01.000Z" }).state;
  assert.equal(transitionControlledOperationRequest(state, {
    type: "CLAIM",
    workerId: "agent-a",
    now: "2026-09-06T00:00:02.000Z",
    leaseExpiresAt: "not-a-timestamp",
  }).error, "LEASE_EXPIRED");
});
