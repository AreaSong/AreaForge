import PlanInboxPage from "@/lib/routes/plan-inbox-page";
import { PageFrame } from "@/components/ui/page";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/allocation/drafts");

export default async function RoadmapAllocationDraftsPage({ searchParams }: { searchParams: Promise<{ status?: string; stableRef?: string; returnTo?: string }> }) {
  return <PageFrame variant="split-view">{await PlanInboxPage({ searchParams })}</PageFrame>;
}
