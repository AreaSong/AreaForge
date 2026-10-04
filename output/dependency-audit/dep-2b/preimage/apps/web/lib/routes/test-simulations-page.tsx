import { ArrowRight, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { SimulationExamCard } from "@/components/simulation-exam-card";
import { SimulationListClient } from "@/components/simulation-list-client";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDateKey } from "@/lib/formatters";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listSimulationExams } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/simulations");

export default async function TestSimulationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const exams = await listSimulationExams(user.id);
  const unfinished = exams.filter((exam) => exam.status === "DRAFT" || exam.status === "IN_PROGRESS");
  const history = exams.filter((exam) => exam.status === "CONFIRMED");
  const latestUnfinished = unfinished[0];

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="检验"
        title="模拟考试"
        description="录入考试事实，冻结失分分析，再把明确的补救动作送入投入草稿。"
        action={
          latestUnfinished ? (
            <ButtonLink href={`/test/simulations/${latestUnfinished.id}`} variant="primary">
              <ArrowRight size={16} aria-hidden="true" />
              继续未完成模拟
            </ButtonLink>
          ) : (
            <ButtonLink href="#create-simulation" variant="primary">
              <Plus size={16} aria-hidden="true" />
              创建新模拟
            </ButtonLink>
          )
        }
      />

      {latestUnfinished ? (
        <section className="space-y-4">
          <SectionHeader
            title="继续分析"
            description="优先完成当前考试的录分、失分核对与事实确认。"
            meta={<Badge tone="warning">{latestUnfinished.status === "IN_PROGRESS" ? "进行中" : "未确认"}</Badge>}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SimulationExamCard exam={latestUnfinished} primary />
            {unfinished.slice(1).map((exam) => (
              <SimulationExamCard key={exam.id} exam={exam} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionHeader
          title="已确认记录"
          description="已确认的成绩和失分只读，可继续选择补救动作。"
          meta={<Badge>{history.length} 场</Badge>}
        />
        {history.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {history.map((exam) => (
              <SimulationExamCard key={exam.id} exam={exam} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="还没有已确认的模拟考试"
            description="完成一场模拟并确认事实后，会在这里形成可追溯记录。"
          />
        )}
      </section>

      <SimulationListClient initialExamDate={toDateInput(new Date())} />
    </PageFrame>
  );
}

function toDateInput(value: Date): string {
  return formatDateKey(value);
}
