import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyWorkflowForm,
  readGeneratedResult,
  snapshotAdoption,
  snapshotRequestInput,
} from "./ai-draft-workflow-support";

test("AI request and adoption snapshots freeze mutable form identities", () => {
  const form = {
    ...emptyWorkflowForm("第一版输入"),
    checked: { subjectLabel: true },
    values: { ...emptyWorkflowForm().values, subjectLabel: "数学" },
    draft: { schemaVersion: "knowledge-card-draft-v1" },
    operation: { id: "operation-1", projectionVersion: "v1", resultProof: "proof-1" },
  };
  const request = snapshotRequestInput("knowledge-card", form);
  const adoption = snapshotAdoption(
    { endpoint: "knowledge-card", userId: "user-1" },
    form,
    "draft-key",
  );

  form.selectedText = "第二版输入";
  form.checked.subjectLabel = false;
  form.values.subjectLabel = "英语";
  form.operation.id = "operation-2";

  assert.equal(request.selectedText, "第一版输入");
  assert.deepEqual(request.checked, { subjectLabel: true });
  assert.equal(request.values.subjectLabel, "数学");
  assert.deepEqual(adoption.operation, {
    id: "operation-1",
    projectionVersion: "v1",
    resultProof: "proof-1",
  });
  assert.equal(adoption.values.subjectLabel, "数学");
});

test("AI generated result requires a complete immutable identity", () => {
  assert.equal(readGeneratedResult({
    draft: { title: "草稿" },
    operationId: "operation-1",
    projectionVersion: "v1",
  }), null);
  assert.deepEqual(readGeneratedResult({
    draft: { title: "草稿" },
    operationId: "operation-1",
    projectionVersion: "v1",
    resultProof: "proof-1",
  }), {
    draft: { title: "草稿" },
    operation: { id: "operation-1", projectionVersion: "v1", resultProof: "proof-1" },
  });
});
