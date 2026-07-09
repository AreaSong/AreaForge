"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PeriodicReportDto } from "@/lib/study/reports-service";

interface ReportDecisionActionsProps {
  report: PeriodicReportDto;
}

export function ReportDecisionActions({ report }: ReportDecisionActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const decision = report.decision;
  const disabled = isPending || Boolean(decision);

  async function decide(action: "confirm" | "reject") {
    setError(null);
    setNotice(null);

    const response = await fetch("/api/reports/periodic/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: report.kind,
        action,
        rangeStart: report.range.start,
        rangeEnd: report.range.end,
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      decision?: { alreadyDecided?: boolean };
      error?: string;
    } | null;

    if (!response.ok) {
      setError(labelDecisionError(body?.error));
      return;
    }

    setNotice(body?.decision?.alreadyDecided ? "该周期报告已经处理，正在刷新回放。" : "报告决策已记录。");
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-4 rounded-md border border-white/10 bg-[#151a20] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-100">报告决策</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            只冻结报告快照、下一周期草稿和审计记录，不自动修改任务或阶段计划。
          </p>
        </div>
        {decision ? (
          <span className="w-fit rounded-md border border-teal-300/20 px-2 py-1 text-xs text-teal-100">
            {decision.status === "confirmed" ? "已确认" : "已驳回"}
          </span>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              onClick={() => decide("confirm")}
              type="button"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              确认本报告
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rose-300/30 px-3 text-sm font-medium text-rose-100 hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              onClick={() => decide("reject")}
              type="button"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              驳回本报告
            </button>
          </div>
        )}
      </div>

      {decision ? (
        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 text-xs leading-5 text-zinc-400">
          <p>处理时间：{new Date(decision.decidedAt).toLocaleString("zh-CN")}</p>
          <p>冻结短板：{decision.reportSnapshot.weakness.title}</p>
          <p>确认边界：{decision.canAutoApply ? "可自动应用" : "不自动应用"} / {decision.requiresUserConfirmation ? "需确认" : "无需确认"}</p>
          {decision.nextCycleDraft ? <p>下周期草稿：{decision.nextCycleDraft.focus}</p> : null}
        </div>
      ) : null}

      {notice ? <p className="mt-3 text-xs text-teal-100">{notice}</p> : null}
      {error ? <p className="mt-3 text-xs text-red-200">{error}</p> : null}
    </div>
  );
}

function labelDecisionError(error?: string): string {
  switch (error) {
    case "PERIODIC_REPORT_DECISION_CONFLICT":
      return "该周期报告已经做过相反决策，不能静默覆盖。";
    case "PERIODIC_REPORT_RANGE_STALE":
      return "页面中的报告周期已过期，请刷新后再处理。";
    case "UNAUTHORIZED":
      return "请先登录后再处理报告。";
    default:
      return error ?? "报告决策失败。";
  }
}
