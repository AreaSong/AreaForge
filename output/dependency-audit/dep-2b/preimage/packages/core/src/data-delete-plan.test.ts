import assert from "node:assert/strict";
import test from "node:test";
import { createDataDeletePlan, dataDeleteControlAllowed, dataDeleteSummary } from "./data-delete-plan";
const hash = (char: string) => "sha256:" + char.repeat(64);
const target = { requesterId: "user-1", scope: "ACCOUNT" as const, workspaceId: null, resourceType: null, resourceId: null };
const item = { model: "Note", key: { id: "note-1" }, identityHash: hash("a"), rowHash: hash("b") };
const plan = () => createDataDeletePlan({ target, authorizationHash: hash("c"), schemaHash: hash("d"), items: [item], blockers: [] });

test("删除计划绑定身份、内容版本及授权，不以相同计数替代对象集合", () => {
  const first = plan();
  for (const changed of [{ ...item, key: { id: "note-2" }, identityHash: hash("e") }, { ...item, rowHash: hash("e") }]) {
    assert.notEqual(createDataDeletePlan({ ...first, items: [changed] }).fingerprint, first.fingerprint);
  }
  assert.notEqual(createDataDeletePlan({ ...first, authorizationHash: hash("e") }).fingerprint, first.fingerprint);
  assert.equal(dataDeleteSummary(first).totalObjects, 1);
  assert.equal(JSON.stringify(dataDeleteSummary(first)).includes("note-1"), false);
});

test("删除计划拒绝重复身份、未知范围和不安全标识", () => {
  assert.throws(() => createDataDeletePlan({ ...plan(), items: [item, item] }), /DUPLICATE/);
  assert.throws(() => createDataDeletePlan({ ...plan(), target: { ...target, workspaceId: "workspace-1" } }), /SCOPE_INVALID/);
  assert.throws(() => createDataDeletePlan({ ...plan(), items: [{ ...item, key: { id: "../outside" } }] }), /IDENTIFIER_INVALID/);
});

test("回收站恢复和不可逆点后的取消由持久状态决定", () => {
  assert.equal(dataDeleteControlAllowed("TRASHED", null).canRestore, true);
  assert.equal(dataDeleteControlAllowed("COOLDOWN", null).canCancel, true);
  assert.equal(dataDeleteControlAllowed("RUNNING", new Date()).canCancel, false);
  assert.equal(dataDeleteControlAllowed("SUCCEEDED", new Date()).canRetry, false);
});
