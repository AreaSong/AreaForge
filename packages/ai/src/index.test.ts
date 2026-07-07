import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiErrorFallbackStatus,
  aiGeneratedStatus,
  aiInvalidFallbackStatus,
  createFallbackDailyReviewAdvice,
  createFallbackDisciplineAdvice,
  createFallbackTomorrowPlanAdvice,
  createStaticJsonProvider,
  createThrowingJsonProvider,
  findSensitiveContextKeys,
  generateAdviceWithProvider,
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

test("mock provider success is validated as ai generated output", async () => {
  const result = await generateAdviceWithProvider({
    kind: "discipline",
    context: {
      phase: "基础唤醒期",
      riskState: "stable",
      streakDays: 3,
      taskCompletionRate: 0.6,
      effectiveMinutes: 80,
    },
    provider: createStaticJsonProvider({
      line: "保持推进，但别扩任务。",
      nextAction: "先完成一段 45 分钟计时。",
      reason: "mock structured result",
    }),
    fallback: createFallbackDisciplineAdvice,
    validate: validateDisciplineAdvice,
  });

  assert.equal(result.meta.status, aiGeneratedStatus);
  assert.equal(result.meta.externalCall, false);
  assert.equal(result.advice.status, aiGeneratedStatus);
  assert.equal(result.advice.line, "保持推进，但别扩任务。");
});

test("mock provider invalid output falls back without breaking advice shape", async () => {
  const result = await generateAdviceWithProvider({
    kind: "tomorrow_plan",
    context: {
      riskState: "stable",
      recoveryActive: false,
      debtCount: 0,
      weakSubject: "英语",
    },
    provider: createStaticJsonProvider({
      title: "",
      minimumTaskTitle: "bad",
      estimatedMinutes: 999,
      priority: "urgent",
      reason: "",
      cautions: [],
    }),
    fallback: createFallbackTomorrowPlanAdvice,
    validate: validateTomorrowPlanAdvice,
  });

  assert.equal(result.meta.status, aiInvalidFallbackStatus);
  assert.equal(result.advice.status, aiInvalidFallbackStatus);
  assert.equal(result.advice.priority, "medium");
  assert.match(result.meta.reason, /回退/);
});

test("provider errors fall back to local rules", async () => {
  const result = await generateAdviceWithProvider({
    kind: "daily_review",
    context: {
      totalMinutes: 120,
      effectiveMinutes: 40,
      taskCompletionRate: 0.2,
      lowConversionCount: 1,
      reviewSubmitted: false,
      moodTag: "很累",
    },
    provider: createThrowingJsonProvider(),
    fallback: createFallbackDailyReviewAdvice,
    validate: validateDailyReviewAdvice,
  });

  assert.equal(result.meta.status, aiInvalidFallbackStatus);
  assert.equal(result.meta.externalCall, false);
  assert.match(result.advice.nextReviewPrompt, /3 句话/);
});

test("sensitive context is blocked before provider execution", async () => {
  let called = false;
  const result = await generateAdviceWithProvider({
    kind: "daily_review",
    context: {
      totalMinutes: 20,
      effectiveMinutes: 0,
      taskCompletionRate: 0,
      lowConversionCount: 0,
      reviewSubmitted: true,
      moodTag: "焦虑",
      summary: "这是一段完整复盘正文，不能进入外部 AI 上下文。",
      whyStarted: "动机档案也不能默认发送。",
    },
    provider: {
      externalCall: true,
      async generateJson() {
        called = true;
        return {};
      },
    },
    fallback: createFallbackDailyReviewAdvice,
    validate: validateDailyReviewAdvice,
  });

  assert.equal(called, false);
  assert.equal(result.meta.status, aiErrorFallbackStatus);
  assert.equal(result.meta.externalCall, false);
  assert.equal(result.meta.sensitiveContextIncluded, true);
  assert.deepEqual(result.meta.sensitiveContextKeys, ["context.summary", "context.whyStarted"]);
});

test("sensitive context finder detects nested private fields", () => {
  assert.deepEqual(
    findSensitiveContextKeys({
      safe: {
        value: 1,
      },
      nested: {
        firstSimulationDiary: "private",
      },
      tasks: [
        {
          reviewText: "private",
        },
      ],
    }),
    ["context.nested.firstSimulationDiary", "context.tasks[0].reviewText"],
  );
});

test("sensitive context finder detects key naming variants", () => {
  assert.deepEqual(
    findSensitiveContextKeys({
      api_key: "secret",
      "session-token": "secret",
      uploadDir: "/private/uploads",
      dailyReviewSummary: "完整复盘摘要",
      moodText: "完整情绪正文",
      pdfContent: "PDF 原文",
      attachmentFilePath: "/private/uploads/a.pdf",
    }),
    [
      "context.api_key",
      "context.attachmentFilePath",
      "context.dailyReviewSummary",
      "context.moodText",
      "context.pdfContent",
      "context.session-token",
      "context.uploadDir",
    ],
  );
});

test("safe minimized AI contexts are not marked sensitive", () => {
  assert.deepEqual(
    findSensitiveContextKeys({
      phase: "基础唤醒期",
      riskState: "stable",
      streakDays: 3,
      taskCompletionRate: 0.6,
      effectiveMinutes: 80,
      moodTag: "焦虑",
      weakSubject: "数学",
      debtCount: 2,
    }),
    [],
  );
});
