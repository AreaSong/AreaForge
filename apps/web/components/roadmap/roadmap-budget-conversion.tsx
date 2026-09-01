import { Activity, ArrowUpRight, CheckCircle2, Clock, Scale, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/feedback";
import type { AnalyticsSubjectShareDto, AnalyticsSummaryDto, SyllabusMapOverviewDto, WorkspaceSubjectDto } from "@/lib/contracts";

export interface RoadmapBudgetConversionProps {
  analytics: AnalyticsSummaryDto;
  syllabusOverview?: SyllabusMapOverviewDto;
  subjects?: WorkspaceSubjectDto[];
}

export interface SubjectConversionRow {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  budgetMinutes: number;
  actualMinutes: number;
  effectiveMinutes: number;
  conversionRate: number; // effective / actual or effective / budget
  progressRate: number; // actual / budget
  deltaMinutes: number;
  status: "high" | "normal" | "lag" | "low_conversion";
  statusLabel: string;
}

export function computeSubjectConversionRows(
  analyticsSubjects: AnalyticsSubjectShareDto[],
  overview?: SyllabusMapOverviewDto,
  workspaceSubjects: WorkspaceSubjectDto[] = [],
): SubjectConversionRow[] {
  const subjectMap = new Map<string, WorkspaceSubjectDto>();
  for (const s of workspaceSubjects) {
    subjectMap.set(s.id, s);
  }

  // Calculate targetMinutes per subject from syllabus tree if available
  const targetMinutesBySubject: Record<string, number> = {};
  if (overview?.nodes) {
    const accumulateTargets = (nodes: typeof overview.nodes) => {
      for (const node of nodes) {
        if (node.targetMinutes && node.targetMinutes > 0) {
          targetMinutesBySubject[node.subjectId] = (targetMinutesBySubject[node.subjectId] || 0) + node.targetMinutes;
        }
        if (node.children?.length) {
          accumulateTargets(node.children);
        }
      }
    };
    accumulateTargets(overview.nodes);
  }

  return analyticsSubjects.map((sub) => {
    const custom = subjectMap.get(sub.subjectId);
    const name = custom?.name || sub.subjectName || "未知科目";
    const color = custom?.color || sub.subjectColor || "#2dd4bf";

    // Planned budget: either from syllabus targetMinutes, or proportional estimate (e.g. 60-120h)
    const budgetMinutes = targetMinutesBySubject[sub.subjectId] || (sub.totalMinutes > 0 ? Math.round(sub.totalMinutes * 1.25) : 3600);
    const actualMinutes = sub.totalMinutes || 0;
    const effectiveMinutes = sub.effectiveMinutes || 0;

    const conversionRate = actualMinutes > 0 ? Math.round((effectiveMinutes / actualMinutes) * 100) : 0;
    const progressRate = budgetMinutes > 0 ? Math.round((actualMinutes / budgetMinutes) * 100) : 0;
    const deltaMinutes = actualMinutes - budgetMinutes;

    let status: SubjectConversionRow["status"] = "normal";
    let statusLabel = "稳步推进";

    if (conversionRate >= 88 && progressRate >= 70) {
      status = "high";
      statusLabel = "高效转化";
    } else if (conversionRate < 65 && actualMinutes >= 120) {
      status = "low_conversion";
      statusLabel = "转化偏低";
    } else if (progressRate < 50) {
      status = "lag";
      statusLabel = "需补投入";
    }

    return {
      subjectId: sub.subjectId,
      subjectName: name,
      subjectColor: color,
      budgetMinutes,
      actualMinutes,
      effectiveMinutes,
      conversionRate,
      progressRate,
      deltaMinutes,
      status,
      statusLabel,
    };
  });
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
  }
}

export function RoadmapBudgetConversionTable({
  analytics,
  syllabusOverview,
  subjects = [],
}: RoadmapBudgetConversionProps) {
  const rows = computeSubjectConversionRows(analytics.subjects, syllabusOverview, subjects);

  const totalBudgetMinutes = rows.reduce((sum, r) => sum + r.budgetMinutes, 0);
  const totalActualMinutes = rows.reduce((sum, r) => sum + r.actualMinutes, 0);
  const totalEffectiveMinutes = rows.reduce((sum, r) => sum + r.effectiveMinutes, 0);
  const totalConversionRate = totalActualMinutes > 0
    ? Math.round((totalEffectiveMinutes / totalActualMinutes) * 100)
    : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md space-y-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
            <Scale size={16} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">科目预算 vs 实际投入转化对比</h2>
            <p className="text-xs text-zinc-400">
              各科计划时长与专注有效时长转化效率，防止“学了很久却没有学进去”
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1 text-zinc-300">
            <TrendingUp size={13} className="text-teal-400" />
            <span>全科平均转化率: <strong className="text-white font-mono">{totalConversionRate}%</strong></span>
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
                    {formatHours(row.budgetMinutes)}
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
                          row.conversionRate >= 85
                            ? "text-emerald-400"
                            : row.conversionRate >= 70
                            ? "text-teal-300"
                            : "text-amber-400"
                        }`}
                      >
                        {row.conversionRate}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-zinc-400">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>{row.progressRate}%</span>
                      <span className="text-[10px] text-zinc-500">
                        ({row.deltaMinutes >= 0 ? `+${formatHours(row.deltaMinutes)}` : formatHours(row.deltaMinutes)})
                      </span>
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
                  {formatHours(totalBudgetMinutes)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-white">
                  {formatHours(totalActualMinutes)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-teal-300">
                  {formatHours(totalEffectiveMinutes)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold">
                  {totalConversionRate}%
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-zinc-300">
                  {totalBudgetMinutes > 0 ? `${Math.round((totalActualMinutes / totalBudgetMinutes) * 100)}%` : "100%"}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <Badge tone={totalConversionRate >= 80 ? "success" : "info"}>
                    {totalConversionRate >= 80 ? "整体高效" : "稳步推进"}
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
