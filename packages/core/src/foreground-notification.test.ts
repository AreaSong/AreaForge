import assert from "node:assert/strict";
import test from "node:test";
import { selectForegroundNotifications, type ForegroundNotificationPreference } from "./foreground-notification";

const preference: ForegroundNotificationPreference = {
  reviewDueEnabled: true,
  planStartEnabled: true,
  eveningReviewEnabled: true,
  reviewDueWindowStart: 8,
  reviewDueWindowEnd: 22,
  planStartWindowStart: 7,
  planStartWindowEnd: 21,
  eveningReviewWindowStart: 20,
  eveningReviewWindowEnd: 23,
  quietHoursStart: null,
  quietHoursEnd: null,
};

test("selects only enabled candidates inside their windows", () => {
  assert.deepEqual(selectForegroundNotifications({
    hour: 20,
    preference,
    candidates: { reviewDue: true, planStart: false, eveningReview: true },
  }), ["review", "evening"]);
});

test("overnight quiet hours suppress every category", () => {
  const quiet = { ...preference, quietHoursStart: 22, quietHoursEnd: 7 };
  assert.deepEqual(selectForegroundNotifications({
    hour: 23,
    preference: quiet,
    candidates: { reviewDue: true, planStart: true, eveningReview: true },
  }), []);
  assert.deepEqual(selectForegroundNotifications({
    hour: 6,
    preference: quiet,
    candidates: { reviewDue: true, planStart: true, eveningReview: true },
  }), []);
});

test("equal notification window means all day while equal quiet hours are disabled", () => {
  const allDay = {
    ...preference,
    reviewDueWindowStart: 0,
    reviewDueWindowEnd: 0,
    quietHoursStart: 8,
    quietHoursEnd: 8,
  };
  assert.deepEqual(selectForegroundNotifications({
    hour: 3,
    preference: allDay,
    candidates: { reviewDue: true, planStart: false, eveningReview: false },
  }), ["review"]);
});
