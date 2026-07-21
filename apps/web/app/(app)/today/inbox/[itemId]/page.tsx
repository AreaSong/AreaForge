import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanInboxItemClient } from "@/components/plan-inbox-item-client";
import { getCurrentUser } from "@/lib/auth/session";
import { listPlanInboxItems } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

export default async function TodayInboxItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { itemId } = await params;
  const items = await listPlanInboxItems(user.id);
  const item = items.find((row) => row.id === itemId);
  if (!item) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-white">收件箱项不存在</h1>
        <Link href="/today/inbox" className="text-teal-300 hover:underline">
          返回收件箱
        </Link>
      </section>
    );
  }
  return <PlanInboxItemClient item={item} />;
}
