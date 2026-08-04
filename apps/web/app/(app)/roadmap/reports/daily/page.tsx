import DailyReviewPage from "@/lib/routes/daily-review-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/reports/daily");

export default function RoadmapDailyReviewPage() {
  return DailyReviewPage();
}
