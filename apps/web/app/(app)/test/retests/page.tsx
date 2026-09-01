import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { RetestCard } from "@/components/retest-card";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listKnowledgeRetests } from "@/lib/study/knowledge-retest-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/retests");

export default async function KnowledgeRetestsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const retests = await listKnowledgeRetests(user.id);
  const open = retests.filter((item) => item.status !== "CLOSED" && item.status !== "VOIDED");
  const closed = retests.filter((item) => item.status === "CLOSED");

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="检验 · 专项复测"
        title="专项复测"
        description="复测才知道是否稳定掌握；每次复测都留下结果和个人反馈。"
        action={
          <ButtonLink href="/test/retests/new" variant="primary">
            <Plus size={16} aria-hidden="true" />
            安排专项复测
          </ButtonLink>
        }
      />
      <section className="space-y-4">
        <SectionHeader
          title="待处理复测"
          description="优先处理已到期或仍未收口的复测。"
          meta={<Badge tone={open.length ? "warning" : "neutral"}>{open.length} 项</Badge>}
        />
        {open.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {open.map((item) => (
              <RetestCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="当前没有待处理复测"
            description="从知识点详情安排下一次复测，或继续学习后再安排。"
            action={
              <ButtonLink href="/test/retests/new" variant="secondary">
                <Plus size={15} aria-hidden="true" />
                立即安排复测
              </ButtonLink>
            }
          />
        )}
      </section>
      <section className="space-y-4">
        <SectionHeader
          title="已完成复测"
          description="历史结果只读保留，用于观察掌握是否稳定。"
          meta={<Badge>{closed.length} 项</Badge>}
        />
        {closed.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {closed.map((item) => (
              <RetestCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="border-y border-white/10 py-5 text-sm text-zinc-500">还没有已完成复测。</p>
        )}
      </section>
    </PageFrame>
  );
}
