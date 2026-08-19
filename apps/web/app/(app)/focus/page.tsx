import { redirect } from "next/navigation";
import { FocusLauncher } from "@/components/focus-launcher";
import { FocusSessionClient } from "@/components/focus-session-client";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/app-navigation";
import { activitySourcePath } from "@/lib/study/activity-route";
import { getActiveStudySession, getFocusLauncherSummary, getStudySessionById, listStudySessionEvidenceReceipts, listSubjects, listStudyTasks } from "@/lib/study/service";
import { listKnowledgePoints } from "@/lib/study/knowledge-point-service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/focus");

export default async function FocusLandingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; mode?: string; command?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/today");
  const [activeSession, subjects, tasks, syllabusNodes, knowledgePoints, launcherSummary] = await Promise.all([
    getActiveStudySession(user.id),
    listSubjects(user.id),
    listStudyTasks(user.id),
    listSyllabusOptions(user.id),
    listKnowledgePoints(user.id),
    getFocusLauncherSummary(user.id),
  ]);
  if (activeSession && activeSession.activityMode !== "FREE_STUDY") {
    redirect(withReturnTo(activitySourcePath(activeSession), returnTo));
  }
  if (activeSession) {
    const session = await getStudySessionById(activeSession.id, user.id);
    if (!session) redirect("/focus");
    const evidenceReceipts = await listStudySessionEvidenceReceipts(session.id, user.id);
    return (
      <PageFrame variant="workspace-full">
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
      </PageFrame>
    );
  }
  return (
    <PageFrame variant="workspace-full">
      <FocusLauncher
        subjects={subjects}
        userId={user.id}
        returnTo={returnTo}
        initialNow={new Date().toISOString()}
        contextOptions={{ tasks, syllabusNodes, knowledgePoints }}
        launcherSummary={launcherSummary}
        commandMode={query.mode === "now" ? "now" : undefined}
        commandText={query.command}
      />
    </PageFrame>
  );
}

