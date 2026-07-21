import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiErrorFallbackStatus,
  aiGeneratedStatus,
  aiInvalidFallbackStatus,
  createAiPrompt,
  createFallbackDailyReviewAdvice,
  createFallbackDisciplineAdvice,
  createFallbackLearningTreeDraftAdvice,
  createFallbackMotivationDraftAdvice,
  createFallbackStageAdjustmentAdvice,
  createFallbackTomorrowPlanAdvice,
  createOpenAiCompatibleJsonProvider,
  createStaticJsonProvider,
  createThrowingJsonProvider,
  findSensitiveContextKeys,
  generateAdviceWithProvider,
  validateDailyReviewAdvice,
  validateDisciplineAdvice,
  validateLearningTreeDraftAdvice,
  validateMotivationDraftAdvice,
  validateStageAdjustmentAdvice,
  validateTomorrowPlanAdvice,
  type StageAdjustmentContext,
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

test("fallback stage adjustment advice validates as confirm-only draft", () => {
  const advice = createFallbackStageAdjustmentAdvice({
    ...stageAdjustmentContext(),
    taskCompletionRate: 0.2,
    lowConversionCount: 5,
  });

  assert.equal(validateStageAdjustmentAdvice(advice).status, "local_rule_fallback");
  assert.equal(advice.mode, "recovery");
  assert.equal(advice.canAutoApply, false);
  assert.equal(advice.requiresUserConfirmation, true);
  assert.ok(advice.focusSubjects.length > 0);
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

test("mock stage adjustment provider success is validated as ai generated draft", async () => {
  const result = await generateAdviceWithProvider({
    kind: "stage_adjustment",
    context: stageAdjustmentContext(),
    provider: createStaticJsonProvider({
      mode: "strengthen",
      risk: "medium",
      riskConclusion: "长期执行稳定，但薄弱科目还需要加压。",
      focusSubjects: ["数学", "英语"],
      taskIntensity: "increase",
      taskAdjustmentActions: ["retest", "simulate"],
      nextStageEmphasis: "下一阶段提高数学和英语的题目强度，保留用户确认边界。",
      canAutoApply: false,
      requiresUserConfirmation: true,
    }),
    fallback: createFallbackStageAdjustmentAdvice,
    validate: validateStageAdjustmentAdvice,
  });

  assert.equal(result.meta.status, aiGeneratedStatus);
  assert.equal(result.advice.status, aiGeneratedStatus);
  assert.equal(result.advice.mode, "strengthen");
  assert.equal(result.advice.canAutoApply, false);
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

test("mock stage adjustment invalid output falls back without applying", async () => {
  const result = await generateAdviceWithProvider({
    kind: "stage_adjustment",
    context: stageAdjustmentContext(),
    provider: createStaticJsonProvider({
      mode: "auto",
      risk: "urgent",
      riskConclusion: "",
      focusSubjects: [],
      taskIntensity: "max",
      taskAdjustmentActions: ["rewrite_everything"],
      nextStageEmphasis: "",
      canAutoApply: true,
      requiresUserConfirmation: false,
    }),
    fallback: createFallbackStageAdjustmentAdvice,
    validate: validateStageAdjustmentAdvice,
  });

  assert.equal(result.meta.status, aiInvalidFallbackStatus);
  assert.equal(result.advice.status, aiInvalidFallbackStatus);
  assert.equal(result.advice.canAutoApply, false);
  assert.equal(result.advice.requiresUserConfirmation, true);
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

  assert.equal(result.meta.status, aiErrorFallbackStatus);
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

test("openai compatible provider returns generated JSON from chat completions", async () => {
  const requests: string[] = [];
  const provider = createOpenAiCompatibleJsonProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 1000,
    maxRetries: 0,
    fetchImpl: async (input, init) => {
      requests.push(String(input));
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-key");
      return jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                line: "稳住节奏。",
                nextAction: "完成一段 45 分钟计时。",
                reason: "mock generated",
              }),
            },
          },
        ],
      });
    },
  });

  const result = await generateAdviceWithProvider({
    kind: "discipline",
    context: {
      phase: "基础唤醒期",
      riskState: "stable",
      streakDays: 3,
      taskCompletionRate: 0.6,
      effectiveMinutes: 80,
    },
    provider,
    fallback: createFallbackDisciplineAdvice,
    validate: validateDisciplineAdvice,
  });

  assert.equal(requests[0], "https://ai.example.test/v1/chat/completions");
  assert.equal(result.meta.status, aiGeneratedStatus);
  assert.equal(result.meta.externalCall, true);
  assert.equal(result.advice.line, "稳住节奏。");
});

test("openai compatible provider retries rate limits and server errors", async () => {
  let calls = 0;
  const provider = createOpenAiCompatibleJsonProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 1000,
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { error: "rate limited" });
      if (calls === 2) return jsonResponse(500, { error: "server" });
      return jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "明日稳态推进",
                minimumTaskTitle: "固定 45 分钟推进一个核心任务",
                estimatedMinutes: 45,
                priority: "medium",
                reason: "mock generated after retry",
                cautions: ["不要扩任务。"],
              }),
            },
          },
        ],
      });
    },
  });

  const result = await generateAdviceWithProvider({
    kind: "tomorrow_plan",
    context: {
      riskState: "stable",
      recoveryActive: false,
      debtCount: 0,
      weakSubject: "英语",
    },
    provider,
    fallback: createFallbackTomorrowPlanAdvice,
    validate: validateTomorrowPlanAdvice,
  });

  assert.equal(calls, 3);
  assert.equal(result.meta.status, aiGeneratedStatus);
});

test("openai compatible provider times out and falls back", async () => {
  let calls = 0;
  const provider = createOpenAiCompatibleJsonProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 5,
    maxRetries: 0,
    fetchImpl: async (_input, init) => {
      calls += 1;
      const signal = init?.signal;
      assert.ok(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    },
  });

  const result = await generateAdviceWithProvider({
    kind: "discipline",
    context: {
      phase: "基础唤醒期",
      riskState: "stable",
      streakDays: 3,
      taskCompletionRate: 0.6,
      effectiveMinutes: 80,
    },
    provider,
    fallback: createFallbackDisciplineAdvice,
    validate: validateDisciplineAdvice,
  });

  assert.equal(calls, 1);
  assert.equal(result.meta.status, aiErrorFallbackStatus);
  assert.match(result.meta.reason, /请求超时/);
});

test("openai compatible provider does not retry auth failures", async () => {
  let calls = 0;
  const provider = createOpenAiCompatibleJsonProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "bad-key",
    model: "test-model",
    timeoutMs: 1000,
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(401, { error: "auth" });
    },
  });

  const result = await generateAdviceWithProvider({
    kind: "daily_review",
    context: {
      totalMinutes: 60,
      effectiveMinutes: 30,
      taskCompletionRate: 0.5,
      lowConversionCount: 0,
      reviewSubmitted: false,
    },
    provider,
    fallback: createFallbackDailyReviewAdvice,
    validate: validateDailyReviewAdvice,
  });

  assert.equal(calls, 1);
  assert.equal(result.meta.status, aiErrorFallbackStatus);
  assert.match(result.meta.reason, /鉴权失败/);
});

test("openai compatible provider invalid JSON falls back as provider error", async () => {
  const provider = createOpenAiCompatibleJsonProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 1000,
    maxRetries: 0,
    fetchImpl: async () => jsonResponse(200, {
      choices: [{ message: { content: "not json" } }],
    }),
  });

  const result = await generateAdviceWithProvider({
    kind: "daily_review",
    context: {
      totalMinutes: 60,
      effectiveMinutes: 30,
      taskCompletionRate: 0.5,
      lowConversionCount: 0,
      reviewSubmitted: false,
    },
    provider,
    fallback: createFallbackDailyReviewAdvice,
    validate: validateDailyReviewAdvice,
  });

  assert.equal(result.meta.status, aiErrorFallbackStatus);
  assert.match(result.meta.reason, /非 JSON/);
});

test("openai compatible provider schema invalid JSON falls back as invalid output", async () => {
  const provider = createOpenAiCompatibleJsonProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 1000,
    maxRetries: 0,
    fetchImpl: async () => jsonResponse(200, {
      choices: [{ message: { content: JSON.stringify({ title: "", observations: [], nextReviewPrompt: "", reason: "" }) } }],
    }),
  });

  const result = await generateAdviceWithProvider({
    kind: "daily_review",
    context: {
      totalMinutes: 60,
      effectiveMinutes: 30,
      taskCompletionRate: 0.5,
      lowConversionCount: 0,
      reviewSubmitted: false,
    },
    provider,
    fallback: createFallbackDailyReviewAdvice,
    validate: validateDailyReviewAdvice,
  });

  assert.equal(result.meta.status, aiInvalidFallbackStatus);
  assert.match(result.meta.reason, /输出无效/);
});

test("provider prompt redacts private task title before external request", async () => {
  let body = "";
  const provider = createOpenAiCompatibleJsonProvider({
    baseUrl: "https://ai.example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 1000,
    maxRetries: 0,
    fetchImpl: async (_input, init) => {
      body = String(init?.body ?? "");
      return jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "明日恢复任务",
                minimumTaskTitle: "恢复推进：30 分钟有效学习",
                estimatedMinutes: 30,
                priority: "critical",
                reason: "mock generated",
                cautions: [],
              }),
            },
          },
        ],
      });
    },
  });

  const privateTitle = "task title may contain private content";
  await generateAdviceWithProvider({
    kind: "tomorrow_plan",
    context: {
      riskState: "danger",
      recoveryActive: true,
      debtCount: 3,
      topTaskTitle: privateTitle,
      weakSubject: "数学",
    },
    provider,
    fallback: createFallbackTomorrowPlanAdvice,
    validate: validateTomorrowPlanAdvice,
  });

  assert.ok(!body.includes(privateTitle));
  assert.match(body, /topTaskTitleRedacted/);
});

test("createAiPrompt keeps only allowed context fields", () => {
  const prompt = createAiPrompt("daily_review", {
    totalMinutes: 90,
    effectiveMinutes: 45,
    taskCompletionRate: 0.5,
    lowConversionCount: 1,
    reviewSubmitted: false,
    moodTag: "焦虑",
    summary: "完整复盘正文不能进入 prompt",
  });

  assert.equal(prompt.sanitizedContext.summary, undefined);
  assert.ok(!prompt.user.includes("完整复盘正文"));
  assert.equal(prompt.sanitizedContext.moodTag, "焦虑");
});

test("createAiPrompt keeps only allowed stage adjustment context fields", () => {
  const longPrivateStageGoal = "阶段目标原文可能包含不该外发的长备注".repeat(10);
  const prompt = createAiPrompt("stage_adjustment", {
    ...stageAdjustmentContext(),
    stageGoal: longPrivateStageGoal,
    reviewText: "完整复盘正文不能进入长期阶段 prompt",
    topTaskTitle: "原始任务标题不能进入长期阶段 prompt",
  });

  assert.equal(prompt.sanitizedContext.stageGoal, undefined);
  assert.equal(prompt.sanitizedContext.stageGoalSummary, "2026 年 12 月同步全真自测");
  assert.equal(prompt.sanitizedContext.reviewText, undefined);
  assert.equal(prompt.sanitizedContext.topTaskTitle, undefined);
  assert.ok(!prompt.user.includes(longPrivateStageGoal));
  assert.ok(!prompt.user.includes("完整复盘正文"));
  assert.ok(!prompt.user.includes("原始任务标题"));
  assert.deepEqual(prompt.sanitizedContext.riskTags, ["steady"]);
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stageAdjustmentContext(): StageAdjustmentContext {
  return {
    rangeKind: "week",
    rangeStart: "2026-07-01T00:00:00.000Z",
    rangeEnd: "2026-07-08T00:00:00.000Z",
    rangeDays: 7,
    stageGoalSummary: "2026 年 12 月同步全真自测",
    effectiveMinutes: 420,
    taskCompletionRate: 0.68,
    reviewCompletionRate: 0.57,
    lowConversionCount: 1,
    subjectShares: [
      { subjectName: "数学", effectiveMinutes: 120, share: 0.29 },
      { subjectName: "英语", effectiveMinutes: 90, share: 0.21 },
      { subjectName: "408", effectiveMinutes: 210, share: 0.5 },
    ],
    weakNodeSummary: [
      { subjectName: "数学", weakCount: 2, reviewCount: 1, staleEvidenceCount: 1 },
      { subjectName: "英语", weakCount: 1, reviewCount: 0, staleEvidenceCount: 0 },
    ],
    simulationSummary: {
      examDate: "2026-06-30T00:00:00.000Z",
      scoreRate: 0.62,
      durationRate: 0.94,
      blankQuestionCount: 3,
      subjectCount: 3,
    },
    stagePlanMode: "maintain",
    stagePlanStatus: "active",
    daysToStageEnd: 120,
    riskTags: ["steady"],
  };
}

test("motivation draft fallback never reads vault fields", async () => {
  const result = await generateAdviceWithProvider({
    kind: "motivation_draft",
    context: { selectedText: "坚持下去", tone: "CALM" as const },
    fallback: createFallbackMotivationDraftAdvice,
    validate: validateMotivationDraftAdvice,
  });
  assert.equal(result.advice.schemaVersion, "motivation-draft-v1");
  assert.equal(result.meta.externalCall, false);
  assert.ok(!JSON.stringify(result.advice).includes("whyStarted"));
});

test("learning tree draft fallback stays markdown only", async () => {
  const result = await generateAdviceWithProvider({
    kind: "learning_tree_draft",
    context: { selectedText: "极限定义", scope: "subject" as const, subjectLabel: "数学" },
    fallback: createFallbackLearningTreeDraftAdvice,
    validate: validateLearningTreeDraftAdvice,
  });
  assert.equal(result.advice.schemaVersion, "learning-tree-draft-v1");
  assert.ok(result.advice.markdownDraft.includes("极限定义") || result.advice.markdownDraft.includes("数学"));
});
