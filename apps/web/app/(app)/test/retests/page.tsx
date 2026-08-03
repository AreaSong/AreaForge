import { ArrowRight, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, withReturnTo } from "@/lib/navigation/batch7";
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
      <PageHeader eyebrow="检验 · 专项复测" title="专项复测" description="复测才知道是否稳定掌握；每次复测都留下结果和个人反馈。" action={<Link href={withReturnTo("/test/retests/new", "/test/retests")} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] hover:bg-teal-300"><ClipboardCheck size={16} aria-hidden="true" />安排复测</Link>} />
      <section className="space-y-3">
        <SectionHeader title="待处理复测" description="优先处理已到期或仍未收口的复测。" meta={<Badge tone={open.length ? "warning" : "neutral"}>{open.length} 项</Badge>} />
        {open.length ? <div className="divide-y divide-white/10 border-y border-white/10">{open.map((item) => <RetestRow key={item.id} item={item} />)}</div> : <EmptyState title="当前没有待处理复测" description="从知识点详情安排下一次复测，或继续学习后再安排。" />}
      </section>
      <section className="space-y-3">
        <SectionHeader title="已完成复测" description="历史结果只读保留，用于观察掌握是否稳定。" meta={<Badge>{closed.length} 项</Badge>} />
        {closed.length ? <div className="divide-y divide-white/10 border-y border-white/10">{closed.map((item) => <RetestRow key={item.id} item={item} />)}</div> : <p className="border-y border-white/10 py-5 text-sm text-zinc-500">还没有已完成复测。</p>}
      </section>
    </PageFrame>
  );
}

function RetestRow({ item }: { item: Awaited<ReturnType<typeof listKnowledgeRetests>>[number] }) {
  return (
    <Link href={withReturnTo(`/test/retests/${item.id}`, "/test/retests")} className="group grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-white group-hover:text-teal-200">{item.title}</span><Badge tone={item.result === "PASSED" ? "success" : item.status === "CLOSED" ? "neutral" : "warning"}>{retestStatusLabel(item.status, item.result)}</Badge></div>
        <p className="mt-1 text-sm text-zinc-400">{item.method} · {item.pointCount} 个知识点{item.nextDueAt ? ` · 下次 ${formatDate(item.nextDueAt)}` : ""}</p>
        {item.pointTitles.length ? <p className="mt-1 truncate text-xs text-zinc-500">{item.pointTitles.join("、")}</p> : null}
      </div>
      <span className="inline-flex items-center gap-2 text-sm text-teal-300">打开复测<ArrowRight size={16} aria-hidden="true" /></span>
    </Link>
  );
}

function retestStatusLabel(status: string, result: string | null): string {
  if (status === "CLOSED") return result === "PASSED" ? "通过" : result === "PARTIAL" ? "部分掌握" : "未通过";
  if (status === "PENDING_REVIEW") return "待复盘";
  if (status === "IN_PROGRESS") return "进行中";
  return "待开始";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value));
}
