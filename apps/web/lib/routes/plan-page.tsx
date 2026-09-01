import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { PlanRollingClient } from "@/components/plan-rolling-client";
import { TaskDetailClient } from "@/components/task-detail-client";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { ApiError } from "@/lib/api/responses";
import {
  loadPlanPageData,
  type PlanPageSearchParams,
} from "@/lib/study/plan-page-data";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/allocation");

export default async function TodayPlanPage({
  searchParams,
}: {
  searchParams: Promise<PlanPageSearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof loadPlanPageData>>;
  try {
    data = await loadPlanPageData(user.id, params);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  if (data.setupRequired) {
    return (
      <Card variant="master" className="p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold text-white">投入安排</h1>
        <p className="text-sm text-zinc-400">需要先设置考试工作区。</p>
        <div>
          <ButtonLink href="/settings/exams?setup=1" variant="primary">
            设置考试目标
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const closeDetailHref = buildPlanHref(params);

  return (
    <div className="space-y-6">
      <PlanRollingClient
        initial={data.plan}
        subjects={data.subjects}
        syllabusNodes={data.syllabusNodes}
        milestones={data.milestones}
        stagePlans={data.stagePlans}
        knowledgePoints={data.knowledgePoints}
        createMinimum={params.createMinimum === "1"}
        sourceResource={data.sourceResource}
        query={{
          date: params.date,
          subjectId: params.subjectId,
          status: params.status,
          q: params.q,
          resourceId: params.resourceId,
          syllabusNodeId: params.syllabusNodeId,
        }}
        detailTaskId={params.taskId}
        closeDetailHref={closeDetailHref}
        detailPanel={data.selectedTaskData ? (
          <TaskDetailClient
            key={data.selectedTaskData.detail.task.id}
            detail={data.selectedTaskData.detail}
            dependencies={data.selectedTaskData.dependencies}
            subjects={data.selectedTaskData.subjects}
            syllabusNodes={data.selectedTaskData.syllabusNodes}
            milestones={data.selectedTaskData.milestones}
            stagePlans={data.selectedTaskData.stagePlans}
            knowledgePoints={data.selectedTaskData.knowledgePoints}
            dependencyCandidates={data.selectedTaskData.dependencyCandidates}
            embedded
            closeHref={closeDetailHref}
          />
        ) : null}
      />
      <Card variant="subtle" className="p-4">
        <details>
          <summary className="cursor-pointer text-xs font-medium text-zinc-400 hover:text-zinc-200">AI 投入草稿</summary>
          <div className="mt-3"><AiDraftPanel endpoint="plan" userId={user.id} /></div>
        </details>
      </Card>
    </div>
  );
}

function buildPlanHref(params: {
  date?: string;
  subjectId?: string;
  status?: string;
  q?: string;
  createMinimum?: string;
  resourceId?: string;
  syllabusNodeId?: string;
}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "createMinimum" && key !== "taskId") query.set(key, value);
  }
  const serialized = query.toString();
  return `/roadmap/allocation${serialized ? `?${serialized}` : ""}`;
}
