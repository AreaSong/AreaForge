import { AlertCircle, ArrowRight, CheckCircle2, RotateCw } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";

export interface EbbinghausIntervalStats {
  overdue: number;
  d1_2: number;
  d3_7: number;
  d8_14: number;
  d15_30: number;
  d30_plus: number;
  total: number;
  retentionRate7d: number;
  completedReviews: number;
}

const INTERVAL_CONFIGS = [
  { key: "overdue", label: "逾期待复习", shortLabel: "已逾期", color: "bg-rose-500", textColor: "text-rose-400", borderTone: "border-rose-500/30", bgTone: "bg-rose-500/10" },
  { key: "d1_2", label: "1-2 天内到期", shortLabel: "1-2天", color: "bg-amber-500", textColor: "text-amber-400", borderTone: "border-amber-500/30", bgTone: "bg-amber-500/10" },
  { key: "d3_7", label: "3-7 天内到期", shortLabel: "3-7天", color: "bg-sky-500", textColor: "text-sky-400", borderTone: "border-sky-500/30", bgTone: "bg-sky-500/10" },
  { key: "d8_14", label: "8-14 天内到期", shortLabel: "8-14天", color: "bg-indigo-500", textColor: "text-indigo-400", borderTone: "border-indigo-500/30", bgTone: "bg-indigo-500/10" },
  { key: "d15_30", label: "15-30 天内到期", shortLabel: "15-30天", color: "bg-teal-500", textColor: "text-teal-400", borderTone: "border-teal-500/30", bgTone: "bg-teal-500/10" },
  { key: "d30_plus", label: ">30 天 / 稳固掌握", shortLabel: "稳固(>30d)", color: "bg-emerald-500", textColor: "text-emerald-400", borderTone: "border-emerald-500/30", bgTone: "bg-emerald-500/10" },
] as const;

export function KnowledgeEbbinghausDistribution({ stats }: { stats: EbbinghausIntervalStats }) {
  const { overdue, d1_2, d3_7, d8_14, d15_30, d30_plus, total, retentionRate7d } = stats;

  const counts: Record<string, number> = {
    overdue,
    d1_2,
    d3_7,
    d8_14,
    d15_30,
    d30_plus,
  };

  const hasItems = total > 0;

  return (
    <Card variant="master" className="p-4 sm:p-5 transition-all hover:border-white/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-teal-300">艾宾浩斯复习留存曲线与周期分布</h2>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            基于记忆衰减周期的复习负荷分布 · 活跃复习计划 {total} 项 · 7 日留存率 {retentionRate7d}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={retentionRate7d >= 80 ? "success" : retentionRate7d >= 60 ? "warning" : "danger"}>
            7日留存 {retentionRate7d}%
          </Badge>
          <Link
            href="/knowledge/reviews"
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-300 transition-colors hover:text-teal-200"
          >
            <span>复习工作台</span>
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      </div>

      {/* Segmented Distribution Bar */}
      <div className="mt-4">
        <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-white/[0.05] p-0.5 ring-1 ring-white/10">
          {hasItems ? (
            INTERVAL_CONFIGS.map((cfg) => {
              const count = counts[cfg.key] ?? 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <div
                  key={cfg.key}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                  title={`${cfg.label}: ${count}项 (${pct.toFixed(1)}%)`}
                  className={`h-full first:rounded-l-full last:rounded-r-full ${cfg.color} transition-all hover:opacity-90`}
                />
              );
            })
          ) : (
            <div className="h-full w-full rounded-full bg-zinc-800" title="暂无活跃复习计划" />
          )}
        </div>
      </div>

      {/* Interval Details Grid */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {INTERVAL_CONFIGS.map((cfg) => {
          const count = counts[cfg.key] ?? 0;
          const pct = total > 0 ? ((count / total) * 100).toFixed(0) : "0";
          return (
            <div
              key={cfg.key}
              className={`flex flex-col justify-between rounded-xl border ${cfg.borderTone} ${cfg.bgTone} p-2.5 transition-all`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-zinc-300 truncate">{cfg.shortLabel}</span>
                <span className={`size-1.5 rounded-full ${cfg.color}`} />
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-base font-semibold text-white">{count}</span>
                <span className="text-[10px] text-zinc-400">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Load Warning / Status Callout */}
      {overdue > 0 ? (
        <div className="mt-3.5 flex items-center justify-between gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={15} className="shrink-0 text-rose-400" aria-hidden />
            <span className="truncate">
              当前有 <strong>{overdue}</strong> 项复习已逾期，建议优先完成以免产生遗忘断层。
            </span>
          </div>
          <Link
            href="/knowledge/reviews"
            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-100 hover:bg-rose-500/30 transition-colors"
          >
            <RotateCw size={12} aria-hidden />
            <span>立即处理</span>
          </Link>
        </div>
      ) : (
        <div className="mt-3.5 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-400" aria-hidden />
          <span>复习节奏保持优异，当前没有逾期积压项。</span>
        </div>
      )}
    </Card>
  );
}
