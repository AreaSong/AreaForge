import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type { NotificationPreferenceDto } from "@/lib/contracts";

export interface NotificationPreferenceResponse {
  preference?: NotificationPreferenceDto;
  latest?: NotificationPreferenceDto;
  conflictFields?: string[];
  error?: string;
  workbench?: string;
}

export interface NotificationTestResponse {
  payload?: {
    title: string;
    body: string;
    tag: string;
    data: { route: string };
  };
  error?: string;
}

export function updateNotificationPreferences(
  body: unknown,
): Promise<ApiResult<NotificationPreferenceResponse>> {
  return requestApiResult(
    "/api/notification-preferences",
    createJsonRequest("PATCH", body),
  );
}

export function sendNotificationTest(
  category: "review" | "plan" | "evening",
): Promise<ApiResult<NotificationTestResponse>> {
  return requestApiResult(
    "/api/notifications/test",
    createJsonRequest("POST", { category }),
  );
}
