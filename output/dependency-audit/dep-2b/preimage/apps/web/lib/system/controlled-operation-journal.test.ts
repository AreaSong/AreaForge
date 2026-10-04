import assert from "node:assert/strict";
import test from "node:test";
import {
  computeControlledOperationJournalEntryHash,
  isControlledOperationJournalLockOrder,
  parseControlledOperationJournalEntry,
  parseControlledOperationReconciliationRecord,
  reconcileControlledOperationJournal,
  type ControlledOperationJournalEntry,
} from "./controlled-operation-journal";

const operationId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-06T00:00:00.000Z";

function entry(input: Partial<ControlledOperationJournalEntry> = {}): ControlledOperationJournalEntry {
  const value: ControlledOperationJournalEntry = {
    schemaVersion: 1,
    operationId,
    sequence: 1,
    phase: "admission",
    state: "complete",
    reasonCode: "OPERATION_CREATED",
    uncertainPhase: null,
    sourceKind: "automatic",
    source: "agent.local",
    requestId: null,
    requestHash: null,
    release: null,
    executionAttempted: false,
    beforeStateHash: null,
    backupSetId: null,
    backupInventoryHash: null,
    updateRecordHash: null,
    productionIdentityHash: null,
    createdAt: timestamp,
    previousEventHash: null,
    eventHash: `sha256:${"0".repeat(64)}`,
    ...input,
  };
  value.eventHash = computeControlledOperationJournalEntryHash(value);
  return value;
}

test("journal entry parser is strict and always report-only", () => {
  const valid = entry();
  assert.ok(parseControlledOperationJournalEntry(valid));
  assert.equal(parseControlledOperationJournalEntry({ ...valid, executionAttempted: true }), null);
  assert.equal(parseControlledOperationJournalEntry({ ...valid, phase: "health", uncertainPhase: "migration" }), null);
  assert.equal(parseControlledOperationJournalEntry({ ...valid, phase: "health", state: "complete", sourceKind: "request" }), null);
  assert.equal(parseControlledOperationJournalEntry({ ...valid, phase: "unknown" }), null);
});

test("lock order is fixed and duplicate/reversed locks fail closed", () => {
  assert.equal(isControlledOperationJournalLockOrder(["QUEUE_CONTROL", "PRODUCTION_STATE", "AGENT_LOCAL"]), true);
  assert.equal(isControlledOperationJournalLockOrder(["QUEUE_CONTROL", "AGENT_LOCAL"]), true);
  assert.equal(isControlledOperationJournalLockOrder(["PRODUCTION_STATE", "QUEUE_CONTROL"]), false);
  assert.equal(isControlledOperationJournalLockOrder(["QUEUE_CONTROL", "QUEUE_CONTROL"]), false);
  assert.equal(isControlledOperationJournalLockOrder([]), false);
});

test("reconciliation accepts only a complete, untampered terminal chain", () => {
  const first = entry();
  const second = entry({
    sequence: 2,
    phase: "terminal",
    state: "rejected",
    reasonCode: "REQUEST_REJECTED",
    createdAt: "2026-09-06T00:00:01.000Z",
    previousEventHash: first.eventHash,
  });
  const result = reconcileControlledOperationJournal({ entries: [first, second] });
  assert.equal(result.status, "CLEAN");
  assert.equal(result.reasonCode, null);
  assert.equal(result.lastEventHash, second.eventHash);

  const tampered = reconcileControlledOperationJournal({ entries: [first, { ...second, reasonCode: "OTHER_REASON" }] });
  assert.equal(tampered.status, "NEEDS_RECONCILIATION");
  assert.equal(tampered.reasonCode, "JOURNAL_CHAIN_BROKEN");
});

test("request-bound journal evidence rejects missing or drifting request identity", () => {
  const requestHash = `sha256:${"a".repeat(64)}`;
  const first = entry({ sourceKind: "request", source: "web.request", requestId: "opreq_fixture", requestHash });
  const second = entry({
    sequence: 2,
    phase: "terminal",
    state: "rejected",
    reasonCode: "REQUEST_REJECTED",
    sourceKind: "request",
    source: "web.request",
    requestId: "opreq_fixture",
    requestHash,
    createdAt: "2026-09-06T00:00:01.000Z",
    previousEventHash: first.eventHash,
  });
  assert.equal(reconcileControlledOperationJournal({ entries: [first, second], expectedRequest: { requestId: "opreq_fixture", requestHash } }).status, "CLEAN");
  assert.equal(reconcileControlledOperationJournal({ entries: [first, second], expectedRequest: { requestId: "opreq_other", requestHash } }).reasonCode, "REQUEST_IDENTITY_MISMATCH");
  assert.equal(reconcileControlledOperationJournal({ entries: [first, second], expectedRequest: { requestId: "opreq_fixture", requestHash: "invalid" } }).reasonCode, "REQUEST_IDENTITY_MISMATCH");
});

test("missing terminal, bad lock metadata, and reconciliation marker stay blocked", () => {
  const active = reconcileControlledOperationJournal({ entries: [entry({ phase: "validation", state: "started", reasonCode: "VALIDATION_STARTED" })] });
  assert.equal(active.reasonCode, "ACTIVE_JOURNAL");
  const badLocks = reconcileControlledOperationJournal({
    entries: [entry(), entry({ sequence: 2, phase: "terminal", state: "rejected", reasonCode: "REQUEST_REJECTED", createdAt: "2026-09-06T00:00:01.000Z", previousEventHash: entry().eventHash })],
    locks: [{ nope: true }],
  });
  assert.equal(badLocks.reasonCode, "LOCK_METADATA_INVALID");
  const reconciliation = entry({
    phase: "reconciliation",
    state: "reconciliation_required",
    reasonCode: "JOURNAL_CORRUPT",
    uncertainPhase: "migration",
  });
  const blocked = reconcileControlledOperationJournal({ entries: [reconciliation] });
  assert.equal(blocked.reasonCode, "JOURNAL_RECONCILIATION_REQUIRED");
  assert.ok(parseControlledOperationReconciliationRecord(blocked));
  assert.equal(parseControlledOperationReconciliationRecord({ ...blocked, executionAttempted: true }), null);
  assert.equal(parseControlledOperationReconciliationRecord({ ...blocked, reasonCode: null }), null);
});
