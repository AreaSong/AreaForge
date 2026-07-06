export type StageAdjustmentMode = "recovery" | "strengthen" | "sprint" | "maintain";

export interface StageAdjustmentDraftInput {
  stageGoal: string;
  taskCompletionRate: number;
  subjectInvestmentBalance: number;
  mistakeReviewRate: number;
  reviewCompletionRate: number;
  currentStreakDays: number;
  breakCount: number;
  lowConversionCount: number;
  weakSubjectNames: string[];
  simulationScoreRate?: number | null;
  daysToFinal: number;
}

export interface StageAdjustmentDraft {
  mode: StageAdjustmentMode;
  risk: "low" | "medium" | "high" | "critical";
  riskConclusion: string;
  focusSubjects: string[];
  taskIntensity: "reduce" | "keep" | "increase" | "sprint";
  taskAdjustmentActions: Array<"split" | "defer" | "drop" | "convert_review" | "simulate" | "retest">;
  nextStageEmphasis: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
}

export function draftStageAdjustment(input: StageAdjustmentDraftInput): StageAdjustmentDraft {
  const mode = determineAdjustmentMode(input);
  const risk = determineAdjustmentRisk(input, mode);
  const focusSubjects = createFocusSubjects(input);

  return {
    mode,
    risk,
    riskConclusion: createRiskConclusion(input, mode, risk),
    focusSubjects,
    taskIntensity: determineTaskIntensity(input, mode),
    taskAdjustmentActions: createTaskAdjustmentActions(input, mode),
    nextStageEmphasis: createNextStageEmphasis(input, mode, focusSubjects),
    canAutoApply: false,
    requiresUserConfirmation: true,
  };
}

function determineAdjustmentMode(input: StageAdjustmentDraftInput): StageAdjustmentMode {
  if (input.daysToFinal <= 120) return "sprint";
  if (
    input.taskCompletionRate < 0.35 ||
    input.breakCount >= 3 ||
    input.lowConversionCount >= 4 ||
    (input.simulationScoreRate != null && input.simulationScoreRate < 0.45)
  ) {
    return "recovery";
  }
  if (
    input.taskCompletionRate >= 0.72 &&
    input.mistakeReviewRate >= 0.6 &&
    input.reviewCompletionRate >= 0.6 &&
    input.currentStreakDays >= 7
  ) {
    return "strengthen";
  }
  return "maintain";
}

function determineAdjustmentRisk(
  input: StageAdjustmentDraftInput,
  mode: StageAdjustmentMode,
): StageAdjustmentDraft["risk"] {
  if (mode === "sprint") return input.simulationScoreRate != null && input.simulationScoreRate < 0.55 ? "critical" : "high";
  if (mode === "recovery") return input.breakCount >= 5 || input.taskCompletionRate < 0.2 ? "critical" : "high";
  if (input.lowConversionCount > 0 || input.subjectInvestmentBalance < 0.45) return "medium";
  return "low";
}

function determineTaskIntensity(
  input: StageAdjustmentDraftInput,
  mode: StageAdjustmentMode,
): StageAdjustmentDraft["taskIntensity"] {
  if (mode === "sprint") return "sprint";
  if (mode === "recovery") return "reduce";
  if (mode === "strengthen" && input.subjectInvestmentBalance >= 0.6) return "increase";
  return "keep";
}

function createTaskAdjustmentActions(
  input: StageAdjustmentDraftInput,
  mode: StageAdjustmentMode,
): StageAdjustmentDraft["taskAdjustmentActions"] {
  const actions = new Set<StageAdjustmentDraft["taskAdjustmentActions"][number]>();

  if (mode === "recovery") {
    actions.add("split");
    actions.add("defer");
    actions.add("drop");
  }

  if (input.lowConversionCount > 0 || input.reviewCompletionRate < 0.5) {
    actions.add("convert_review");
  }

  if (input.mistakeReviewRate < 0.6) {
    actions.add("retest");
  }

  if (mode === "sprint") {
    actions.add("simulate");
    actions.add("convert_review");
    actions.add("retest");
  }

  return Array.from(actions);
}

function createFocusSubjects(input: StageAdjustmentDraftInput): string[] {
  const subjects = input.weakSubjectNames.map((subject) => subject.trim()).filter(Boolean);
  return subjects.length > 0 ? [...new Set(subjects)].slice(0, 3) : ["当前阶段最薄弱科目"];
}

function createRiskConclusion(
  input: StageAdjustmentDraftInput,
  mode: StageAdjustmentMode,
  risk: StageAdjustmentDraft["risk"],
): string {
  if (mode === "sprint") return "已经进入冲刺窗口，阶段调整必须回到真题、模拟、错题和复盘。";
  if (mode === "recovery") return "当前阶段执行不稳，先降低任务面宽度，恢复有效学习连续性。";
  if (mode === "strengthen") return "当前阶段具备加压基础，可以提高薄弱科目和综合题压强。";
  if (risk === "medium") return "阶段目标还可维持，但投入结构或复盘质量需要校正。";
  return `阶段目标「${input.stageGoal}」可以继续执行，重点是保持证据质量。`;
}

function createNextStageEmphasis(
  input: StageAdjustmentDraftInput,
  mode: StageAdjustmentMode,
  focusSubjects: string[],
): string {
  const focus = focusSubjects.join("、");
  switch (mode) {
    case "recovery":
      return `下一阶段先保 ${focus} 的最小闭环，任务少一点，但每天必须有产出。`;
    case "strengthen":
      return `下一阶段提高 ${focus} 的题目强度，并把错题复盘作为掌握证明。`;
    case "sprint":
      return `下一阶段围绕 ${focus} 做真题、模拟和复测，不再扩展低价值新任务。`;
    case "maintain":
      return `下一阶段维持当前目标，把 ${focus} 的证据链补厚。`;
  }
}
