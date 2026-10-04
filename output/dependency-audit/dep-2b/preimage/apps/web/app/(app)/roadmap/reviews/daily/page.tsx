import DailyReviewPage from "@/lib/routes/daily-review-page";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/reviews/daily");

export default function RoadmapDailyReviewCanonicalPage() {
  return DailyReviewPage();
}
