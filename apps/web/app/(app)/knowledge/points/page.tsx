import { redirect } from "next/navigation";
import { KnowledgePointsWorkbench } from "@/components/knowledge-points-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listSubjects } from "@/lib/study/service";
import { listKnowledgePoints, type KnowledgeMasteryStateDto } from "@/lib/study/knowledge-point-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/points");

const masteryStates: KnowledgeMasteryStateDto[] = ["UNTOUCHED", "LEARNING", "INITIAL_MASTERY", "STABLE_MASTERY", "NEEDS_RETEST"];

export default async function KnowledgePointsPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; q?: string; masteryState?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const masteryState = masteryStates.includes(query.masteryState as KnowledgeMasteryStateDto) ? query.masteryState as KnowledgeMasteryStateDto : undefined;
  const [subjects, knowledgePoints] = await Promise.all([
    listSubjects(user.id),
    listKnowledgePoints(user.id, { subjectId: query.subjectId, q: query.q, masteryState }),
  ]);

  return (
    <KnowledgePointsWorkbench
      subjects={subjects}
      knowledgePoints={knowledgePoints}
      initialSubjectId={query.subjectId}
      initialQuery={query.q}
      initialMasteryState={masteryState}
    />
  );
}
