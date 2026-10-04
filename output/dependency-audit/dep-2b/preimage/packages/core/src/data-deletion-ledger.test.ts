import assert from "node:assert/strict";
import test from "node:test";
import { buildDataDeletionLedgerReplayPlan, createDataDeletionLedgerEntry, validateDataDeletionLedger } from "./data-deletion-ledger";

const scopeFingerprint = `sha256:${"a".repeat(64)}`;
const first = createDataDeletionLedgerEntry({ sequence: 1, deletionId: "delete-1", scope: "ACCOUNT", scopeFingerprint, completedAt: "2026-09-02T00:00:00.000Z", counts: { Note: 2 }, previousEntryHash: null });
const second = createDataDeletionLedgerEntry({ sequence: 2, deletionId: "delete-2", scope: "WORKSPACE", scopeFingerprint, completedAt: "2026-09-04T00:00:00.000Z", counts: { Attachment: 1 }, previousEntryHash: first.entryHash });

test("deletion ledger is immutable, hash chained, and deterministic", () => {
  assert.equal(validateDataDeletionLedger([first, second]).headHash, second.entryHash);
  assert.equal(createDataDeletionLedgerEntry({ sequence: 1, deletionId: "delete-1", scope: "ACCOUNT", scopeFingerprint, completedAt: "2026-09-02T00:00:00.000Z", counts: { Note: 2 }, previousEntryHash: null }).entryHash, first.entryHash);
  assert.throws(() => validateDataDeletionLedger([first, { ...second, counts: { Attachment: 2 } }]), /hash mismatch/);
  assert.throws(() => validateDataDeletionLedger([second]), /sequence/);
});

test("restore replay plans only post-backup deletions and never executes", () => {
  const plan = buildDataDeletionLedgerReplayPlan({ entries: [first, second], backupCreatedAt: "2026-09-03T00:00:00.000Z" });
  assert.deepEqual(plan.entries.map((entry) => entry.deletionId), ["delete-2"]);
  assert.equal(plan.executionAllowed, false);
  assert.deepEqual(buildDataDeletionLedgerReplayPlan({ entries: [first, second], backupCreatedAt: "2026-09-01T00:00:00.000Z", alreadyAppliedEntryHashes: [first.entryHash] }).entries.map((entry) => entry.deletionId), ["delete-2"]);
});
