import { redirect } from "next/navigation";
import { ConfirmationCenter } from "@/components/confirmation-center";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listConfirmationItems } from "@/lib/study/confirmation-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations");

export default async function ConfirmationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await listConfirmationItems(user.id, "pending");
  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader eyebrow="确认中心" title="待确认" description="建议、报告和检验结果先停在这里，只有你确认后才会形成下一步动作。" status={<Badge tone={items.length ? "warning" : "success"}>{items.length} 项待确认</Badge>} />
      <section className="space-y-3">
        <SectionHeader title="需要你的决定" description="每一项都会回到原业务工作台完成确认，确认中心不代替具体业务表单。" />
        <ConfirmationCenter items={items} filter="pending" />
      </section>
    </PageFrame>
  );
}
