import QuickReviewPage from "@/lib/routes/quick-review-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/reviews/schedule/run");

export default async function KnowledgeReviewRunPage({ params, searchParams }: { params: Promise<{ scheduleId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  return QuickReviewPage({ params, searchParams });
}
