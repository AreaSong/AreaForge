export type MasteryProofCondition =
  | "course_or_textbook"
  | "own_explanation"
  | "basic_exercise"
  | "comprehensive_exercise"
  | "mistake_reviewed"
  | "delayed_retest";

export type MasteryProofLevel =
  | "seen"
  | "learned"
  | "basic_exercises"
  | "can_explain"
  | "retest_passed"
  | "exam_stable";

export interface MasteryEvidenceInput {
  taskCount: number;
  sessionCount: number;
  noteCount: number;
  mistakeCount: number;
  reviewedMistakeCount?: number;
  retestPassedCount?: number;
  daysSinceLastEvidence?: number | null;
}

export interface MasteryProofInput {
  requestedLevel?: MasteryProofLevel;
  completedConditions: MasteryProofCondition[];
  evidence: MasteryEvidenceInput;
}

export interface MasteryProofSummary {
  allowedLevel: MasteryProofLevel | null;
  canMarkRequestedLevel: boolean;
  requestedLevel: MasteryProofLevel | null;
  evidenceCount: number;
  evidenceTypes: string[];
  missingConditions: MasteryProofCondition[];
  missingEvidence: string[];
  risk: "no_evidence" | "thin_evidence" | "stale_evidence" | "ready";
  nextAction: string;
}

const masteryLevels: MasteryProofLevel[] = [
  "seen",
  "learned",
  "basic_exercises",
  "can_explain",
  "retest_passed",
  "exam_stable",
];

export function evaluateMasteryProof(input: MasteryProofInput): MasteryProofSummary {
  const conditionSet = new Set(input.completedConditions);
  const evidenceCount = countMasteryEvidence(input.evidence);
  const evidenceTypes = listEvidenceTypes(input.evidence);
  const allowedLevel = findAllowedMasteryLevel(conditionSet, input.evidence, evidenceCount);
  const requestedLevel = input.requestedLevel ?? allowedLevel;
  const missingConditions = requestedLevel ? missingConditionsForLevel(requestedLevel, conditionSet) : [];
  const missingEvidence = requestedLevel ? missingEvidenceForLevel(requestedLevel, input.evidence, evidenceCount) : [];
  const canMarkRequestedLevel = requestedLevel
    ? Boolean(allowedLevel && masteryLevelRank(allowedLevel) >= masteryLevelRank(requestedLevel))
    : false;
  const risk = classifyMasteryRisk(input.evidence, evidenceCount, allowedLevel);

  return {
    allowedLevel,
    canMarkRequestedLevel,
    requestedLevel,
    evidenceCount,
    evidenceTypes,
    missingConditions,
    missingEvidence,
    risk,
    nextAction: createMasteryNextAction(requestedLevel, missingConditions, missingEvidence, risk),
  };
}

function countMasteryEvidence(evidence: MasteryEvidenceInput): number {
  return (
    Math.max(0, evidence.taskCount) +
    Math.max(0, evidence.sessionCount) +
    Math.max(0, evidence.noteCount) +
    Math.max(0, evidence.mistakeCount) +
    Math.max(0, evidence.reviewedMistakeCount ?? 0) +
    Math.max(0, evidence.retestPassedCount ?? 0)
  );
}

function listEvidenceTypes(evidence: MasteryEvidenceInput): string[] {
  return [
    evidence.taskCount > 0 ? "task" : null,
    evidence.sessionCount > 0 ? "session" : null,
    evidence.noteCount > 0 ? "note" : null,
    evidence.mistakeCount > 0 ? "mistake" : null,
    (evidence.reviewedMistakeCount ?? 0) > 0 ? "mistake_review" : null,
    (evidence.retestPassedCount ?? 0) > 0 ? "retest" : null,
  ].filter((type): type is string => Boolean(type));
}

function findAllowedMasteryLevel(
  conditions: Set<MasteryProofCondition>,
  evidence: MasteryEvidenceInput,
  evidenceCount: number,
): MasteryProofLevel | null {
  for (const level of [...masteryLevels].reverse()) {
    if (
      missingConditionsForLevel(level, conditions).length === 0 &&
      missingEvidenceForLevel(level, evidence, evidenceCount).length === 0
    ) {
      return level;
    }
  }

  return null;
}

function missingConditionsForLevel(
  level: MasteryProofLevel,
  conditions: Set<MasteryProofCondition>,
): MasteryProofCondition[] {
  const required: Record<MasteryProofLevel, MasteryProofCondition[]> = {
    seen: ["course_or_textbook"],
    learned: ["course_or_textbook", "own_explanation"],
    basic_exercises: ["course_or_textbook", "own_explanation", "basic_exercise"],
    can_explain: ["course_or_textbook", "own_explanation", "basic_exercise"],
    retest_passed: ["course_or_textbook", "own_explanation", "basic_exercise", "delayed_retest"],
    exam_stable: [
      "course_or_textbook",
      "own_explanation",
      "basic_exercise",
      "comprehensive_exercise",
      "mistake_reviewed",
      "delayed_retest",
    ],
  };

  return required[level].filter((condition) => !conditions.has(condition));
}

function missingEvidenceForLevel(
  level: MasteryProofLevel,
  evidence: MasteryEvidenceInput,
  evidenceCount: number,
): string[] {
  const missing: string[] = [];

  if (evidenceCount <= 0) {
    missing.push("至少一条任务、计时、笔记、错题或复测证据");
  }

  if (requiresNote(level) && evidence.noteCount <= 0) {
    missing.push("自己的理解笔记");
  }

  if (requiresPractice(level) && evidence.taskCount <= 0 && evidence.sessionCount <= 0) {
    missing.push("做题或专项练习记录");
  }

  if (requiresMistakeReview(level) && (evidence.reviewedMistakeCount ?? 0) <= 0) {
    missing.push("错题复盘证据");
  }

  if (requiresRetest(level) && (evidence.retestPassedCount ?? 0) <= 0) {
    missing.push("7 天后复测通过记录");
  }

  if (level === "exam_stable" && evidence.daysSinceLastEvidence != null && evidence.daysSinceLastEvidence > 30) {
    missing.push("30 天内稳定证据");
  }

  return missing;
}

function requiresNote(level: MasteryProofLevel): boolean {
  return masteryLevelRank(level) >= masteryLevelRank("learned");
}

function requiresPractice(level: MasteryProofLevel): boolean {
  return masteryLevelRank(level) >= masteryLevelRank("basic_exercises");
}

function requiresMistakeReview(level: MasteryProofLevel): boolean {
  return level === "exam_stable";
}

function requiresRetest(level: MasteryProofLevel): boolean {
  return masteryLevelRank(level) >= masteryLevelRank("retest_passed");
}

function masteryLevelRank(level: MasteryProofLevel): number {
  return masteryLevels.indexOf(level);
}

function classifyMasteryRisk(
  evidence: MasteryEvidenceInput,
  evidenceCount: number,
  allowedLevel: MasteryProofLevel | null,
): MasteryProofSummary["risk"] {
  if (evidenceCount <= 0 || !allowedLevel) return "no_evidence";
  if (evidenceCount < 3 || masteryLevelRank(allowedLevel) < masteryLevelRank("basic_exercises")) return "thin_evidence";
  if (evidence.daysSinceLastEvidence != null && evidence.daysSinceLastEvidence > 30) return "stale_evidence";
  return "ready";
}

function createMasteryNextAction(
  requestedLevel: MasteryProofLevel | null,
  missingConditions: MasteryProofCondition[],
  missingEvidence: string[],
  risk: MasteryProofSummary["risk"],
): string {
  if (!requestedLevel) return "先补一条真实学习证据，再谈掌握等级。";
  if (missingConditions.length > 0) return `先补掌握条件：${missingConditions.map(labelCondition).join("、")}。`;
  if (missingEvidence.length > 0) return `先补证据：${missingEvidence.join("、")}。`;
  if (risk === "stale_evidence") return "证据已经偏旧，先安排一次复测再提升掌握等级。";
  if (risk === "thin_evidence") return "证据还薄，先补一条自己的理解或练习记录。";
  return "可以标记当前掌握等级，但后续仍要按复测节奏确认。";
}

function labelCondition(condition: MasteryProofCondition): string {
  switch (condition) {
    case "course_or_textbook":
      return "看完课程或教材";
    case "own_explanation":
      return "写过自己的理解";
    case "basic_exercise":
      return "做过基础题";
    case "comprehensive_exercise":
      return "做过综合题";
    case "mistake_reviewed":
      return "错题已经复盘";
    case "delayed_retest":
      return "7 天后复测";
  }
}
