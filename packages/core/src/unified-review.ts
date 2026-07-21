export type ReviewResult = "PASSED" | "PARTIAL" | "FAILED";
export type ReviewTargetType = "NOTE" | "MISTAKE" | "STUDY_RESOURCE" | "SYLLABUS_NODE";

const PASS_INTERVAL_DAYS = [7, 14, 30, 60] as const;

export function nextConsecutivePassCount(input: {
  current: number;
  result: ReviewResult;
}): number {
  if (input.result !== "PASSED") return 0;
  return input.current + 1;
}

export function suggestReviewIntervalDays(input: {
  result: ReviewResult;
  consecutivePassCountAfter: number;
}): number {
  if (input.result === "FAILED") return 1;
  if (input.result === "PARTIAL") return 3;
  const idx = Math.min(input.consecutivePassCountAfter - 1, PASS_INTERVAL_DAYS.length - 1);
  if (idx < 0) return PASS_INTERVAL_DAYS[0];
  return PASS_INTERVAL_DAYS[idx];
}

export function addShanghaiLearningDays(base: Date, days: number): Date {
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const shifted = new Date(base.getTime() + shanghaiOffsetMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();
  const start = new Date(Date.UTC(year, month, date) - shanghaiOffsetMs);
  return new Date(start.getTime() + days * dayMs);
}

export function validateReviewDurationSeconds(seconds: number): "ok" | "invalid_duration" {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 14400) return "invalid_duration";
  return "ok";
}

export function buildReviewRequestFingerprint(input: {
  result: ReviewResult;
  durationSeconds: number;
  nextDueDateKey: string;
  note?: string | null;
  correctedEventId?: string | null;
}): string {
  return [
    input.result,
    String(input.durationSeconds),
    input.nextDueDateKey,
    input.note?.trim() ?? "",
    input.correctedEventId ?? "",
  ].join("|");
}
