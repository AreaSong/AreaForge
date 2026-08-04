import { redirect } from "next/navigation";
import { FocusLauncher } from "@/components/focus-launcher";
import { FocusSessionClient } from "@/components/focus-session-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getActiveStudySession, getStudySessionById, listStudySessionEvidenceReceipts, listSubjects, listStudyTasks } from "@/lib/study/service";
import { listKnowledgePoints } from "@/lib/study/knowledge-point-service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/focus");

export default async function FocusLandingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/today");
  const [activeSession, subjects, tasks, syllabusNodes, knowledgePoints] = await Promise.all([
    getActiveStudySession(user.id),
    listSubjects(user.id),
    listStudyTasks(user.id),
    listSyllabusOptions(user.id),
    listKnowledgePoints(user.id),
  ]);
  if (activeSession) {
    const session = await getStudySessionById(activeSession.id, user.id);
    if (!session) redirect("/focus");
    const evidenceReceipts = await listStudySessionEvidenceReceipts(session.id, user.id);
    return (
      <FocusSessionClient
        userId={user.id}
        session={session}
        activeConflictId={null}
        returnTo={returnTo}
        initialNow={new Date().toISOString()}
        initialEvidenceReceipts={evidenceReceipts}
        contextOptions={{ tasks, syllabusNodes, knowledgePoints }}
        embeddedInWorkbench
      />
    );
  }
  return <FocusLauncher subjects={subjects} userId={user.id} returnTo={returnTo} contextOptions={{ tasks, syllabusNodes, knowledgePoints }} />;
}
