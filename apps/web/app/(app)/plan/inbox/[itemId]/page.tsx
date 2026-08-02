import TodayInboxItemPage from "@/lib/routes/plan-inbox-item-page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/plan/inbox/item");

export default async function PlanInboxItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return TodayInboxItemPage({ params, searchParams });
}
