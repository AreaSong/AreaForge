import { notificationQueueEnabled, parseRankingNotificationJob, RankingNotificationError } from "../../packages/core/src/index";
import { deliverRankingNotificationJob } from "../../packages/db/src/index";
import { DataJobHandlerError, type DataJobHandler } from "./data-job-handler";

export const parseRankingNotificationPayload = parseRankingNotificationJob;

/** 持久 row 是提交源事实，不信任 prepare 时可被调用者替换的 lease payload。 */
export function createRankingNotificationHandler(env: Readonly<Record<string, string | undefined>> = process.env): DataJobHandler {
  return {
    kind: "NOTIFICATION",
    prepare: async () => {
      if (!notificationQueueEnabled(env)) throw new DataJobHandlerError("USER_NOTIFICATION_QUEUE_DISABLED", true);
      return async (tx, job) => {
        try { await deliverRankingNotificationJob(tx, job, env); }
        catch (error) {
          if (error instanceof RankingNotificationError) throw new DataJobHandlerError(error.code, error.retryable);
          throw error;
        }
      };
    },
  };
}
