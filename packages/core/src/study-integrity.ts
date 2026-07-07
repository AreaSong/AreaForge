export interface StudyCloseoutInput {
  minutes: number;
  userMarkedEffective: boolean;
  understandingLevel: string;
  minimalOutput: string;
  nextAction: string;
  note?: string;
  producedNote?: boolean;
  producedMistake?: boolean;
}

export interface StudyCloseoutSummary {
  isEffective: boolean;
  isLowConversion: boolean;
  antiFakeReason: string;
  requiredOutput: string;
  hasOutput: boolean;
  canExplain: boolean;
  practiced: boolean;
  reviewedMistake: boolean;
  closeoutText: string;
}

export interface CheckInSnapshotInput {
  studyDate: string;
  completedMinimumAction: boolean;
  lowEfficiency: boolean;
  effectiveMinutes: number;
}

export interface CheckInHistorySummary {
  currentStreakDays: number;
  longestStreakDays: number;
  missedDaysInWindow: number;
  recentMissedDates: string[];
  breakCount: number;
  consecutiveLowEfficiencyDays: number;
}

export type LightweightDebtAction =
  | "recover"
  | "defer"
  | "drop"
  | "split"
  | "convert_review"
  | "complete";

export type LightweightDebtTaskStatus = "todo" | "in_progress" | "done" | "skipped" | "deferred";

export interface LightweightDebtActionInput {
  action: LightweightDebtAction;
  fromStatus: LightweightDebtTaskStatus;
  toStatus: LightweightDebtTaskStatus;
  reason?: string;
}

export interface LightweightDebtActionSummary {
  action: LightweightDebtAction;
  label: string;
  shouldResolveDebt: boolean;
  shouldKeepDebtVisible: boolean;
  auditAction: string;
  reason: string;
}

export type TaskDebtReorderAction =
  | "keep"
  | "recover"
  | "defer"
  | "split"
  | "drop"
  | "convert_review";

export type TaskDebtReorderPressure = "normal" | "recovery" | "stage_impact" | "sprint";

export interface TaskDebtReorderTaskInput {
  id: string;
  title: string;
  subject: string;
  priority: "low" | "medium" | "high" | "critical";
  estimatedMinutes: number;
  daysOverdue: number;
  hasRecentEvidence?: boolean;
  blocksStageGoal?: boolean;
  isReviewable?: boolean;
}

export interface TaskDebtReorderInput {
  tasks: TaskDebtReorderTaskInput[];
  pressure: TaskDebtReorderPressure;
  availableMinutes: number;
}

export interface TaskDebtReorderSuggestion {
  taskId: string;
  action: TaskDebtReorderAction;
  reason: string;
  estimatedMinutes: number;
  rank: number;
}

export interface TaskDebtReorderPlan {
  suggestions: TaskDebtReorderSuggestion[];
  keepTaskIds: string[];
  deferredTaskIds: string[];
  droppedTaskIds: string[];
  canAutoApply: false;
  requiresUserConfirmation: true;
  summary: string;
}

export function normalizeStudyCloseout(input: StudyCloseoutInput): StudyCloseoutSummary {
  const hasOutput = Boolean(input.producedNote || input.producedMistake || input.minimalOutput.trim().length >= 4);
  const canExplain = canExplainFromText(input.understandingLevel, input.note);
  const practiced = mentionsPractice(input.minimalOutput, input.note);
  const reviewedMistake = Boolean(input.producedMistake || mentionsMistakeReview(input.minimalOutput, input.note));
  const antiFake = evaluateCloseoutConversion({
    minutes: input.minutes,
    hasOutput,
    canExplain,
    practiced,
    reviewedMistake,
  });
  const isEffective = input.userMarkedEffective && !antiFake.isLowConversion;

  return {
    isEffective,
    isLowConversion: antiFake.isLowConversion,
    antiFakeReason: antiFake.reason,
    requiredOutput: antiFake.requiredOutput,
    hasOutput,
    canExplain,
    practiced,
    reviewedMistake,
    closeoutText: composeCloseoutText(input, antiFake, isEffective),
  };
}

export function summarizeCheckInHistory(
  snapshots: CheckInSnapshotInput[],
  windowDays = 7,
): CheckInHistorySummary {
  const byDate = new Map(snapshots.map((snapshot) => [snapshot.studyDate, snapshot]));
  const sortedDates = Array.from(byDate.keys()).sort();
  const latestDate = sortedDates.at(-1);

  if (!latestDate) {
    return {
      currentStreakDays: 0,
      longestStreakDays: 0,
      missedDaysInWindow: windowDays,
      recentMissedDates: [],
      breakCount: 0,
      consecutiveLowEfficiencyDays: 0,
    };
  }

  let currentStreakDays = 0;
  let consecutiveLowEfficiencyDays = 0;
  const recentMissedDates: string[] = [];

  for (let index = 0; index < windowDays; index += 1) {
    const dateKey = shiftDateKey(latestDate, -index);
    const snapshot = byDate.get(dateKey);

    if (snapshot?.completedMinimumAction) {
      if (currentStreakDays === index) {
        currentStreakDays += 1;
      }
      if (snapshot.lowEfficiency && consecutiveLowEfficiencyDays === index) {
        consecutiveLowEfficiencyDays += 1;
      }
    } else {
      recentMissedDates.push(dateKey);
      if (index === 0) {
        currentStreakDays = 0;
      }
    }

    if (!snapshot?.lowEfficiency && consecutiveLowEfficiencyDays === index) {
      consecutiveLowEfficiencyDays = index === 0 ? 0 : consecutiveLowEfficiencyDays;
    }
  }

  return {
    currentStreakDays,
    longestStreakDays: calculateLongestStreak(byDate),
    missedDaysInWindow: recentMissedDates.length,
    recentMissedDates,
    breakCount: calculateBreakCount(byDate),
    consecutiveLowEfficiencyDays,
  };
}

export function summarizeLightweightDebtAction(
  input: LightweightDebtActionInput,
): LightweightDebtActionSummary {
  const shouldResolveDebt = input.action === "complete" || input.action === "drop";
  const shouldKeepDebtVisible = input.action === "recover" || input.action === "defer" || input.action === "split" || input.action === "convert_review";

  return {
    action: input.action,
    label: labelDebtAction(input.action),
    shouldResolveDebt,
    shouldKeepDebtVisible,
    auditAction: auditActionForDebtAction(input.action),
    reason: input.reason?.trim() || defaultDebtActionReason(input.action, input.fromStatus, input.toStatus),
  };
}

export function suggestTaskDebtReorder(input: TaskDebtReorderInput): TaskDebtReorderPlan {
  const taskBudget = budgetForPressure(input.pressure, input.availableMinutes);
  const ranked = [...input.tasks]
    .map((task) => ({
      task,
      score: scoreDebtTask(task, input.pressure),
    }))
    .sort((left, right) => right.score - left.score);

  let usedMinutes = 0;
  const suggestions = ranked.map(({ task }, index) => {
    const action = chooseDebtReorderAction({
      task,
      pressure: input.pressure,
      remainingMinutes: Math.max(0, taskBudget - usedMinutes),
    });
    const estimatedMinutes = minutesForDebtAction(task, action);
    if (action === "recover" || action === "split" || action === "convert_review" || action === "keep") {
      usedMinutes += estimatedMinutes;
    }

    return {
      taskId: task.id,
      action,
      reason: reasonForDebtSuggestion(task, action, input.pressure),
      estimatedMinutes,
      rank: index + 1,
    };
  });

  return {
    suggestions,
    keepTaskIds: suggestions
      .filter((item) => item.action === "keep" || item.action === "recover" || item.action === "split" || item.action === "convert_review")
      .map((item) => item.taskId),
    deferredTaskIds: suggestions.filter((item) => item.action === "defer").map((item) => item.taskId),
    droppedTaskIds: suggestions.filter((item) => item.action === "drop").map((item) => item.taskId),
    canAutoApply: false,
    requiresUserConfirmation: true,
    summary: createDebtReorderSummary(suggestions, input.pressure),
  };
}

function evaluateCloseoutConversion(input: {
  minutes: number;
  hasOutput: boolean;
  canExplain: boolean;
  practiced: boolean;
  reviewedMistake: boolean;
}) {
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

function composeCloseoutText(
  input: StudyCloseoutInput,
  antiFake: ReturnType<typeof evaluateCloseoutConversion>,
  isEffective: boolean,
): string {
  return [
    `理解程度：${input.understandingLevel}`,
    `最小产出：${input.minimalOutput}`,
    `下一步动作：${input.nextAction}`,
    `反假学习：${isEffective ? "通过" : "低转化"}`,
    `规则原因：${antiFake.reason}`,
    antiFake.isLowConversion ? `补产出要求：${antiFake.requiredOutput}` : `保留动作：${antiFake.requiredOutput}`,
    input.producedNote ? "产生笔记：是" : null,
    input.producedMistake ? "产生错题：是" : null,
    input.note ? `补充：${input.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function canExplainFromText(understandingLevel: string, note: string | undefined): boolean {
  const text = `${understandingLevel}\n${note ?? ""}`;
  if (/不会|不懂|没懂|说不清|讲不出|糊涂|模糊/.test(text)) return false;
  return text.trim().length >= 4;
}

function mentionsPractice(minimalOutput: string, note: string | undefined): boolean {
  return /题|练|刷|例题|真题|复现|推导|代码|证明|默写/.test(`${minimalOutput}\n${note ?? ""}`);
}

function mentionsMistakeReview(minimalOutput: string, note: string | undefined): boolean {
  return /错题|错因|复盘|订正|失分|漏洞/.test(`${minimalOutput}\n${note ?? ""}`);
}

function calculateLongestStreak(byDate: Map<string, CheckInSnapshotInput>): number {
  let longest = 0;
  let current = 0;

  for (const dateKey of Array.from(byDate.keys()).sort()) {
    const snapshot = byDate.get(dateKey);
    if (snapshot?.completedMinimumAction) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function calculateBreakCount(byDate: Map<string, CheckInSnapshotInput>): number {
  let breakCount = 0;
  let wasInStreak = false;

  for (const dateKey of Array.from(byDate.keys()).sort()) {
    const snapshot = byDate.get(dateKey);
    if (snapshot?.completedMinimumAction) {
      wasInStreak = true;
    } else if (wasInStreak) {
      breakCount += 1;
      wasInStreak = false;
    }
  }

  return breakCount;
}

function shiftDateKey(dateKey: string, offsetDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return date.toISOString().slice(0, 10);
}

function labelDebtAction(action: LightweightDebtAction): string {
  switch (action) {
    case "recover":
      return "补做";
    case "defer":
      return "延期";
    case "drop":
      return "放弃";
    case "split":
      return "拆小";
    case "convert_review":
      return "改成复习任务";
    case "complete":
      return "完成";
  }
}

function auditActionForDebtAction(action: LightweightDebtAction): string {
  switch (action) {
    case "recover":
      return "STUDY_TASK_RECOVERED";
    case "defer":
      return "STUDY_TASK_DEFERRED";
    case "drop":
      return "STUDY_TASK_DROPPED";
    case "split":
      return "STUDY_TASK_SPLIT_LIGHTWEIGHT";
    case "convert_review":
      return "STUDY_TASK_CONVERTED_TO_REVIEW";
    case "complete":
      return "STUDY_TASK_COMPLETED";
  }
}

function defaultDebtActionReason(
  action: LightweightDebtAction,
  fromStatus: LightweightDebtTaskStatus,
  toStatus: LightweightDebtTaskStatus,
): string {
  return `${labelDebtAction(action)}：任务从 ${fromStatus} 流转到 ${toStatus}。`;
}

function budgetForPressure(pressure: TaskDebtReorderPressure, availableMinutes: number): number {
  const safeMinutes = Math.max(0, availableMinutes);
  switch (pressure) {
    case "recovery":
      return Math.min(safeMinutes, 90);
    case "stage_impact":
      return Math.min(safeMinutes, 180);
    case "sprint":
      return Math.min(safeMinutes, 240);
    case "normal":
      return Math.min(safeMinutes, 120);
  }
}

function scoreDebtTask(task: TaskDebtReorderTaskInput, pressure: TaskDebtReorderPressure): number {
  return (
    priorityScore(task.priority) +
    Math.min(24, task.daysOverdue * 3) +
    (task.blocksStageGoal ? 28 : 0) +
    (task.isReviewable ? reviewableScore(pressure) : 0) +
    (task.hasRecentEvidence ? -10 : 0) -
    Math.max(0, task.estimatedMinutes - 90) / 6
  );
}

function chooseDebtReorderAction(input: {
  task: TaskDebtReorderTaskInput;
  pressure: TaskDebtReorderPressure;
  remainingMinutes: number;
}): TaskDebtReorderAction {
  const { task, pressure, remainingMinutes } = input;

  if (pressure === "recovery") {
    if (task.blocksStageGoal || task.priority === "critical") {
      return task.estimatedMinutes > remainingMinutes ? "split" : "recover";
    }
    if (task.isReviewable) return "convert_review";
    return "defer";
  }

  if (pressure === "sprint") {
    if (task.blocksStageGoal || task.priority === "critical") {
      return task.estimatedMinutes > remainingMinutes ? "split" : "recover";
    }
    if (task.isReviewable) return "convert_review";
    return task.daysOverdue >= 14 ? "drop" : "defer";
  }

  if (task.blocksStageGoal) {
    return task.estimatedMinutes > remainingMinutes ? "split" : "recover";
  }

  if (task.priority === "critical" || task.priority === "high") {
    return task.estimatedMinutes > remainingMinutes ? "split" : "recover";
  }

  if (task.isReviewable && task.daysOverdue >= 3) return "convert_review";
  if (task.daysOverdue >= 10 && !task.hasRecentEvidence) return "drop";
  if (task.estimatedMinutes > remainingMinutes) return "defer";
  return "keep";
}

function minutesForDebtAction(task: TaskDebtReorderTaskInput, action: TaskDebtReorderAction): number {
  switch (action) {
    case "split":
      return Math.min(45, Math.max(25, Math.ceil(task.estimatedMinutes / 2)));
    case "convert_review":
      return Math.min(30, Math.max(20, Math.ceil(task.estimatedMinutes / 3)));
    case "recover":
    case "keep":
      return task.estimatedMinutes;
    case "defer":
    case "drop":
      return 0;
  }
}

function reasonForDebtSuggestion(
  task: TaskDebtReorderTaskInput,
  action: TaskDebtReorderAction,
  pressure: TaskDebtReorderPressure,
): string {
  switch (action) {
    case "recover":
      return task.blocksStageGoal
        ? "该任务阻塞阶段目标，建议优先补做。"
        : "优先级和欠账时间较高，建议补做。";
    case "split":
      return pressure === "recovery"
        ? "恢复期不适合硬补大任务，建议拆成一个最小任务。"
        : "任务体量超过当前可用时间，建议拆小后推进。";
    case "convert_review":
      return "该任务可转化为复习动作，先压住遗忘和错题风险。";
    case "defer":
      return "当前压强下不应一次补完，建议延期并保留可见。";
    case "drop":
      return "该欠账过旧且不阻塞阶段目标，建议放弃，避免继续污染计划。";
    case "keep":
      return "该任务仍可保留在当前计划中，暂不需要重排。";
  }
}

function createDebtReorderSummary(
  suggestions: TaskDebtReorderSuggestion[],
  pressure: TaskDebtReorderPressure,
): string {
  const recoverCount = suggestions.filter((item) => item.action === "recover").length;
  const splitCount = suggestions.filter((item) => item.action === "split").length;
  const deferCount = suggestions.filter((item) => item.action === "defer").length;
  const dropCount = suggestions.filter((item) => item.action === "drop").length;
  return `压强 ${pressure}：建议补做 ${recoverCount} 项，拆小 ${splitCount} 项，延期 ${deferCount} 项，放弃 ${dropCount} 项；所有建议需用户确认后才可应用。`;
}

function priorityScore(priority: TaskDebtReorderTaskInput["priority"]): number {
  switch (priority) {
    case "critical":
      return 40;
    case "high":
      return 28;
    case "medium":
      return 16;
    case "low":
      return 6;
  }
}

function reviewableScore(pressure: TaskDebtReorderPressure): number {
  return pressure === "sprint" ? 14 : 8;
}
