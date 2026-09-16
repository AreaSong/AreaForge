import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceSearchJob, searchGeneration, workspaceSearchIndexEnabled, workspaceSearchJobFingerprint, workspaceSearchQueueEnabled } from "./workspace-search-job";
import { workspaceGrantAllowsActor, type ActiveWorkspaceGrant, type WorkspaceRole } from "./rbac";

const job = { protocol: "workspace-search-index-job-v1", actorUserId: "user-a", workspaceId: "workspace-a", partitionId: "index-a", generation: 1,
  sourceFingerprint: `sha256:${"a".repeat(64)}`, requestedAt: "2026-09-15T00:00:00.000Z" };
test("索引协议拒绝正文、查询历史、未知字段和畸形代次", () => {
  assert.deepEqual(parseWorkspaceSearchJob(job), job);
  for (const value of [null, [], { ...job, title: "private" }, { ...job, query: "history" }, { ...job, generation: 0 },
    { ...job, generation: Infinity }, { ...job, actorUserId: "../user" }, { ...job, requestedAt: "2026-02-30T00:00:00.000Z" },
    { ...job, protocol: "ranking-rebuild-job-v1" }, Object.assign(Object.create({ extra: true }), job)]) {
    assert.throws(() => parseWorkspaceSearchJob(value), /SEARCH_INDEX_PAYLOAD_INVALID/);
  }
  assert.equal(searchGeneration(0, true), 0); assert.throws(() => searchGeneration(2147483647));
});
test("完整索引指纹绑定分区、用户、工作区、代次、来源和时间", () => {
  const original = workspaceSearchJobFingerprint(job);
  for (const key of ["actorUserId", "workspaceId", "partitionId", "sourceFingerprint", "requestedAt", "generation"] as const) {
    const value = key === "generation" ? 2 : key === "requestedAt" ? "2026-09-15T01:00:00.000Z" : key === "sourceFingerprint" ? `sha256:${"b".repeat(64)}` : "other";
    assert.notEqual(workspaceSearchJobFingerprint({ ...job, [key]: value }), original, key);
  }
  assert.equal(workspaceSearchJobFingerprint({ ...job }), original);
});
test("索引读取与消费者开关分离且默认关闭", () => {
  const flags = ["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "SEARCH_INDEX_ENABLED", "SEARCH_INDEX_QUEUE_ENABLED", "DATA_JOB_WORKER_ENABLED"];
  const env = Object.fromEntries(flags.map(key => [key, "true"]));
  assert.equal(workspaceSearchQueueEnabled(env), true); assert.equal(workspaceSearchQueueEnabled({}), false);
  for (const key of flags) for (const value of [undefined, "false", "TRUE", "1"]) assert.equal(workspaceSearchQueueEnabled({ ...env, [key]: value }), false);
  assert.equal(workspaceSearchIndexEnabled({ ...env, DATA_JOB_WORKER_ENABLED: "false", SEARCH_INDEX_QUEUE_ENABLED: "false" }), true);
});
test("共享 grant 判定保留原 Web 语义并拒绝过期、撤销和错配目标", () => {
  const now = new Date("2026-09-15T00:00:00Z");
  const base: ActiveWorkspaceGrant = { scope: "USER", granteeUserId: "member", granteeRole: null, access: "VIEW", revokedAt: null, expiresAt: null };
  const actor = { actorId: "member", role: "MEMBER" as WorkspaceRole };
  assert.equal(workspaceGrantAllowsActor(base, actor, "VIEW", now), true);
  for (const grant of [{ ...base, revokedAt: now }, { ...base, expiresAt: now }, { ...base, granteeUserId: "other" }, { ...base, granteeRole: "COACH" as WorkspaceRole }]) {
    assert.equal(workspaceGrantAllowsActor(grant, actor, "VIEW", now), false);
  }
  assert.equal(workspaceGrantAllowsActor({ ...base, scope: "WORKSPACE", granteeUserId: null }, actor, "VIEW", now), true);
  assert.equal(workspaceGrantAllowsActor({ ...base, scope: "WORKSPACE", granteeUserId: null, access: "COACH" }, actor, "VIEW", now), false);
  assert.equal(workspaceGrantAllowsActor({ ...base, scope: "ROLE", granteeUserId: null, granteeRole: "COACH", access: "COACH" }, { ...actor, role: "COACH" }, "COACH", now), true);
});
