import TodayPlanPage from "@/lib/routes/plan-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/plan");

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    subjectId?: string;
    status?: string;
    q?: string;
    createMinimum?: string;
    resourceId?: string;
    syllabusNodeId?: string;
    taskId?: string;
  }>;
}) {
  return TodayPlanPage({ searchParams });
}
