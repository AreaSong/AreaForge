import type { MistakeCauseDto, MistakeDto } from "@/lib/contracts";

export type MistakePracticePool = "mixed" | "failed" | "due" | "unscheduled";

export interface MistakePracticeOptions {
  subjectId?: string;
  syllabusNodeId?: string;
  cause?: MistakeCauseDto;
  pool: MistakePracticePool;
  count: number;
  now?: Date;
}

/**
 * Keeps the practice picker deterministic: due work is protected first, then
 * recent failures fill the round, and finally the remaining complete items.
 */
export function selectMistakePracticeCandidates(
  mistakes: MistakeDto[],
  options: MistakePracticeOptions,
): MistakeDto[] {
  const now = options.now ?? new Date();
  const filtered = mistakes.filter((mistake) => {
    if (mistake.archivedAt || !isPracticeReady(mistake)) return false;
    if (options.subjectId && mistake.subjectId !== options.subjectId) return false;
    if (options.syllabusNodeId && mistake.syllabusNodeId !== options.syllabusNodeId) return false;
    if (options.cause && mistake.cause !== options.cause) return false;
    if (options.pool === "failed" && !hasRecentFailure(mistake)) return false;
    if (options.pool === "due" && !isDue(mistake, now)) return false;
    if (options.pool === "unscheduled" && hasSchedule(mistake)) return false;
    return true;
  });

  return filtered
    .sort((left, right) => comparePracticePriority(left, right, now))
    .slice(0, normalizePracticeCount(options.count));
}

export function isPracticeReady(mistake: Pick<MistakeDto, "questionText" | "cause" | "correctIdea">) {
  return Boolean(mistake.questionText?.trim()) && mistake.cause !== "unknown" && Boolean(mistake.correctIdea?.trim());
}

export function isDue(mistake: MistakeDto, now = new Date()) {
  const schedule = mistake.reviewSchedule;
  return Boolean(schedule?.status === "ACTIVE" && schedule.dueDate && new Date(schedule.dueDate).getTime() <= now.getTime());
}

export function hasRecentFailure(mistake: MistakeDto) {
  return latestAttempt(mistake)?.result === "FAILED";
}

export function hasActiveSchedule(mistake: MistakeDto) {
  return mistake.reviewSchedule?.status === "ACTIVE";
}

function hasSchedule(mistake: MistakeDto) {
  return Boolean(mistake.reviewSchedule);
}

export function normalizePracticeCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.min(Math.floor(value), 50);
}

function comparePracticePriority(left: MistakeDto, right: MistakeDto, now: Date) {
  const leftDue = isDue(left, now);
  const rightDue = isDue(right, now);
  if (leftDue !== rightDue) return leftDue ? -1 : 1;
  if (leftDue && rightDue) {
    const dueDelta = dateValue(left.reviewSchedule?.dueDate) - dateValue(right.reviewSchedule?.dueDate);
    if (dueDelta !== 0) return dueDelta;
  }

  const leftFailedAt = latestFailureAt(left);
  const rightFailedAt = latestFailureAt(right);
  if (Boolean(leftFailedAt) !== Boolean(rightFailedAt)) return leftFailedAt ? -1 : 1;
  if (leftFailedAt && rightFailedAt) {
    const failureDelta = rightFailedAt - leftFailedAt;
    if (failureDelta !== 0) return failureDelta;
  }
  return dateValue(right.updatedAt) - dateValue(left.updatedAt);
}

function latestFailureAt(mistake: MistakeDto) {
  const latest = latestAttempt(mistake);
  return latest?.result === "FAILED" ? dateValue(latest.attemptedAt) : null;
}

function latestAttempt(mistake: MistakeDto) {
  return mistake.attempts.reduce<MistakeDto["attempts"][number] | null>((latest, attempt) => {
    if (!latest || dateValue(attempt.attemptedAt) > dateValue(latest.attemptedAt)) return attempt;
    return latest;
  }, null);
}

function dateValue(value: string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}
