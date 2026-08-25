import assert from "node:assert/strict";
import test from "node:test";
import type { UpdateCenterStatus, UpdateOperation } from "./update-center";
import {
  createUpdateCenterCoordinatorState,
  isUpdateCenterMutationLocked,
  reduceUpdateCenterCoordinator,
  selectUpdateCenterStatus,
  shouldContinueTargetOperation,
} from "./update-center-coordinator";

const baseStatus: UpdateCenterStatus = {
  currentVersion: "1.1.1",
  currentImage: null,
  appUrl: null,
  deployMode: "release",
  releaseUrl: null,
  latestVersion: "1.1.2",
  latestPublishedAt: null,
  updateAvailable: true,
  autoApply: "none",
  signatureRequired: true,
  timerEnabled: false,
  timerActive: false,
  lastCheckedAt: null,
  lastOperation: null,
  rollback: { available: true, targetVersion: "1.1.0", targetImage: null },
  blocker: null,
  requestQueueLength: 0,
  statusUpdatedAt: null,
};

const queued: UpdateOperation = {
  id: "target",
  action: "set_auto_apply",
  status: "queued",
  requestedAt: "2026-08-22T00:00:00.000Z",
  finishedAt: null,
  message: null,
};

test("queued target survives null and unrelated status reads until its own terminal state", () => {
  let state = createUpdateCenterCoordinatorState(baseStatus);
  state = reduceUpdateCenterCoordinator(state, { type: "submit-started" });
  state = reduceUpdateCenterCoordinator(state, { type: "request-queued", operation: queued });

  state = reduceUpdateCenterCoordinator(state, {
    type: "read-status",
    sequence: 1,
    status: baseStatus,
  });
  assert.equal(selectUpdateCenterStatus(state).lastOperation?.id, "target");
  assert.equal(isUpdateCenterMutationLocked(state), true);

  state = reduceUpdateCenterCoordinator(state, {
    type: "read-status",
    sequence: 2,
    status: { ...baseStatus, lastOperation: { ...queued, id: "older" } },
  });
  assert.equal(selectUpdateCenterStatus(state).lastOperation?.id, "target");

  const terminal = { ...queued, status: "succeeded" as const, finishedAt: "2026-08-22T00:01:00.000Z" };
  state = reduceUpdateCenterCoordinator(state, {
    type: "read-status",
    sequence: 3,
    status: { ...baseStatus, autoApply: "patch", lastOperation: terminal },
  });
  assert.equal(selectUpdateCenterStatus(state).lastOperation?.status, "succeeded");
  assert.equal(isUpdateCenterMutationLocked(state), false);
});

test("stale reads cannot overwrite newer snapshots and dirty policy remains local", () => {
  let state = createUpdateCenterCoordinatorState(baseStatus);
  state = reduceUpdateCenterCoordinator(state, { type: "change-policy", policy: "patch" });
  state = reduceUpdateCenterCoordinator(state, {
    type: "read-status",
    sequence: 5,
    status: { ...baseStatus, currentVersion: "1.1.2" },
  });
  state = reduceUpdateCenterCoordinator(state, {
    type: "read-status",
    sequence: 4,
    status: { ...baseStatus, currentVersion: "1.0.0" },
  });

  assert.equal(state.serverStatus.currentVersion, "1.1.2");
  assert.equal(state.policyDraft, "patch");
  assert.equal(state.policyDirty, true);
});

test("polling continues for absent, unrelated, or pending target observations", () => {
  assert.equal(shouldContinueTargetOperation(baseStatus, "target"), true);
  assert.equal(shouldContinueTargetOperation({ ...baseStatus, lastOperation: { ...queued, id: "other" } }, "target"), true);
  assert.equal(shouldContinueTargetOperation({ ...baseStatus, lastOperation: queued }, "target"), true);
  assert.equal(shouldContinueTargetOperation({
    ...baseStatus,
    lastOperation: { ...queued, status: "failed", finishedAt: "2026-08-22T00:01:00.000Z" },
  }, "target"), false);
});
