import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmationCenter } from "@/components/confirmation-center";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listConfirmationItems } from "@/lib/study/confirmation-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations/history");

export default async function ConfirmationHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await listConfirmationItems(user.id, "history");
  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader eyebrow="确认中心" title="已处理" description="这里是已确认或已驳回的冻结结果，只读回放，不会再次应用。" action={<Link href="/confirmations" className="inline-flex h-10 items-center rounded-md border border-white/10 px-3 text-sm text-zinc-200 hover:bg-white/5">返回待确认</Link>} />
      <section className="space-y-3">
        <SectionHeader title="处理记录" description="原业务页面仍是修改入口，历史记录只用于追溯当时决定。" />
        <ConfirmationCenter items={items} filter="history" />
      </section>
    </PageFrame>
  );
}
