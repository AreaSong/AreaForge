export type LongTermRiskSource =
  | "periodic_report"
  | "task_debt"
  | "syllabus_map"
  | "review_queue"
  | "simulation"
  | "stage_plan"
  | "theme_state";

export type LongTermRiskSeverity = "info" | "warning" | "danger" | "critical";

export type LongTermRiskEvidenceFreshness = "fresh" | "stale" | "unknown";

export type LongTermRiskActionType =
  | "restore_execution"
  | "reduce_debt"
  | "review_evidence"
  | "simulate"
  | "adjust_stage"
  | "maintain";

export interface LongTermRiskWindowInput {
  start: string;
  end: string;
  label?: string;
}

export interface LongTermRiskWeakNodeInput {
  id: string;
  title: string;
  subjectName: string;
  status: "weak" | "needs_review" | "forgetting_risk" | "mistake_hotspot" | string;
  mistakeCount: number;
  evidenceFreshness?: LongTermRiskEvidenceFreshness;
}

export interface LongTermRiskSimulationInput {
  latestScoreRate?: number | null;
  daysToNextSimulation?: number | null;
  weakSubjectNames?: string[];
  isFirstSynchronized?: boolean;
}

export interface LongTermRiskStageInput {
  mode: "recovery" | "strengthen" | "sprint" | "maintain" | string;
  goal: string;
  daysToFinal: number;
  activeDraftCount?: number;
}

export interface LongTermRiskSummaryInput {
  window: LongTermRiskWindowInput;
  effectiveMinutes: number;
  taskCompletionRate: number;
  debtCount: number;
  lowConversionCount: number;
  reviewCompletionRate: number;
  dueMistakeCount: number;
  dueNoteCount: number;
  weakNodes: LongTermRiskWeakNodeInput[];
  simulation?: LongTermRiskSimulationInput | null;
  stage?: LongTermRiskStageInput | null;
  themeState?: "normal" | "forge" | "alert" | "recovery" | "sprint" | string | null;
}

export interface LongTermRiskItem {
  id: string;
  source: LongTermRiskSource;
  severity: LongTermRiskSeverity;
  title: string;
  detail: string;
  window: LongTermRiskWindowInput;
  evidenceFreshness: LongTermRiskEvidenceFreshness;
  nextAction: string;
  actionType: LongTermRiskActionType;
  subjectName?: string;
  syllabusNodeId?: string;
  syllabusNodeTitle?: string;
}

export interface LongTermRiskSummary {
  sourceVersion: 1;
  risks: LongTermRiskItem[];
  topRiskLevel: LongTermRiskSeverity;
  focusSubjects: string[];
  nextActions: string[];
  canAutoApply: false;
  requiresUserConfirmation: true;
}

export function summarizeLongTermRisks(input: LongTermRiskSummaryInput): LongTermRiskSummary {
  const risks = createLongTermRiskItems(input).sort(compareRisks);

  return {
    sourceVersion: 1,
    risks,
    topRiskLevel: risks[0]?.severity ?? "info",
    focusSubjects: createFocusSubjects(risks, input.simulation?.weakSubjectNames ?? []),
    nextActions: createNextActions(risks),
    canAutoApply: false,
    requiresUserConfirmation: true,
  };
}

function createLongTermRiskItems(input: LongTermRiskSummaryInput): LongTermRiskItem[] {
  const risks: LongTermRiskItem[] = [];
  const window = input.window;

  if (input.effectiveMinutes < 240) {
    risks.push({
      id: "periodic-low-effective",
      source: "periodic_report",
      severity: input.effectiveMinutes < 120 ? "critical" : "danger",
      title: "长期有效学习不足",
      detail: `${labelWindow(window)}有效学习 ${input.effectiveMinutes} 分钟，长期策略必须先恢复执行闭环。`,
      window,
      evidenceFreshness: "fresh",
      nextAction: "把下一天任务缩到 1 个最小闭环，先恢复一次有效学习。",
      actionType: "restore_execution",
    });
  }

  if (input.taskCompletionRate < 0.45) {
    risks.push({
      id: "periodic-low-completion",
      source: "periodic_report",
      severity: input.taskCompletionRate < 0.25 ? "danger" : "warning",
      title: "长期任务完成率偏低",
      detail: `${labelWindow(window)}任务完成率为 ${formatPercent(input.taskCompletionRate)}。`,
      window,
      evidenceFreshness: "fresh",
      nextAction: "降低任务数量，把最高优先级任务拆成当天可完成的最小动作。",
      actionType: "restore_execution",
    });
  }

  if (input.debtCount >= 5) {
    risks.push({
      id: "task-debt-backlog",
      source: "task_debt",
      severity: input.debtCount >= 10 ? "critical" : "danger",
      title: "任务债务正在影响阶段计划",
      detail: `${labelWindow(window)}仍有 ${input.debtCount} 个欠账任务。`,
      window,
      evidenceFreshness: "fresh",
      nextAction: "只挑用户确认的欠账进入重排，先处理会阻断阶段目标的任务。",
      actionType: "reduce_debt",
    });
  }

  if (input.lowConversionCount >= 2) {
    risks.push({
      id: "periodic-low-conversion",
      source: "periodic_report",
      severity: input.lowConversionCount >= 5 ? "danger" : "warning",
      title: "低转化学习偏多",
      detail: `${labelWindow(window)}低转化记录 ${input.lowConversionCount} 次。`,
      window,
      evidenceFreshness: "fresh",
      nextAction: "后续学习必须留下笔记、错题复盘或可解释输出，避免只累计时长。",
      actionType: "review_evidence",
    });
  }

  if (input.reviewCompletionRate < 0.5) {
    risks.push({
      id: "review-coverage-gap",
      source: "review_queue",
      severity: "warning",
      title: "复盘覆盖不足",
      detail: `${labelWindow(window)}复盘完成率为 ${formatPercent(input.reviewCompletionRate)}。`,
      window,
      evidenceFreshness: "fresh",
      nextAction: "先补一条周期复盘，写清最大失控点和下一天最小任务。",
      actionType: "review_evidence",
    });
  }

  if (input.dueMistakeCount + input.dueNoteCount > 0) {
    risks.push({
      id: "review-queue-due",
      source: "review_queue",
      severity: input.dueMistakeCount >= 3 ? "danger" : "warning",
      title: "复习队列到期",
      detail: `到期错题 ${input.dueMistakeCount} 条，到期笔记 ${input.dueNoteCount} 条。`,
      window,
      evidenceFreshness: "fresh",
      nextAction: "优先处理到期错题，再回看与其同节点的笔记。",
      actionType: "review_evidence",
    });
  }

  for (const node of input.weakNodes) {
    risks.push({
      id: `syllabus-${node.id}`,
      source: "syllabus_map",
      severity: severityForWeakNode(node),
      title: labelWeakNode(node),
      detail: `${node.subjectName} / ${node.title}：错题 ${node.mistakeCount}。`,
      window,
      evidenceFreshness: node.evidenceFreshness ?? "unknown",
      nextAction: "围绕这个节点补一次错题复盘或延迟复测，再更新掌握证明。",
      actionType: "review_evidence",
      subjectName: node.subjectName,
      syllabusNodeId: node.id,
      syllabusNodeTitle: node.title,
    });
  }

  if (input.simulation) {
    const score = input.simulation.latestScoreRate;
    if (score != null && score < 0.55) {
      risks.push({
        id: "simulation-low-score",
        source: "simulation",
        severity: score < 0.45 ? "critical" : "danger",
        title: "模拟考试结果偏低",
        detail: `最近模拟得分率为 ${formatPercent(score)}。`,
        window,
        evidenceFreshness: "fresh",
        nextAction: "先把薄弱科目和失分原因写入阶段草稿，确认后再调整阶段计划。",
        actionType: "simulate",
      });
    }

    if (input.simulation.daysToNextSimulation != null && input.simulation.daysToNextSimulation <= 14) {
      risks.push({
        id: "simulation-window",
        source: "simulation",
        severity: "warning",
        title: "同步模拟窗口临近",
        detail: `距离下一次同步模拟约 ${input.simulation.daysToNextSimulation} 天。`,
        window,
        evidenceFreshness: "fresh",
        nextAction: "把近两周安排收敛到真题、错题和模拟复盘。",
        actionType: "simulate",
      });
    }
  }

  if (input.stage) {
    if (input.stage.mode === "recovery" || input.stage.activeDraftCount) {
      risks.push({
        id: "stage-plan-draft",
        source: "stage_plan",
        severity: input.stage.mode === "recovery" ? "danger" : "warning",
        title: "阶段计划需要确认调整",
        detail: `当前阶段目标为「${input.stage.goal}」，仍有 ${input.stage.activeDraftCount ?? 0} 个待确认草稿。`,
        window,
        evidenceFreshness: "fresh",
        nextAction: "先阅读阶段草稿，确认或驳回后再让页面使用新的阶段目标。",
        actionType: "adjust_stage",
      });
    }

    if (input.stage.daysToFinal <= 120) {
      risks.push({
        id: "stage-sprint-window",
        source: "stage_plan",
        severity: "danger",
        title: "冲刺窗口已经打开",
        detail: `距离最终考试约 ${input.stage.daysToFinal} 天。`,
        window,
        evidenceFreshness: "fresh",
        nextAction: "把长期计划压缩到真题、模拟、错题和复盘四条线。",
        actionType: "adjust_stage",
      });
    }
  }

  if (input.themeState === "recovery" || input.themeState === "alert") {
    risks.push({
      id: `theme-${input.themeState}`,
      source: "theme_state",
      severity: input.themeState === "recovery" ? "danger" : "warning",
      title: input.themeState === "recovery" ? "首页状态处于恢复态" : "首页状态处于警报态",
      detail: "首页状态主题已提示当前节奏需要收窄。",
      window,
      evidenceFreshness: "fresh",
      nextAction: "保持完整任务列表可见，但把行动焦点收敛到最小可执行任务。",
      actionType: "restore_execution",
    });
  }

  return risks.slice(0, 16);
}

function createFocusSubjects(risks: LongTermRiskItem[], simulationSubjects: string[]): string[] {
  const subjects = [
    ...risks.map((risk) => risk.subjectName),
    ...simulationSubjects,
  ]
    .filter((subject): subject is string => Boolean(subject?.trim()))
    .map((subject) => subject.trim());

  return [...new Set(subjects)].slice(0, 3);
}

function createNextActions(risks: LongTermRiskItem[]): string[] {
  const actions = risks.map((risk) => risk.nextAction);
  return actions.length > 0 ? [...new Set(actions)].slice(0, 5) : ["保持当前节奏，继续把学习产出关联到任务、错题、笔记或考纲节点。"];
}

function compareRisks(left: LongTermRiskItem, right: LongTermRiskItem): number {
  const severityDiff = severityRank(right.severity) - severityRank(left.severity);
  if (severityDiff !== 0) return severityDiff;
  return sourceRank(right.source) - sourceRank(left.source);
}

function severityRank(severity: LongTermRiskSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "danger":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function sourceRank(source: LongTermRiskSource): number {
  switch (source) {
    case "periodic_report":
      return 7;
    case "task_debt":
      return 6;
    case "simulation":
      return 5;
    case "stage_plan":
      return 4;
    case "syllabus_map":
      return 3;
    case "review_queue":
      return 2;
    case "theme_state":
      return 1;
  }
}

function severityForWeakNode(node: LongTermRiskWeakNodeInput): LongTermRiskSeverity {
  if (node.status === "weak" || node.status === "mistake_hotspot" || node.mistakeCount >= 3) return "danger";
  if (node.status === "forgetting_risk" || node.evidenceFreshness === "stale") return "warning";
  return "info";
}

function labelWeakNode(node: LongTermRiskWeakNodeInput): string {
  if (node.status === "mistake_hotspot") return "错题高发节点";
  if (node.status === "forgetting_risk") return "遗忘风险节点";
  if (node.status === "weak") return "薄弱节点";
  return "需要复核的考纲节点";
}

function labelWindow(window: LongTermRiskWindowInput): string {
  return window.label ? `${window.label} ` : "";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
