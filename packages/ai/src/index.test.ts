import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFallbackDailyReviewAdvice,
  createFallbackDisciplineAdvice,
  createFallbackTomorrowPlanAdvice,
  validateDailyReviewAdvice,
  validateDisciplineAdvice,
  validateTomorrowPlanAdvice,
} from "./index";

test("fallback discipline advice validates as structured output", () => {
  const advice = createFallbackDisciplineAdvice({
    phase: "基础唤醒期",
    riskState: "danger",
    streakDays: 0,
    taskCompletionRate: 0.1,
    effectiveMinutes: 0,
  });

  assert.equal(validateDisciplineAdvice(advice).status, "local_rule_fallback");
  assert.match(advice.nextAction, /30 分钟/);
});

test("fallback daily review advice avoids full sensitive context", () => {
  const advice = createFallbackDailyReviewAdvice({
    totalMinutes: 120,
    effectiveMinutes: 60,
    taskCompletionRate: 0.25,
    lowConversionCount: 1,
    reviewSubmitted: false,
    moodTag: "焦虑",
  });

  assert.equal(validateDailyReviewAdvice(advice).status, "local_rule_fallback");
  assert.ok(advice.observations.every((item) => !item.includes("完整复盘正文")));
  assert.match(advice.reason, /没有发送/);
});

test("fallback tomorrow plan narrows recovery days", () => {
  const advice = createFallbackTomorrowPlanAdvice({
    riskState: "lost",
    recoveryActive: true,
    debtCount: 8,
    topTaskTitle: "数学错题复盘",
  });

  assert.equal(validateTomorrowPlanAdvice(advice).priority, "critical");
  assert.equal(advice.estimatedMinutes, 30);
  assert.match(advice.minimumTaskTitle, /数学错题复盘/);
});
