import ReportHistoryPage from "@/lib/routes/report-history-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/reviews/history/decision");

export default function RoadmapReviewHistoryPage({ params, searchParams }: { params: Promise<{ decisionId: string }>; searchParams: Promise<{ period?: string }> }) {
  return ReportHistoryPage({ params, searchParams });
}
