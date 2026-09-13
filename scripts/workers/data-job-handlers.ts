import { createRankingNotificationHandler } from "./ranking-notification-handler";
import type { DataJobHandler } from "./data-job-handler";
import { createDataExportHandler } from "./data-export-handler";
import type { DataQueueClient } from "../../packages/db/src/index";

export function enabledDataJobKinds(env: Readonly<Record<string, string | undefined>>): DataJobHandler["kind"][] {
  const kinds: DataJobHandler["kind"][] = [];
  if (env.PLATFORM_NOTIFICATIONS_ENABLED === "true" && env.PLATFORM_NOTIFICATION_QUEUE_ENABLED === "true") kinds.push("NOTIFICATION");
  if (env.DATA_LIFECYCLE_ENABLED === "true" && env.DATA_EXPORT_ENABLED === "true") kinds.push("EXPORT");
  return kinds;
}

/** 处理器注册是代码 allowlist；环境变量只能打开已登记的处理器，不能指定模块路径。 */
export function createDataJobHandlers(env: Readonly<Record<string, string | undefined>> = process.env, client?: DataQueueClient): DataJobHandler[] {
  const handlers: DataJobHandler[] = [];
  const kinds = enabledDataJobKinds(env);
  if (kinds.includes("NOTIFICATION")) handlers.push(createRankingNotificationHandler(env));
  if (kinds.includes("EXPORT")) {
    if (!client) throw new TypeError("DATA_EXPORT_CLIENT_REQUIRED");
    handlers.push(createDataExportHandler(client, env));
  }
  return handlers;
}
