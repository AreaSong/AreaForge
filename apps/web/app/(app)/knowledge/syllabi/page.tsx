import { redirect } from "next/navigation";
import { LongTermRiskPanel } from "@/components/long-term-risk-panel";
import { SyllabusManager } from "@/components/syllabus-manager";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getLongTermRiskSummary } from "@/lib/study/long-term-risk-service";
import { listSubjects } from "@/lib/study/study-query-service";
import { filterSyllabusTreeByQuery, getSyllabusMapOverviewShared } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/syllabi");

export default async function KnowledgeSyllabiPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; q?: string; status?: string; map?: string; action?: string; create?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;

  const [subjects, overview, longTermRisks] = await Promise.all([
    listSubjects(user.id),
    getSyllabusMapOverviewShared(user.id),
    getLongTermRiskSummary(user.id),
  ]);
  const nodes = filterSyllabusTreeByQuery(overview.nodes, query.q);

  return (
    <PageFrame variant="split-view" className="space-y-4">
      <h1 data-ai-current-object="true" data-ai-selectable data-ai-label="考纲" className="text-2xl font-semibold text-white">考纲</h1>
      <SyllabusManager
        subjects={subjects}
        nodes={nodes}
        summary={overview.summary}
        summaryBySubject={overview.summaryBySubject}
        initialSubjectId={query.subjectId ?? nodes[0]?.subjectId}
        initialQuery={query.q}
        initialStatusFilter={query.status}
        initialMapStatusFilter={query.map}
        initialActionFilter={query.action}
        initialCreate={query.create === "1"}
      />
      <LongTermRiskPanel
        summary={longTermRisks}
        title="考纲遗忘风险"
        description="考纲节点与画布共用同一掌握与风险信号。"
        compact
      />
    </PageFrame>
  );
}
