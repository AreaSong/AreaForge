import assert from "node:assert/strict";
import test from "node:test";
import { buildDataDeletionPreview, createDataDeletionState, transitionDataDeletion } from "./data-deletion";

const preview = buildDataDeletionPreview({ scope: "ACCOUNT", workspaceIds: ["w2", "w1"], counts: { Note: 2, User: 1 }, generatedAt: "2026-09-06T00:00:00.000Z", cooldownUntil: "2026-09-07T00:00:00.000Z", blockers: [] });
const now = "2026-09-06T00:00:00.000Z";

test("deletion preview is deterministic and fingerprinted", () => {
  assert.deepEqual(preview.workspaceIds, ["w1", "w2"]);
  assert.equal(preview.totalObjects, 3);
  assert.match(preview.scopeFingerprint, /^sha256:/);
  assert.equal(preview.physicalDeletionSupported, false);
});

test("deletion state requires reauth/cooldown/freeze and protects kill point", () => {
  assert.equal(transitionDataDeletion(createDataDeletionState(preview), "requestReauthentication", { now, scopeFingerprint: preview.scopeFingerprint }).state.executionAllowed, false);
  let state = createDataDeletionState(preview, { allowExecution: true });
  for (const action of ["requestReauthentication", "reauthenticate"] as const) {
    const result = transitionDataDeletion(state, action, { now, scopeFingerprint: preview.scopeFingerprint, blockers: [] });
    assert.equal(result.error, null);
    state = result.state;
  }
  assert.equal(transitionDataDeletion(state, "freeze", { now, scopeFingerprint: preview.scopeFingerprint }).error, "COOLDOWN_ACTIVE");
  for (const action of ["freeze", "approve", "start"] as const) {
    const result = transitionDataDeletion(state, action, { now: "2026-09-07T00:00:00.000Z", scopeFingerprint: preview.scopeFingerprint, blockers: [] });
    assert.equal(result.error, null);
    state = result.state;
  }
  assert.equal(state.status, "EXECUTING");
  assert.equal(transitionDataDeletion(state, "cancel", { now, scopeFingerprint: preview.scopeFingerprint }).error, "KILL_POINT_REACHED");
  const failed = transitionDataDeletion(state, "fail", { now, scopeFingerprint: preview.scopeFingerprint }).state;
  assert.equal(transitionDataDeletion(failed, "retry", { now, scopeFingerprint: preview.scopeFingerprint }).error, "COMPENSATION_REQUIRED");
  const compensated = transitionDataDeletion(failed, "compensate", { now, scopeFingerprint: preview.scopeFingerprint }).state;
  assert.equal(transitionDataDeletion(compensated, "retry", { now, scopeFingerprint: preview.scopeFingerprint }).state.status, "EXECUTING");
  assert.equal(transitionDataDeletion(state, "succeed", { now, scopeFingerprint: "sha256:bad" }).error, "SCOPE_FINGERPRINT_MISMATCH");
});

test("execution remains fail-closed without an explicit isolated fixture grant", () => {
  let state = createDataDeletionState(preview);
  state = transitionDataDeletion(state, "requestReauthentication", { now, scopeFingerprint: preview.scopeFingerprint }).state;
  state = transitionDataDeletion(state, "reauthenticate", { now, scopeFingerprint: preview.scopeFingerprint }).state;
  state = transitionDataDeletion(state, "freeze", { now: "2026-09-07T00:00:00.000Z", scopeFingerprint: preview.scopeFingerprint }).state;
  assert.equal(transitionDataDeletion(state, "approve", { now, scopeFingerprint: preview.scopeFingerprint, blockers: [] }).error, "DELETE_EXECUTION_NOT_AUTHORIZED");
});
