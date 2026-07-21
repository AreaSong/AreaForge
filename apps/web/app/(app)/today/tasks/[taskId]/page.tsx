import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskDetailClient } from "@/components/task-detail-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getStudyTaskDetail } from "@/lib/study/plan-rolling-service";
import { listTaskDependencies, type TaskDependencyDto } from "@/lib/study/task-dependency-service";
import { ApiError } from "@/lib/api/responses";
import type { StudyTaskDto } from "@/lib/study/types";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { taskId } = await params;

  let task: StudyTaskDto | null = null;
  let dependencies: TaskDependencyDto[] = [];
  let notFound = false;

  try {
    [task, dependencies] = await Promise.all([
      getStudyTaskDetail(user.id, taskId),
      listTaskDependencies(user.id, taskId),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound = true;
    } else {
      throw error;
    }
  }

  if (notFound || !task) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-white">任务不存在</h1>
        <Link href="/today/plan" className="text-teal-300 hover:underline">
          返回计划
        </Link>
      </section>
    );
  }

  return <TaskDetailClient task={task} dependencies={dependencies} />;
}
