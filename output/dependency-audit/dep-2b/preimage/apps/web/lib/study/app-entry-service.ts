import "server-only";
import { selectAuthenticatedEntryRoute } from "@/lib/navigation/app-entry";
import {
  findActiveWorkspaceOrNull,
  findSelectedMemberWorkspaceOrNull,
} from "@/lib/study/exam-workspace-service";
import { getActiveStudySession } from "@/lib/study/session-query-service";

export async function resolveAuthenticatedAppEntry(actorId: string): Promise<string> {
  const ownedWorkspace = await findActiveWorkspaceOrNull(actorId);
  const workspace = ownedWorkspace ?? await findSelectedMemberWorkspaceOrNull(actorId);
  if (!workspace) {
    return selectAuthenticatedEntryRoute({ hasWorkspace: false, hasOwnedWorkspace: false, activeSession: null });
  }
  const activeSession = await getActiveStudySession(actorId);
  return selectAuthenticatedEntryRoute({
    hasWorkspace: true,
    hasOwnedWorkspace: Boolean(ownedWorkspace),
    activeSession,
  });
}
