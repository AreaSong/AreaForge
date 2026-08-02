"use client";

import { ArrowRight, CalendarRange } from "lucide-react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { EmptyState, Badge } from "@/components/ui/feedback";
import type { PeriodicReportDecisionDto } from "@/lib/study/reports-service";

export function ReportHistoryList(props: {
  history: PeriodicReportDecisionDto[];
  period: "week" | "month";
}) {
  useRestoreListReturn();

  return (
    <div>
      {props.history.length === 0 ? <EmptyState title="还没有已处理报告" description={`处理一份${props.period === "week" ? "周" : "月"}报告后，冻结快照会出现在这里。`} /> : null}
      <div className="divide-y divide-white/10 border-y border-white/10">
      {props.history.map((decision) => (
        <ListDetailLink
          key={decision.id}
          href={`/review/reports/history/${decision.id}?period=${props.period}`}
          focusId={`report-history-${decision.id}`}
          className="flex items-center justify-between gap-4 py-4"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-white">{decision.kind === "week" ? "周报告" : "月报告"}</span>
              <Badge tone={decision.status === "confirmed" ? "success" : "neutral"}>{decision.status === "confirmed" ? "已确认" : "已驳回"}</Badge>
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
              <CalendarRange size={14} aria-hidden="true" />
              {new Date(decision.range.start).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 至 {new Date(decision.range.end).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}
            </p>
          </div>
          <ArrowRight className="size-4 shrink-0 text-zinc-600" aria-hidden="true" />
        </ListDetailLink>
      ))}
      </div>
    </div>
  );
}
