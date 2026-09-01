import {
  knowledgeRetestDetailRoute,
  quickReviewRunRoute,
  simulationExamDetailRoute,
} from "@/lib/navigation/route-helpers";
import type { StudySessionDto } from "@/lib/contracts";

type ActivityRouteSession = Pick<StudySessionDto, "activityMode" | "reviewScheduleId" | "knowledgeRetestId" | "simulationExamId">;

export function activitySourcePath(session: ActivityRouteSession): string {
  if (session.activityMode === "SIMULATION" && session.simulationExamId) {
    return simulationExamDetailRoute(session.simulationExamId);
  }
  if (session.activityMode === "RETEST" && session.knowledgeRetestId) {
    return knowledgeRetestDetailRoute(session.knowledgeRetestId);
  }
  if (session.activityMode === "KNOWLEDGE_REVIEW" && session.reviewScheduleId) {
    return quickReviewRunRoute(session.reviewScheduleId);
  }
  return "/focus";
}

export function isActivitySourcePath(pathname: string, session: ActivityRouteSession): boolean {
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
