import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { notificationEventKey, notificationJobFingerprint, notificationJobKey, parseRankingNotificationEvent, parseRankingNotificationJob, type RankingNotificationEvent, type RankingNotificationJob } from "./ranking-notification-job";
import { stableStringify } from "./ai-draft";

const event: RankingNotificationEvent = { actorUserId: "owner", recipientUserId: "member", workspaceId: "workspace", kind: "RANKING_INVITATION", sourceEntityType: "PRIVATE_CHALLENGE_PARTICIPANT", sourceEntityId: "participant", eventVersion: 1 };
const payload: RankingNotificationJob = {
  protocol: "ranking-notification-job-v1", event, eventKey: notificationEventKey(event), authorization: {
    actorAuthRevision: 1, recipientAuthRevision: 1, workspaceRevision: 1,
    actorMembershipId: "ma", actorMembershipRevision: 1, recipientMembershipId: "mb", recipientMembershipRevision: 1,
  },
};

test("通知协议严格拒绝额外字段、路径、未知种类和不匹配源", () => {
  assert.deepEqual(parseRankingNotificationJob(payload), payload);
  for (const invalid of [
    null, [], { ...payload, body: "private" }, { ...payload, eventKey: "forged" }, { ...payload, protocol: "unknown" },
    { ...payload, event: { ...event, actorUserId: "../escape" } }, { ...payload, event: { ...event, body: "private" } },
    { ...payload, event: { ...event, sourceEntityType: "PRIVATE_CHALLENGE" } }, { ...payload, event: { ...event, eventVersion: 0 } },
    { ...payload, authorization: { ...payload.authorization, recipientAuthRevision: NaN } },
    Object.assign(Object.create({ inherited: true }), payload),
  ]) assert.throws(() => parseRankingNotificationJob(invalid));
  for (const bad of ["", "x/y", "中文", " a "]) assert.throws(() => parseRankingNotificationEvent({ ...event, sourceEntityId: bad }));
});

test("通知 hash 绑定完整协议与所有权限版本，不使用导出脱敏", () => {
  const expected = `sha256:${createHash("sha256").update(`areaforge:ranking-notification-job:v1\n${stableStringify(payload)}`).digest("hex")}`;
  assert.equal(notificationJobFingerprint(payload), expected);
  for (const key of Object.keys(payload.authorization) as Array<keyof typeof payload.authorization>) {
    const original = payload.authorization[key];
    const changed = { ...payload.authorization, [key]: typeof original === "number" ? original + 1 : `${original}x` };
    assert.notEqual(notificationJobFingerprint({ ...payload, authorization: changed }), expected);
  }
  assert.notEqual(notificationJobKey({ ...event, recipientUserId: "other" }), notificationJobKey(event));
  assert.notEqual(notificationJobKey({ ...event, workspaceId: "other" }), notificationJobKey(event));
});
