import { notFound, redirect } from "next/navigation";
import { TaskDetailClient } from "@/components/task-detail-client";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { loadTaskPageData } from "@/lib/study/task-page-data";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/plan/tasks/task");

export default async function TaskDetailPage({ params, searchParams }: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { taskId } = await params;
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo || "/plan");

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
      stagePlans={pageData.stagePlans}
      knowledgePoints={pageData.knowledgePoints}
      dependencyCandidates={pageData.dependencyCandidates}
      returnTo={returnTo}
    />
  );
}
