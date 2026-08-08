import QuickReviewPage from "@/lib/routes/quick-review-page";
import { PageFrame } from "@/components/ui/page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/reviews/schedule/run");

export default async function KnowledgeReviewRunPage({ params, searchParams }: { params: Promise<{ scheduleId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  return <PageFrame variant="workspace-full">{await QuickReviewPage({ params, searchParams })}</PageFrame>;
}
