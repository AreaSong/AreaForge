import StageOverviewPage from "@/lib/routes/plan-stages-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/stages");

export default function RoadmapStagesPage({ searchParams }: { searchParams: Promise<{ createMilestone?: string; returnTo?: string }> }) {
  return StageOverviewPage({ searchParams });
}
