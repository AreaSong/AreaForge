import { createRankingNotificationHandler } from "./ranking-notification-handler";
import type { DataJobHandler } from "./data-job-handler";

/** 处理器注册是代码 allowlist；环境变量只能打开已登记的处理器，不能指定模块路径。 */
export function createDataJobHandlers(env: Readonly<Record<string, string | undefined>> = process.env): DataJobHandler[] {
  if (env.PLATFORM_NOTIFICATIONS_ENABLED !== "true" || env.PLATFORM_NOTIFICATION_QUEUE_ENABLED !== "true") return [];
  return [createRankingNotificationHandler()];
}
