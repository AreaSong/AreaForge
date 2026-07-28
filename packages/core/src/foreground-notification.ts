export type ForegroundNotificationCategory = "review" | "plan" | "evening";

export interface ForegroundNotificationPayload {
  title: string;
  body: string;
  tag: string;
  actionLabel: string;
  data: { route: string };
}

type ForegroundNotificationDetail = Omit<ForegroundNotificationPayload, "data"> & { route: string };

const notificationDetails: Record<ForegroundNotificationCategory, ForegroundNotificationDetail> = {
  review: {
    title: "复习提醒",
    body: "有到期复习可处理。",
    tag: "af-review-due",
    actionLabel: "打开复习",
    route: "/knowledge/reviews",
  },
  plan: {
    title: "计划提醒",
    body: "今日计划窗口已到。",
    tag: "af-plan-start",
    actionLabel: "打开计划",
    route: "/today/plan",
  },
  evening: {
    title: "复盘提醒",
    body: "晚间复盘窗口已到。",
    tag: "af-evening-review",
    actionLabel: "打开复盘",
    route: "/review/daily",
  },
};

const safeNotificationRoutes = new Set(["/knowledge/reviews", "/today/plan", "/review/daily"]);

/** Keeps notification click navigation within the known application routes. */
export function sanitizeForegroundNotificationRoute(route: string | null | undefined): string {
  return route && safeNotificationRoutes.has(route) ? route : "/today";
}

/**
 * Canonical foreground notification payload shared by the browser and the test API.
 * Callers should use the generic product title unless the current device explicitly
 * opts into exposing a category-specific title.
 */
export function buildForegroundNotificationPayload(
  category: ForegroundNotificationCategory,
  route?: string | null,
): ForegroundNotificationPayload {
  const detail = notificationDetails[category];
  return {
    title: detail.title,
    body: detail.body,
    tag: detail.tag,
    actionLabel: detail.actionLabel,
    data: { route: sanitizeForegroundNotificationRoute(route ?? detail.route) },
  };
}

export interface ForegroundNotificationPreference {
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
}

export interface ForegroundNotificationCandidates {
  reviewDue: boolean;
  planStart: boolean;
  eveningReview: boolean;
}

export function selectForegroundNotifications(input: {
  hour: number;
  preference: ForegroundNotificationPreference;
  candidates: ForegroundNotificationCandidates;
}): ForegroundNotificationCategory[] {
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) return [];
  const quietStart = input.preference.quietHoursStart;
  const quietEnd = input.preference.quietHoursEnd;
  if (quietStart !== null && quietEnd !== null && isHourInRange(input.hour, quietStart, quietEnd, false)) {
    return [];
  }

  const selected: ForegroundNotificationCategory[] = [];
  if (
    input.preference.reviewDueEnabled &&
    input.candidates.reviewDue &&
    isHourInRange(input.hour, input.preference.reviewDueWindowStart, input.preference.reviewDueWindowEnd, true)
  ) selected.push("review");
  if (
    input.preference.planStartEnabled &&
    input.candidates.planStart &&
    isHourInRange(input.hour, input.preference.planStartWindowStart, input.preference.planStartWindowEnd, true)
  ) selected.push("plan");
  if (
    input.preference.eveningReviewEnabled &&
    input.candidates.eveningReview &&
    isHourInRange(input.hour, input.preference.eveningReviewWindowStart, input.preference.eveningReviewWindowEnd, true)
  ) selected.push("evening");
  return selected;
}

function isHourInRange(hour: number, start: number, end: number, equalMeansAllDay: boolean): boolean {
  if (start === end) return equalMeansAllDay;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}
