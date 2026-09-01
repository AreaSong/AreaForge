import {
  ArrowRight,
  Bot,
  ClipboardCheck,
  FileCheck2,
  Flag,
  Repeat2,
} from "lucide-react";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { ConfirmationItemDto } from "@/lib/contracts";

export function ConfirmationCenter({
  items,
  filter,
}: {
  items: ConfirmationItemDto[];
  filter: "pending" | "history";
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={filter === "pending" ? "当前没有待确认事项" : "还没有已处理记录"}
        description={
          filter === "pending"
            ? "完成学习、复盘或检验后，需要你决定的结果会统一出现在这里。"
            : "确认或驳回的报告、阶段建议和模拟考试会保留在这里。"
        }
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {items.map((item) => (
        <ConfirmationRow key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  );
}

function ConfirmationRow({ item }: { item: ConfirmationItemDto }) {
  const Icon =
    item.kind === "periodic_report"
      ? ClipboardCheck
      : item.kind === "stage_adjustment"
        ? Flag
        : item.kind === "knowledge_retest"
          ? Repeat2
          : item.kind === "ai_draft"
            ? Bot
            : FileCheck2;
  const statusTone =
    item.status === "PENDING"
      ? "warning"
      : item.status === "CONFIRMED" || item.status === "FROZEN"
        ? "success"
        : "neutral";
  const statusLabel =
    item.status === "PENDING"
      ? "需要决定"
      : item.status === "FROZEN"
        ? "已确认 · 已冻结"
        : item.status === "CONFIRMED"
          ? item.frozen
            ? "已确认 · 已冻结"
            : "已确认"
          : "已驳回 · 已冻结";
  const listHref =
    item.status === "PENDING" ? "/confirmations" : "/confirmations/history";

  return (
    <Card
      variant="master"
      padding="md"
      className="group flex flex-col justify-between gap-4 transition-all hover:border-teal-500/30 hover:shadow-[0_0_20px_rgba(45,212,191,0.15)]"
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.15)] group-hover:border-teal-400/40 group-hover:shadow-[0_0_16px_rgba(45,212,191,0.3)]">
            <Icon size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words font-semibold text-white group-hover:text-teal-200">
                {item.title}
              </span>
              <Badge tone={statusTone}>{statusLabel}</Badge>
              <Badge tone="neutral">v{item.revision}</Badge>
            </div>
            <span className="text-xs text-zinc-500">{item.sourceLabel}</span>
          </div>
        </div>
        <p className="break-words text-xs leading-relaxed text-zinc-400">
          {item.summary}
        </p>
      </div>

      <div className="flex items-center justify-end border-t border-white/5 pt-3">
        <Link
          href={withReturnTo(item.href, listHref)}
          className={buttonClassName({
            variant: item.status === "PENDING" ? "primary" : "secondary",
            size: "sm",
            className:
              item.status === "PENDING"
                ? "shadow-[0_0_12px_rgba(45,212,191,0.25)]"
                : "",
          })}
        >
          <span>{item.status === "PENDING" ? "打开并确认" : "查看冻结记录"}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}
