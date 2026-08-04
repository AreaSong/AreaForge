import PlanTaskDetailPage from "@/lib/routes/plan-task-detail-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/allocation/tasks/task");

export default function RoadmapAllocationTaskDetailPage({ params, searchParams }: { params: Promise<{ taskId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  return PlanTaskDetailPage({ params, searchParams });
}
