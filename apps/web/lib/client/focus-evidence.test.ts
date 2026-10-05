import assert from "node:assert/strict";
import test from "node:test";
import { archiveFocusEvidence } from "./focus-evidence";

test("证据归档读取并使用真实版本，且成功响应必须确认归档", async () => {
  for (const evidenceType of ["note", "mistake"] as const) {
    const calls: unknown[] = [];
    const source = { id: "source", revision: 8, updatedAt: "2026-01-01T00:00:00.000Z" };
    const read = async () => ({ ok: true, body: { [evidenceType]: source } });
    const archive = async (id: string, input: unknown) => { calls.push([id, input]); return { ok: true, body: { [evidenceType]: { ...source, archivedAt: "2026-10-04T00:00:00.000Z" } } }; };
    const api = { getNote: read, getMistake: read, archiveNote: archive, archiveMistake: archive } as unknown as Parameters<typeof archiveFocusEvidence>[1];
    await archiveFocusEvidence({ evidenceType, evidenceId: source.id, label: "证据" }, api);
    assert.deepEqual(calls, [[source.id, evidenceType === "note" ? { expectedRevision: 8 } : { expectedUpdatedAt: source.updatedAt }]]);
  }
});

test("读取失败不发归档；冲突、网络异常和空回执均不得假成功", async () => {
  for (const evidenceType of ["note", "mistake"] as const) {
    for (const failure of ["read", "conflict", "empty", "network"]) {
      let calls = 0;
      const read = async () => ({ ok: failure !== "read", body: { [evidenceType]: { id: "source", revision: 9, updatedAt: "2026-01-01T00:00:00.000Z" } } });
      const archive = async () => { calls++; if (failure === "network") throw new Error("network"); return { ok: failure !== "conflict", body: null }; };
      const api = { getNote: read, getMistake: read, archiveNote: archive, archiveMistake: archive } as unknown as Parameters<typeof archiveFocusEvidence>[1];
      await assert.rejects(archiveFocusEvidence({ evidenceType, evidenceId: "source", label: "证据" }, api));
      assert.equal(calls, failure === "read" ? 0 : 1);
    }
  }
  await assert.rejects(archiveFocusEvidence({ evidenceType: "retest", evidenceId: "id", label: "复测" }));
});
