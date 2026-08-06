import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { SimulationDetailClient } from "@/components/simulation-detail-client";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import { listWorkspaceSubjects, resolveActiveWorkspace } from "@/lib/study/exam-workspace-service";
import { getSimulationExam, listSimulationRemediations } from "@/lib/study/simulation-service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/simulations/exam");

export default async function SimulationExamPage({ params, searchParams }: { params: Promise<{ examId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { examId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : "/test/simulations";
  const data = await loadPageData(examId, user.id);
  const activeLossItems = data.exam.subjectResults.flatMap((result) => result.lossItems).filter((item) => !item.archivedAt);
  const lostScore = activeLossItems.reduce((total, item) => total + item.lostScore, 0);

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="模拟考试"
        title={data.exam.name}
        back={<ButtonLink href={returnTo} variant="ghost" size="sm"><ArrowLeft size={16} />{query.returnTo ? getReturnContextLabel(returnTo, "返回模拟列表") : "返回模拟列表"}</ButtonLink>}
        description={`${new Date(data.exam.examDate).toLocaleDateString("zh-CN")} · ${data.exam.subjectResults.length} 科 · ${lostScore} 分结构化失分`}
        status={<div className="flex flex-wrap gap-2"><Badge tone={data.exam.status === "CONFIRMED" ? "success" : data.exam.timerSessionStatus === "RUNNING" || data.exam.timerSessionStatus === "PAUSED" ? "info" : data.exam.timerSessionStatus === "CLOSING" ? "warning" : "warning"}>{data.exam.status === "CONFIRMED" ? "事实已确认" : data.exam.timerSessionStatus === "RUNNING" || data.exam.timerSessionStatus === "PAUSED" ? "计时进行中" : data.exam.timerSessionStatus === "CLOSING" ? "待收口" : data.exam.status === "IN_PROGRESS" ? "待确认" : "事实待开始"}</Badge><Badge>{activeLossItems.length} 条失分</Badge></div>}
      />
      {data.exam.totalsSource === "legacy_fallback" ? (
        <Alert tone="warning" title="这是无分科的旧记录">
          <p className="mt-1 text-amber-100/80">
            历史总分：{data.exam.legacyDisplayTotals?.actualScore ?? "—"} / {data.exam.legacyDisplayTotals?.targetScore ?? "—"}。
            {data.exam.status === "DRAFT" ? " 请按科目补齐结果；首次保存成功后会升级为分科记录。" : " 该记录已确认，只读保留。"}
          </p>
        </Alert>
      ) : null}
      <SimulationDetailClient userId={user.id} exam={data.exam} subjects={data.subjects} syllabus={data.syllabus} remediations={data.remediations} returnTo={returnTo} initialNow={new Date().toISOString()} />
    </PageFrame>
  );
}

async function loadPageData(examId: string, actorId: string) {
  try {
    const workspace = await resolveActiveWorkspace(actorId);
    const [exam, subjects, syllabus, remediations] = await Promise.all([
      getSimulationExam(examId, actorId),
      listWorkspaceSubjects(actorId, workspace.id),
      listSyllabusOptions(actorId),
      listSimulationRemediations(examId, actorId),
    ]);
    return { exam, subjects, syllabus, remediations };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
