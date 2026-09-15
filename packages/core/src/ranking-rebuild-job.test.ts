import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRankingRebuildJob, rankingRebuildJobFingerprint, rankingRebuildQueueEnabled } from "./ranking-rebuild-job";

const participant = { participantId: "participant-a", userId: "user-a", participantRevision: 1, authRevision: 1,
  membershipId: "member-a", membershipRevision: 1, preferenceRevision: 1, authorizedFields: ["score"] };
const payload = () => ({ protocol: "ranking-rebuild-job-v1", actorUserId: "user-a", workspaceId: "workspace-a",
  challengeId: "challenge-a", challengeRevision: 1, generation: 1, scoreVersion: "private-challenge-v1", rulesVersion: 1,
  dataCutoff: "2026-09-15T00:00:00.000Z", ruleFingerprint: `sha256:${"a".repeat(64)}`, sourceFingerprint: `sha256:${"b".repeat(64)}`,
  authorization: { workspaceRevision: 1, deletionRevision: "0", participants: [{ ...participant }] } });

test("排名重建协议只接受精确字段、版本和完整本人参与绑定", () => {
  assert.equal(parseRankingRebuildJob(payload()).challengeId, "challenge-a");
  for (const value of [{ ...payload(), title: "private" }, { ...payload(), protocol: "legacy" },
    { ...payload(), actorUserId: "someone-else" }, { ...payload(), challengeId: "../private" },
    { ...payload(), dataCutoff: "2026-02-30T00:00:00.000Z" }, { ...payload(), sourceFingerprint: "unknown" }]) {
    assert.throws(() => parseRankingRebuildJob(value), /RANKING_REBUILD_PAYLOAD_INVALID/);
  }
  assert.throws(() => parseRankingRebuildJob({ ...payload(), authorization: { ...payload().authorization,
    participants: [{ ...participant, authorizedFields: ["score", "private_title"] }] } }));
  assert.throws(() => parseRankingRebuildJob({ ...payload(), authorization: { ...payload().authorization,
    participants: [participant, participant] } }));
});

test("排名重建指纹覆盖权限历史、删除代次、来源及截止时间", () => {
  const first = rankingRebuildJobFingerprint(payload());
  for (const value of [{ ...payload(), dataCutoff: "2026-09-15T00:00:00.001Z" },
    { ...payload(), sourceFingerprint: `sha256:${"c".repeat(64)}` },
    { ...payload(), authorization: { ...payload().authorization, deletionRevision: "1" } },
    { ...payload(), authorization: { ...payload().authorization, participants: [{ ...participant, authRevision: 2 }] } }]) {
    assert.notEqual(rankingRebuildJobFingerprint(value), first);
  }
  assert.equal(rankingRebuildJobFingerprint(parseRankingRebuildJob(payload())), first);
});

test("排名重建需要全部显式开关，缺失或畸形值关闭", () => {
  const env = Object.fromEntries(["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "RANKING_ENABLED", "RANKING_PROJECTION_ENABLED",
    "RANKING_REBUILD_QUEUE_ENABLED", "DATA_JOB_WORKER_ENABLED"].map(key => [key, "true"]));
  assert.equal(rankingRebuildQueueEnabled(env), true);
  for (const key of Object.keys(env)) for (const value of [undefined, "false", "TRUE", "1"]) {
    assert.equal(rankingRebuildQueueEnabled({ ...env, [key]: value }), false);
  }
});
