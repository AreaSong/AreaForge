import { redirect } from "next/navigation";
import { LongTermRiskPanel } from "@/components/long-term-risk-panel";
import { SyllabusManager } from "@/components/syllabus-manager";
import { getCurrentUser } from "@/lib/auth/session";
import { getLongTermRiskSummary } from "@/lib/study/long-term-risk-service";
import { listSubjects } from "@/lib/study/service";
import { getSyllabusMapOverviewShared } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeSyllabusPage({ searchParams }: { searchParams: Promise<{ subjectId?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;

  const [subjects, overview, longTermRisks] = await Promise.all([
    listSubjects(user.id),
    getSyllabusMapOverviewShared(user.id),
    getLongTermRiskSummary(user.id),
  ]);

  return (
    <div className="space-y-4">
      <LongTermRiskPanel
        summary={longTermRisks}
        title="考纲遗忘风险"
        description="考纲节点与画布共用同一掌握与风险信号。"
      />
      <SyllabusManager
        subjects={subjects}
        nodes={overview.nodes}
        summary={overview.summary}
        summaryBySubject={overview.summaryBySubject}
        initialSubjectId={query.subjectId}
      />
    </div>
  );
}
