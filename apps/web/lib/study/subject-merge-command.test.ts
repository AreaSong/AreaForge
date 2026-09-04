import assert from "node:assert/strict";
import test from "node:test";
import { subjectMergeConfirmSchema, subjectMergeUndoSchema } from "./subject-merge-command";

const validCommand = {
  targetSubjectId: "target",
  sourceSubjectIds: ["source-a", "source-b"],
  snapshotHash: "sha256:" + "a".repeat(64),
  expectedWorkspaceRevision: 3,
  idempotencyKey: "merge-command-1",
  confirm: true,
};

test("subject merge confirm command accepts the complete strict payload", () => {
  assert.equal(subjectMergeConfirmSchema.safeParse(validCommand).success, true);
});

test("subject merge confirm command rejects missing confirmation and unknown fields", () => {
  const { confirm, ...withoutConfirm } = validCommand;
  assert.equal(confirm, true);
  assert.equal(subjectMergeConfirmSchema.safeParse(withoutConfirm).success, false);
  assert.equal(subjectMergeConfirmSchema.safeParse({ ...validCommand, actorId: "attacker" }).success, false);
});

test("subject merge confirm command rejects duplicate sources and a target mixed into sources", () => {
  assert.equal(subjectMergeConfirmSchema.safeParse({
    ...validCommand,
    sourceSubjectIds: ["source-a", "source-a"],
  }).success, false);
  assert.equal(subjectMergeConfirmSchema.safeParse({
    ...validCommand,
    sourceSubjectIds: ["source-a", "target"],
  }).success, false);
});

test("subject merge undo command requires a strict confirmed snapshot", () => {
  const command = {
    expectedWorkspaceRevision: 4,
    undoSnapshotHash: "sha256:" + "b".repeat(64),
    idempotencyKey: "undo-command-1",
    confirm: true,
  };
  assert.equal(subjectMergeUndoSchema.safeParse(command).success, true);
  assert.equal(subjectMergeUndoSchema.safeParse({ ...command, confirm: false }).success, false);
  assert.equal(subjectMergeUndoSchema.safeParse({ ...command, actorId: "attacker" }).success, false);
});
