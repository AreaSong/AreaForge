import ReviewReportsPage from "@/lib/routes/review-reports-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/reports");

export default function RoadmapReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  return ReviewReportsPage({ searchParams });
}
