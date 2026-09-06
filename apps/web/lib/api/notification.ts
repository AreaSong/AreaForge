import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  NotificationPreferenceDto,
  UserNotificationAction,
  UserNotificationDto,
  UserNotificationFilter,
} from "@/lib/contracts";

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

export interface UserNotificationsResponse {
  notifications?: UserNotificationDto[];
  notification?: UserNotificationDto;
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

export function listUserNotifications(
  filter: UserNotificationFilter = "unread",
): Promise<ApiResult<UserNotificationsResponse>> {
  return requestApiResult(`/api/notifications?filter=${encodeURIComponent(filter)}`);
}

export function updateUserNotification(
  id: string,
  action: UserNotificationAction,
  expectedRevision: number,
): Promise<ApiResult<UserNotificationsResponse>> {
  return requestApiResult(
    `/api/notifications/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", { action, expectedRevision }),
  );
}
