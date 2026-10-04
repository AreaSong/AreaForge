import assert from "node:assert/strict";
import test from "node:test";
import { buildDataTrashImpactPreview, createDataTrashState, transitionDataTrash } from "./data-trash";

const preview = buildDataTrashImpactPreview({ resourceType: "Note", resourceId: "note-1", ownerUserId: "user-1", workspaceId: "workspace-1", dependencyCounts: { ReviewSchedule: 1 }, attachmentCount: 2, rankingProjectionCount: 0, blockers: [] });

test("trash lifecycle enforces revision, fingerprint, and restore window", () => {
  const initial = createDataTrashState(preview);
  const trashed = transitionDataTrash(initial, "trash", { expectedRevision: 1, sourceFingerprint: preview.sourceFingerprint, now: "2026-09-06T00:00:00.000Z", retentionDays: 30 });
  assert.equal(trashed.error, null);
  assert.equal(trashed.state.status, "TRASHED");
  assert.equal(transitionDataTrash(trashed.state, "restore", { expectedRevision: 1, sourceFingerprint: preview.sourceFingerprint, now: "2026-09-07T00:00:00.000Z" }).error, "TRASH_REVISION_CONFLICT");
  assert.equal(transitionDataTrash(trashed.state, "restore", { expectedRevision: 2, sourceFingerprint: "sha256:stale", now: "2026-09-07T00:00:00.000Z" }).error, "TRASH_FINGERPRINT_MISMATCH");
  assert.equal(transitionDataTrash(trashed.state, "restore", { expectedRevision: 2, sourceFingerprint: preview.sourceFingerprint, now: "2026-09-07T00:00:00.000Z" }).state.status, "ACTIVE");
});

test("expired trash becomes purge-eligible but never authorizes physical deletion", () => {
  const trashed = transitionDataTrash(createDataTrashState(preview), "trash", { expectedRevision: 1, sourceFingerprint: preview.sourceFingerprint, now: "2026-09-06T00:00:00.000Z", retentionDays: 1 }).state;
  assert.equal(transitionDataTrash(trashed, "markPurgeEligible", { expectedRevision: 2, sourceFingerprint: preview.sourceFingerprint, now: "2026-09-06T12:00:00.000Z" }).error, "TRASH_RETENTION_ACTIVE");
  const eligible = transitionDataTrash(trashed, "markPurgeEligible", { expectedRevision: 2, sourceFingerprint: preview.sourceFingerprint, now: "2026-09-07T00:00:00.000Z" }).state;
  assert.equal(eligible.status, "PURGE_ELIGIBLE");
  assert.equal(eligible.purgeExecutionAllowed, false);
});
