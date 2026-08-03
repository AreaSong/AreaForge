import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getConfirmationItem } from "@/lib/study/confirmation-service";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import { getRouteMetadata, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/batch7";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { Badge } from "@/components/ui/feedback";
import { buttonClassName } from "@/components/ui/button";
import { ConfirmationDetailActions } from "@/components/confirmation-detail-actions";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations/detail");

export default async function ConfirmationDetailPage({ params, searchParams }: {
  params: Promise<{ confirmationId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { confirmationId } = await params;
  const item = await getConfirmationItem(user.id, decodeURIComponent(confirmationId));
  if (!item) notFound();
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/confirmations");
  const detailHref = withReturnTo(item.href, returnTo);
  const sourceHref = withReturnTo(item.sourceHref, detailHref);
  const statusLabel = item.status === "PENDING" ? "待确认" : item.status === "REJECTED" ? "已驳回" : "已确认并冻结";
  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="确认中心 / 当前事项"
        title={item.title}
        description="先查看这次建议或检验结果的冻结摘要，再进入来源页面完成最终确认。"
        status={<Badge tone={item.status === "PENDING" ? "warning" : item.status === "REJECTED" ? "neutral" : "success"}>{statusLabel}</Badge>}
        action={<Link href={returnTo} className={buttonClassName({ size: "sm" })}><ArrowLeft size={16} aria-hidden="true" />{getReturnContextLabel(returnTo, "返回确认中心")}</Link>}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="space-y-6">
          <SectionHeader title="事项摘要" description={item.summary} />
          <dl className="grid gap-4 border-y border-white/10 py-5 text-sm sm:grid-cols-2">
            <DetailFact label="类型" value={item.sourceLabel} />
            <DetailFact label="版本" value={`v${item.revision}`} />
            <DetailFact label="生成时间" value={formatDate(item.createdAt)} />
            <DetailFact label="冻结时间" value={item.frozenAt ? formatDate(item.frozenAt) : "尚未冻结"} />
          </dl>
          <div className="flex flex-wrap gap-3 border-t border-white/10 pt-5">
            <Link href={sourceHref} className={buttonClassName({ variant: "primary", size: "lg" })}><ExternalLink size={16} aria-hidden="true" />打开来源页面</Link>
            {item.status === "PENDING" && item.action?.kind === "ai_draft" ? <span className="inline-flex items-center gap-2 text-sm text-zinc-500"><Check size={16} aria-hidden="true" />AI 草稿需在来源页面使用原始证明确认</span> : null}
          </div>
          <ConfirmationDetailActions item={item} sourceHref={sourceHref} />
        </section>
        <aside className="border-l border-white/10 pl-6">
          <p className="text-xs font-medium text-zinc-500">确认规则</p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">确认中心只保存事实快照和决定状态，不会绕过原业务表单直接修改计划、掌握状态或考试结果。</p>
          <p className="mt-4 text-sm leading-6 text-zinc-400">驳回后仍保留历史记录，后续不会自动再次应用。</p>
        </aside>
      </div>
    </PageFrame>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-zinc-500">{label}</dt><dd className="mt-1 break-words text-zinc-200">{value}</dd></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
