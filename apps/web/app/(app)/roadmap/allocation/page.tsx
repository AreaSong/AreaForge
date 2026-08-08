import PlanPage from "@/lib/routes/plan-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/allocation");

export default async function RoadmapAllocationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return PlanPage({ searchParams });
}
