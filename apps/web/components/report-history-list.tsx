"use client";

import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import type { PeriodicReportDecisionDto } from "@/lib/study/reports-service";

export function ReportHistoryList(props: {
  history: PeriodicReportDecisionDto[];
  period: "week" | "month";
}) {
  useRestoreListReturn();

  return (
    <div className="grid gap-3">
      {props.history.map((decision) => (
        <ListDetailLink
          key={decision.id}
          href={`/review/reports/history/${decision.id}?period=${props.period}`}
          focusId={`report-history-${decision.id}`}
          className="rounded-md border border-white/10 bg-[#101419] p-4"
        >
          <div className="flex justify-between">
            <span className="text-white">{decision.kind === "week" ? "周报告" : "月报告"}</span>
            <span className="text-xs text-zinc-500">{decision.status === "confirmed" ? "已确认" : "已驳回"}</span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            {new Date(decision.range.start).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} - {new Date(decision.range.end).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}
          </p>
        </ListDetailLink>
      ))}
    </div>
  );
}
