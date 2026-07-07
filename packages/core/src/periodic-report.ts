export type PeriodicReportKind = "week" | "month";

export type PeriodicReportTheme = "recovery" | "strengthening" | "sprint" | "steady";

export type PeriodicWeaknessSource =
  | "syllabus_node"
  | "debt_subject"
  | "zero_effective_subject"
  | "low_conversion"
  | "none";

export type PeriodicWeaknessSeverity = "critical" | "high" | "medium" | "low" | "clear";

export type PeriodicWeaknessNodeStatus =
  | "not_started"
  | "learning"
  | "covered"
  | "needs_review"
  | "mastered"
  | "weak"
  | "deferred";

export interface PeriodicWeaknessSubjectInput {
  subjectName: string;
  effectiveMinutes: number;
}

export interface PeriodicWeaknessDebtInput {
  subjectName: string;
}

export interface PeriodicWeaknessNodeInput {
  title: string;
  status: PeriodicWeaknessNodeStatus;
  subjectName: string;
  mistakeCount: number;
  noteCount: number;
  sessionCount: number;
}

export interface PeriodicWeaknessInput {
  subjectShares: PeriodicWeaknessSubjectInput[];
  debtTasks: PeriodicWeaknessDebtInput[];
  weakNodes: PeriodicWeaknessNodeInput[];
  lowConversionCount: number;
}

export interface PeriodicWeakness {
  title: string;
  detail: string;
  source: PeriodicWeaknessSource;
  severity: PeriodicWeaknessSeverity;
  reasons: string[];
  subjectName?: string;
  syllabusNodeTitle?: string;
}

export interface PeriodicReportStrategyInput {
  kind: PeriodicReportKind;
  effectiveMinutes: number;
  taskCompletionRate: number;
  debtCount: number;
  lowConversionCount: number;
  mistakesCreatedCount: number;
  mistakeReviewCount: number;
  reviewCompletionRate: number;
  weakNodeCount: number;
  dueNoteCount: number;
  maxWeakness?: string;
}

export interface PeriodicReportStrategy {
  theme: PeriodicReportTheme;
  mustPressIssue: string;
  nextActions: string[];
  stageAdjustment: string;
  calmConclusion: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
}

export interface PeriodicNextCycleDraftInput {
  kind: PeriodicReportKind;
  strategy: PeriodicReportStrategy;
  weakness?: Pick<PeriodicWeakness, "title" | "detail" | "source" | "severity">;
}

export interface PeriodicNextCycleDraft {
  title: string;
  focus: string;
  actions: string[];
  stageAdjustment: string;
  theme: PeriodicReportTheme;
  source: "local_rule";
  canAutoApply: false;
  requiresUserConfirmation: true;
  reason: string;
}

export interface PeriodicReportDecisionSnapshotInput {
  kind: PeriodicReportKind;
  range: {
    start: string;
    end: string;
    days: number;
  };
  metrics: {
    totalMinutes: number;
    effectiveMinutes: number;
    taskCompletionRate: number;
    debtCount: number;
    lowConversionCount: number;
    reviewCompletionRate: number;
    weakNodeCount: number;
    dueNoteCount: number;
    mistakesCreatedCount: number;
    mistakeReviewCount: number;
  };
  weakness: PeriodicWeakness;
  strategy: PeriodicReportStrategy;
  nextCycleDraft: PeriodicNextCycleDraft;
}

export interface PeriodicReportDecisionSnapshot {
  sourceVersion: 1;
  kind: PeriodicReportKind;
  range: PeriodicReportDecisionSnapshotInput["range"];
  metrics: PeriodicReportDecisionSnapshotInput["metrics"];
  weakness: PeriodicWeakness;
  strategy: PeriodicReportStrategy;
  nextCycleDraft: PeriodicNextCycleDraft;
  canAutoApply: false;
  requiresUserConfirmation: true;
}

export function choosePeriodicWeakness(input: PeriodicWeaknessInput): PeriodicWeakness {
  const strongestNode = [...input.weakNodes].sort((left, right) => {
    const leftWeight = periodicWeaknessWeight(left.status, left.mistakeCount);
    const rightWeight = periodicWeaknessWeight(right.status, right.mistakeCount);
    return rightWeight - leftWeight;
  })[0];

  if (strongestNode) {
    return {
      title: strongestNode.status === "weak" ? "最大短板：薄弱节点" : "最大短板：错题集中节点",
      detail: `${strongestNode.subjectName} / ${strongestNode.title}：错题 ${strongestNode.mistakeCount}，计时证据 ${strongestNode.sessionCount}，笔记 ${strongestNode.noteCount}。`,
      source: "syllabus_node",
      severity: severityForWeakNode(strongestNode),
      reasons: [
        `节点状态为${labelWeaknessNodeStatus(strongestNode.status)}。`,
        `该节点已有 ${strongestNode.mistakeCount} 条错题、${strongestNode.sessionCount} 条计时证据和 ${strongestNode.noteCount} 条笔记证据。`,
        "考纲节点风险优先于科目欠账和投入缺口。",
      ],
      subjectName: strongestNode.subjectName,
      syllabusNodeTitle: strongestNode.title,
    };
  }

  const debtSubject = mostFrequentPeriodicValue(input.debtTasks.map((task) => task.subjectName));
  if (debtSubject) {
    return {
      title: "最大短板：任务欠账集中",
      detail: `${debtSubject.value} 的欠账最多，下周期先压这个科目。`,
      source: "debt_subject",
      severity: debtSubject.count >= 3 ? "high" : "medium",
      reasons: [
        `${debtSubject.value} 当前欠账 ${debtSubject.count} 项，是欠账最集中的科目。`,
        "没有更高优先级的薄弱考纲节点时，欠账集中科目优先进入下周期策略。",
      ],
      subjectName: debtSubject.value,
    };
  }

  const lowShareSubject = input.subjectShares.find((subject) => subject.effectiveMinutes === 0);
  if (lowShareSubject) {
    return {
      title: "最大短板：投入缺口",
      detail: `${lowShareSubject.subjectName} 本周期没有有效学习记录。`,
      source: "zero_effective_subject",
      severity: "medium",
      reasons: [
        `${lowShareSubject.subjectName} 本周期有效学习时长为 0。`,
        "没有薄弱节点和欠账集中科目时，零有效投入科目优先暴露。",
      ],
      subjectName: lowShareSubject.subjectName,
    };
  }

  if (input.lowConversionCount > 0) {
    return {
      title: "最大短板：低转化学习",
      detail: `本周期有 ${input.lowConversionCount} 次学习被标记为低转化。`,
      source: "low_conversion",
      severity: input.lowConversionCount >= 3 ? "high" : "low",
      reasons: [
        `本周期低转化学习 ${input.lowConversionCount} 次。`,
        "没有单一科目或节点风险时，先处理学习投入和产出脱节。",
      ],
    };
  }

  return {
    title: "最大短板：暂无明确集中风险",
    detail: "当前数据没有显示单一短板，继续保持任务、计时、笔记和错题的关联。",
    source: "none",
    severity: "clear",
    reasons: ["当前没有薄弱节点、集中欠账、零有效投入科目或低转化学习。"],
  };
}

export function summarizePeriodicReportStrategy(input: PeriodicReportStrategyInput): PeriodicReportStrategy {
  const theme = choosePeriodicTheme(input);
  const mustPressIssue = choosePeriodicMustPressIssue(input);
  const nextActions = createPeriodicNextActions(input);

  return {
    theme,
    mustPressIssue,
    nextActions: nextActions.length > 0 ? nextActions : ["保持当前节奏，并把产出继续关联到考纲节点。"],
    stageAdjustment: createPeriodicStageAdjustment(input.kind, theme),
    calmConclusion: createPeriodicCalmConclusion(theme, mustPressIssue),
    canAutoApply: false,
    requiresUserConfirmation: true,
  };
}

export function createPeriodicNextCycleDraft(input: PeriodicNextCycleDraftInput): PeriodicNextCycleDraft {
  const target = input.kind === "week" ? "下周" : "下月";
  const weaknessSummary = input.weakness && input.weakness.source !== "none"
    ? `${input.weakness.title}：${input.weakness.detail}`
    : input.strategy.mustPressIssue;

  return {
    title: `${target}策略草稿`,
    focus: weaknessSummary,
    actions: [...new Set(input.strategy.nextActions)].slice(0, 5),
    stageAdjustment: input.strategy.stageAdjustment,
    theme: input.strategy.theme,
    source: "local_rule",
    canAutoApply: false,
    requiresUserConfirmation: true,
    reason: `由已确认的${input.kind === "week" ? "周审判" : "月复盘"}报告策略生成，只作为下一周期草稿，不自动修改任务或阶段计划。`,
  };
}

export function createPeriodicReportDecisionSnapshot(
  input: PeriodicReportDecisionSnapshotInput,
): PeriodicReportDecisionSnapshot {
  return {
    sourceVersion: 1,
    kind: input.kind,
    range: { ...input.range },
    metrics: { ...input.metrics },
    weakness: {
      ...input.weakness,
      reasons: [...input.weakness.reasons],
    },
    strategy: {
      ...input.strategy,
      nextActions: [...input.strategy.nextActions],
      canAutoApply: false,
      requiresUserConfirmation: true,
    },
    nextCycleDraft: {
      ...input.nextCycleDraft,
      actions: [...input.nextCycleDraft.actions],
      canAutoApply: false,
      requiresUserConfirmation: true,
    },
    canAutoApply: false,
    requiresUserConfirmation: true,
  };
}

function periodicWeaknessWeight(status: PeriodicWeaknessNodeStatus, mistakeCount: number): number {
  const statusWeight = status === "weak" ? 4 : status === "needs_review" ? 3 : 1;
  return statusWeight + mistakeCount;
}

function severityForWeakNode(node: PeriodicWeaknessNodeInput): PeriodicWeaknessSeverity {
  if (node.status === "weak" || node.mistakeCount >= 3) return "critical";
  if (node.status === "needs_review" || node.mistakeCount > 0) return "high";
  return "medium";
}

function labelWeaknessNodeStatus(status: PeriodicWeaknessNodeStatus): string {
  switch (status) {
    case "not_started":
      return "未开始";
    case "learning":
      return "学习中";
    case "covered":
      return "已覆盖";
    case "needs_review":
      return "需复习";
    case "mastered":
      return "已掌握";
    case "weak":
      return "薄弱";
    case "deferred":
      return "暂缓";
  }
}

function mostFrequentPeriodicValue(values: string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const entry = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return entry ? { value: entry[0], count: entry[1] } : null;
}

function choosePeriodicTheme(input: PeriodicReportStrategyInput): PeriodicReportTheme {
  const minimumMinutes = input.kind === "week" ? 180 : 900;
  if (input.effectiveMinutes < minimumMinutes || input.taskCompletionRate < 0.3 || input.debtCount >= 8) {
    return "recovery";
  }

  if (
    input.lowConversionCount >= 3 ||
    input.taskCompletionRate < 0.6 ||
    input.mistakesCreatedCount > input.mistakeReviewCount + 2 ||
    input.weakNodeCount >= 5
  ) {
    return "strengthening";
  }

  if (
    input.effectiveMinutes >= (input.kind === "week" ? 720 : 2400) &&
    input.taskCompletionRate >= 0.75 &&
    input.reviewCompletionRate >= 0.65
  ) {
    return "sprint";
  }

  return "steady";
}

function choosePeriodicMustPressIssue(input: PeriodicReportStrategyInput): string {
  const minimumMinutes = input.kind === "week" ? 180 : 900;
  if (input.effectiveMinutes < minimumMinutes) return "先恢复有效学习时长，不扩任务。";
  if (input.taskCompletionRate < 0.5) return "先压任务完成率，减少明面任务数量。";
  if (input.debtCount > 0) return "先处理最影响阶段推进的欠账。";
  if (input.lowConversionCount > 0) return "先提高学习转化率，每次必须留产出。";
  if (input.mistakesCreatedCount > input.mistakeReviewCount) return "先把新增错题变成复盘证据。";
  if (input.reviewCompletionRate < 0.5) return "先恢复周期复盘，不让记录散掉。";
  if (input.weakNodeCount > 0) return input.maxWeakness ?? "先压最薄弱的考纲节点。";
  if (input.dueNoteCount > 0) return "先处理到期笔记复习，避免遗忘滚大。";
  return input.maxWeakness ?? "保持稳态推进，并固定复盘最大短板。";
}

function createPeriodicNextActions(input: PeriodicReportStrategyInput): string[] {
  const actions: string[] = [];
  const minimumMinutes = input.kind === "week" ? 180 : 900;

  if (input.effectiveMinutes < minimumMinutes) {
    actions.push(input.kind === "week" ? "下周先保证 3 次有效学习闭环。" : "下月先保证每周至少 3 次有效学习闭环。");
  }

  if (input.taskCompletionRate < 0.5) {
    actions.push("把下一周期任务量降到能完成，优先最高优先级任务。");
  }

  if (input.debtCount > 0) {
    actions.push("欠账不全补，只挑最影响阶段推进的 1 到 2 项。");
  }

  if (input.lowConversionCount > 0) {
    actions.push("每次计时结束必须留下一个可检查产出。");
  }

  if (input.mistakesCreatedCount > input.mistakeReviewCount) {
    actions.push("新增错题必须配套复盘更新，别只收集不会。");
  }

  if (input.reviewCompletionRate < 0.5) {
    actions.push("复盘缺口先补，至少写清失控点和下个最小动作。");
  }

  if (input.weakNodeCount > 0) {
    actions.push("给最薄弱考纲节点固定一个复习时间块。");
  }

  if (input.dueNoteCount > 0) {
    actions.push("到期笔记只挑最相关的 1 到 3 条复习。");
  }

  return [...new Set(actions)].slice(0, 5);
}

function createPeriodicStageAdjustment(kind: PeriodicReportKind, theme: PeriodicReportTheme): string {
  const target = kind === "week" ? "下周" : "下月";

  switch (theme) {
    case "recovery":
      return `${target} 减少任务量，先恢复有效学习和复盘闭环。`;
    case "strengthening":
      return `${target} 任务不求多，重点压低转化、错题复盘和薄弱节点。`;
    case "sprint":
      return `${target} 可以提高压强：增加真题、错题和模拟复盘比重。`;
    case "steady":
      return `${target} 保持稳态推进：延续当前节奏，同时给最大短板固定时间块。`;
  }
}

function createPeriodicCalmConclusion(theme: PeriodicReportTheme, mustPressIssue: string): string {
  switch (theme) {
    case "recovery":
      return "这不是总结失败，是把系统拉回可执行状态。";
    case "strengthening":
      return "问题已经出现形状了，接下来不要扩张，先把短板打穿。";
    case "sprint":
      return "节奏已经起来了，接下来要把投入压到真题、错题和复盘上。";
    case "steady":
      return `当前可以稳态推进，但不能无视这个问题：${mustPressIssue}`;
  }
}
