import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRecoveryPlan,
  determineDebtLevel,
  evaluateAntiFakeStudy,
  evaluateDailyCheckIn,
  evaluateMotivationWake,
  evaluateSimulationReadiness,
  evaluateStageLevel,
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
