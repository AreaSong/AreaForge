export type ActivityBucket = "study" | "review" | "test";
import type { ActivityBreakdown } from "@/lib/contracts/activity";

export interface ActivityMetricSession {
  activityKind?: string | null;
  activityMode?: string | null;
  effectiveMinutes: number;
  isEffective?: boolean | null;
  startedAt?: Date | string;
}

export type { ActivityBreakdown } from "@/lib/contracts/activity";

export function activityBucket(input: Pick<ActivityMetricSession, "activityKind" | "activityMode">): ActivityBucket {
  if (input.activityMode === "SIMULATION") return "test";
  if (input.activityKind === "REVIEW" || input.activityMode === "KNOWLEDGE_REVIEW" || input.activityMode === "RETEST") return "review";
  if (input.activityKind === "TEST") return "test";
  return "study";
}

export function emptyActivityBreakdown(): ActivityBreakdown {
  return {
    studyMinutes: 0,
    reviewMinutes: 0,
    testMinutes: 0,
    totalMinutes: 0,
    effectiveStudyMinutes: 0,
    effectiveReviewMinutes: 0,
    effectiveTestMinutes: 0,
    studySessionCount: 0,
    reviewSessionCount: 0,
    testSessionCount: 0,
  };
}

export function aggregateActivityBreakdown(sessions: ActivityMetricSession[]): ActivityBreakdown {
  const result = emptyActivityBreakdown();
  for (const session of sessions) {
    const minutes = Math.max(0, Math.floor(session.effectiveMinutes));
    const bucket = activityBucket(session);
    result.totalMinutes += minutes;
    if (bucket === "study") {
      result.studyMinutes += minutes;
      result.studySessionCount += 1;
      if (session.isEffective) result.effectiveStudyMinutes += minutes;
    } else if (bucket === "review") {
      result.reviewMinutes += minutes;
      result.reviewSessionCount += 1;
      if (session.isEffective) result.effectiveReviewMinutes += minutes;
    } else {
      result.testMinutes += minutes;
      result.testSessionCount += 1;
      if (session.isEffective) result.effectiveTestMinutes += minutes;
    }
  }
  return result;
}

export function mergeActivityBreakdowns(left: ActivityBreakdown, right: ActivityBreakdown): ActivityBreakdown {
  return {
    studyMinutes: left.studyMinutes + right.studyMinutes,
    reviewMinutes: left.reviewMinutes + right.reviewMinutes,
    testMinutes: left.testMinutes + right.testMinutes,
    totalMinutes: left.totalMinutes + right.totalMinutes,
    effectiveStudyMinutes: left.effectiveStudyMinutes + right.effectiveStudyMinutes,
    effectiveReviewMinutes: left.effectiveReviewMinutes + right.effectiveReviewMinutes,
    effectiveTestMinutes: left.effectiveTestMinutes + right.effectiveTestMinutes,
    studySessionCount: left.studySessionCount + right.studySessionCount,
    reviewSessionCount: left.reviewSessionCount + right.reviewSessionCount,
    testSessionCount: left.testSessionCount + right.testSessionCount,
  };
}
