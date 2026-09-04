import "server-only";
import { selectAuthenticatedEntryRoute } from "@/lib/navigation/app-entry";
import { findActiveWorkspaceOrNull } from "@/lib/study/exam-workspace-service";
import { getActiveStudySession } from "@/lib/study/session-query-service";

export async function resolveAuthenticatedAppEntry(actorId: string): Promise<string> {
  const workspace = await findActiveWorkspaceOrNull(actorId);
  if (!workspace) {
    return selectAuthenticatedEntryRoute({ hasWorkspace: false, activeSession: null });
  }
  const activeSession = await getActiveStudySession(actorId);
  return selectAuthenticatedEntryRoute({ hasWorkspace: true, activeSession });
}
