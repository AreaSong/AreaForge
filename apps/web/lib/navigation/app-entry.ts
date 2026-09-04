import type { StudySessionDto } from "@/lib/contracts";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import { ROOT_ROUTES } from "@/lib/navigation/route-helpers";

type ActiveEntrySession = Pick<
  StudySessionDto,
  "activityMode" | "reviewScheduleId" | "knowledgeRetestId" | "simulationExamId"
>;

export function selectAuthenticatedEntryRoute(input: {
  hasWorkspace: boolean;
  activeSession: ActiveEntrySession | null;
}): string {
  if (!input.hasWorkspace) return "/settings/exams?setup=1";
  if (input.activeSession) return activitySourcePath(input.activeSession);
  return ROOT_ROUTES.app;
}
