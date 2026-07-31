import { notFound, redirect } from "next/navigation";
import { PlanInboxItemClient } from "@/components/plan-inbox-item-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getPlanInboxFormOptions, listPlanInboxItems } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/today/inbox/item");

export default async function TodayInboxItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { itemId } = await params;
  const [items, options] = await Promise.all([listPlanInboxItems(user.id), getPlanInboxFormOptions(user.id)]);
  const item = items.find((row) => row.id === itemId);
  if (!item) notFound();
  return <PlanInboxItemClient userId={user.id} item={item} options={options} />;
}
