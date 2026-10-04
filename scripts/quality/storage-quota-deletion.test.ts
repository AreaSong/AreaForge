import assert from "node:assert/strict";
import { test } from "node:test";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import type { PrismaClient } from "../../packages/db/src/index";

test("定向删除 claim 的过期回收也必须限定 intent", async () => {
  const previous = [process.env.DATA_DELETE_ENABLED, process.env.DATA_LIFECYCLE_ENABLED];
  process.env.DATA_DELETE_ENABLED = process.env.DATA_LIFECYCLE_ENABLED = "true";
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const tx = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("?"); queries.push({ sql, values });
    return sql.includes("clock_timestamp") ? [{ now: new Date() }] : [];
  } };
  try {
    await claimDatabaseDeletion({ $transaction: (run: (value: typeof tx) => unknown) => run(tx) } as unknown as PrismaClient, "storage-worker", "storage-intent");
    const stale = queries.find(query => query.sql.includes("state='RUNNING'"))!;
    assert.ok(stale.sql.includes("id=?"), "定向 claim 不得回收其他 intent");
    assert.ok(stale.values.includes("storage-intent"));
  } finally {
    ["DATA_DELETE_ENABLED", "DATA_LIFECYCLE_ENABLED"].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    });
  }
});

import { deletionIdentitySelection, checkedDeletionResult } from "../../packages/db/src/data-delete-result-visibility";
import { deletionReadArgs } from "../../packages/db/src/data-delete-visibility";
test("必选关系内部身份不泄露，mutation 隐藏返回拒绝而不跳过过滤", () => {
  const fences = new Map([["StudyResource", [{ id: "frozen" }]]]);
  const args = { select: { resource: { select: { title: true } } } };
  const rewritten = deletionReadArgs("StudyResourceNoteLink", args, { fences, revision: 1n }, false);
  assert.equal("where" in rewritten, false);
  const internal = deletionIdentitySelection("StudyResourceNoteLink", rewritten) as { select: Record<string, unknown> };
  assert.equal(internal.select.id, true);
  assert.throws(() => checkedDeletionResult("StudyResourceNoteLink", { id: "link", resource: { id: "frozen", title: "hidden" } }, args, fences), { code: "DATA_DELETE_READ_BUSY" });
  assert.deepEqual(checkedDeletionResult("StudyResourceNoteLink", { id: "link", resource: { id: "allowed", title: "visible" } }, args, fences), { resource: { title: "visible" } });
});
