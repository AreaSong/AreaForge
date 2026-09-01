export type MasteryStatus = "UNTOUCHED" | "LEARNING" | "INDEPENDENT" | "STABLE";

export type KnowledgeMasteryPersistenceState =
  | "UNTOUCHED"
  | "LEARNING"
  | "INITIAL_MASTERY"
  | "STABLE_MASTERY"
  | "NEEDS_RETEST";

export type SyllabusMasteryPersistenceLevel =
  | "seen"
  | "learned"
  | "basic_exercises"
  | "can_explain"
  | "retest_passed"
  | "exam_stable";

export interface MasteryStatusView {
  status: MasteryStatus;
  label: string;
  tone: "neutral" | "info" | "warning" | "success";
  needsRetest: boolean;
}

export interface MasteryQuantitativeInput {
  evidenceCount: number;
  sessionCount?: number;
  noteCount?: number;
  mistakeCount?: number;
  passedRetestCount?: number;
  daysSinceLastEvidence?: number | null;
}

export const MASTERY_STATUS_OPTIONS: readonly MasteryStatus[] = [
  "UNTOUCHED",
  "LEARNING",
  "INDEPENDENT",
  "STABLE",
] as const;

const labels: Record<MasteryStatus, string> = {
  UNTOUCHED: "未接触",
  LEARNING: "学习中",
  INDEPENDENT: "可独立应用",
  STABLE: "稳定掌握",
};

const tones: Record<MasteryStatus, MasteryStatusView["tone"]> = {
  UNTOUCHED: "neutral",
  LEARNING: "info",
  INDEPENDENT: "warning",
  STABLE: "success",
};

export function masteryStatusLabel(status: MasteryStatus): string {
  return labels[status];
}

export function masteryStatusTone(status: MasteryStatus): MasteryStatusView["tone"] {
  return tones[status];
}

export function knowledgeMasteryStatusView(
  state: KnowledgeMasteryPersistenceState,
  nextRetestAt?: string | Date | null,
  now = new Date(),
): MasteryStatusView {
  const status = knowledgeStatus(state);
  return {
    status,
    label: labels[status],
    tone: tones[status],
    needsRetest: state === "NEEDS_RETEST" || isDue(nextRetestAt, now),
  };
}

export function syllabusMasteryStatusView(input: {
  level: SyllabusMasteryPersistenceLevel | null;
  nextRetestAt?: string | Date | null;
  proofRisk?: string | null;
  now?: Date;
}): MasteryStatusView {
  const status = syllabusStatus(input.level);
  const now = input.now ?? new Date();
  return {
    status,
    label: labels[status],
    tone: tones[status],
    needsRetest: isDue(input.nextRetestAt, now) || input.proofRisk === "stale_evidence",
  };
}

export function knowledgeStateForMasteryStatus(status: MasteryStatus): KnowledgeMasteryPersistenceState {
  switch (status) {
    case "UNTOUCHED":
      return "UNTOUCHED";
    case "LEARNING":
      return "LEARNING";
    case "INDEPENDENT":
      return "INITIAL_MASTERY";
    case "STABLE":
      return "STABLE_MASTERY";
  }
}

export function syllabusLevelForMasteryStatus(status: MasteryStatus): SyllabusMasteryPersistenceLevel | null {
  switch (status) {
    case "UNTOUCHED":
      return null;
    case "LEARNING":
      return "learned";
    case "INDEPENDENT":
      return "can_explain";
    case "STABLE":
      return "retest_passed";
  }
}

/** 将考纲内部兼容等级投影为用户可见的四级状态。 */
export function masteryStatusForSyllabusLevel(
  level: SyllabusMasteryPersistenceLevel | null,
): MasteryStatus {
  return syllabusStatus(level);
}

export function calculateMasteryConfidence(input: MasteryQuantitativeInput): number {
  const evidence = Math.max(0, input.evidenceCount);
  const sessions = Math.max(0, input.sessionCount ?? 0);
  const notes = Math.max(0, input.noteCount ?? 0);
  const mistakes = Math.max(0, input.mistakeCount ?? 0);
  const passedRetests = Math.max(0, input.passedRetestCount ?? 0);
  const raw = evidence * 8 + sessions * 4 + notes * 8 + mistakes * 5 + passedRetests * 18;
  const recencyPenalty = input.daysSinceLastEvidence != null
    ? Math.min(35, Math.max(0, input.daysSinceLastEvidence - 7) * 0.8)
    : 0;
  return Math.max(0, Math.min(100, Math.round(raw - recencyPenalty)));
}

function knowledgeStatus(state: KnowledgeMasteryPersistenceState): MasteryStatus {
  switch (state) {
    case "UNTOUCHED":
      return "UNTOUCHED";
    case "LEARNING":
    case "NEEDS_RETEST":
      return "LEARNING";
    case "INITIAL_MASTERY":
      return "INDEPENDENT";
    case "STABLE_MASTERY":
      return "STABLE";
  }
}

function syllabusStatus(level: SyllabusMasteryPersistenceLevel | null): MasteryStatus {
  switch (level) {
    case "seen":
    case "learned":
      return "LEARNING";
    case "basic_exercises":
    case "can_explain":
      return "INDEPENDENT";
    case "retest_passed":
    case "exam_stable":
      return "STABLE";
    case null:
      return "UNTOUCHED";
  }
}

function isDue(value: string | Date | null | undefined, now: Date): boolean {
  if (!value) return false;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}
