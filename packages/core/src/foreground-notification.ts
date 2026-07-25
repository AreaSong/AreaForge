export type ForegroundNotificationCategory = "review" | "plan" | "evening";

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
