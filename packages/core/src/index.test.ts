import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRecoveryPlan,
  determineDebtLevel,
  evaluateAntiFakeStudy,
  evaluateDailyCheckIn,
  evaluateMasteryProof,
  evaluateMotivationWake,
  evaluateSimulationReadiness,
  evaluateStageLevel,
  evaluateSyllabusMapSignal,
  draftStageAdjustment,
  normalizeStudyCloseout,
  parseSyllabusMarkdown,
  summarizeSimulationResult,
  summarizeCheckInHistory,
  summarizeLightweightDebtAction,
} from "./index";

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
