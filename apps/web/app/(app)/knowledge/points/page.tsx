import { redirect } from "next/navigation";
import { KnowledgePointsWorkbench } from "@/components/knowledge-points-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listSubjects } from "@/lib/study/service";
import { listKnowledgePoints } from "@/lib/study/knowledge-point-service";
import { MASTERY_STATUS_OPTIONS, type MasteryStatus } from "@/lib/study/mastery-status";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/points");

export default async function KnowledgePointsPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; q?: string; masteryStatus?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const masteryStatus = MASTERY_STATUS_OPTIONS.includes(query.masteryStatus as MasteryStatus)
    ? query.masteryStatus as MasteryStatus
    : undefined;
  const [subjects, knowledgePoints] = await Promise.all([
    listSubjects(user.id),
    listKnowledgePoints(user.id, { subjectId: query.subjectId, q: query.q, masteryStatus }),
  ]);

  return (
    <KnowledgePointsWorkbench
      subjects={subjects}
      knowledgePoints={knowledgePoints}
      initialSubjectId={query.subjectId}
      initialQuery={query.q}
      initialMasteryStatus={masteryStatus}
    />
  );
}
