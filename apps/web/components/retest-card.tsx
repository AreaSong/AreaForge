import { ArrowRight, Calendar } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { formatDateMonthDayPadded } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";

export interface RetestCardItem {
  id: string;
  title: string;
  method: string;
  pointCount: number;
  pointTitles: string[];
  status: string;
  result: string | null;
  nextDueAt: Date | string | null;
}

export interface RetestCardProps {
  item: RetestCardItem;
  returnTo?: string;
}

export function RetestCard({ item, returnTo = "/test/retests" }: RetestCardProps) {
  const isPassed = item.result === "PASSED";
  const isPartial = item.result === "PARTIAL";
  const isClosed = item.status === "CLOSED";

  const badgeTone = isPassed
    ? "success"
    : isPartial
      ? "warning"
      : isClosed
        ? "neutral"
        : item.status === "PENDING_REVIEW"
          ? "warning"
          : "info";

  return (
    <Card
      variant="master"
      className="group flex flex-col justify-between p-5 transition-all hover:border-teal-400/30 hover:shadow-[0_0_16px_rgba(45,212,191,0.1)]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone={badgeTone}>{retestStatusLabel(item.status, item.result)}</Badge>
          {item.nextDueAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              <Calendar className="h-3 w-3 text-zinc-500" aria-hidden="true" />
              下次 {formatDateMonthDayPadded(item.nextDueAt)}
            </span>
          ) : null}
        </div>
        <h3 className="mt-3 break-words text-base font-semibold text-white group-hover:text-teal-200">
          {item.title}
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          {item.method} · {item.pointCount} 个知识点
        </p>
        {item.pointTitles.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.pointTitles.slice(0, 4).map((title, i) => (
              <span
                key={i}
                className="max-w-[12rem] truncate rounded-md border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400"
              >
                {title}
              </span>
            ))}
            {item.pointTitles.length > 4 ? (
              <span className="rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-zinc-500">
                +{item.pointTitles.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-end border-t border-white/5 pt-3">
        <Link
          href={withReturnTo(`/test/retests/${item.id}`, returnTo)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-300 transition-colors group-hover:text-teal-200"
          aria-label={`打开复测 ${item.title}`}
        >
          <span>打开复测</span>
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

export function retestStatusLabel(status: string, result: string | null): string {
  if (status === "CLOSED") return result === "PASSED" ? "通过" : result === "PARTIAL" ? "部分掌握" : "未通过";
  if (status === "PENDING_REVIEW") return "待确认";
  if (status === "IN_PROGRESS") return "进行中";
  return "待开始";
}
