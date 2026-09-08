import assert from "node:assert/strict";
import test from "node:test";
import { createDataJobHandlers } from "../workers/data-job-handlers";
import { parseRankingNotificationPayload } from "../workers/ranking-notification-handler";

test("通知处理器注册是显式 allowlist 且默认关闭", () => {
  assert.equal(createDataJobHandlers({}).length, 0);
  assert.equal(createDataJobHandlers({ PLATFORM_NOTIFICATIONS_ENABLED: "true" }).length, 0);
  assert.equal(createDataJobHandlers({ PLATFORM_NOTIFICATIONS_ENABLED: "true", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "true" }).length, 1);
});

test("通知任务 payload 只允许受控类型和不透明标识", () => {
  const payload = parseRankingNotificationPayload({
    recipientUserId: "user-1", workspaceId: "workspace-1", kind: "RANKING_APPEAL_STATUS",
    sourceEntityType: "RANKING_APPEAL", sourceEntityId: "appeal-1", eventKey: "ranking:event-1",
  });
  assert.equal(payload.kind, "RANKING_APPEAL_STATUS");
  for (const invalid of [
    null,
    { ...payload, kind: "SHELL" },
    { ...payload, sourceEntityType: "UNKNOWN" },
    { ...payload, recipientUserId: "" },
    { ...payload, sourceEntityId: "x".repeat(301) },
  ]) assert.throws(() => parseRankingNotificationPayload(invalid), /USER_NOTIFICATION_PAYLOAD_INVALID/);
});
