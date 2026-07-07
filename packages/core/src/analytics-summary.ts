export type AnalyticsRiskType =
  | "weak_node"
  | "note_review"
  | "mistake_review"
  | "review_gap"
  | "low_completion"
  | "low_effective";

export type AnalyticsRiskSeverity = "info" | "warning" | "danger";

export interface AnalyticsReviewItemInput {
  id: string;
  title: string;
  subjectName: string;
  dueAt?: Date | null;
  syllabusNodeId?: string | null;
  syllabusNodeTitle?: string | null;
}

export interface AnalyticsWeakNodeInput {
  id: string;
  title: string;
  status: "weak" | "needs_review" | string;
  subjectName: string;
  mistakeCount: number;
  noteCount: number;
}

export interface AnalyticsRiskSummaryInput {
  weekEffectiveMinutes: number;
  weeklyTaskCompletionRate: number;
  reviewCompletionRate: number;
  dueMistakes: AnalyticsReviewItemInput[];
  dueNotes: AnalyticsReviewItemInput[];
  weakNodes: AnalyticsWeakNodeInput[];
  now?: Date;
}

export interface AnalyticsRiskSummaryItem {
  id: string;
  type: AnalyticsRiskType;
  severity: AnalyticsRiskSeverity;
  title: string;
  detail: string;
  action: string;
  subjectName?: string;
  syllabusNodeId?: string | null;
  syllabusNodeTitle?: string | null;
  dueAt?: Date | null;
}

export interface AnalyticsRiskSummary {
  risks: AnalyticsRiskSummaryItem[];
  actions: string[];
}

export function summarizeAnalyticsRisks(input: AnalyticsRiskSummaryInput): AnalyticsRiskSummary {
  const risks = createAnalyticsRiskItems(input);

  return {
    risks,
    actions: createAnalyticsActions({
      weekEffectiveMinutes: input.weekEffectiveMinutes,
      weeklyTaskCompletionRate: input.weeklyTaskCompletionRate,
      reviewCompletionRate: input.reviewCompletionRate,
      risks,
    }),
  };
}

function createAnalyticsRiskItems(input: AnalyticsRiskSummaryInput): AnalyticsRiskSummaryItem[] {
  const risks: AnalyticsRiskSummaryItem[] = [];
  const now = input.now ?? new Date();

  if (input.weekEffectiveMinutes < 120) {
    risks.push({
      id: "low-effective-week",
      type: "low_effective",
      severity: "danger",
      title: "本周有效学习不足",
      detail: `近 7 天只有 ${input.weekEffectiveMinutes} 分钟有效学习。`,
      action: "先完成一次 30 到 90 分钟的有效学习，再扩展任务量。",
    });
  }

  if (input.weeklyTaskCompletionRate < 0.4) {
    risks.push({
      id: "low-task-completion",
      type: "low_completion",
      severity: "warning",
      title: "任务完成率偏低",
      detail: `近 7 天任务完成率为 ${formatPercent(input.weeklyTaskCompletionRate)}。`,
      action: "减少明天任务数量，把最关键的一项压到完成。",
    });
  }

  if (input.reviewCompletionRate < 0.5) {
    risks.push({
      id: "review-gap",
      type: "review_gap",
      severity: "warning",
      title: "复盘覆盖不足",
      detail: `近 7 天复盘完成率为 ${formatPercent(input.reviewCompletionRate)}。`,
      action: "今晚先补一条复盘，把明天最小任务写下来。",
    });
  }

  for (const node of input.weakNodes) {
    risks.push({
      id: `weak-node-${node.id}`,
      type: "weak_node",
      severity: node.status === "weak" || node.mistakeCount >= 2 ? "danger" : "warning",
      title: node.status === "weak" ? "薄弱节点" : "错题集中节点",
      detail: `${node.subjectName} / ${node.title}：错题 ${node.mistakeCount}，笔记 ${node.noteCount}。`,
      action: "从这个节点挑一道错题复盘，并补一条可解释笔记。",
      subjectName: node.subjectName,
      syllabusNodeId: node.id,
      syllabusNodeTitle: node.title,
    });
  }

  for (const mistake of input.dueMistakes) {
    risks.push({
      id: `mistake-${mistake.id}`,
      type: "mistake_review",
      severity: isOverdue(mistake.dueAt ?? null, now) ? "danger" : "warning",
      title: "错题复习到期",
      detail: `${mistake.subjectName} / ${mistake.title}`,
      action: "今天复做这道错题，更新正确思路和下次复习时间。",
      subjectName: mistake.subjectName,
      syllabusNodeId: mistake.syllabusNodeId ?? null,
      syllabusNodeTitle: mistake.syllabusNodeTitle ?? null,
      dueAt: mistake.dueAt ?? null,
    });
  }

  for (const note of input.dueNotes) {
    risks.push({
      id: `note-${note.id}`,
      type: "note_review",
      severity: isOverdue(note.dueAt ?? null, now) ? "danger" : "info",
      title: "笔记复习提醒",
      detail: `${note.subjectName} / ${note.title}`,
      action: "回看这条笔记，用自己的话复述一遍核心结论。",
      subjectName: note.subjectName,
      syllabusNodeId: note.syllabusNodeId ?? null,
      syllabusNodeTitle: note.syllabusNodeTitle ?? null,
      dueAt: note.dueAt ?? null,
    });
  }

  return risks.slice(0, 12);
}

function createAnalyticsActions(input: {
  weekEffectiveMinutes: number;
  weeklyTaskCompletionRate: number;
  reviewCompletionRate: number;
  risks: AnalyticsRiskSummaryItem[];
}): string[] {
  const actions: string[] = [];
  const firstReviewRisk = input.risks.find((risk) => risk.type === "mistake_review" || risk.type === "note_review");
  const firstWeakNode = input.risks.find((risk) => risk.type === "weak_node");

  if (input.weekEffectiveMinutes < 120) {
    actions.push("今天只追求一次有效学习闭环，不补过去的总账。");
  }

  if (input.weeklyTaskCompletionRate < 0.4) {
    actions.push("明天任务缩到 1 到 2 项，优先完成最高优先级任务。");
  }

  if (input.reviewCompletionRate < 0.5) {
    actions.push("今晚提交复盘，至少写清失控点和明天最小动作。");
  }

  if (firstReviewRisk) {
    actions.push(firstReviewRisk.action);
  }

  if (firstWeakNode) {
    actions.push(firstWeakNode.action);
  }

  return actions.length > 0 ? [...new Set(actions)].slice(0, 5) : ["继续保持当前节奏，把新增产出关联到任务或考纲节点。"];
}

function isOverdue(value: Date | null, now: Date): boolean {
  return Boolean(value && value.getTime() < now.getTime());
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
