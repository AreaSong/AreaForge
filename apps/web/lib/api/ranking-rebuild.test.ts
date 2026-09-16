import assert from "node:assert/strict";
import { test } from "node:test";
import { rankingRebuildAccessLost, rankingRebuildResponseUncertain, requestRankingRebuild } from "./ranking-rebuild";

const stamp = "2026-09-15T00:00:00.000Z";
const job = { id: "job-a", status: "QUEUED", revision: 1, progress: 0, attempt: 0, maxAttempts: 5, errorCode: null,
  retryable: false, pauseRequested: false, deadLettered: false, nextAttemptAt: stamp, createdAt: stamp,
  expiresAt: stamp, dataCutoff: stamp, controls: ["CANCEL", "PAUSE"] };

test("202 回执残缺或字段非法时保留同一幂等请求", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of ["", JSON.stringify({ job: { ...job, authorization: "forbidden" } }), JSON.stringify({ job: { ...job, id: null } })]) {
      globalThis.fetch = async () => new Response(response, { status: 202 });
      const result = await requestRankingRebuild("challenge-a", { expectedRevision: 1, idempotencyKey: "request-a" });
      assert.equal(result.ok, true); assert.equal(result.body, null); assert.equal(rankingRebuildResponseUncertain(result), true);
    }
    globalThis.fetch = async () => Response.json({ job }, { status: 202 });
    const result = await requestRankingRebuild("challenge-a", { expectedRevision: 1, idempotencyKey: "request-a" });
    assert.equal(result.body?.job?.id, "job-a"); assert.equal(rankingRebuildResponseUncertain(result), false);
  } finally { globalThis.fetch = original; }
});

test("权限失败清理当前作用域，但单独关闭队列仍可查看和取消旧任务", () => {
  const result = { ok: false, status: 401, headers: new Headers(), body: null };
  assert.equal(rankingRebuildAccessLost(result), true);
  assert.equal(rankingRebuildAccessLost({ ...result, status: 404, body: { error: "RANKING_REBUILD_NOT_FOUND" } }), true);
  assert.equal(rankingRebuildAccessLost({ ...result, status: 404, body: { error: "RANKING_REBUILD_DISABLED" } }), false);
  assert.equal(rankingRebuildAccessLost({ ...result, status: 503, body: { error: "RANKING_REBUILD_SCOPE_BUSY" } }), false);
});

test("配额429保留当前任务与权限视图，不进入不明确回执分支", () => {
  const result = { ok: false, status: 429, body: { error: "DATA_JOB_QUOTA_ACTIVE_LIMIT" }, headers: new Headers() };
  assert.equal(rankingRebuildResponseUncertain(result), false);
  assert.equal(rankingRebuildAccessLost(result), false);
});
