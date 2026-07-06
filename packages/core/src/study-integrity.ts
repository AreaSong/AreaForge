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
