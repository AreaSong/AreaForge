import StageAnalyticsPage from "@/lib/routes/plan-stages-analytics-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/plan/stages/analytics");

export default async function PlanStagesAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  return StageAnalyticsPage({ searchParams });
}
