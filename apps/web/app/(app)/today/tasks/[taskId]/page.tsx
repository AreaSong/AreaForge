import { notFound, redirect } from "next/navigation";
import { TaskDetailClient } from "@/components/task-detail-client";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listPlanMilestones } from "@/lib/study/plan-milestone-service";
import { listSubjects } from "@/lib/study/service";
import { listSyllabusOptionsShared } from "@/lib/study/syllabus-service";
import { listOwnedTaskDependencies } from "@/lib/study/task-dependency-service";
import { getStudyTaskDetail, listTaskDependencyCandidates } from "@/lib/study/task-detail-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/today/tasks/task");

export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { taskId } = await params;

  let pageData: Awaited<ReturnType<typeof loadTaskPageData>>;
  try {
    pageData = await loadTaskPageData(user.id, taskId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <TaskDetailClient
      detail={pageData.detail}
      dependencies={pageData.dependencies}
      subjects={pageData.subjects}
      syllabusNodes={pageData.syllabusNodes}
      milestones={pageData.milestones}
      dependencyCandidates={pageData.dependencyCandidates}
    />
  );
}

async function loadTaskPageData(actorId: string, taskId: string) {
  const [detail, dependencies] = await Promise.all([
    getStudyTaskDetail(actorId, taskId),
    listOwnedTaskDependencies(actorId, taskId),
  ]);
  if (detail.readOnly) {
    return {
      detail,
      dependencies,
      subjects: [],
      syllabusNodes: [],
      milestones: [],
      dependencyCandidates: [],
    };
  }
  const [subjects, syllabusNodes, milestones, dependencyCandidates] = await Promise.all([
    listSubjects(actorId),
    listSyllabusOptionsShared(actorId),
    listPlanMilestones(actorId),
    listTaskDependencyCandidates(actorId, taskId),
  ]);
  return { detail, dependencies, subjects, syllabusNodes, milestones, dependencyCandidates };
}
