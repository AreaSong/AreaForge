export interface SimulationResultInput {
  targetScore: number;
  actualScore: number;
  targetDurationMinutes: number;
  actualDurationMinutes: number;
  blankQuestionCount: number;
  lossReasons: string[];
  mood?: string | null;
  isFirstSynchronizedSimulation?: boolean;
}

export interface SimulationResultSummary {
  scoreGap: number;
  scoreRate: number;
  performance: "above_target" | "near_target" | "below_target" | "collapse";
  timePressure: "low" | "medium" | "high";
  mainShortfalls: string[];
  nextActions: string[];
  shouldRecalibratePlan: boolean;
  postSimulationRequiredFields: string[];
}

export const SIMULATION_LOSS_REASONS = [
  "CONCEPT_GAP",
  "MEMORY_FORMULA",
  "METHOD_ERROR",
  "CALCULATION_CARELESS",
  "TIME_ALLOCATION",
  "READING_COMPREHENSION",
  "UNFAMILIAR_PATTERN",
  "MINDSET",
  "UNANSWERED",
  "OTHER",
] as const;

export type SimulationLossReason = (typeof SIMULATION_LOSS_REASONS)[number];

export interface StructuredSimulationLossInput {
  id?: string;
  subjectId: string;
  reason: SimulationLossReason;
  syllabusNodeId?: string | null;
  lostScore: number;
  archived?: boolean;
}

export interface SimulationSubjectScoreInput {
  subjectId: string;
  paperFullScore: number;
  targetScore: number;
  actualScore: number;
}

export function isHalfPointScore(value: number): boolean {
  return Number.isFinite(value) && Math.round(value * 2) === value * 2;
}

export function summarizeSimulationScores(subjects: SimulationSubjectScoreInput[]) {
  return subjects.reduce(
    (summary, subject) => ({
      paperFullScore: summary.paperFullScore + subject.paperFullScore,
      targetScore: summary.targetScore + subject.targetScore,
      actualScore: summary.actualScore + subject.actualScore,
      realLostScore: summary.realLostScore + Math.max(0, subject.paperFullScore - subject.actualScore),
      targetGap: summary.targetGap + Math.max(0, subject.targetScore - subject.actualScore),
    }),
    { paperFullScore: 0, targetScore: 0, actualScore: 0, realLostScore: 0, targetGap: 0 },
  );
}

export function isHighSeveritySimulationLoss(items: StructuredSimulationLossInput[]): boolean {
  const active = items.filter((item) => !item.archived);
  if (active.some((item) => item.lostScore >= 5)) return true;
  const grouped = new Map<string, number>();
  for (const item of active) {
    const key = `${item.subjectId}:${item.reason}:${item.syllabusNodeId ?? "none"}`;
    grouped.set(key, (grouped.get(key) ?? 0) + item.lostScore);
  }
  return Array.from(grouped.values()).some((score) => score >= 10);
}

export function buildSimulationRemediationGroups(items: StructuredSimulationLossInput[]) {
  const grouped = new Map<string, { subjectId: string; reason: SimulationLossReason; syllabusNodeId: string | null; lostScore: number; itemIds: string[] }>();
  for (const item of items.filter((entry) => !entry.archived)) {
    const key = `${item.subjectId}:${item.reason}:${item.syllabusNodeId ?? "none"}`;
    const current = grouped.get(key) ?? {
      subjectId: item.subjectId,
      reason: item.reason,
      syllabusNodeId: item.syllabusNodeId ?? null,
      lostScore: 0,
      itemIds: [],
    };
    current.lostScore += item.lostScore;
    if (item.id) current.itemIds.push(item.id);
    grouped.set(key, current);
  }
  return Array.from(grouped.entries())
    .map(([originKey, value]) => ({ originKey: `simulation-loss:${originKey}`, ...value }))
    .sort((left, right) => right.lostScore - left.lostScore || left.originKey.localeCompare(right.originKey));
}

export function summarizeSimulationResult(input: SimulationResultInput): SimulationResultSummary {
  const scoreGap = input.actualScore - input.targetScore;
  const scoreRate = input.targetScore > 0 ? roundRate(input.actualScore / input.targetScore) : 0;
  const performance = classifySimulationPerformance(scoreGap, scoreRate);
  const timePressure = classifySimulationTimePressure(input);
  const mainShortfalls = createSimulationShortfalls(input, performance, timePressure);

  return {
    scoreGap,
    scoreRate,
    performance,
    timePressure,
    mainShortfalls,
    nextActions: createSimulationResultActions(input, performance, timePressure, mainShortfalls),
    shouldRecalibratePlan: shouldRecalibratePlan(input, performance),
    postSimulationRequiredFields: createPostSimulationRequiredFields(input),
  };
}

function classifySimulationPerformance(
  scoreGap: number,
  scoreRate: number,
): SimulationResultSummary["performance"] {
  if (scoreGap >= 0) return "above_target";
  if (scoreRate >= 0.9) return "near_target";
  if (scoreRate >= 0.65) return "below_target";
  return "collapse";
}

function classifySimulationTimePressure(input: SimulationResultInput): SimulationResultSummary["timePressure"] {
  if (input.targetDurationMinutes <= 0) return "low";
  const overtimeRate = (input.actualDurationMinutes - input.targetDurationMinutes) / input.targetDurationMinutes;
  if (overtimeRate >= 0.15 || input.blankQuestionCount >= 5) return "high";
  if (overtimeRate > 0 || input.blankQuestionCount > 0) return "medium";
  return "low";
}

function createSimulationShortfalls(
  input: SimulationResultInput,
  performance: SimulationResultSummary["performance"],
  timePressure: SimulationResultSummary["timePressure"],
): string[] {
  const shortfalls = new Set<string>();

  if (performance === "below_target" || performance === "collapse") shortfalls.add("分数低于目标");
  if (timePressure === "high") shortfalls.add("时间分配失控");
  if (input.blankQuestionCount > 0) shortfalls.add("存在空题");
  for (const reason of input.lossReasons.map((item) => item.trim()).filter(Boolean)) {
    shortfalls.add(reason);
  }
  if (input.mood && /慌|焦虑|崩|乱|麻/.test(input.mood)) shortfalls.add("考试心态不稳");

  return shortfalls.size > 0 ? Array.from(shortfalls).slice(0, 6) : ["本次模拟未暴露明显短板"];
}

function createSimulationResultActions(
  input: SimulationResultInput,
  performance: SimulationResultSummary["performance"],
  timePressure: SimulationResultSummary["timePressure"],
  shortfalls: string[],
): string[] {
  const actions = new Set<string>();

  if (performance === "collapse") {
    actions.add("先重建基础任务，不急着追加下一场模拟。");
  }
  if (performance === "below_target") {
    actions.add("把失分原因拆成 1 到 2 个下周必须压住的问题。");
  }
  if (timePressure !== "low") {
    actions.add("复盘每个大题用时，下一场先做限时训练。");
  }
  if (input.blankQuestionCount > 0) {
    actions.add("空题必须归类：不会、来不及、还是心态乱。");
  }
  if (input.isFirstSynchronizedSimulation) {
    actions.add("写第一次全真自测阶段日记，作为 2027 计划重校准输入。");
  }
  if (shortfalls.length > 0) {
    actions.add("把主要短板关联到错题或考纲节点，别只写感受。");
  }

  return actions.size > 0 ? Array.from(actions).slice(0, 5) : ["保持模拟节奏，考后当天完成错题和时间分配复盘。"];
}

function shouldRecalibratePlan(
  input: SimulationResultInput,
  performance: SimulationResultSummary["performance"],
): boolean {
  return Boolean(input.isFirstSynchronizedSimulation || performance === "collapse" || performance === "below_target");
}

function createPostSimulationRequiredFields(input: SimulationResultInput): string[] {
  const fields = ["实际分", "失分原因", "空题数量", "时间分配", "考后总结"];
  if (input.isFirstSynchronizedSimulation) fields.push("第一次全真自测阶段日记");
  return fields;
}

function roundRate(value: number): number {
  return Math.round(value * 100) / 100;
}
