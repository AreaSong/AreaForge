import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDashboardSnapshot,
  createRecoveryPlan,
  buildDailyCheckInSnapshot,
  determineDebtLevel,
  evaluateAntiFakeStudy,
  evaluateDailyCheckIn,
  evaluateMasteryProof,
  evaluateMotivationWake,
  evaluateSimulationReadiness,
  evaluateStageLevel,
  evaluateSyllabusMapSignal,
  summarizeSyllabusMap,
  draftStageAdjustment,
  normalizeStudyCloseout,
  parseSyllabusMarkdown,
  summarizeSimulationResult,
  summarizeCheckInHistory,
  summarizeLightweightDebtAction,
  choosePeriodicWeakness,
  createPeriodicNextCycleDraft,
  createPeriodicReportDecisionSnapshot,
  previewTaskDebtReorderApplication,
  suggestTaskDebtReorder,
  summarizePeriodicReportStrategy,
  rankRecoveryTaskCandidates,
  selectRecoveryTaskCandidate,
  summarizeAnalyticsRisks,
  summarizeLongTermRisks,
} from "./index";

type DashboardInputForTest = Parameters<typeof createDashboardSnapshot>[0];

function makeDashboardInput(overrides: Partial<DashboardInputForTest> = {}): DashboardInputForTest {
  return {
    targetExamDate: new Date("2027-12-20T08:30:00+08:00"),
    simulationDate: new Date("2026-12-20T08:30:00+08:00"),
    todayMinutes: 120,
    effectiveMinutes: 90,
    taskCompletionRate: 0.75,
    streakDays: 3,
    missedDays: 0,
    debtCount: 0,
    daysToFinal: 300,
    daysToSimulation: 150,
    tasks: [
      {
        id: "task-main",
        title: "数学基础题",
        subject: "数学",
        status: "todo",
        estimatedMinutes: 60,
        actualMinutes: 0,
        priority: "high",
      },
    ],
    ...overrides,
  };
}

test("evaluateDailyCheckIn requires an effective study action", () => {
  const summary = evaluateDailyCheckIn({
    effectiveMinutes: 10,
    effectiveSessionCount: 0,
    reviewSubmitted: false,
    taskCompletionRate: 0,
  });

  assert.equal(summary.completedMinimumAction, false);
  assert.equal(summary.lowEfficiency, true);
});

test("buildDailyCheckInSnapshot derives Batch 1 fields from day inputs", () => {
  const snapshot = buildDailyCheckInSnapshot({
    studyDate: "2026-07-07",
    sessions: [
      { effectiveMinutes: 40, isEffective: true, isLowConversion: false },
      { effectiveMinutes: 20, isEffective: false, isLowConversion: true },
      { effectiveMinutes: 15, isEffective: null },
    ],
    tasks: [
      { status: "done" },
      { status: "todo" },
      { status: "deferred" },
    ],
    reviewSubmitted: true,
  });

  assert.equal(snapshot.studyDate, "2026-07-07");
  assert.equal(snapshot.completedMinimumAction, true);
  assert.equal(snapshot.totalMinutes, 75);
  assert.equal(snapshot.effectiveMinutes, 40);
  assert.equal(snapshot.effectiveSessionCount, 1);
  assert.equal(snapshot.taskCompletionRate, 1 / 3);
  assert.equal(snapshot.reviewSubmitted, true);
  assert.equal(snapshot.lowEfficiency, false);
  assert.equal(snapshot.lowConversionCount, 1);
  assert.equal(snapshot.sourceVersion, 1);
});

test("buildDailyCheckInSnapshot keeps historical low conversion fallback", () => {
  const snapshot = buildDailyCheckInSnapshot({
    studyDate: "2026-07-08",
    sessions: [
      { effectiveMinutes: 55, isEffective: false },
      { effectiveMinutes: 30, isEffective: true, isLowConversion: true },
    ],
    tasks: [],
    reviewSubmitted: false,
  });

  assert.equal(snapshot.totalMinutes, 85);
  assert.equal(snapshot.effectiveMinutes, 30);
  assert.equal(snapshot.effectiveSessionCount, 1);
  assert.equal(snapshot.taskCompletionRate, 0);
  assert.equal(snapshot.lowEfficiency, true);
  assert.equal(snapshot.lowConversionCount, 2);
});

test("buildDailyCheckInSnapshot lets explicit low conversion override historical fallback", () => {
  const snapshot = buildDailyCheckInSnapshot({
    studyDate: "2026-07-09",
    sessions: [
      { effectiveMinutes: 45, isEffective: false, isLowConversion: false },
      { effectiveMinutes: 25, isEffective: false },
    ],
    tasks: [],
    reviewSubmitted: false,
  });

  assert.equal(snapshot.lowConversionCount, 1);
});

test("createDashboardSnapshot maps theme states from real execution signals", () => {
  assert.equal(createDashboardSnapshot(makeDashboardInput()).themeState, "normal");
  assert.equal(createDashboardSnapshot(makeDashboardInput({
    streakDays: 9,
    taskCompletionRate: 0.86,
  })).themeState, "forge");
  assert.equal(createDashboardSnapshot(makeDashboardInput({
    streakDays: 9,
    taskCompletionRate: 0.7,
  })).themeState, "normal");
  assert.equal(createDashboardSnapshot(makeDashboardInput({
    debtCount: 6,
  })).themeState, "alert");
  assert.equal(createDashboardSnapshot(makeDashboardInput({
    missedDays: 5,
  })).themeState, "recovery");
  assert.equal(createDashboardSnapshot(makeDashboardInput({
    daysToFinal: 90,
  })).themeState, "sprint");
});

test("createDashboardSnapshot changes task priority by theme", () => {
  const tasks = [
    {
      id: "generic-critical",
      title: "普通高优先任务",
      subject: "数学",
      status: "todo" as const,
      estimatedMinutes: 90,
      actualMinutes: 0,
      priority: "critical" as const,
    },
    {
      id: "review",
      title: "英语错题复习",
      type: "review",
      subject: "英语",
      status: "todo" as const,
      estimatedMinutes: 45,
      actualMinutes: 0,
      priority: "medium" as const,
    },
    {
      id: "mistake",
      title: "408 错题订正",
      type: "mistake",
      subject: "408",
      status: "todo" as const,
      estimatedMinutes: 40,
      actualMinutes: 0,
      priority: "low" as const,
    },
    {
      id: "simulation",
      title: "全真模拟",
      type: "simulation_exam",
      subject: "综合",
      status: "todo" as const,
      estimatedMinutes: 180,
      actualMinutes: 0,
      priority: "low" as const,
    },
  ];

  const sprint = createDashboardSnapshot(makeDashboardInput({
    daysToFinal: 90,
    tasks,
  }));
  const recovery = createDashboardSnapshot(makeDashboardInput({
    missedDays: 5,
    tasks,
  }));

  assert.deepEqual(sprint.topTasks.map((task) => task.id), ["simulation", "mistake", "review", "generic-critical"]);
  assert.equal(sprint.nextAction.includes("全真模拟"), true);
  assert.equal(recovery.topTasks.length, 1);
  assert.equal(recovery.nextAction.includes("90 分钟恢复任务"), true);
});

test("createRecoveryPlan narrows the day during danger state", () => {
  const plan = createRecoveryPlan({
    riskState: "danger",
    debtCount: 8,
    missedDays: 5,
    effectiveMinutes: 0,
    topTask: {
      id: "task-1",
      title: "补数学基础题",
      subject: "数学",
      status: "todo",
      estimatedMinutes: 45,
      actualMinutes: 0,
      priority: "critical",
    },
  });

  assert.equal(plan.active, true);
  assert.equal(plan.visibleTaskLimit, 1);
  assert.match(plan.action, /补数学基础题/);
});

test("anti fake study asks for output when time has no conversion", () => {
  const result = evaluateAntiFakeStudy({
    minutes: 60,
    hasOutput: false,
    canExplain: false,
    practiced: false,
    reviewedMistake: false,
  });

  assert.equal(result.isLowConversion, true);
  assert.match(result.requiredOutput, /写下/);
});

test("debt level escalates by count", () => {
  assert.equal(determineDebtLevel(0), "none");
  assert.equal(determineDebtLevel(4), "needs_recovery");
  assert.equal(determineDebtLevel(12), "plan_breaking");
});

test("stage level promotes stable effective study", () => {
  const stage = evaluateStageLevel({
    streakDays: 16,
    todayEffectiveMinutes: 120,
    recentEffectiveMinutes: 980,
    taskCompletionRate: 0.72,
    syllabusProgress: 0.35,
    daysToFinal: 420,
  });

  assert.equal(stage.title, "稳态");
  assert.equal(stage.pressure, "high");
});

test("stage level switches to sprint near final exam", () => {
  const stage = evaluateStageLevel({
    streakDays: 0,
    todayEffectiveMinutes: 0,
    recentEffectiveMinutes: 0,
    taskCompletionRate: 0,
    syllabusProgress: 0,
    daysToFinal: 80,
  });

  assert.equal(stage.title, "冲刺");
  assert.equal(stage.pressure, "sprint");
});

test("motivation wake signal stays sparse but reacts to danger", () => {
  const signal = evaluateMotivationWake({
    hasVault: true,
    riskState: "danger",
    missedDays: 4,
    debtCount: 8,
    daysToSimulation: 180,
    todayMood: "平静",
  });

  assert.equal(signal.shouldWake, true);
  assert.equal(signal.trigger, "danger_period");
});

test("motivation wake signal covers major review without exposing content", () => {
  const signal = evaluateMotivationWake({
    hasVault: true,
    riskState: "stable",
    missedDays: 0,
    debtCount: 0,
    daysToSimulation: 180,
    hasMajorReview: true,
    todayMood: "平静",
  });

  assert.equal(signal.shouldWake, true);
  assert.equal(signal.trigger, "major_review");
  assert.doesNotMatch(signal.message, /平静/);
});

test("simulation readiness highlights the simulation window", () => {
  const readiness = evaluateSimulationReadiness({
    daysToSimulation: 3,
    weeklyEffectiveMinutes: 180,
    weeklyTaskCompletionRate: 0.35,
    reviewCompletionRate: 0.2,
    weakNodeCount: 2,
    dueMistakeCount: 1,
    hasFirstSimulationDiary: false,
  });

  assert.equal(readiness.level, "simulation_window");
  assert.match(readiness.nextActions.join("\n"), /真实考试节奏/);
});

test("simulation readiness blocks overconfident stage adjustment", () => {
  const readiness = evaluateSimulationReadiness({
    daysToSimulation: 120,
    weeklyEffectiveMinutes: 0,
    weeklyTaskCompletionRate: 0,
    reviewCompletionRate: 0,
    weakNodeCount: 3,
    dueMistakeCount: 2,
    hasFirstSimulationDiary: false,
  });

  assert.equal(readiness.level, "not_ready");
  assert.match(readiness.reason, /准备度不足/);
});

test("normalizeStudyCloseout turns weak self-report into low conversion", () => {
  const closeout = normalizeStudyCloseout({
    minutes: 60,
    userMarkedEffective: true,
    understandingLevel: "说不清",
    minimalOutput: "看了",
    nextAction: "补一条总结",
    note: "没有做题",
  });

  assert.equal(closeout.isEffective, false);
  assert.equal(closeout.isLowConversion, true);
  assert.match(closeout.closeoutText, /反假学习：低转化/);
  assert.match(closeout.closeoutText, /补产出要求/);
});

test("normalizeStudyCloseout preserves mistake review as conversion evidence", () => {
  const closeout = normalizeStudyCloseout({
    minutes: 45,
    userMarkedEffective: true,
    understandingLevel: "能讲清主要错因",
    minimalOutput: "复盘一道错题并订正",
    nextAction: "明天继续压同类题",
    producedMistake: true,
  });

  assert.equal(closeout.isEffective, true);
  assert.equal(closeout.reviewedMistake, true);
  assert.match(closeout.closeoutText, /产生错题：是/);
});

test("summarizeCheckInHistory derives streak and missed dates from snapshots", () => {
  const summary = summarizeCheckInHistory([
    { studyDate: "2026-07-01", completedMinimumAction: true, lowEfficiency: false, effectiveMinutes: 60 },
    { studyDate: "2026-07-02", completedMinimumAction: true, lowEfficiency: false, effectiveMinutes: 90 },
    { studyDate: "2026-07-03", completedMinimumAction: false, lowEfficiency: true, effectiveMinutes: 0 },
    { studyDate: "2026-07-04", completedMinimumAction: true, lowEfficiency: true, effectiveMinutes: 30 },
    { studyDate: "2026-07-05", completedMinimumAction: true, lowEfficiency: true, effectiveMinutes: 30 },
  ]);

  assert.equal(summary.currentStreakDays, 2);
  assert.equal(summary.longestStreakDays, 2);
  assert.equal(summary.missedDaysInWindow, 3);
  assert.deepEqual(summary.recentMissedDates, ["2026-07-03", "2026-06-30", "2026-06-29"]);
  assert.equal(summary.breakCount, 1);
  assert.equal(summary.consecutiveLowEfficiencyDays, 2);
});

test("summarizeLightweightDebtAction classifies lightweight task flow", () => {
  const split = summarizeLightweightDebtAction({
    action: "split",
    fromStatus: "todo",
    toStatus: "deferred",
  });
  const complete = summarizeLightweightDebtAction({
    action: "complete",
    fromStatus: "in_progress",
    toStatus: "done",
  });

  assert.equal(split.label, "拆小");
  assert.equal(split.shouldKeepDebtVisible, true);
  assert.equal(split.shouldResolveDebt, false);
  assert.equal(split.auditAction, "STUDY_TASK_SPLIT_LIGHTWEIGHT");
  assert.equal(complete.shouldResolveDebt, true);
});

test("suggestTaskDebtReorder keeps recovery debt suggestions confirm-only", () => {
  const plan = suggestTaskDebtReorder({
    pressure: "recovery",
    availableMinutes: 60,
    tasks: [
      {
        id: "task-critical",
        title: "数学大题补做",
        subject: "数学",
        priority: "critical",
        estimatedMinutes: 120,
        daysOverdue: 4,
        blocksStageGoal: true,
      },
      {
        id: "task-review",
        title: "英语阅读复盘",
        subject: "英语",
        priority: "medium",
        estimatedMinutes: 45,
        daysOverdue: 3,
        isReviewable: true,
      },
    ],
  });

  assert.equal(plan.canAutoApply, false);
  assert.equal(plan.requiresUserConfirmation, true);
  assert.equal(plan.suggestions[0]?.taskId, "task-critical");
  assert.equal(plan.suggestions[0]?.action, "split");
  assert.equal(plan.suggestions[1]?.action, "convert_review");
  assert.match(plan.summary, /用户确认/);
});

test("suggestTaskDebtReorder drops stale non-blocking sprint debt", () => {
  const plan = suggestTaskDebtReorder({
    pressure: "sprint",
    availableMinutes: 120,
    tasks: [
      {
        id: "task-stage",
        title: "408 真题订正",
        subject: "408",
        priority: "high",
        estimatedMinutes: 90,
        daysOverdue: 2,
        blocksStageGoal: true,
      },
      {
        id: "task-stale",
        title: "旧视频补看",
        subject: "数学",
        priority: "low",
        estimatedMinutes: 60,
        daysOverdue: 20,
      },
    ],
  });

  assert.equal(plan.suggestions[0]?.action, "recover");
  assert.equal(plan.suggestions.find((item) => item.taskId === "task-stale")?.action, "drop");
  assert.deepEqual(plan.droppedTaskIds, ["task-stale"]);
  assert.deepEqual(plan.keepTaskIds, ["task-stage"]);
});

test("previewTaskDebtReorderApplication keeps D2 application confirm-only", () => {
  const preview = previewTaskDebtReorderApplication({
    selectedTaskIds: ["task-critical", "task-done", "task-missing"],
    maxApplyCount: 2,
    suggestions: [
      {
        taskId: "task-critical",
        action: "split",
        reason: "任务太大，先拆成最小推进。",
        estimatedMinutes: 35,
        rank: 1,
      },
      {
        taskId: "task-done",
        action: "convert_review",
        reason: "改成复习任务。",
        estimatedMinutes: 25,
        rank: 2,
      },
    ],
    currentTasks: [
      { id: "task-critical", status: "TODO", debtStatus: "PLAN_BREAKING" },
      { id: "task-done", status: "DONE", debtStatus: "NONE" },
    ],
  });

  assert.equal(preview.canAutoApply, false);
  assert.equal(preview.requiresUserConfirmation, true);
  assert.equal(preview.shouldStopOnFirstFailure, true);
  assert.deepEqual(preview.items.map((item) => [item.taskId, item.mutation]), [["task-critical", "split"]]);
  assert.deepEqual(preview.skipped.map((item) => [item.taskId, item.reason]), [
    ["task-done", "already_resolved"],
    ["task-missing", "missing_suggestion"],
  ]);
});

test("previewTaskDebtReorderApplication limits mutations but keeps no-op confirmations", () => {
  const preview = previewTaskDebtReorderApplication({
    selectedTaskIds: ["task-keep", "task-recover", "task-defer"],
    maxApplyCount: 1,
    suggestions: [
      { taskId: "task-keep", action: "keep", reason: "保留。", estimatedMinutes: 30, rank: 1 },
      { taskId: "task-recover", action: "recover", reason: "补做。", estimatedMinutes: 40, rank: 2 },
      { taskId: "task-defer", action: "defer", reason: "延期。", estimatedMinutes: 0, rank: 3 },
    ],
    currentTasks: [
      { id: "task-keep", status: "TODO", debtStatus: "ACCEPTABLE" },
      { id: "task-recover", status: "TODO", debtStatus: "NEEDS_RECOVERY" },
      { id: "task-defer", status: "DEFERRED", debtStatus: "ACCEPTABLE" },
    ],
  });

  assert.deepEqual(preview.items.map((item) => [item.taskId, item.mutation]), [
    ["task-keep", "none"],
    ["task-recover", "recover"],
  ]);
  assert.deepEqual(preview.skipped.map((item) => [item.taskId, item.reason]), [["task-defer", "batch_limit"]]);
  assert.match(preview.summary, /用户所选建议/);
});

test("summarizePeriodicReportStrategy enters recovery when effective time is too low", () => {
  const strategy = summarizePeriodicReportStrategy({
    kind: "week",
    effectiveMinutes: 60,
    taskCompletionRate: 0.25,
    debtCount: 9,
    lowConversionCount: 1,
    mistakesCreatedCount: 3,
    mistakeReviewCount: 0,
    reviewCompletionRate: 0.2,
    weakNodeCount: 2,
    dueNoteCount: 3,
  });

  assert.equal(strategy.theme, "recovery");
  assert.equal(strategy.canAutoApply, false);
  assert.equal(strategy.requiresUserConfirmation, true);
  assert.match(strategy.mustPressIssue, /有效学习时长/);
  assert.ok(strategy.nextActions.some((item) => item.includes("有效学习闭环")));
});

test("createPeriodicNextCycleDraft keeps report decisions confirm-only", () => {
  const strategy = summarizePeriodicReportStrategy({
    kind: "week",
    effectiveMinutes: 60,
    taskCompletionRate: 0.25,
    debtCount: 9,
    lowConversionCount: 1,
    mistakesCreatedCount: 3,
    mistakeReviewCount: 0,
    reviewCompletionRate: 0.2,
    weakNodeCount: 2,
    dueNoteCount: 3,
  });
  const draft = createPeriodicNextCycleDraft({
    kind: "week",
    strategy,
    weakness: {
      title: "最大短板：任务欠账集中",
      detail: "数学 的欠账最多，下周期先压这个科目。",
      source: "debt_subject",
      severity: "high",
    },
  });

  assert.equal(draft.title, "下周策略草稿");
  assert.equal(draft.theme, "recovery");
  assert.equal(draft.source, "local_rule");
  assert.equal(draft.canAutoApply, false);
  assert.equal(draft.requiresUserConfirmation, true);
  assert.match(draft.focus, /任务欠账集中/);
  assert.match(draft.reason, /不自动修改任务或阶段计划/);
  assert.deepEqual(draft.actions, [...new Set(strategy.nextActions)].slice(0, 5));
});

test("createPeriodicNextCycleDraft falls back to must press issue without a concrete weakness", () => {
  const strategy = summarizePeriodicReportStrategy({
    kind: "month",
    effectiveMinutes: 2600,
    taskCompletionRate: 0.82,
    debtCount: 0,
    lowConversionCount: 0,
    mistakesCreatedCount: 5,
    mistakeReviewCount: 5,
    reviewCompletionRate: 0.8,
    weakNodeCount: 0,
    dueNoteCount: 0,
    maxWeakness: "英语阅读稳定提速",
  });
  const draft = createPeriodicNextCycleDraft({
    kind: "month",
    strategy,
    weakness: {
      title: "最大短板：暂无明确集中风险",
      detail: "当前数据没有显示单一短板。",
      source: "none",
      severity: "clear",
    },
  });

  assert.equal(draft.title, "下月策略草稿");
  assert.equal(draft.focus, strategy.mustPressIssue);
  assert.equal(draft.stageAdjustment, strategy.stageAdjustment);
  assert.equal(draft.canAutoApply, false);
  assert.equal(draft.requiresUserConfirmation, true);
});

test("createPeriodicReportDecisionSnapshot freezes replay data without private task lists", () => {
  const strategy = summarizePeriodicReportStrategy({
    kind: "week",
    effectiveMinutes: 420,
    taskCompletionRate: 0.7,
    debtCount: 2,
    lowConversionCount: 1,
    mistakesCreatedCount: 8,
    mistakeReviewCount: 2,
    reviewCompletionRate: 0.8,
    weakNodeCount: 1,
    dueNoteCount: 0,
    maxWeakness: "数学 / 极限错题集中",
  });
  const weakness = choosePeriodicWeakness({
    subjectShares: [{ subjectName: "数学", effectiveMinutes: 420 }],
    debtTasks: [],
    lowConversionCount: 0,
    weakNodes: [
      {
        title: "极限定义",
        status: "needs_review",
        subjectName: "数学",
        mistakeCount: 3,
        noteCount: 1,
        sessionCount: 2,
      },
    ],
  });
  const nextCycleDraft = createPeriodicNextCycleDraft({ kind: "week", strategy, weakness });
  const snapshot = createPeriodicReportDecisionSnapshot({
    kind: "week",
    range: {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-08T00:00:00.000Z",
      days: 7,
    },
    metrics: {
      totalMinutes: 600,
      effectiveMinutes: 420,
      taskCompletionRate: 0.7,
      debtCount: 2,
      lowConversionCount: 1,
      reviewCompletionRate: 0.8,
      weakNodeCount: 1,
      dueNoteCount: 0,
      mistakesCreatedCount: 8,
      mistakeReviewCount: 2,
    },
    weakness,
    strategy,
    nextCycleDraft,
  });

  strategy.nextActions.push("后续输入变动不应污染历史快照。");
  weakness.reasons.push("后续输入变动不应污染历史快照。");
  nextCycleDraft.actions.push("后续输入变动不应污染历史快照。");

  assert.equal(snapshot.sourceVersion, 1);
  assert.equal(snapshot.canAutoApply, false);
  assert.equal(snapshot.requiresUserConfirmation, true);
  assert.equal(snapshot.strategy.canAutoApply, false);
  assert.equal(snapshot.nextCycleDraft.requiresUserConfirmation, true);
  assert.equal(snapshot.strategy.nextActions.includes("后续输入变动不应污染历史快照。"), false);
  assert.equal(snapshot.weakness.reasons.includes("后续输入变动不应污染历史快照。"), false);
  assert.equal(snapshot.nextCycleDraft.actions.includes("后续输入变动不应污染历史快照。"), false);
  assert.equal(JSON.stringify(snapshot).includes("private task title"), false);
});

test("choosePeriodicWeakness prioritizes weak syllabus nodes over debt and low share", () => {
  const weakness = choosePeriodicWeakness({
    subjectShares: [
      { subjectName: "数学", effectiveMinutes: 120 },
      { subjectName: "英语", effectiveMinutes: 0 },
    ],
    debtTasks: [{ subjectName: "英语" }, { subjectName: "英语" }],
    lowConversionCount: 2,
    weakNodes: [
      {
        title: "极限定义",
        status: "weak",
        subjectName: "数学",
        mistakeCount: 3,
        noteCount: 1,
        sessionCount: 2,
      },
    ],
  });

  assert.equal(weakness.title, "最大短板：薄弱节点");
  assert.equal(weakness.subjectName, "数学");
  assert.equal(weakness.syllabusNodeTitle, "极限定义");
  assert.equal(weakness.source, "syllabus_node");
  assert.equal(weakness.severity, "critical");
  assert.match(weakness.detail, /错题 3/);
  assert.ok(weakness.reasons.some((reason) => reason.includes("考纲节点风险")));
});

test("choosePeriodicWeakness falls back to concentrated debt subject", () => {
  const weakness = choosePeriodicWeakness({
    subjectShares: [
      { subjectName: "数学", effectiveMinutes: 90 },
      { subjectName: "英语", effectiveMinutes: 30 },
    ],
    debtTasks: [{ subjectName: "408" }, { subjectName: "408" }, { subjectName: "政治" }],
    weakNodes: [],
    lowConversionCount: 0,
  });

  assert.equal(weakness.title, "最大短板：任务欠账集中");
  assert.equal(weakness.subjectName, "408");
  assert.equal(weakness.source, "debt_subject");
  assert.equal(weakness.severity, "medium");
  assert.ok(weakness.reasons.some((reason) => reason.includes("欠账 2 项")));
});

test("choosePeriodicWeakness falls back to zero effective subject", () => {
  const weakness = choosePeriodicWeakness({
    subjectShares: [
      { subjectName: "数学", effectiveMinutes: 60 },
      { subjectName: "政治", effectiveMinutes: 0 },
    ],
    debtTasks: [],
    weakNodes: [],
    lowConversionCount: 0,
  });

  assert.equal(weakness.title, "最大短板：投入缺口");
  assert.equal(weakness.subjectName, "政治");
  assert.equal(weakness.source, "zero_effective_subject");
  assert.equal(weakness.severity, "medium");
  assert.ok(weakness.reasons.some((reason) => reason.includes("有效学习时长为 0")));
});

test("choosePeriodicWeakness falls back to low conversion count", () => {
  const weakness = choosePeriodicWeakness({
    subjectShares: [{ subjectName: "数学", effectiveMinutes: 60 }],
    debtTasks: [],
    weakNodes: [],
    lowConversionCount: 2,
  });

  assert.equal(weakness.title, "最大短板：低转化学习");
  assert.equal(weakness.source, "low_conversion");
  assert.equal(weakness.severity, "low");
  assert.match(weakness.detail, /2 次/);
  assert.ok(weakness.reasons.some((reason) => reason.includes("投入和产出脱节")));
});

test("summarizeAnalyticsRisks turns weak nodes and due reviews into actions", () => {
  const summary = summarizeAnalyticsRisks({
    weekEffectiveMinutes: 90,
    weeklyTaskCompletionRate: 0.35,
    reviewCompletionRate: 0.25,
    now: new Date("2026-07-07T08:00:00+08:00"),
    weakNodes: [
      {
        id: "node-1",
        title: "极限定义",
        status: "weak",
        subjectName: "数学",
        mistakeCount: 3,
        noteCount: 1,
      },
    ],
    dueMistakes: [
      {
        id: "mistake-1",
        title: "夹逼准则错题",
        subjectName: "数学",
        dueAt: new Date("2026-07-06T08:00:00+08:00"),
        syllabusNodeId: "node-1",
        syllabusNodeTitle: "极限定义",
      },
    ],
    dueNotes: [
      {
        id: "note-1",
        title: "极限笔记",
        subjectName: "数学",
        dueAt: new Date("2026-07-08T08:00:00+08:00"),
      },
    ],
  });

  assert.equal(summary.risks[0]?.type, "low_effective");
  assert.equal(summary.risks.find((risk) => risk.id === "weak-node-node-1")?.severity, "danger");
  assert.equal(summary.risks.find((risk) => risk.id === "mistake-mistake-1")?.severity, "danger");
  assert.equal(summary.risks.find((risk) => risk.id === "note-note-1")?.severity, "info");
  assert.ok(summary.actions.some((action) => action.includes("有效学习闭环")));
  assert.ok(summary.actions.some((action) => action.includes("错题")));
});

test("summarizeAnalyticsRisks gives steady fallback action when risk is clear", () => {
  const summary = summarizeAnalyticsRisks({
    weekEffectiveMinutes: 520,
    weeklyTaskCompletionRate: 0.75,
    reviewCompletionRate: 0.75,
    weakNodes: [],
    dueMistakes: [],
    dueNotes: [],
    now: new Date("2026-07-07T08:00:00+08:00"),
  });

  assert.deepEqual(summary.risks, []);
  assert.deepEqual(summary.actions, ["继续保持当前节奏，把新增产出关联到任务或考纲节点。"]);
});

test("summarizeLongTermRisks combines long-term evidence without auto application", () => {
  const summary = summarizeLongTermRisks({
    window: {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-08T00:00:00.000Z",
      label: "近 7 天",
    },
    effectiveMinutes: 90,
    taskCompletionRate: 0.22,
    debtCount: 11,
    lowConversionCount: 5,
    reviewCompletionRate: 0.3,
    dueMistakeCount: 4,
    dueNoteCount: 2,
    weakNodes: [
      {
        id: "node-limit",
        title: "极限定义",
        subjectName: "数学",
        status: "mistake_hotspot",
        mistakeCount: 4,
        evidenceFreshness: "stale",
      },
    ],
    simulation: {
      latestScoreRate: 0.42,
      daysToNextSimulation: 10,
      weakSubjectNames: ["数学", "英语"],
      isFirstSynchronized: true,
    },
    stage: {
      mode: "recovery",
      goal: "恢复数学和英语基础稳定性",
      daysToFinal: 110,
      activeDraftCount: 1,
    },
    themeState: "recovery",
  });

  assert.equal(summary.canAutoApply, false);
  assert.equal(summary.requiresUserConfirmation, true);
  assert.equal(summary.sourceVersion, 1);
  assert.equal(summary.topRiskLevel, "critical");
  assert.deepEqual(summary.focusSubjects, ["数学", "英语"]);
  assert.equal(summary.risks[0]?.source, "periodic_report");
  assert.ok(summary.risks.some((risk) => risk.source === "task_debt" && risk.actionType === "reduce_debt"));
  assert.ok(summary.risks.some((risk) => risk.source === "syllabus_map" && risk.evidenceFreshness === "stale"));
  assert.ok(summary.risks.some((risk) => risk.source === "simulation" && risk.actionType === "simulate"));
  assert.ok(summary.risks.some((risk) => risk.source === "stage_plan" && risk.actionType === "adjust_stage"));
  assert.ok(summary.nextActions.some((action) => action.includes("最小闭环")));
});

test("summarizeLongTermRisks keeps clear periods as confirm-only guidance", () => {
  const summary = summarizeLongTermRisks({
    window: {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-08T00:00:00.000Z",
      label: "近 7 天",
    },
    effectiveMinutes: 640,
    taskCompletionRate: 0.82,
    debtCount: 0,
    lowConversionCount: 0,
    reviewCompletionRate: 0.85,
    dueMistakeCount: 0,
    dueNoteCount: 0,
    weakNodes: [],
    simulation: {
      latestScoreRate: 0.72,
      daysToNextSimulation: 45,
      weakSubjectNames: [],
    },
    stage: {
      mode: "maintain",
      goal: "维持稳定节奏",
      daysToFinal: 260,
    },
    themeState: "normal",
  });

  assert.deepEqual(summary.risks, []);
  assert.equal(summary.topRiskLevel, "info");
  assert.deepEqual(summary.focusSubjects, []);
  assert.deepEqual(summary.nextActions, ["保持当前节奏，继续把学习产出关联到任务、错题、笔记或考纲节点。"]);
  assert.equal(summary.canAutoApply, false);
  assert.equal(summary.requiresUserConfirmation, true);
});

test("summarizePeriodicReportStrategy strengthens when mistakes outpace review", () => {
  const strategy = summarizePeriodicReportStrategy({
    kind: "week",
    effectiveMinutes: 420,
    taskCompletionRate: 0.7,
    debtCount: 0,
    lowConversionCount: 0,
    mistakesCreatedCount: 8,
    mistakeReviewCount: 2,
    reviewCompletionRate: 0.8,
    weakNodeCount: 1,
    dueNoteCount: 0,
    maxWeakness: "数学 / 极限错题集中",
  });

  assert.equal(strategy.theme, "strengthening");
  assert.match(strategy.mustPressIssue, /新增错题/);
  assert.ok(strategy.nextActions.some((item) => item.includes("错题")));
});

test("summarizePeriodicReportStrategy allows sprint pressure only after stable execution", () => {
  const strategy = summarizePeriodicReportStrategy({
    kind: "month",
    effectiveMinutes: 2600,
    taskCompletionRate: 0.82,
    debtCount: 0,
    lowConversionCount: 0,
    mistakesCreatedCount: 5,
    mistakeReviewCount: 5,
    reviewCompletionRate: 0.8,
    weakNodeCount: 0,
    dueNoteCount: 0,
    maxWeakness: "英语阅读稳定提速",
  });

  assert.equal(strategy.theme, "sprint");
  assert.match(strategy.stageAdjustment, /提高压强/);
  assert.match(strategy.calmConclusion, /真题/);
});

test("rankRecoveryTaskCandidates prefers visible debt and smaller same-priority tasks", () => {
  const ranked = rankRecoveryTaskCandidates({
    todayTasks: [
      {
        id: "today-1",
        title: "今日高优先级任务",
        subject: "英语",
        status: "todo",
        priority: "critical",
        estimatedMinutes: 30,
      },
    ],
    debtTasks: [
      {
        id: "debt-done",
        title: "已完成欠账",
        subject: "数学",
        status: "done",
        priority: "critical",
        estimatedMinutes: 20,
      },
      {
        id: "debt-large",
        title: "大块欠账",
        subject: "数学",
        status: "todo",
        priority: "high",
        estimatedMinutes: 90,
      },
      {
        id: "debt-small",
        title: "小块欠账",
        subject: "数学",
        status: "todo",
        priority: "high",
        estimatedMinutes: 30,
      },
    ],
  });

  assert.deepEqual(ranked.map((task) => task.id), ["debt-small", "debt-large", "today-1"]);
  assert.equal(ranked[0]?.source, "debt");
  assert.match(ranked[0]?.reason ?? "", /欠账/);
});

test("selectRecoveryTaskCandidate deduplicates debt before today's task", () => {
  const selected = selectRecoveryTaskCandidate({
    todayTasks: [
      {
        id: "same-task",
        title: "今日重复任务",
        subject: "数学",
        status: "todo",
        priority: "critical",
        estimatedMinutes: 45,
      },
    ],
    debtTasks: [
      {
        id: "same-task",
        title: "欠账重复任务",
        subject: "数学",
        status: "deferred",
        priority: "medium",
        estimatedMinutes: 25,
      },
    ],
  });

  assert.equal(selected?.id, "same-task");
  assert.equal(selected?.source, "debt");
  assert.equal(selected?.title, "欠账重复任务");
});

test("evaluateMasteryProof blocks mastered levels without real evidence", () => {
  const proof = evaluateMasteryProof({
    requestedLevel: "can_explain",
    completedConditions: ["course_or_textbook"],
    evidence: {
      taskCount: 0,
      sessionCount: 0,
      noteCount: 0,
      mistakeCount: 0,
    },
  });

  assert.equal(proof.canMarkRequestedLevel, false);
  assert.equal(proof.allowedLevel, null);
  assert.equal(proof.risk, "no_evidence");
  assert.match(proof.nextAction, /掌握条件/);
});

test("evaluateMasteryProof allows basic level with manual conditions and real evidence", () => {
  const proof = evaluateMasteryProof({
    requestedLevel: "basic_exercises",
    completedConditions: ["course_or_textbook", "own_explanation", "basic_exercise"],
    evidence: {
      taskCount: 1,
      sessionCount: 1,
      noteCount: 1,
      mistakeCount: 0,
      daysSinceLastEvidence: 0,
    },
  });

  assert.equal(proof.canMarkRequestedLevel, true);
  assert.equal(proof.allowedLevel, "can_explain");
  assert.equal(proof.risk, "ready");
  assert.deepEqual(proof.missingConditions, []);
  assert.deepEqual(proof.missingEvidence, []);
});

test("evaluateMasteryProof keeps manual conditions gated by evidence", () => {
  const proof = evaluateMasteryProof({
    requestedLevel: "basic_exercises",
    completedConditions: ["course_or_textbook", "own_explanation", "basic_exercise"],
    evidence: {
      taskCount: 0,
      sessionCount: 0,
      noteCount: 1,
      mistakeCount: 0,
      daysSinceLastEvidence: 0,
    },
  });

  assert.equal(proof.canMarkRequestedLevel, false);
  assert.equal(proof.allowedLevel, "learned");
  assert.deepEqual(proof.missingConditions, []);
  assert.deepEqual(proof.missingEvidence, ["做题或专项练习记录"]);
});

test("evaluateMasteryProof allows retest level after delayed evidence", () => {
  const proof = evaluateMasteryProof({
    requestedLevel: "retest_passed",
    completedConditions: ["course_or_textbook", "own_explanation", "basic_exercise", "delayed_retest"],
    evidence: {
      taskCount: 2,
      sessionCount: 3,
      noteCount: 1,
      mistakeCount: 1,
      reviewedMistakeCount: 1,
      retestPassedCount: 1,
      daysSinceLastEvidence: 7,
    },
  });

  assert.equal(proof.canMarkRequestedLevel, true);
  assert.equal(proof.allowedLevel, "retest_passed");
  assert.equal(proof.risk, "ready");
  assert.deepEqual(proof.missingEvidence, []);
});

test("draftStageAdjustment keeps AI style suggestions confirm-only", () => {
  const draft = draftStageAdjustment({
    stageGoal: "基础唤醒期",
    taskCompletionRate: 0.18,
    subjectInvestmentBalance: 0.35,
    mistakeReviewRate: 0.2,
    reviewCompletionRate: 0.2,
    currentStreakDays: 0,
    breakCount: 4,
    lowConversionCount: 5,
    weakSubjectNames: ["数学", "408 数据结构"],
    simulationScoreRate: 0.4,
    daysToFinal: 420,
  });

  assert.equal(draft.mode, "recovery");
  assert.equal(draft.risk, "critical");
  assert.equal(draft.taskIntensity, "reduce");
  assert.equal(draft.canAutoApply, false);
  assert.equal(draft.requiresUserConfirmation, true);
  assert.ok(draft.taskAdjustmentActions.includes("split"));
  assert.ok(draft.taskAdjustmentActions.includes("convert_review"));
});

test("draftStageAdjustment switches to sprint near final exam", () => {
  const draft = draftStageAdjustment({
    stageGoal: "冲刺模拟期",
    taskCompletionRate: 0.7,
    subjectInvestmentBalance: 0.62,
    mistakeReviewRate: 0.72,
    reviewCompletionRate: 0.68,
    currentStreakDays: 20,
    breakCount: 0,
    lowConversionCount: 0,
    weakSubjectNames: ["英语"],
    simulationScoreRate: 0.52,
    daysToFinal: 80,
  });

  assert.equal(draft.mode, "sprint");
  assert.equal(draft.risk, "critical");
  assert.equal(draft.taskIntensity, "sprint");
  assert.ok(draft.taskAdjustmentActions.includes("simulate"));
  assert.match(draft.riskConclusion, /冲刺窗口/);
});

test("evaluateSyllabusMapSignal highlights mistake hotspots before mastery", () => {
  const signal = evaluateSyllabusMapSignal({
    nodeStatus: "mastered",
    masteryLevel: "can_explain",
    evidenceCount: 4,
    mistakeCount: 4,
    daysSinceLastReview: 3,
    isHighFrequency: true,
  });

  assert.equal(signal.cellStatus, "mistake_hotspot");
  assert.deepEqual(signal.markers, ["cross", "star", "warning"]);
  assert.match(signal.nextAction, /错题/);
});

test("evaluateSyllabusMapSignal detects forgetting risk for old covered nodes", () => {
  const signal = evaluateSyllabusMapSignal({
    nodeStatus: "covered",
    masteryLevel: "learned",
    evidenceCount: 2,
    mistakeCount: 0,
    daysSinceLastReview: 28,
  });

  assert.equal(signal.cellStatus, "forgetting_risk");
  assert.ok(signal.markers.includes("warning"));
  assert.match(signal.reasons.join("\n"), /遗忘风险/);
});

test("summarizeSyllabusMap aggregates risk filters and focus nodes", () => {
  const summary = summarizeSyllabusMap([
    { id: "n1", title: "极限错题", cellStatus: "mistake_hotspot", subject: "数学", isHighFrequency: true },
    { id: "n2", title: "线代薄弱", cellStatus: "weak", subject: "数学" },
    { id: "n3", title: "英语阅读", cellStatus: "forgetting_risk", subject: "英语", isPersonalFocus: true },
    { id: "n4", title: "操作系统", cellStatus: "covered", subject: "408" },
    { id: "n5", title: "数据结构", cellStatus: "verified", subject: "408" },
  ]);

  assert.equal(summary.totalNodes, 5);
  assert.equal(summary.coverageRate, 100);
  assert.equal(summary.verificationRate, 20);
  assert.equal(summary.riskLevel, "critical");
  assert.deepEqual(summary.recommendedFilters, ["mistake_hotspot", "weak", "forgetting_risk"]);
  assert.deepEqual(summary.focusNodeIds.slice(0, 3), ["n1", "n2", "n3"]);
  assert.ok(summary.nextActions.some((item) => item.includes("错题高发")));
});

test("summarizeSyllabusMap detects clear map with covered-but-unverified action", () => {
  const summary = summarizeSyllabusMap([
    { id: "n1", title: "函数", cellStatus: "covered" },
    { id: "n2", title: "导数", cellStatus: "verified" },
    { id: "n3", title: "积分", cellStatus: "verified" },
  ]);

  assert.equal(summary.riskLevel, "clear");
  assert.equal(summary.coverageRate, 100);
  assert.equal(summary.verificationRate, 67);
  assert.deepEqual(summary.recommendedFilters, []);
  assert.deepEqual(summary.focusNodeIds, ["n1"]);
  assert.ok(summary.nextActions.some((item) => item.includes("复测")));
});

test("summarizeSimulationResult recalibrates after first synchronized simulation", () => {
  const result = summarizeSimulationResult({
    targetScore: 100,
    actualScore: 58,
    targetDurationMinutes: 180,
    actualDurationMinutes: 205,
    blankQuestionCount: 6,
    lossReasons: ["基础概念不稳", "时间分配失控"],
    mood: "很慌",
    isFirstSynchronizedSimulation: true,
  });

  assert.equal(result.performance, "collapse");
  assert.equal(result.timePressure, "high");
  assert.equal(result.shouldRecalibratePlan, true);
  assert.ok(result.postSimulationRequiredFields.includes("第一次全真自测阶段日记"));
  assert.match(result.nextActions.join("\n"), /2027/);
});

test("summarizeSimulationResult keeps near target simulations focused", () => {
  const result = summarizeSimulationResult({
    targetScore: 100,
    actualScore: 94,
    targetDurationMinutes: 180,
    actualDurationMinutes: 176,
    blankQuestionCount: 0,
    lossReasons: [],
  });

  assert.equal(result.performance, "near_target");
  assert.equal(result.timePressure, "low");
  assert.equal(result.shouldRecalibratePlan, false);
});

test("parseSyllabusMarkdown converts headings and nested lists into nodes", () => {
  const parsed = parseSyllabusMarkdown({
    markdown: [
      "# 高等数学",
      "## 函数极限",
      "- 极限定义",
      "  - 夹逼准则",
      "- [x] 连续性",
    ].join("\n"),
  });

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.nodes.map((node) => [node.title, node.depth, node.kind]),
    [
      ["高等数学", 0, "chapter"],
      ["函数极限", 1, "topic"],
      ["极限定义", 2, "problem_type"],
      ["夹逼准则", 3, "problem_type"],
      ["连续性", 2, "problem_type"],
    ],
  );
});

test("parseSyllabusMarkdown rejects oversized or too deep imports", () => {
  const tooDeep = parseSyllabusMarkdown({
    markdown: "####### 不支持",
  });
  const tooMany = parseSyllabusMarkdown({
    markdown: Array.from({ length: 3 }, (_, index) => `# 节点 ${index}`).join("\n"),
    maxLines: 2,
  });

  assert.match(tooDeep.errors.join("\n"), /没有识别/);
  assert.match(tooMany.errors.join("\n"), /最多只能导入/);
});
