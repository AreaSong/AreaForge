import assert from "node:assert/strict";
import test from "node:test";
import { createDataJobHandlers } from "../workers/data-job-handlers";
import { parseRankingNotificationPayload } from "../workers/ranking-notification-handler";
import { parseDataJobWorkerArguments, runConfiguredDataJobWorker } from "../workers/data-job-worker";

test("通知处理器注册是显式 allowlist 且默认关闭", async () => {
  assert.equal(createDataJobHandlers({}).length, 0);
  assert.equal(createDataJobHandlers({ PLATFORM_NOTIFICATIONS_ENABLED: "true" }).length, 0);
  assert.equal(createDataJobHandlers({ PLATFORM_NOTIFICATIONS_ENABLED: "true", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "true" }).length, 1);
  await assert.rejects(runConfiguredDataJobWorker([], {}), /DATA_JOB_WORKER_DISABLED/);
  await assert.rejects(runConfiguredDataJobWorker(["--script=arbitrary"], {}), /DATA_JOB_WORKER_ARGUMENT_INVALID/);
  await assert.rejects(runConfiguredDataJobWorker([], { DATA_JOB_WORKER_ENABLED: "true" }), /DATA_JOB_HANDLERS_REQUIRED/);
  assert.deepEqual(parseDataJobWorkerArguments(["--once", "--workspace=workspace-1"]), { once: true, workspaceId: "workspace-1", reclaimExports: false });
  for (const args of [["--once", "--once"], ["--workspace=../escape"], ["--workspace=x", "--workspace=y"]]) assert.throws(() => parseDataJobWorkerArguments(args));
});

test("旧的未绑定通知 payload 不会被新处理器误消费", () => {
  assert.throws(() => parseRankingNotificationPayload({
    recipientUserId: "user-1", workspaceId: "workspace-1", kind: "RANKING_APPEAL_STATUS",
    sourceEntityType: "RANKING_APPEAL", sourceEntityId: "appeal-1", eventKey: "ranking:event-1",
  }), /USER_NOTIFICATION_PAYLOAD_INVALID/);
});
