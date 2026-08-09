import PlanInboxItemPage from "@/lib/routes/plan-inbox-item-page";
import { PageFrame } from "@/components/ui/page";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/allocation/drafts/item");

export default async function RoadmapAllocationDraftDetailPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  return <PageFrame variant="content-focus">{await PlanInboxItemPage({ params, searchParams })}</PageFrame>;
}
