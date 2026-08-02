import TaskDetailPage from "@/lib/routes/plan-task-detail-page";

export const dynamic = "force-dynamic";

export default function PlanTaskDetailRoute(props: Parameters<typeof TaskDetailPage>[0]) {
  return TaskDetailPage(props);
}
