import assert from "node:assert/strict";
import test from "node:test";
import { controlSearchIndex, getSearchIndex, requestSearchIndex, searchIndexUncertain, searchIndexAccessLost } from "./search-index";
import type { WorkspaceSearchJobView } from "@areaforge/core";

const stamp = "2026-09-15T00:00:00.000Z";
const job = { id: "search-job", status: "QUEUED", revision: 1, generation: 1, progress: 0, attempt: 0, maxAttempts: 5,
  retryable: false, pauseRequested: false, deadLettered: false, errorCode: null, nextAttemptAt: stamp, createdAt: stamp, expiresAt: stamp, controls: ["CANCEL"] };
test("索引202回执残缺、未知字段或畸形值属于同请求重试", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of ["{", "", JSON.stringify({ job: { ...job, title: "private" } }), JSON.stringify({ job: { ...job, generation: -1 } }),
      JSON.stringify({ job: { ...job, generation: 2 } })]) {
      globalThis.fetch = async () => new Response(body, { status: 202 });
      const result = await requestSearchIndex("workspace", { expectedGeneration: 0, idempotencyKey: "search-a" });
      assert.equal(result.body, null); assert.equal(searchIndexUncertain(result), true);
    }
    globalThis.fetch = async () => Response.json({ job }, { status: 202 });
    const result = await requestSearchIndex("workspace", { expectedGeneration: 0, idempotencyKey: "search-a" });
    assert.equal(result.body?.job?.id, job.id); assert.equal(searchIndexUncertain(result), false);
  } finally { globalThis.fetch = original; }
});
test("索引控制回执必须绑定原任务，失效索引不能带旧计数与时间", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ job: { ...job, id: "other-job" } });
    assert.equal((await controlSearchIndex("workspace", job as WorkspaceSearchJobView, "CANCEL")).body, null);
    for (const index of [{ state: "CURRENT", indexedAt: null, documentCount: 8 },
      { state: "STALE", indexedAt: stamp, documentCount: 0 }, { state: "STALE", indexedAt: null, documentCount: 8 }]) {
      globalThis.fetch = async () => Response.json({ searchIndex: { workspaceId: "workspace", enabled: true, generation: 1, index, jobs: [] } });
      assert.equal((await getSearchIndex("workspace")).ok, false);
    }
  } finally { globalThis.fetch = original; }
});
test("权限丢失清空视图，关闭开关不冒充身份失效", () => {
  const result = { ok: false, status: 401, body: null, headers: new Headers() };
  assert.equal(searchIndexAccessLost(result), true);
  assert.equal(searchIndexAccessLost({ ...result, status: 404, body: { error: "SEARCH_INDEX_DISABLED" } }), false);
});
