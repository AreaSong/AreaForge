import PlanPage from "@/lib/routes/plan-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/arrangements");

export default function RoadmapArrangementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return PlanPage({ searchParams });
}
