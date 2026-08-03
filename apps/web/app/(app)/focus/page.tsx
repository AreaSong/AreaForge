import { redirect } from "next/navigation";
import { FocusLauncher } from "@/components/focus-launcher";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getActiveStudySession, listSubjects, listStudyTasks } from "@/lib/study/service";
import { listKnowledgePoints } from "@/lib/study/knowledge-point-service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/focus");

export default async function FocusLandingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [activeSession, subjects, tasks, syllabusNodes, knowledgePoints] = await Promise.all([
    getActiveStudySession(user.id),
    listSubjects(user.id),
    listStudyTasks(user.id),
    listSyllabusOptions(user.id),
    listKnowledgePoints(user.id),
  ]);
  if (activeSession) redirect(`/focus/${activeSession.id}`);
  return <FocusLauncher subjects={subjects} userId={user.id} contextOptions={{ tasks, syllabusNodes, knowledgePoints }} />;
}
