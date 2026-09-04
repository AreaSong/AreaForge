import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";

export interface SubjectMasteryData {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  totalPoints: number;
  stableCount: number;
  initialCount: number;
  learningCount: number;
  weakCount: number;
  untouchedCount: number;
  masteryRate: number | null; // 0-100%，无考点时为空
}

export interface RadarDimension {
  label: string;
  value: number | null; // 0-100%，无真实样本时为空
}

export interface KnowledgeSubjectMasteryPanelProps {
  subjects: SubjectMasteryData[];
  radarDimensions: RadarDimension[];
  overallMasteryRate: number | null;
}

export function KnowledgeSubjectMasteryPanel({
  subjects,
  radarDimensions,
  overallMasteryRate,
}: KnowledgeSubjectMasteryPanelProps) {
  return (
    <Card variant="master" className="flex flex-col justify-between p-4 sm:p-5 transition-all hover:border-white/20">
      <div>
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-teal-300">科目掌握度全景分布</h2>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              各学科考点稳固、进阶与薄弱多态量化 · 综合掌握率 {overallMasteryRate == null ? "暂无样本" : `${overallMasteryRate}%`}
            </p>
          </div>
          <Badge tone={overallMasteryRate == null ? "info" : overallMasteryRate >= 70 ? "success" : overallMasteryRate >= 45 ? "warning" : "info"}>
            综合掌握 {overallMasteryRate == null ? "暂无样本" : `${overallMasteryRate}%`}
          </Badge>
        </div>

        {/* Multi-Subject Stacked Bars + MiniRadar Layout */}
        <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-center">
          {/* Left: Stacked Progress Bars per Subject */}
          <div className="space-y-3 lg:col-span-7">
            {subjects.length > 0 ? (
              subjects.map((subj) => {
                const total = Math.max(subj.totalPoints, 1);
                const stablePct = (subj.stableCount / total) * 100;
                const learningPct = ((subj.initialCount + subj.learningCount) / total) * 100;
                const weakPct = (subj.weakCount / total) * 100;
                const untouchedPct = (subj.untouchedCount / total) * 100;

                return (
                  <div key={subj.subjectId} className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: subj.subjectColor || "#14b8a6" }}
                        />
                        <span className="font-medium text-white truncate">{subj.subjectName}</span>
                        <span className="text-[11px] text-zinc-500">({subj.totalPoints} 考点)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-teal-300">
                          {subj.masteryRate == null ? "暂无样本" : `${subj.masteryRate}%`}
                        </span>
                      </div>
                    </div>

                    {/* Stacked Bar */}
                    <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05] ring-1 ring-white/5">
                      {subj.stableCount > 0 ? (
                        <div
                          style={{ width: `${stablePct}%` }}
                          title={`稳固掌握: ${subj.stableCount} (${stablePct.toFixed(0)}%)`}
                          className="h-full bg-emerald-500 transition-all"
                        />
                      ) : null}
                      {subj.initialCount + subj.learningCount > 0 ? (
                        <div
                          style={{ width: `${learningPct}%` }}
                          title={`学习中: ${subj.initialCount + subj.learningCount} (${learningPct.toFixed(0)}%)`}
                          className="h-full bg-sky-500 transition-all"
                        />
                      ) : null}
                      {subj.weakCount > 0 ? (
                        <div
                          style={{ width: `${weakPct}%` }}
                          title={`待复测: ${subj.weakCount} (${weakPct.toFixed(0)}%)`}
                          className="h-full bg-amber-500 transition-all"
                        />
                      ) : null}
                      {subj.untouchedCount > 0 ? (
                        <div
                          style={{ width: `${untouchedPct}%` }}
                          title={`未触达: ${subj.untouchedCount} (${untouchedPct.toFixed(0)}%)`}
                          className="h-full bg-zinc-700/60 transition-all"
                        />
                      ) : null}
                    </div>

                    {/* Sub-counts row */}
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-[10px] text-zinc-400">
                      <span>稳固 {subj.stableCount}</span>
                      <span>学习 {subj.initialCount + subj.learningCount}</span>
                      <span>薄弱 {subj.weakCount}</span>
                      <span>未触达 {subj.untouchedCount}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-zinc-500">暂无科目考点数据</p>
            )}
          </div>

          {/* Right: Pure SVG MiniRadar */}
          <div className="flex flex-col items-center justify-center lg:col-span-5">
            <div className="relative flex items-center justify-center">
              <MiniRadar dimensions={radarDimensions} />
            </div>
            {/* Radar Mini Legend */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span>稳固</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-sky-500" />
                <span>学习</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-amber-500" />
                <span>薄弱</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-zinc-600" />
                <span>未触达</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Link */}
      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-zinc-400">
        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
          <ShieldCheck size={13} className="text-teal-400" aria-hidden />
          <span>考点状态随复测与专注结果实时演进</span>
        </span>
        <Link
          href="/knowledge/points"
          className="font-medium text-teal-300 hover:text-teal-200 transition-colors"
        >
          考点工作台 →
        </Link>
      </div>
    </Card>
  );
}

/**
 * Pure SVG 5-Axis Radar Component (Zero Dependencies)
 */
function MiniRadar({ dimensions }: { dimensions: RadarDimension[] }) {
  const size = 200;
  const center = size / 2;
  const radius = 62;
  const count = 5;

  const emptyDims: RadarDimension[] = [
    { label: "覆盖率", value: null },
    { label: "熟练度", value: null },
    { label: "留存率", value: null },
    { label: "复测率", value: null },
    { label: "深度", value: null },
  ];

  const activeDims = dimensions.length === count ? dimensions : emptyDims;
  const hasCompleteData = activeDims.every((dimension) => dimension.value != null);

  // Compute angles: top is -pi/2
  const angles = Array.from({ length: count }, (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / count);

  // Concentric polygon rings (25%, 50%, 75%, 100%)
  const rings = [0.25, 0.5, 0.75, 1.0];

  const ringPolygons = rings.map((scale) => {
    const r = radius * scale;
    return angles
      .map((a) => `${(center + r * Math.cos(a)).toFixed(1)},${(center + r * Math.sin(a)).toFixed(1)}`)
      .join(" ");
  });

  // Data polygon points
  const dataPoints = hasCompleteData ? angles.map((a, i) => {
    const val = activeDims[i]?.value ?? 0;
    const r = radius * Math.max(Math.min(val / 100, 1), 0.08);
    const x = center + r * Math.cos(a);
    const y = center + r * Math.sin(a);
    return { x, y, str: `${x.toFixed(1)},${y.toFixed(1)}`, val, label: activeDims[i]?.label ?? "" };
  }) : [];

  const dataPolygonString = dataPoints.map((p) => p.str).join(" ");

  return (
    <svg
      width={200}
      height={200}
      viewBox="0 0 200 200"
      className="overflow-visible select-none"
      role="img"
      aria-label="知识掌握度 5 维雷达图"
    >
      <defs>
        <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0.1" />
        </radialGradient>
      </defs>

      {/* Background Rings */}
      {ringPolygons.map((points, idx) => (
        <polygon
          key={idx}
          points={points}
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth="1"
        />
      ))}

      {/* Axis Lines */}
      {angles.map((a, idx) => {
        const x2 = center + radius * Math.cos(a);
        const y2 = center + radius * Math.sin(a);
        return (
          <line
            key={idx}
            x1={center}
            y1={center}
            x2={x2}
            y2={y2}
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth="1"
            strokeDasharray="2,2"
          />
        );
      })}

      {/* Data Polygon Fill & Outline */}
      {hasCompleteData ? (
        <polygon
          points={dataPolygonString}
          fill="url(#radarGradient)"
          stroke="#2dd4bf"
          strokeWidth="1.75"
          strokeLinejoin="round"
          className="transition-all duration-500"
        />
      ) : (
        <text x={center} y={center + 4} textAnchor="middle" className="fill-zinc-500 text-[10px]">
          暂无完整样本
        </text>
      )}

      {/* Data Vertex Dots */}
      {hasCompleteData ? dataPoints.map((p, idx) => (
        <circle
          key={idx}
          cx={p.x}
          cy={p.y}
          r="2.5"
          fill="#2dd4bf"
          stroke="#0e1619"
          strokeWidth="1"
        />
      )) : null}

      {/* Axis Labels */}
      {angles.map((a, idx) => {
        const labelRadius = radius + 15;
        const x = center + labelRadius * Math.cos(a);
        const y = center + labelRadius * Math.sin(a);
        const dim = activeDims[idx];
        return (
          <text
            key={idx}
            x={x}
            y={y + 3}
            textAnchor="middle"
            className="fill-zinc-400 text-[9.5px] font-medium"
          >
            {dim?.label} {dim?.value == null ? "-" : `${dim.value}%`}
          </text>
        );
      })}
    </svg>
  );
}
