import { ArrowRight, Bot, CheckCheck, ClipboardCheck, FileCheck2, Flag } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { withReturnTo } from "@/lib/navigation/batch7";
import type { ConfirmationItemDto } from "@/lib/study/confirmation-service";

export function ConfirmationCenter({ items, filter }: { items: ConfirmationItemDto[]; filter: "pending" | "history" }) {
  if (items.length === 0) {
    return <EmptyState title={filter === "pending" ? "当前没有待确认事项" : "还没有已处理记录"} description={filter === "pending" ? "完成学习、复盘或检验后，需要你决定的结果会统一出现在这里。" : "确认或驳回的报告、阶段建议和模拟考试会保留在这里。"} />;
  }
  return (
    <div className="divide-y divide-white/10 border-y border-white/10">
      {items.map((item) => <ConfirmationRow key={`${item.kind}-${item.id}`} item={item} />)}
    </div>
  );
}

function ConfirmationRow({ item }: { item: ConfirmationItemDto }) {
  const Icon = item.kind === "periodic_report" ? ClipboardCheck : item.kind === "stage_adjustment" ? Flag : item.kind === "knowledge_retest" ? CheckCheck : item.kind === "ai_draft" ? Bot : FileCheck2;
  const statusTone = item.status === "PENDING" ? "warning" : item.status === "CONFIRMED" || item.status === "FROZEN" ? "success" : "neutral";
  const statusLabel = item.status === "PENDING" ? "需要决定" : item.status === "FROZEN" ? "已确认 · 已冻结" : item.status === "CONFIRMED" ? (item.frozen ? "已确认 · 已冻结" : "已确认") : "已驳回 · 已冻结";
  const listHref = item.status === "PENDING" ? "/confirmations" : "/confirmations/history";
  return (
    <Link href={withReturnTo(item.href, listHref)} className="group grid gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span className="hidden size-9 place-items-center rounded-md border border-white/10 text-teal-300 sm:grid"><Icon size={17} aria-hidden="true" /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-white group-hover:text-teal-200">{item.title}</span><Badge tone={statusTone}>{statusLabel}</Badge><span className="text-xs text-zinc-600">{item.sourceLabel}</span></div>
        <p className="mt-1 text-sm leading-6 text-zinc-400">{item.summary}</p>
      </div>
      <span className="inline-flex items-center gap-2 text-sm text-teal-300">{item.status === "PENDING" ? "打开并确认" : "查看冻结记录"}<ArrowRight size={16} aria-hidden="true" /></span>
    </Link>
  );
}
