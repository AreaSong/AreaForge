import TodayInboxPage from "@/lib/routes/plan-inbox-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/plan/inbox");

export default async function PlanInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; stableRef?: string; returnTo?: string }>;
}) {
  return TodayInboxPage({ searchParams });
}
