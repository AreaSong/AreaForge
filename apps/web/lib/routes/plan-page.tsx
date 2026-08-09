import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { PlanRollingClient } from "@/components/plan-rolling-client";
import { TaskDetailClient } from "@/components/task-detail-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getPlanRolling } from "@/lib/study/plan-rolling-service";
import { listPlanMilestones } from "@/lib/study/plan-milestone-service";
import { listStagePlans } from "@/lib/study/stage-service";
import { listSyllabusOptionsShared } from "@/lib/study/syllabus-service";
import { findActiveWorkspaceOrNull, listWorkspaceSubjects } from "@/lib/study/exam-workspace-service";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { ApiError } from "@/lib/api/responses";
import { getStudyResource, type StudyResourceDto } from "@/lib/study/study-resource-service";
import { loadTaskPageData } from "@/lib/study/task-page-data";
import type { SyllabusOptionNodeDto } from "@/lib/study/types";
import { listKnowledgePoints } from "@/lib/study/knowledge-point-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/allocation");

export default async function TodayPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; subjectId?: string; status?: string; q?: string; createMinimum?: string; resourceId?: string; syllabusNodeId?: string; taskId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const plan = await getPlanRolling(user.id, {
    date: params.date,
    subjectId: params.subjectId,
    status: params.status,
    q: params.q,
  });

  if (plan.setupRequired) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-white">投入安排</h1>
        <p className="text-sm text-zinc-400">需要先设置考试工作区。</p>
        <Link href="/settings/exams?setup=1" className="text-teal-300 hover:underline">
          设置考试目标
        </Link>
      </section>
    );
  }

  const workspace = await findActiveWorkspaceOrNull(user.id);
  const [subjects, syllabusNodes, milestones, stagePlans, knowledgePoints] = workspace ? await Promise.all([
    listWorkspaceSubjects(user.id, workspace.id),
    listSyllabusOptionsShared(user.id),
    listPlanMilestones(user.id),
    listStagePlans(user.id),
    listKnowledgePoints(user.id),
  ]) : [[], [], [], [], []];
  let sourceResource: StudyResourceDto | null = null;
  if (params.resourceId) {
    try {
      sourceResource = await getStudyResource(user.id, params.resourceId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  }
  const sourceNodeIds = sourceResource?.syllabusNodeIds.filter((nodeId) =>
    flattenSyllabusOptions(syllabusNodes).some((node) => node.id === nodeId && node.subjectId === sourceResource?.subjectId),
  ) ?? [];
  let selectedTaskData: Awaited<ReturnType<typeof loadTaskPageData>> | null = null;
  if (params.taskId) {
    try {
      selectedTaskData = await loadTaskPageData(user.id, params.taskId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  }
  const closeDetailHref = buildPlanHref(params);

  return (
    <div className="space-y-4">
      <PlanRollingClient
        initial={plan}
        subjects={subjects.filter((subject) => !subject.archivedAt).map((subject) => ({ id: subject.id, name: subject.name }))}
        syllabusNodes={syllabusNodes}
        milestones={milestones}
        stagePlans={stagePlans}
        knowledgePoints={knowledgePoints}
        createMinimum={params.createMinimum === "1"}
        sourceResource={sourceResource ? {
          id: sourceResource.id,
          title: sourceResource.title,
          subjectId: sourceResource.subjectId,
          syllabusNodeId: sourceNodeIds.length === 1 ? sourceNodeIds[0] ?? null : null,
          archived: Boolean(sourceResource.archivedAt),
        } : null}
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
        detailPanel={selectedTaskData ? (
          <TaskDetailClient
            detail={selectedTaskData.detail}
            dependencies={selectedTaskData.dependencies}
            subjects={selectedTaskData.subjects}
            syllabusNodes={selectedTaskData.syllabusNodes}
            milestones={selectedTaskData.milestones}
            stagePlans={selectedTaskData.stagePlans}
            knowledgePoints={selectedTaskData.knowledgePoints}
            dependencyCandidates={selectedTaskData.dependencyCandidates}
            embedded
            closeHref={closeDetailHref}
          />
        ) : null}
      />
      <details className="border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-300">AI 投入草稿</summary>
        <div className="mt-3"><AiDraftPanel endpoint="plan" userId={user.id} /></div>
      </details>
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

function flattenSyllabusOptions(nodes: SyllabusOptionNodeDto[]): SyllabusOptionNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenSyllabusOptions(node.children)]);
}
