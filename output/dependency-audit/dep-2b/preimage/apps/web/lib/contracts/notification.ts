import type { UserNotificationKind } from "@areaforge/core";

export interface NotificationPreferenceDto {
  reviewDueEnabled: boolean;
  planStartEnabled: boolean;
  eveningReviewEnabled: boolean;
  reviewDueWindowStart: number;
  reviewDueWindowEnd: number;
  planStartWindowStart: number;
  planStartWindowEnd: number;
  eveningReviewWindowStart: number;
  eveningReviewWindowEnd: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  revision: number;
}

export type UserNotificationFilter = "unread" | "all" | "dismissed";
export type UserNotificationAction = "read" | "unread" | "dismiss" | "restore";

export interface UserNotificationDto {
  id: string;
  workspaceId: string;
  workspaceLabel: string;
  kind: UserNotificationKind;
  title: string;
  body: string;
  actionLabel: string;
  route: "/settings/data";
  readAt: string | null;
  dismissedAt: string | null;
  revision: number;
  createdAt: string;
}
