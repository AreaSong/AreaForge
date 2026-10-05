import assert from "node:assert/strict";
import test from "node:test";
import { filterCurrentSessionEvidence } from "./session-evidence-contract";

test("当前回执重验归属、工作区及归档状态，不重放已失效的审计标签", async () => {
  const queries: Record<string, unknown> = {};
  const client = Object.fromEntries(["note", "mistake", "masteryRetest"].map(model => [model, {
    findMany: async (query: { where: Record<string, unknown> }) => { queries[model] = query.where; return model === "note" ? [{ id: "same", title: "现标题" }] : []; },
  }])) as unknown as Parameters<typeof filterCurrentSessionEvidence>[0];
  const receipts = [
    { evidenceType: "note" as const, evidenceId: "same", label: "旧标题" },
    { evidenceType: "mistake" as const, evidenceId: "same", label: "归档错题" },
    { evidenceType: "note" as const, evidenceId: "gone", label: "已删除或冻结" },
  ];
  assert.deepEqual(await filterCurrentSessionEvidence(client, "actor", "workspace", receipts), [{ ...receipts[0], label: "现标题" }]);
  assert.deepEqual(queries.note, { id: { in: ["same", "gone"] }, ownerUserId: "actor", archivedAt: null, subject: { workspaceId: "workspace" } });
  assert.deepEqual(queries.mistake, { id: { in: ["same"] }, ownerUserId: "actor", archivedAt: null, subject: { workspaceId: "workspace" } });
});
