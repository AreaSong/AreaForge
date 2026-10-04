import assert from "node:assert/strict";
import test from "node:test";
import { consumeFixedWindowRateLimit, decideQueueRetry, evaluateCapacity, evaluateWorkspaceQuota, filterWorkspaceSearchCandidates, normalizeAuditSearchQuery } from "./platform-hardening";

test("queue retry uses deterministic exponential backoff and dead letters safely", () => {
  const retry = decideQueueRetry({ attempt: 1, retryable: true, errorCode: "TEMPORARY", now: "2026-09-06T00:00:00.000Z" });
  assert.equal(retry.status, "RETRY_WAIT");
  assert.equal(retry.delaySeconds, 60);
  assert.equal(retry.nextAttemptAt, "2026-09-06T00:01:00.000Z");
  assert.equal(decideQueueRetry({ attempt: 1, retryable: false, errorCode: "PERMANENT", now: "2026-09-06T00:00:00.000Z" }).status, "DEAD_LETTER");
  assert.equal(decideQueueRetry({ attempt: 5, retryable: true, errorCode: "TEMPORARY", now: "2026-09-06T00:00:00.000Z" }).reason, "ATTEMPT_LIMIT_REACHED");
});

test("workspace quota returns stable resource violations", () => {
  const decision = evaluateWorkspaceQuota({ usage: { activeJobs: 2, dailyExports: 1, members: 4, storageBytes: 90 }, requested: { activeJobs: 1, storageBytes: 20 }, quota: { maxActiveJobs: 2, maxDailyExports: 5, maxMembers: 10, maxStorageBytes: 100 } });
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.violations.map((item) => item.resource), ["activeJobs", "storageBytes"]);
});

test("fixed-window limiter is deterministic and fails closed on invalid state", () => {
  let state = { windowStartedAt: 0, count: 0 };
  state = consumeFixedWindowRateLimit({ state, nowMs: 1_000, maxRequests: 2, windowMs: 10_000 }).state;
  state = consumeFixedWindowRateLimit({ state, nowMs: 2_000, maxRequests: 2, windowMs: 10_000 }).state;
  const blocked = consumeFixedWindowRateLimit({ state, nowMs: 3_000, maxRequests: 2, windowMs: 10_000 });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.retryAfterSeconds, 7);
  assert.throws(() => consumeFixedWindowRateLimit({ state: { windowStartedAt: -1, count: 0 }, nowMs: 0, maxRequests: 1, windowMs: 1 }), /invalid/);
  assert.throws(() => consumeFixedWindowRateLimit({ state: { windowStartedAt: 2_000, count: 1 }, nowMs: 1_999, maxRequests: 2, windowMs: 10_000 }), /clock moved backwards/);
});

test("capacity reports healthy, warning and blocked without mutating source facts", () => {
  assert.equal(evaluateCapacity({ storageBytes: 10, storageLimitBytes: 100, activeJobs: 1, activeJobLimit: 10 }).state, "HEALTHY");
  assert.equal(evaluateCapacity({ storageBytes: 85, storageLimitBytes: 100, activeJobs: 1, activeJobLimit: 10 }).state, "WARNING");
  assert.equal(evaluateCapacity({ storageBytes: 100, storageLimitBytes: 100, activeJobs: 1, activeJobLimit: 10 }).state, "BLOCKED");
  assert.equal(evaluateCapacity({ storageBytes: 0, storageLimitBytes: 0, activeJobs: 0, activeJobLimit: 1 }).reasons[0], "INVALID_USAGE");
});

test("audit query normalizes scope and rejects unbounded or invalid ranges", () => {
  assert.deepEqual(normalizeAuditSearchQuery({ workspaceId: " workspace-1 ", actionPrefix: "auth_", limit: 50 }), { workspaceId: "workspace-1", actorId: null, actionPrefix: "AUTH_", from: null, to: null, limit: 50 });
  assert.throws(() => normalizeAuditSearchQuery({ limit: 501 }), /limit/);
  assert.throws(() => normalizeAuditSearchQuery({ from: "2026-09-07T00:00:00Z", to: "2026-09-06T00:00:00Z" }), /range/);
});

test("workspace search filters cross-tenant and private candidates before projection", () => {
  const visible = filterWorkspaceSearchCandidates({
    actorId: "member-1",
    workspaceId: "workspace-1",
    activeWorkspaceIds: ["workspace-1"],
    candidates: [
      { id: "own", workspaceId: "workspace-1", ownerUserId: "member-1", visibility: "OWNER" },
      { id: "private", workspaceId: "workspace-1", ownerUserId: "owner-1", visibility: "OWNER" },
      { id: "shared", workspaceId: "workspace-1", ownerUserId: "owner-1", visibility: "SHARED", sharedWithUserIds: ["member-1"] },
      { id: "workspace", workspaceId: "workspace-1", ownerUserId: "owner-1", visibility: "WORKSPACE" },
      { id: "foreign", workspaceId: "workspace-2", ownerUserId: "member-1", visibility: "OWNER" },
    ],
  });
  assert.deepEqual(visible.map((item) => item.id), ["own", "shared", "workspace"]);
  assert.deepEqual(filterWorkspaceSearchCandidates({ actorId: "member-1", workspaceId: "workspace-1", activeWorkspaceIds: [], candidates: visible }), []);
  assert.throws(() => filterWorkspaceSearchCandidates({
    actorId: "member-1",
    workspaceId: "workspace-1",
    activeWorkspaceIds: ["workspace-1"],
    candidates: [{ id: "invalid/id", workspaceId: "workspace-1", ownerUserId: "member-1", visibility: "OWNER" }],
  }), /candidate id/);
  assert.throws(() => filterWorkspaceSearchCandidates({
    actorId: "member-1",
    workspaceId: "workspace-1",
    activeWorkspaceIds: ["workspace-1"],
    candidates: [{ id: "candidate-1", workspaceId: "workspace-1", ownerUserId: "../owner", visibility: "OWNER" }],
  }), /candidate ownerUserId/);
  assert.throws(() => filterWorkspaceSearchCandidates({
    actorId: "member-1",
    workspaceId: "workspace-1",
    activeWorkspaceIds: ["workspace-1"],
    candidates: [{ id: "candidate-1", workspaceId: "workspace-1", ownerUserId: "owner-1", visibility: "SHARED", sharedWithUserIds: ["invalid/shared"] }],
  }), /candidate sharedWithUserId/);
});
