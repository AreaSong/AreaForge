import PlanTaskDetailPage from "@/lib/routes/plan-task-detail-page";
import { PageFrame } from "@/components/ui/page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/allocation/tasks/task");

export default async function RoadmapAllocationTaskDetailPage({ params, searchParams }: { params: Promise<{ taskId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  return <PageFrame variant="content-focus">{await PlanTaskDetailPage({ params, searchParams })}</PageFrame>;
}
