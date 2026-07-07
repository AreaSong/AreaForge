export * from "./study-integrity";
export * from "./mastery-proof";
export * from "./stage-adjustment";
export * from "./syllabus-map";
export * from "./simulation-result";
export * from "./syllabus-import";
export * from "./periodic-report";
export * from "./recovery-task";
export * from "./analytics-summary";

export type RiskState =
  | "rising"
  | "stable"
  | "volatile"
  | "lost"
  | "danger"
  | "sprint";

export type ThemeState =
  | "normal"
  | "forge"
  | "alert"
  | "recovery"
  | "sprint";

export type TimerStatus = "idle" | "running" | "paused" | "ending" | "completed";

export type TaskStatus = "todo" | "in_progress" | "done" | "skipped" | "deferred";

export type TaskDebtLevel =
  | "none"
  | "acceptable"
  | "needs_recovery"
  | "stage_impact"
  | "plan_breaking";

export interface StudyTaskInput {
  id: string;
  title: string;
  subject: string;
  status: TaskStatus;
  estimatedMinutes: number;
  actualMinutes: number;
  priority: "low" | "medium" | "high" | "critical";
}

export interface DashboardInput {
  targetExamDate: Date;
  simulationDate: Date;
  todayMinutes: number;
  effectiveMinutes: number;
  taskCompletionRate: number;
  streakDays: number;
  missedDays: number;
  debtCount: number;
  daysToFinal: number;
  daysToSimulation: number;
  tasks: StudyTaskInput[];
}

export interface DashboardSnapshot {
  riskState: RiskState;
  themeState: ThemeState;
  debtLevel: TaskDebtLevel;
  nextAction: string;
  disciplineLine: string;
  topTasks: StudyTaskInput[];
}

export interface DailyCheckInInput {
  effectiveMinutes: number;
  effectiveSessionCount: number;
  reviewSubmitted: boolean;
  taskCompletionRate: number;
}

export interface DailyCheckInSummary {
  completedMinimumAction: boolean;
  lowEfficiency: boolean;
  reason: string;
}

export interface RecoveryPlanInput {
  riskState: RiskState;
  debtCount: number;
  missedDays: number;
  effectiveMinutes: number;
  topTask?: StudyTaskInput;
}

export interface RecoveryPlan {
  active: boolean;
  minimumMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  action: string;
}

export type StageTitle = "初醒" | "入炉" | "淬火" | "重铸" | "稳态" | "破局" | "冲刺";

export interface StageLevelInput {
  streakDays: number;
  todayEffectiveMinutes: number;
  recentEffectiveMinutes: number;
  taskCompletionRate: number;
  syllabusProgress: number;
  daysToFinal: number;
}

export interface StageLevelSummary {
  title: StageTitle;
  score: number;
  stateLevel: "cold_start" | "warming_up" | "forging" | "stabilizing" | "breakthrough" | "sprint";
  pressure: "low" | "medium" | "high" | "sprint";
  reason: string;
}

export interface MotivationWakeInput {
  hasVault: boolean;
  riskState: RiskState;
  missedDays: number;
  debtCount: number;
  daysToSimulation: number;
  hasMajorReview?: boolean;
  todayMood?: string | null;
}

export interface MotivationWakeSignal {
  shouldWake: boolean;
  trigger:
    | "missing_vault"
    | "lost_streak"
    | "danger_period"
    | "simulation_window"
    | "major_review"
    | "heavy_mood"
    | "none";
  message: string;
}

export interface SimulationReadinessInput {
  daysToSimulation: number;
  weeklyEffectiveMinutes: number;
  weeklyTaskCompletionRate: number;
  reviewCompletionRate: number;
  weakNodeCount: number;
  dueMistakeCount: number;
  hasFirstSimulationDiary: boolean;
}

export interface SimulationReadinessSummary {
  level: "not_ready" | "warming_up" | "ready" | "simulation_window";
  score: number;
  reason: string;
  nextActions: string[];
}

export interface TimerSessionInput {
  status: TimerStatus;
  startedAt?: Date;
  pausedAt?: Date;
  endedAt?: Date;
  accumulatedPauseSeconds: number;
  now?: Date;
}

export interface AntiFakeStudyInput {
  minutes: number;
  hasOutput: boolean;
  canExplain: boolean;
  practiced: boolean;
  reviewedMistake: boolean;
}

export function determineRiskState(input: DashboardInput): RiskState {
  if (input.daysToFinal <= 120) return "sprint";
  if (input.missedDays >= 5 || input.taskCompletionRate < 0.25) return "danger";
  if (input.missedDays >= 3 || input.debtCount >= 10) return "lost";
  if (input.taskCompletionRate < 0.55 || input.effectiveMinutes < 60) return "volatile";
  if (input.streakDays >= 7 && input.taskCompletionRate >= 0.8) return "rising";
  return "stable";
}

export function determineDebtLevel(debtCount: number): TaskDebtLevel {
  if (debtCount <= 0) return "none";
  if (debtCount <= 2) return "acceptable";
  if (debtCount <= 5) return "needs_recovery";
  if (debtCount <= 9) return "stage_impact";
  return "plan_breaking";
}

export function determineThemeState(riskState: RiskState, streakDays: number): ThemeState {
  if (riskState === "sprint") return "sprint";
  if (riskState === "danger" || riskState === "lost") return "recovery";
  if (riskState === "volatile") return "alert";
  if (streakDays >= 7 || riskState === "rising") return "forge";
  return "normal";
}

export function evaluateDailyCheckIn(input: DailyCheckInInput): DailyCheckInSummary {
  const completedMinimumAction = input.effectiveSessionCount > 0 && input.effectiveMinutes >= 25;
  if (!completedMinimumAction) {
    return {
      completedMinimumAction: false,
      lowEfficiency: true,
      reason: "今天还没有完成一次有效学习动作。",
    };
  }

  if (!input.reviewSubmitted) {
    return {
      completedMinimumAction: true,
      lowEfficiency: input.taskCompletionRate < 0.3,
      reason: "有效学习已经发生，晚间复盘还没有收口。",
    };
  }

  if (input.taskCompletionRate < 0.3) {
    return {
      completedMinimumAction: true,
      lowEfficiency: true,
      reason: "有效学习存在，但任务完成率偏低，需要缩小明天任务。",
    };
  }

  return {
    completedMinimumAction: true,
    lowEfficiency: false,
    reason: "今天已经完成最小有效学习动作。",
  };
}

export function createRecoveryPlan(input: RecoveryPlanInput): RecoveryPlan {
  const shouldRecover =
    input.riskState === "danger" ||
    input.riskState === "lost" ||
    input.missedDays >= 3 ||
    input.debtCount >= 6 ||
    input.effectiveMinutes < 30;

  if (!shouldRecover) {
    return {
      active: false,
      minimumMinutes: 45,
      visibleTaskLimit: 4,
      reason: "当前不需要进入恢复模式。",
      action: input.topTask ? `继续推进「${input.topTask.title}」。` : "保持正常任务节奏。",
    };
  }

  const minimumMinutes = input.riskState === "danger" || input.debtCount >= 10 ? 90 : 30;
  return {
    active: true,
    minimumMinutes,
    visibleTaskLimit: 1,
    reason: createRecoveryReason(input),
    action: input.topTask
      ? `今天只压「${input.topTask.title}」这一个最小任务，先完成 ${minimumMinutes} 分钟。`
      : `今天不补过去，先完成 ${minimumMinutes} 分钟有效学习。`,
  };
}

export function evaluateStageLevel(input: StageLevelInput): StageLevelSummary {
  if (input.daysToFinal <= 120) {
    return {
      title: "冲刺",
      score: 100,
      stateLevel: "sprint",
      pressure: "sprint",
      reason: "距离终局考试已进入 120 天内，阶段反馈以真题、错题和复盘为主。",
    };
  }

  const score = clampScore(
    scoreStreak(input.streakDays) +
      scoreEffectiveMinutes(input.todayEffectiveMinutes, input.recentEffectiveMinutes) +
      scoreTaskCompletion(input.taskCompletionRate) +
      scoreSyllabusProgress(input.syllabusProgress),
  );
  const title = titleFromScore(score);

  return {
    title,
    score,
    stateLevel: stateLevelFromTitle(title),
    pressure: pressureFromTitle(title),
    reason: createStageReason(title, input),
  };
}

export function evaluateMotivationWake(input: MotivationWakeInput): MotivationWakeSignal {
  if (!input.hasVault) {
    return {
      shouldWake: true,
      trigger: "missing_vault",
      message: "还没有封存开始的原因。先把底层理由写下来，以后只在关键节点唤醒。",
    };
  }

  if (Math.abs(input.daysToSimulation) <= 7) {
    return {
      shouldWake: true,
      trigger: "simulation_window",
      message: "第一次全真自测窗口已到，适合短暂回看动机档案，确认这次模拟的意义。",
    };
  }

  if (input.hasMajorReview) {
    return {
      shouldWake: true,
      trigger: "major_review",
      message: "今天的复盘已经触及关键问题，适合回看一次动机档案，再把明天最小动作写死。",
    };
  }

  if (input.riskState === "danger" || input.missedDays >= 5 || input.debtCount >= 10) {
    return {
      shouldWake: true,
      trigger: "danger_period",
      message: "当前已经进入危险期，回看动机不是煽情，是重新确认今天为什么必须行动。",
    };
  }

  if (input.riskState === "lost" || input.missedDays >= 3) {
    return {
      shouldWake: true,
      trigger: "lost_streak",
      message: "连续性已经失守，适合回看一次动机档案，然后只执行一个恢复任务。",
    };
  }

  if (input.todayMood && isHeavyMood(input.todayMood)) {
    return {
      shouldWake: true,
      trigger: "heavy_mood",
      message: "今天的状态偏重，动机档案只作为校准方向，不替代复盘和行动。",
    };
  }

  return {
    shouldWake: false,
    trigger: "none",
    message: "当前不需要唤醒动机档案，继续把注意力放在今天的动作上。",
  };
}

export function evaluateSimulationReadiness(input: SimulationReadinessInput): SimulationReadinessSummary {
  const score = clampScore(
    scoreSimulationTiming(input.daysToSimulation) +
      scoreSimulationEffectiveMinutes(input.weeklyEffectiveMinutes) +
      scoreSimulationCompletion(input.weeklyTaskCompletionRate) +
      scoreSimulationReview(input.reviewCompletionRate) -
      scoreSimulationRisks(input.weakNodeCount, input.dueMistakeCount) +
      (input.hasFirstSimulationDiary ? 8 : 0),
  );
  const level = simulationLevelFromScore(score, input.daysToSimulation);

  return {
    level,
    score,
    reason: createSimulationReason(level, input),
    nextActions: createSimulationActions(level, input),
  };
}

export function createDashboardSnapshot(input: DashboardInput): DashboardSnapshot {
  const riskState = determineRiskState(input);
  const themeState = determineThemeState(riskState, input.streakDays);
  const debtLevel = determineDebtLevel(input.debtCount);
  const topTasks = input.tasks
    .filter((task) => task.status !== "done")
    .sort((left, right) => priorityWeight(right.priority) - priorityWeight(left.priority))
    .slice(0, themeState === "recovery" ? 1 : 4);

  return {
    riskState,
    themeState,
    debtLevel,
    topTasks,
    nextAction: createNextAction(themeState, topTasks[0]),
    disciplineLine: createDisciplineLine(riskState, input),
  };
}

export function getTimerElapsedSeconds(input: TimerSessionInput): number {
  if (!input.startedAt) return 0;
  const now = input.endedAt ?? input.pausedAt ?? input.now ?? new Date();
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - input.startedAt.getTime()) / 1000));
  return Math.max(0, totalSeconds - input.accumulatedPauseSeconds);
}

export function evaluateAntiFakeStudy(input: AntiFakeStudyInput): {
  isLowConversion: boolean;
  reason: string;
  requiredOutput: string;
} {
  if (input.minutes < 25) {
    return {
      isLowConversion: true,
      reason: "学习时间太短，还不足以证明一次有效推进。",
      requiredOutput: "补一条 3 句话总结，再结束这次记录。",
    };
  }

  if (!input.hasOutput) {
    return {
      isLowConversion: true,
      reason: "只有投入时长，没有留下可检查的产出。",
      requiredOutput: "写下本次学到的一个概念、一个例题或一个错因。",
    };
  }

  if (!input.canExplain && !input.practiced) {
    return {
      isLowConversion: true,
      reason: "看过不等于会了，还没有讲清或做题验证。",
      requiredOutput: "用自己的话解释 1 个知识点，或复现 1 道基础题。",
    };
  }

  if (input.reviewedMistake) {
    return {
      isLowConversion: false,
      reason: "本次学习有复盘动作，具备转化证据。",
      requiredOutput: "保留这条复盘，明天继续压同类题。",
    };
  }

  return {
    isLowConversion: false,
    reason: "本次学习有可检查产出。",
    requiredOutput: "把产出关联到任务或大纲节点。",
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreSimulationTiming(daysToSimulation: number): number {
  if (daysToSimulation <= 0) return 22;
  if (daysToSimulation <= 7) return 20;
  if (daysToSimulation <= 30) return 14;
  if (daysToSimulation <= 90) return 8;
  return 4;
}

function scoreSimulationEffectiveMinutes(minutes: number): number {
  if (minutes >= 1200) return 28;
  if (minutes >= 720) return 22;
  if (minutes >= 360) return 14;
  if (minutes >= 120) return 7;
  return 0;
}

function scoreSimulationCompletion(rate: number): number {
  if (rate >= 0.8) return 20;
  if (rate >= 0.6) return 14;
  if (rate >= 0.4) return 8;
  if (rate > 0) return 3;
  return 0;
}

function scoreSimulationReview(rate: number): number {
  if (rate >= 0.8) return 14;
  if (rate >= 0.5) return 9;
  if (rate > 0) return 4;
  return 0;
}

function scoreSimulationRisks(weakNodeCount: number, dueMistakeCount: number): number {
  return Math.min(26, weakNodeCount * 4 + dueMistakeCount * 3);
}

function simulationLevelFromScore(
  score: number,
  daysToSimulation: number,
): SimulationReadinessSummary["level"] {
  if (Math.abs(daysToSimulation) <= 7) return "simulation_window";
  if (score >= 70) return "ready";
  if (score >= 40) return "warming_up";
  return "not_ready";
}

function createSimulationReason(level: SimulationReadinessSummary["level"], input: SimulationReadinessInput): string {
  switch (level) {
    case "simulation_window":
      return "第一次全真自测窗口已经临近，重点不是临时加戏，而是按真实考试完成一次闭环。";
    case "ready":
      return "近 7 天有效学习、任务完成和复盘指标能支撑一次全真自测。";
    case "warming_up":
      return "已有部分准备基础，但有效时长、完成率或复盘仍不足以支撑稳定发挥。";
    case "not_ready":
      return "当前准备度不足，先恢复有效学习、任务完成和错题复盘，再谈模拟表现。";
  }
}

function createSimulationActions(level: SimulationReadinessSummary["level"], input: SimulationReadinessInput): string[] {
  const actions: string[] = [];

  if (level === "simulation_window") {
    actions.push("确认模拟考试日期和时间段，按真实考试节奏执行。");
  }

  if (input.weeklyEffectiveMinutes < 360) {
    actions.push("先补足近 7 天有效学习，至少完成 3 次 60 分钟闭环。");
  }

  if (input.weeklyTaskCompletionRate < 0.6) {
    actions.push("把模拟前任务缩小到最关键的 1 到 2 项，先提高完成率。");
  }

  if (input.reviewCompletionRate < 0.5) {
    actions.push("补齐复盘，把失控点和明日最小动作写清楚。");
  }

  if (input.weakNodeCount > 0 || input.dueMistakeCount > 0) {
    actions.push("模拟前只压到期错题和薄弱节点，不扩展新战线。");
  }

  if (!input.hasFirstSimulationDiary) {
    actions.push("自测结束后写阶段日记，记录分数、心态和下一阶段判断。");
  }

  return actions.length > 0 ? [...new Set(actions)].slice(0, 5) : ["保持当前节奏，模拟后立刻复盘错题和时间分配。"];
}

function scoreStreak(streakDays: number): number {
  if (streakDays >= 30) return 30;
  if (streakDays >= 14) return 23;
  if (streakDays >= 7) return 16;
  if (streakDays >= 3) return 9;
  if (streakDays >= 1) return 4;
  return 0;
}

function scoreEffectiveMinutes(todayEffectiveMinutes: number, recentEffectiveMinutes: number): number {
  const todayScore = todayEffectiveMinutes >= 180 ? 15 : todayEffectiveMinutes >= 90 ? 10 : todayEffectiveMinutes >= 30 ? 5 : 0;
  const recentScore = recentEffectiveMinutes >= 1800 ? 25 : recentEffectiveMinutes >= 900 ? 18 : recentEffectiveMinutes >= 360 ? 10 : recentEffectiveMinutes >= 120 ? 4 : 0;
  return todayScore + recentScore;
}

function scoreTaskCompletion(taskCompletionRate: number): number {
  if (taskCompletionRate >= 0.85) return 20;
  if (taskCompletionRate >= 0.65) return 14;
  if (taskCompletionRate >= 0.4) return 8;
  if (taskCompletionRate > 0) return 3;
  return 0;
}

function scoreSyllabusProgress(progress: number): number {
  if (progress >= 0.8) return 15;
  if (progress >= 0.55) return 11;
  if (progress >= 0.3) return 7;
  if (progress > 0) return 3;
  return 0;
}

function titleFromScore(score: number): StageTitle {
  if (score >= 85) return "破局";
  if (score >= 68) return "稳态";
  if (score >= 52) return "重铸";
  if (score >= 36) return "淬火";
  if (score >= 18) return "入炉";
  return "初醒";
}

function stateLevelFromTitle(title: StageTitle): StageLevelSummary["stateLevel"] {
  switch (title) {
    case "初醒":
      return "cold_start";
    case "入炉":
      return "warming_up";
    case "淬火":
    case "重铸":
      return "forging";
    case "稳态":
      return "stabilizing";
    case "破局":
      return "breakthrough";
    case "冲刺":
      return "sprint";
  }
}

function pressureFromTitle(title: StageTitle): StageLevelSummary["pressure"] {
  switch (title) {
    case "初醒":
    case "入炉":
      return "low";
    case "淬火":
    case "重铸":
      return "medium";
    case "稳态":
    case "破局":
      return "high";
    case "冲刺":
      return "sprint";
  }
}

function createStageReason(title: StageTitle, input: StageLevelInput): string {
  switch (title) {
    case "初醒":
      return "连续性和有效时长还没有稳定，先证明今天能在场。";
    case "入炉":
      return `已有 ${input.streakDays} 天连续行动，下一步要把有效时长和任务完成率稳住。`;
    case "淬火":
      return "执行已经启动，但还需要用更多产出和复盘证明掌握。";
    case "重铸":
      return "连续性、有效学习和任务完成率正在形成结构，继续压考纲薄弱点。";
    case "稳态":
      return "当前节奏相对稳定，不要降压，继续提高任务质量和掌握证明。";
    case "破局":
      return "连续投入和完成率已经进入高位，适合提高难度和模拟压力。";
    case "冲刺":
      return "冲刺期所有反馈都应回到真题、错题和复盘。";
  }
}

function isHeavyMood(mood: string): boolean {
  const normalized = mood.trim();
  return ["焦虑", "麻木", "想她", "自责", "很累", "失控"].some((label) => normalized.includes(label));
}

function priorityWeight(priority: StudyTaskInput["priority"]): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function createNextAction(themeState: ThemeState, task?: StudyTaskInput): string {
  if (themeState === "recovery") {
    return task ? `先完成「${task.title}」的 30 分钟恢复任务。` : "先做 30 分钟恢复学习，重新启动。";
  }

  if (!task) return "整理今天的复盘，把明天最小任务写下来。";

  if (themeState === "sprint") return `进入冲刺处理：先压「${task.title}」，结束后记录错因。`;

  return `立即开始「${task.title}」，计时结束后留下一个可检查产出。`;
}

function createDisciplineLine(riskState: RiskState, input: DashboardInput): string {
  switch (riskState) {
    case "rising":
      return `连续 ${input.streakDays} 天在场，别把稳定误认成胜利，今天继续加压。`;
    case "stable":
      return "你已经在轨道上，但清华不会因为你难过就降分。下一步只看行动。";
    case "volatile":
      return "现在的问题不是野心太大，是执行还不够硬。先完成一个最小闭环。";
    case "lost":
      return "断掉的不是计划，是行动感。今天不补过去，先把自己拉回来。";
    case "danger":
      return "按当前完成率，计划正在失效。别讲热血，先完成 90 分钟有效学习。";
    case "sprint":
      return "冲刺期没有情绪豁免，所有时间都要回到真题、错题和复盘。";
  }
}

function createRecoveryReason(input: RecoveryPlanInput): string {
  if (input.riskState === "danger") return "当前风险等级已经进入危险期，先恢复行动感。";
  if (input.riskState === "lost") return "最近连续性失守，今天不处理全部欠账。";
  if (input.missedDays >= 3) return `最近 ${input.missedDays} 天缺少连续有效学习。`;
  if (input.debtCount >= 6) return `当前有 ${input.debtCount} 项欠账，必须缩小战线。`;
  return "今日有效学习不足 30 分钟，先完成恢复任务。";
}
