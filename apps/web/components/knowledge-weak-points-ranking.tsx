import { AlertTriangle, ArrowRight, CheckCircle, Zap } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface WeakPointItem {
  id: string;
  title: string;
  subjectName: string;
  subjectColor: string;
  masteryState: string;
  masteryConfidence: number;
  needsRetest: boolean;
  retestCount: number;
  updatedAt: string;
}

export function KnowledgeWeakPointsRanking({ weakPoints }: { weakPoints: WeakPointItem[] }) {
  const hasWeakPoints = weakPoints.length > 0;

  return (
    <Card variant="master" className="flex flex-col justify-between p-4 sm:p-5 transition-all hover:border-white/20">
      <div>
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-rose-300">高频薄弱考点 Top 5</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              基于掌握可信度、复测状态与遗忘周期智能加权排序
            </p>
          </div>
          <Link
            href="/knowledge/points"
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-300 transition-colors hover:text-teal-200"
          >
            <span>全部考点</span>
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>

        {/* Ranking List */}
        <div className="mt-4 space-y-2.5">
          {hasWeakPoints ? (
            weakPoints.slice(0, 5).map((point, index) => {
              const rank = index + 1;
              const rankColor =
                rank === 1
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                  : rank === 2
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    : rank === 3
                      ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
                      : "bg-white/5 text-zinc-400 border-white/10";

              return (
                <div
                  key={point.id}
                  className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 transition-all hover:border-white/15 hover:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold ${rankColor}`}
                    >
                      {rank}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/knowledge/points/${point.id}`}
                          className="truncate text-xs font-medium text-white hover:text-teal-200 transition-colors"
                        >
                          {point.title}
                        </Link>
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-300"
                          style={{ backgroundColor: `${point.subjectColor || "#14b8a6"}20`, border: `1px solid ${point.subjectColor || "#14b8a6"}40` }}
                        >
                          {point.subjectName}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                        <span className="text-zinc-500">可信度:</span>
                        <span className={point.masteryConfidence < 50 ? "font-semibold text-rose-400" : "text-amber-400"}>
                          {point.masteryConfidence}%
                        </span>
                        {point.needsRetest ? (
                          <span className="rounded bg-rose-500/10 px-1 text-[10px] text-rose-300 border border-rose-500/20">
                            待复测
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* 1-Click Retest Trigger */}
                  <div className="flex items-center justify-end gap-2 shrink-0">
                    <ButtonLink
                      href={`/test/retests/new?returnTo=${encodeURIComponent("/knowledge")}`}
                      variant="secondary"
                      size="sm"
                      className="h-7 text-xs px-2.5 border-teal-400/30 text-teal-200 hover:bg-teal-400/10"
                    >
                      <Zap size={12} className="text-teal-400" aria-hidden />
                      <span>安排复测</span>
                    </ButtonLink>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-6 text-center">
              <CheckCircle size={24} className="text-emerald-400" aria-hidden />
              <p className="mt-2 text-xs font-medium text-zinc-300">当前没有显著高危薄弱考点</p>
              <p className="mt-1 text-[11px] text-zinc-500">各科目掌握度保持均衡，继续保持专注节奏。</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-zinc-400">
        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
          <AlertTriangle size={13} className="text-amber-400" aria-hidden />
          <span>专项复测通过后将自动提升考点掌握度</span>
        </span>
        <ButtonLink
          href="/test/retests/new?returnTo=%2Fknowledge"
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-teal-300 hover:text-teal-200 px-1.5"
        >
          批量安排复测 →
        </ButtonLink>
      </div>
    </Card>
  );
}
