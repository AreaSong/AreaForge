import assert from "node:assert/strict";
import test from "node:test";
import { hashDataExportValue } from "./data-lifecycle";
import { selectPersistedDeletionReplay, validatePersistedDeletionLedger } from "./data-delete-ledger";
const digest = "sha256:" + "a".repeat(64);
function entry() {
  const value = { intentId: "intent-1", scope: "RESOURCE", scopeHash: digest, previousHash: null, completedAt: "2026-09-14T00:00:00.000Z",
    manifest: { protocol: "data-delete-ledger-v2", target: { requesterId: "owner", scope: "RESOURCE", workspaceId: "workspace", resourceType: "Note", resourceId: "note" },
      items: [{ model: "Note", key: { id: "note" }, identityHash: digest }], files: [], securityCleanup: [], securityOwnerId: null, securityCleanupCounts: {} } };
  return { ...value, sequence: "1", entryHash: hashDataExportValue(value) };
}
test("持久删除账本绑定可信 head、顺序、资源身份与完整 hash", () => {
  const row = entry(); assert.equal(validatePersistedDeletionLedger([row], row.entryHash).length, 1);
  assert.throws(() => validatePersistedDeletionLedger([row], digest), /HEAD_MISMATCH/);
  assert.throws(() => validatePersistedDeletionLedger([{ ...row, sequence: "2" }], row.entryHash), /LEDGER_INVALID/);
  const changed = structuredClone(row); changed.manifest.items[0]!.key.id = "other";
  assert.throws(() => validatePersistedDeletionLedger([changed], row.entryHash), /LEDGER_INVALID/);
});
test("账本拒绝额外正文字段和不完整 scope", () => {
  const row = entry();
  assert.throws(() => validatePersistedDeletionLedger([{ ...row, privateBody: "forbidden" }], row.entryHash), /LEDGER_INVALID/);
  const changed = structuredClone(row); changed.manifest.target.resourceId = "../unsafe";
  assert.throws(() => validatePersistedDeletionLedger([changed], row.entryHash));
});
test("恢复按备份账本水位重放缺失后缀，不依赖预提交时间", () => {
  const first = entry();
  const { sequence: _sequence, entryHash: _hash, ...body } = entry();
  const secondBody = { ...body, intentId: "intent-2", previousHash: first.entryHash, completedAt: "2026-09-13T23:59:59.000Z" };
  const second = { ...secondBody, sequence: "2", entryHash: hashDataExportValue(secondBody) };
  const input = [first, second];
  assert.deepEqual(selectPersistedDeletionReplay(input, second.entryHash, { sequence: "1", entryHash: first.entryHash }), [second]);
  assert.deepEqual(selectPersistedDeletionReplay(input, second.entryHash, { sequence: "0", entryHash: null }), input);
  assert.deepEqual(selectPersistedDeletionReplay(input, second.entryHash, { sequence: "2", entryHash: second.entryHash }), []);
  for (const watermark of [{ sequence: "01", entryHash: first.entryHash }, { sequence: "1", entryHash: digest },
    { sequence: "3", entryHash: second.entryHash }, { sequence: "0", entryHash: first.entryHash }]) {
    assert.throws(() => selectPersistedDeletionReplay(input, second.entryHash, watermark), /WATERMARK_MISMATCH/);
  }
  assert.throws(() => selectPersistedDeletionReplay([first], first.entryHash, { sequence: "2", entryHash: second.entryHash }), /WATERMARK_MISMATCH/);
});
