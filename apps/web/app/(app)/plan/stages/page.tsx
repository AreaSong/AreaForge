import StageOverviewPage from "@/lib/routes/plan-stages-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/plan/stages");

export default async function PlanStagesPage({
  searchParams,
}: {
  searchParams: Promise<{ createMilestone?: string; returnTo?: string }>;
}) {
  return StageOverviewPage({ searchParams });
}
