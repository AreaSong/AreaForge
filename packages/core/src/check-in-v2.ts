import type { ReviewResult } from "./unified-review";

export type MinimumActionSource = "NONE" | "SESSION" | "REVIEW" | "BOTH";

export interface EffectiveReviewEventInput {
  id: string;
  result: ReviewResult;
  durationSeconds: number;
  correctedEventId: string | null;
}

/**
 * Collapse correction chains: a correction replaces its corrected event in aggregates.
 * Only leaf events (not superseded by a correction) count once.
 */
export function selectEffectiveReviewEvents(
  events: EffectiveReviewEventInput[],
): EffectiveReviewEventInput[] {
  const correctedIds = new Set(
    events.filter((event) => event.correctedEventId).map((event) => event.correctedEventId as string),
  );
  return events.filter((event) => !correctedIds.has(event.id));
}

export function aggregateReviewMetrics(events: EffectiveReviewEventInput[]): {
  reviewCount: number;
  reviewSeconds: number;
  passedCount: number;
  partialCount: number;
  failedCount: number;
} {
  const effective = selectEffectiveReviewEvents(events);
  return {
    reviewCount: effective.length,
    reviewSeconds: effective.reduce((sum, event) => sum + event.durationSeconds, 0),
    passedCount: effective.filter((event) => event.result === "PASSED").length,
    partialCount: effective.filter((event) => event.result === "PARTIAL").length,
    failedCount: effective.filter((event) => event.result === "FAILED").length,
  };
}

export function deriveMinimumActionSource(input: {
  sessionMinimumMet: boolean;
  reviewSeconds: number;
}): MinimumActionSource {
  const reviewMinimumMet = input.reviewSeconds >= 300;
  if (input.sessionMinimumMet && reviewMinimumMet) return "BOTH";
  if (input.sessionMinimumMet) return "SESSION";
  if (reviewMinimumMet) return "REVIEW";
  return "NONE";
}

export function completedMinimumActionV2(input: {
  sessionMinimumMet: boolean;
  reviewSeconds: number;
}): boolean {
  return deriveMinimumActionSource(input) !== "NONE";
}
