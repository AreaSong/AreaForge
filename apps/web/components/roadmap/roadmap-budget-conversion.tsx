import { Scale, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/feedback";
import type { WeeklyBudgetDto } from "@/lib/contracts";

export interface RoadmapBudgetConversionProps {
  weeklyBudget: WeeklyBudgetDto;
}

export interface SubjectConversionRow {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  budgetMinutes: number | null;
  actualMinutes: number;
  effectiveMinutes: number;
  conversionRate: number | null; // effective / actual；无实际投入时为空
  progressRate: number | null; // actual / budget
  deltaMinutes: number | null;
  status: "high" | "normal" | "lag" | "low_conversion" | "no_data";
  statusLabel: string;
}

function formatHours(minutes: number): string {
  const h = (minutes / 60).toFixed(1);
  return `${h} h`;
}

function getStatusBadgeTone(status: SubjectConversionRow["status"]): "success" | "info" | "warning" | "danger" {
  switch (status) {
    case "high":
      return "success";
    case "normal":
      return "info";
    case "lag":
      return "warning";
    case "low_conversion":
      return "danger";
    case "no_data":
      return "info";
  }
}

export function RoadmapBudgetConversionTable({
  weeklyBudget,
}: RoadmapBudgetConversionProps) {
  const rows = computeWeeklyBudgetConversionRows(weeklyBudget);

  const allBudgetsConfigured = rows.length > 0 && rows.every((row) => row.budgetMinutes != null);
  const totalBudgetMinutes = allBudgetsConfigured
    ? rows.reduce((sum, row) => sum + (row.budgetMinutes ?? 0), 0)
    : null;
  const totalActualMinutes = rows.reduce((sum, r) => sum + r.actualMinutes, 0);
  const totalEffectiveMinutes = rows.reduce((sum, r) => sum + r.effectiveMinutes, 0);
  const totalConversionRate = totalActualMinutes > 0
    ? Math.round((totalEffectiveMinutes / totalActualMinutes) * 100)
    : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md space-y-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
            <Scale size={16} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">本周预算 vs 实际投入转化</h2>
            <p className="text-xs text-zinc-400">
              {weeklyBudget.weekStart} 至 {weeklyBudget.weekEnd} · 按真实预算核对时间分配和有效学习
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1 text-zinc-300">
            <TrendingUp size={13} className="text-teal-400" />
            <span>全科平均转化率: <strong className="text-white font-mono">{totalConversionRate == null ? "暂无样本" : `${totalConversionRate}%`}</strong></span>
          </div>
          <Link
            href="/roadmap/allocation"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            投入安排 →
          </Link>
        </div>
      </div>

      {/* Dense Conversion Table */}
      <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#090d0f]">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02] text-zinc-400 text-[11px]">
              <th className="py-2 px-3 font-semibold">科目</th>
              <th className="py-2 px-3 font-semibold text-right">计划预算</th>
              <th className="py-2 px-3 font-semibold text-right">实际投入</th>
              <th className="py-2 px-3 font-semibold text-right">有效专注</th>
              <th className="py-2 px-3 font-semibold text-right">投入转化率</th>
              <th className="py-2 px-3 font-semibold text-right">预算完成度</th>
              <th className="py-2 px-3 font-semibold text-center">推进状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.subjectId} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: row.subjectColor }}
                      />
                      <span className="font-medium text-white">{row.subjectName}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                    {row.budgetMinutes == null ? "未设置" : formatHours(row.budgetMinutes)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-medium text-zinc-200">
                    {formatHours(row.actualMinutes)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-teal-300">
                    {formatHours(row.effectiveMinutes)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 font-mono">
                      <span
                        className={`font-semibold ${
                          row.conversionRate == null
                            ? "text-zinc-500"
                            : row.conversionRate >= 85
                            ? "text-emerald-400"
                            : row.conversionRate >= 70
                            ? "text-teal-300"
                            : "text-amber-400"
                        }`}
                      >
                        {row.conversionRate == null ? "-" : `${row.conversionRate}%`}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                    <div className="flex items-center justify-end gap-1.5">
                      {row.progressRate == null || row.deltaMinutes == null ? (
                        <span>未设置</span>
                      ) : (
                        <>
                          <span>{row.progressRate}%</span>
                          <span className="text-[10px] text-zinc-500">
                            ({row.deltaMinutes >= 0 ? `+${formatHours(row.deltaMinutes)}` : formatHours(row.deltaMinutes)})
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <Badge tone={getStatusBadgeTone(row.status)}>{row.statusLabel}</Badge>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-4 px-3 text-center text-zinc-500">
                  暂无科目投入记录，开启专注计时或排布投入任务后在此汇总。
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-white/[0.03] font-semibold text-zinc-200">
                <td className="py-2.5 px-3 text-white">全科总计</td>
                <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                  {totalBudgetMinutes == null ? "部分未设置" : formatHours(totalBudgetMinutes)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-white">
                  {formatHours(totalActualMinutes)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-teal-300">
                  {formatHours(totalEffectiveMinutes)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold">
                  {totalConversionRate == null ? "-" : `${totalConversionRate}%`}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-zinc-300">
                  {totalBudgetMinutes && totalBudgetMinutes > 0
                    ? `${Math.round((totalActualMinutes / totalBudgetMinutes) * 100)}%`
                    : "未设置"}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <Badge tone={totalConversionRate != null && totalConversionRate >= 80 ? "success" : "info"}>
                    {totalConversionRate == null ? "暂无样本" : totalConversionRate >= 80 ? "整体高效" : "稳步推进"}
                  </Badge>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export function computeWeeklyBudgetConversionRows(budget: WeeklyBudgetDto): SubjectConversionRow[] {
  return budget.subjects.map((subject) => {
    const conversionRate = subject.actualMinutes > 0
      ? Math.round((subject.effectiveMinutes / subject.actualMinutes) * 100)
      : null;
    const progressRate = subject.targetMinutes && subject.targetMinutes > 0
      ? Math.round((subject.actualMinutes / subject.targetMinutes) * 100)
      : null;
    const deltaMinutes = subject.targetMinutes && subject.targetMinutes > 0
      ? subject.actualMinutes - subject.targetMinutes
      : null;
    let status: SubjectConversionRow["status"] = conversionRate == null ? "no_data" : "normal";
    let statusLabel = conversionRate == null ? "暂无样本" : "稳步推进";
    if (conversionRate != null && conversionRate < 65 && subject.actualMinutes >= 120) {
      status = "low_conversion";
      statusLabel = "转化偏低";
    } else if (progressRate != null && conversionRate != null && conversionRate >= 88 && progressRate >= 70) {
      status = "high";
      statusLabel = "高效转化";
    } else if (progressRate != null && conversionRate != null && progressRate < 50) {
      status = "lag";
      statusLabel = "需补投入";
    } else if (subject.targetMinutes == null && conversionRate != null) {
      statusLabel = "未设置预算";
    }
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      subjectColor: subject.subjectColor,
      budgetMinutes: subject.targetMinutes,
      actualMinutes: subject.actualMinutes,
      effectiveMinutes: subject.effectiveMinutes,
      conversionRate,
      progressRate,
      deltaMinutes,
      status,
      statusLabel,
    };
  });
}
