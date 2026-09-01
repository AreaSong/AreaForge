import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { SyllabusMapOverviewDto, WorkspaceSubjectDto } from "@/lib/contracts";

export interface RoadmapSyllabusMatrixProps {
  overview: SyllabusMapOverviewDto;
  subjects?: WorkspaceSubjectDto[];
}

interface SegmentWidths {
  verified: number;
  covered: number;
  learning: number;
  risk: number;
  unstarted: number;
}

function calculateSegments(counts: SyllabusMapOverviewDto["summary"]["counts"], total: number): SegmentWidths {
  if (total <= 0) {
    return { verified: 0, covered: 0, learning: 0, risk: 0, unstarted: 100 };
  }
  const verified = Math.round((counts.verified / total) * 100);
  const covered = Math.round((counts.covered / total) * 100);
  const learning = Math.round((counts.learning / total) * 100);
  const riskCount = (counts.weak || 0) + (counts.forgetting_risk || 0) + (counts.mistake_hotspot || 0);
  const risk = Math.round((riskCount / total) * 100);
  const unstarted = Math.max(0, 100 - verified - covered - learning - risk);
  return { verified, covered, learning, risk, unstarted };
}

export function RoadmapSyllabusMatrix({
  overview,
  subjects = [],
}: RoadmapSyllabusMatrixProps) {
  const summary = overview.summary;
  const totalNodes = summary.totalNodes;
  const overallSegments = calculateSegments(summary.counts, totalNodes);
  const riskCount = (summary.counts.weak || 0) + (summary.counts.forgetting_risk || 0) + (summary.counts.mistake_hotspot || 0);

  const subjectMap = new Map<string, WorkspaceSubjectDto>();
  for (const s of subjects) {
    subjectMap.set(s.id, s);
  }

  const subjectEntries = Object.entries(overview.summaryBySubject || {});

  return (
    <div className="@container rounded-2xl border border-white/10 bg-[#0e1619]/90 p-4 sm:p-5 text-zinc-100 shadow-xl backdrop-blur-md space-y-3.5">
      {/* Header with Title and KPI Badges */}
      <div className="flex flex-col @[36rem]:flex-row @[36rem]:items-center justify-between gap-3 border-b border-white/5 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-white">考纲全景复习覆盖与掌握矩阵</h2>
          <p className="text-xs text-zinc-400">
            全科考纲总览 · 复测验证闭环与薄弱风险实时分布
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs font-mono text-zinc-400">
          <span>总覆盖率: <strong className="font-semibold text-white font-mono">{summary.coverageRate}%</strong></span>
          <span>·</span>
          <span>深度验证率: <strong className="font-semibold text-emerald-300 font-mono">{summary.verificationRate}%</strong></span>
          {riskCount > 0 && (
            <>
              <span>·</span>
              <span className="text-rose-400 font-semibold">{riskCount} 风险节点</span>
            </>
          )}
          <Link
            href="/knowledge/syllabi"
            className="text-xs text-teal-300 hover:text-teal-200 transition-colors flex items-center gap-0.5 ml-1 font-sans"
          >
            考纲树 <ChevronRight size={13} />
          </Link>
        </div>
      </div>

      {/* Stacked Overall Progress Bar & Legend */}
      <div className="space-y-2 rounded-xl border border-white/5 bg-[#090d0f] p-2.5">
        <div className="flex items-center justify-between text-xs text-zinc-300">
          <span className="font-medium">
            全科总纲进度 ({totalNodes} 节点)
          </span>
          <span className="font-mono text-zinc-400">
            已验证 {summary.counts.verified} · 已覆盖 {summary.counts.covered} · 学习中 {summary.counts.learning} · 风险 {riskCount}
          </span>
        </div>

        {/* Multi-Segment Stacked Bar */}
        <div className="h-3.5 w-full rounded-full bg-zinc-800/80 overflow-hidden flex shadow-inner">
          {overallSegments.verified > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${overallSegments.verified}%` }}
              title={`深度验证: ${summary.counts.verified} 节点 (${overallSegments.verified}%)`}
            />
          )}
          {overallSegments.covered > 0 && (
            <div
              className="h-full bg-teal-400 transition-all duration-300"
              style={{ width: `${overallSegments.covered}%` }}
              title={`常规覆盖: ${summary.counts.covered} 节点 (${overallSegments.covered}%)`}
            />
          )}
          {overallSegments.learning > 0 && (
            <div
              className="h-full bg-amber-400 transition-all duration-300"
              style={{ width: `${overallSegments.learning}%` }}
              title={`学习中: ${summary.counts.learning} 节点 (${overallSegments.learning}%)`}
            />
          )}
          {overallSegments.risk > 0 && (
            <div
              className="h-full bg-rose-500 transition-all duration-300"
              style={{ width: `${overallSegments.risk}%` }}
              title={`薄弱/遗忘/错题: ${riskCount} 节点 (${overallSegments.risk}%)`}
            />
          )}
          {overallSegments.unstarted > 0 && (
            <div
              className="h-full bg-zinc-700/60 transition-all duration-300"
              style={{ width: `${overallSegments.unstarted}%` }}
              title={`未开始: ${summary.counts.not_started} 节点 (${overallSegments.unstarted}%)`}
            />
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span>已验证 ({overallSegments.verified}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-teal-400" />
            <span>已覆盖 ({overallSegments.covered}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-400" />
            <span>学习中 ({overallSegments.learning}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-rose-500" />
            <span>薄弱/风险 ({overallSegments.risk}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-zinc-600" />
            <span>未开始 ({overallSegments.unstarted}%)</span>
          </div>
        </div>
      </div>

      {/* Per-Subject Breakdown Micro-Bars */}
      {subjectEntries.length > 0 && (
        <div className="space-y-2 pt-1">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">分科考纲推进概况</h3>
          <div className="grid grid-cols-1 @[30rem]:grid-cols-2 @[52rem]:grid-cols-3 gap-2.5">
            {subjectEntries.map(([subjectId, subSummary]) => {
              const subject = subjectMap.get(subjectId);
              const subjectName = subject ? subject.name : `科目 (${subjectId.slice(0, 6)})`;
              const subjectColor = subject?.color || "#2dd4bf";
              const segments = calculateSegments(subSummary.counts, subSummary.totalNodes);
              const subRisk = (subSummary.counts.weak || 0) + (subSummary.counts.forgetting_risk || 0) + (subSummary.counts.mistake_hotspot || 0);

              return (
                <div
                  key={subjectId}
                  className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 space-y-1.5 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="size-2.5 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: subjectColor }}
                      />
                      <strong className="font-medium text-white truncate">{subjectName}</strong>
                      <span className="text-[11px] text-zinc-500">({subSummary.totalNodes} 节点)</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono shrink-0">
                      <span className="text-teal-300">覆: {subSummary.coverageRate}%</span>
                      <span className="text-emerald-300">验: {subSummary.verificationRate}%</span>
                      {subRisk > 0 && (
                        <span className="text-rose-400 font-semibold">危: {subRisk}</span>
                      )}
                    </div>
                  </div>

                  {/* Micro Stacked Bar */}
                  <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden flex">
                    {segments.verified > 0 && (
                      <div className="h-full bg-emerald-500" style={{ width: `${segments.verified}%` }} />
                    )}
                    {segments.covered > 0 && (
                      <div className="h-full bg-teal-400" style={{ width: `${segments.covered}%` }} />
                    )}
                    {segments.learning > 0 && (
                      <div className="h-full bg-amber-400" style={{ width: `${segments.learning}%` }} />
                    )}
                    {segments.risk > 0 && (
                      <div className="h-full bg-rose-500" style={{ width: `${segments.risk}%` }} />
                    )}
                    {segments.unstarted > 0 && (
                      <div className="h-full bg-zinc-700/60" style={{ width: `${segments.unstarted}%` }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Next Actions & Focus Suggestions */}
      {summary.nextActions && summary.nextActions.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-teal-950/20 px-3 py-2 text-xs text-teal-200">
          <span className="text-zinc-400 shrink-0 font-medium">推荐行动:</span>
          <p className="truncate text-teal-200">{summary.nextActions[0]}</p>
        </div>
      )}
    </div>
  );
}
