import { redirect } from "next/navigation";
import { MistakeLibrary } from "@/components/mistake-library";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getMistakeCreatePrefill, listMistakes } from "@/lib/study/mistakes-service";
import { listSubjects } from "@/lib/study/service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/mistakes");

export default async function KnowledgeMistakesPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; syllabusNodeId?: string; cause?: string; review?: string; create?: string; q?: string; simulationLossItemId?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const [subjects, nodes, mistakes, createPrefill] = await Promise.all([
    listSubjects(user.id),
    listSyllabusOptions(user.id),
    listMistakes(user.id, { q: query.q }),
    query.simulationLossItemId ? getMistakeCreatePrefill(user.id, query.simulationLossItemId) : Promise.resolve(null),
  ]);
  if (createPrefill?.linkedMistakeId) redirect(`/knowledge/mistakes/${createPrefill.linkedMistakeId}`);
  return (
    <PageFrame variant="split-view" className="space-y-4">
      <h1 data-ai-current-object="true" data-ai-selectable data-ai-label="错题" className="text-2xl font-semibold text-white">错题</h1>
      <MistakeLibrary
        userId={user.id}
        subjects={subjects}
        nodes={nodes}
        mistakes={mistakes}
        initialSubjectId={query.subjectId}
        initialSyllabusNodeId={query.syllabusNodeId}
        initialCauseFilter={query.cause}
        initialReviewFilter={query.review}
        initialQuery={query.q}
        initialCreate={query.create === "1" || Boolean(createPrefill)}
        createPrefill={createPrefill}
      />
    </PageFrame>
  );
}
