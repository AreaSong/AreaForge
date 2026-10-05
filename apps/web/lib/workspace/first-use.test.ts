import assert from "node:assert/strict";
import test from "node:test";
import { materializeFirstUseTemplateSelection, nextAvailableGeneratedKey, nextFirstUseDraftId, restoreFirstUseDraftRows, workspaceSetupErrorMessage } from "./first-use";

test("首次设置网络或内部错误不误报未保存，重放冲突给出核对入口", () => {
  for (const code of [undefined, "INTERNAL_ERROR"]) {
    assert.match(workspaceSetupErrorMessage(code), /未能确认保存结果.*草稿已保留/);
    assert.doesNotMatch(workspaceSetupErrorMessage(code), /尚未保存|设置未完成/);
  }
  assert.match(workspaceSetupErrorMessage("WORKSPACE_CREATE_SELECTION_CHANGED"), /设置已保存.*不会自动切回/);
  assert.match(workspaceSetupErrorMessage("WORKSPACE_CREATE_IDEMPOTENCY_CONFLICT"), /刷新核对.*草稿仍保留/);
});

test("修改内部标识、删除与恢复草稿均保持独立行身份", () => {
  for (const kind of ["subject", "group"] as const) {
    const rows = [{ id: `draft:${kind}-1`, stableKey: "custom-a", name: "已有输入" }];
    const added = { id: nextFirstUseDraftId(kind, rows), stableKey: nextAvailableGeneratedKey(kind, rows.map(row => row.stableKey)), name: "新行" };
    assert.notEqual(added.id, rows[0].id);
    assert.deepEqual([...rows, added].filter(row => row.id !== added.id), rows);
    const restored = restoreFirstUseDraftRows(kind, [...rows, { ...added, id: rows[0].id }, { ...added, id: `draft:${kind}-2` }]);
    assert.equal(new Set(restored.map(row => row.id)).size, 3);
    assert.deepEqual(restored.map(({ name, stableKey }) => ({ name, stableKey })), [...rows, added, added].map(({ name, stableKey }) => ({ name, stableKey })));
    assert.deepEqual(restoreFirstUseDraftRows(kind, restored), restored);
  }
});

test("模板行改名改标识后重选模板不会复用身份或覆盖原输入", () => {
  const first = materializeFirstUseTemplateSelection({ subjects: [], groups: [], templateId: "computer-science-408" });
  first.subjects[0] = { ...first.subjects[0], stableKey: "custom-subject", name: "自定义科目" };
  first.groups[0] = { ...first.groups[0], stableKey: "custom-group", name: "自定义组" };
  const second = materializeFirstUseTemplateSelection({ ...first, templateId: "computer-science-408" });
  assert.equal(new Set(second.subjects.map(row => row.id)).size, second.subjects.length);
  assert.equal(new Set(second.groups.map(row => row.id)).size, second.groups.length);
  assert.deepEqual(second.subjects[0], first.subjects[0]);
  assert.deepEqual(second.groups[0], first.groups[0]);
});
