import PlanInboxItemPage from "@/lib/routes/plan-inbox-item-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/arrangements/drafts/item");

export default function RoadmapDraftDetailPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  return PlanInboxItemPage({ params, searchParams });
}
