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

