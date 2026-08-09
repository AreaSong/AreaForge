import StageAnalyticsPage from "@/lib/routes/plan-stages-analytics-page";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/stages/trend");

export default function RoadmapStageTrendPage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  return StageAnalyticsPage({ searchParams });
}
