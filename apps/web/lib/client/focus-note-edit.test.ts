import assert from "node:assert/strict";
import test from "node:test";
import { canSaveFocusNote, loadEditableFocusNote, type FocusNoteBaseline } from "./focus-note-edit";
import { createLatestOperationGate } from "./operation-gates";

const read = (body: unknown, ok = true) => (async () => ({ ok, body })) as unknown as Parameters<typeof loadEditableFocusNote>[1];
test("未加载、目标不匹配、缺版本、只读及网络失败均不能建立编辑基线", async () => {
  for (const body of [null, {}, { note: { id: "other", revision: 1 } }, { note: { id: "target" } }, { note: { id: "target", revision: 0 } }, { note: { id: "target", revision: 1 }, readOnly: true }, { note: { id: "target", revision: 1 }, subjectArchived: true }]) {
    await assert.rejects(loadEditableFocusNote("target", read(body)));
  }
  await assert.rejects(loadEditableFocusNote("target", read({ note: { id: "target", revision: 1 } }, false)));
  await assert.rejects(loadEditableFocusNote("target", async () => { throw new Error("network"); }));
  assert.equal(canSaveFocusNote("target", null), false);
  assert.equal(canSaveFocusNote("target", { context: "previous", revision: 1 }), false);
});

test("失败后重试取得目标真实版本；切换目标丢弃迟到详情", async () => {
  let baseline: FocusNoteBaseline | null = null;
  const gate = createLatestOperationGate();
  const first = gate.begin();
  let finish!: (value: Awaited<ReturnType<NonNullable<Parameters<typeof loadEditableFocusNote>[1]>>>) => void;
  const pending = loadEditableFocusNote("old", () => new Promise(resolve => { finish = resolve; }));
  gate.invalidate();
  const retry = gate.begin();
  const note = await loadEditableFocusNote("new", read({ note: { id: "new", revision: 7 } }));
  if (gate.isCurrent(retry)) baseline = { context: "new", revision: note.revision };
  finish({ ok: true, body: { note: { id: "old", revision: 1 } } } as Awaited<ReturnType<NonNullable<Parameters<typeof loadEditableFocusNote>[1]>>>);
  const stale = await pending;
  if (gate.isCurrent(first)) baseline = { context: "old", revision: stale.revision };
  assert.deepEqual(baseline, { context: "new", revision: 7 });
  assert.equal(canSaveFocusNote("new", baseline), true);
  assert.equal(canSaveFocusNote("old", baseline), false);
});
