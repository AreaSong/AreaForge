import { AlertCircle, ArrowRight, Calendar, Layers } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { formatDate } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { SimulationExamDto } from "@/lib/contracts";

export interface SimulationExamCardProps {
  exam: SimulationExamDto;
  primary?: boolean;
  returnTo?: string;
}

export function SimulationExamCard({ exam, primary = false, returnTo = "/test/simulations" }: SimulationExamCardProps) {
  const lossCount = exam.subjectResults.reduce(
    (total, result) => total + result.lossItems.filter((item) => !item.archivedAt).length,
    0,
  );
  const nextAction = exam.status === "DRAFT"
    ? exam.subjectResults.length > 0
      ? "核对并确认"
      : "录入分科成绩"
    : lossCount > 0
      ? "选择补救"
      : "查看考试事实";

  const isDraft = exam.status === "DRAFT";

  return (
    <Card
      variant={primary ? "accent" : "master"}
      className="group flex flex-col justify-between p-5 transition-all hover:border-teal-400/30 hover:shadow-[0_0_16px_rgba(45,212,191,0.1)]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone={isDraft ? "warning" : "success"}>
            {isDraft ? "未确认" : "已确认"}
          </Badge>
          <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
            <Calendar className="h-3 w-3 text-zinc-500" aria-hidden="true" />
            {formatDate(exam.examDate)}
          </span>
        </div>

        <h3 className="mt-3 break-words text-base font-semibold text-white group-hover:text-teal-200">
          {exam.name}
        </h3>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          {exam.totalsSource === "legacy_fallback" ? (
            <span className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-0.5 text-zinc-400">
              旧版总分记录
            </span>
          ) : (
            <span className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-0.5 text-zinc-200">
              <strong className="text-teal-300 font-semibold">{exam.actualScore ?? 0}</strong>
              <span className="text-zinc-500"> / </span>
              {exam.targetScore ?? 0} 分
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <Layers className="h-3 w-3 text-zinc-500" aria-hidden="true" />
            {exam.subjectResults.length} 科
          </span>
          <span>·</span>
          <span>{lossCount} 条失分</span>
        </div>

        {exam.warnings[0] ? (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-2 text-xs text-amber-200">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
            <span>{exam.warnings[0]}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
        <span className="text-xs text-zinc-500">{isDraft ? "阶段：待收口" : "阶段：事实已冻结"}</span>
        <Link
          href={withReturnTo(`/test/simulations/${exam.id}`, returnTo)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-300 transition-colors group-hover:text-teal-200"
          aria-label={`${nextAction} ${exam.name}`}
        >
          <span>{nextAction}</span>
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}
