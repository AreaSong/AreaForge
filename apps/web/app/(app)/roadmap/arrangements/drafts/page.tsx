import PlanInboxPage from "@/lib/routes/plan-inbox-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/arrangements/drafts");

export default function RoadmapDraftsPage({ searchParams }: { searchParams: Promise<{ status?: string; stableRef?: string; returnTo?: string }> }) {
  return PlanInboxPage({ searchParams });
}
