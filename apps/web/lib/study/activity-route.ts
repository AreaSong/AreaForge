import type { StudySessionDto } from "./types";

export function activitySourcePath(session: Pick<StudySessionDto, "activityMode" | "reviewScheduleId" | "knowledgeRetestId" | "simulationExamId">): string {
  if (session.activityMode === "SIMULATION" && session.simulationExamId) {
    return `/test/simulations/${encodeURIComponent(session.simulationExamId)}`;
  }
  if (session.activityMode === "RETEST" && session.knowledgeRetestId) {
    return `/test/retests/${encodeURIComponent(session.knowledgeRetestId)}`;
  }
  if (session.activityMode === "KNOWLEDGE_REVIEW" && session.reviewScheduleId) {
    return `/knowledge/reviews/${encodeURIComponent(session.reviewScheduleId)}/run`;
  }
  return "/focus";
}

export function isActivitySourcePath(
  pathname: string,
  session: Pick<StudySessionDto, "activityMode" | "reviewScheduleId" | "knowledgeRetestId" | "simulationExamId">,
): boolean {
  return pathname === activitySourcePath(session);
}

export function isKnowledgeReviewActivityForSchedule(
  session: Pick<StudySessionDto, "activityMode" | "reviewScheduleId">,
  scheduleId: string,
): boolean {
  return session.activityMode === "KNOWLEDGE_REVIEW" && session.reviewScheduleId === scheduleId;
}

export function activityLabel(session: Pick<StudySessionDto, "activityMode">): string {
  if (session.activityMode === "SIMULATION") return "模拟考试";
  if (session.activityMode === "RETEST") return "专项复测";
  if (session.activityMode === "KNOWLEDGE_REVIEW") return "复习";
  return "学习";
}
