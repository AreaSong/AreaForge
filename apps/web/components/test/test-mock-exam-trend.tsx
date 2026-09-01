"use client";

import React, { useId, useState } from "react";
import { ArrowUpRight, BarChart3, CheckCircle2, ChevronRight, HelpCircle, Layers, Target, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { MiniSparkline, StatusDot } from "@/components/ui/micro-charts";
import { formatDate } from "@/lib/formatters";
import type { MockExamTrendPoint, MockExamTrendSummary } from "./test-support";

export interface TestMockExamTrendProps {
  trend: MockExamTrendSummary;
  className?: string;
}

export function TestMockExamTrend({ trend, className = "" }: TestMockExamTrendProps) {
  const gradientId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { points, maxScore, latestDelta, avgDelta, targetPassRate } = trend;
  const hasData = points.length > 0;

  // Selected or latest exam for subject breakdown inspection
  const activeExam: MockExamTrendPoint | undefined =
    hoveredIndex !== null ? points[hoveredIndex] : points[points.length - 1];

  // SVG Chart Dimensions
  const chartWidth = 560;
  const chartHeight = 160;
  const padX = 24;
  const padY = 20;

  // Calculate SVG coordinates
  const getY = (val: number) => {
    const range = Math.max(10, maxScore);
    return chartHeight - padY - (Math.max(0, val) / range) * (chartHeight - 2 * padY);
  };

  const getX = (index: number) => {
    if (points.length <= 1) return chartWidth / 2;
    return padX + (index / (points.length - 1)) * (chartWidth - 2 * padX);
  };

  // Generate Actual Score Points & Area
  const actualPolyline = points.map((p, i) => `${getX(i)},${getY(p.actualScore)}`).join(" ");
  const targetPolyline = points.map((p, i) => `${getX(i)},${getY(p.targetScore)}`).join(" ");

  const actualAreaPath =
    points.length > 1
      ? `M ${getX(0)},${getY(points[0].actualScore)} ` +
        points.slice(1).map((p, i) => `L ${getX(i + 1)},${getY(p.actualScore)}`).join(" ") +
        ` L ${getX(points.length - 1)},${chartHeight - padY} L ${getX(0)},${chartHeight - padY} Z`
      : "";

  // Full score baseline (default 500 or maximum full score)
  const fullScoreBaseline = points[0]?.fullScore || 500;
  const fullScoreY = getY(fullScoreBaseline);

  return (
    <Card
      variant="master"
      className={`p-3.5 sm:p-4 bg-[#0e1619]/90 border border-white/10 flex flex-col justify-between ${className}`.trim()}
    >
      {/* 1. Header with Title, Delta Pill & Pass Rate */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md border border-teal-500/30 bg-teal-500/10 text-teal-300">
              <TrendingUp size={15} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">模考得分轨迹与达标分析</h2>
              <p className="text-[11px] text-zinc-400">
                全真模拟考试实际得分与目标分数线对比及分科表现
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {targetPassRate !== null ? (
              <span className="inline-flex items-center gap-1 rounded border border-teal-500/20 bg-teal-400/10 px-2 py-0.5 text-xs font-mono font-medium text-teal-300">
                <CheckCircle2 size={12} className="text-teal-400" />
                目标达标率 {targetPassRate}%
              </span>
            ) : null}

            {latestDelta !== null ? (
              <span
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-mono font-medium ${
                  latestDelta >= 0
                    ? "border-emerald-500/20 bg-emerald-400/10 text-emerald-300"
                    : "border-rose-500/20 bg-rose-500/10 text-rose-300"
                }`}
              >
                最新差值 {latestDelta >= 0 ? `+${latestDelta}` : latestDelta} 分
              </span>
            ) : null}

            <Link
              href="/test/simulations"
              className="inline-flex items-center gap-0.5 text-xs text-zinc-400 hover:text-teal-300 transition-colors"
            >
              <span>模考中心</span>
              <ChevronRight size={14} />
            </Link>
          </div>
        </div>

        {/* 2. Main SVG Trendline & Area Chart */}
        {hasData ? (
          <div className="mt-3 relative">
            {/* Macro Legends */}
            <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-zinc-400 px-1 mb-1">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-0.5 bg-teal-400 rounded-full" />
                  <span className="text-teal-300">实际得分</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-0.5 border-b border-amber-400 border-dashed" />
                  <span className="text-amber-300">目标分数</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-0.5 border-b border-zinc-600 border-dotted" />
                  <span className="text-zinc-500">满分线 ({fullScoreBaseline}分)</span>
                </span>
              </div>
              <span>
                {activeExam
                  ? `${formatDate(activeExam.examDate)} · ${activeExam.name}`
                  : "悬停数据点查看明细"}
              </span>
            </div>

            {/* SVG Visual Canvas */}
            <div className="w-full overflow-hidden rounded-lg border border-white/5 bg-black/40 p-2">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-auto overflow-visible select-none"
                role="img"
                aria-label="模考历史得分趋势折线与面积图"
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.02} />
                  </linearGradient>
                </defs>

                {/* Grid guidelines */}
                <line
                  x1={padX}
                  y1={fullScoreY}
                  x2={chartWidth - padX}
                  y2={fullScoreY}
                  stroke="rgba(255, 255, 255, 0.12)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
                <text
                  x={chartWidth - padX}
                  y={fullScoreY - 4}
                  fill="#71717a"
                  fontSize="9"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  满分 {fullScoreBaseline}
                </text>

                {/* Target Baseline */}
                {points.length > 1 ? (
                  <polyline
                    points={targetPolyline}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                    strokeOpacity="0.85"
                  />
                ) : (
                  <line
                    x1={padX}
                    y1={getY(points[0].targetScore)}
                    x2={chartWidth - padX}
                    y2={getY(points[0].targetScore)}
                    stroke="#fbbf24"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                  />
                )}

                {/* Actual Area Gradient */}
                {actualAreaPath ? <path d={actualAreaPath} fill={`url(#${gradientId})`} /> : null}

                {/* Actual Line */}
                {points.length > 1 ? (
                  <polyline
                    points={actualPolyline}
                    fill="none"
                    stroke="#2dd4bf"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <line
                    x1={padX}
                    y1={getY(points[0].actualScore)}
                    x2={chartWidth - padX}
                    y2={getY(points[0].actualScore)}
                    stroke="#2dd4bf"
                    strokeWidth="2"
                  />
                )}

                {/* Interactive Points */}
                {points.map((p, i) => {
                  const cx = getX(i);
                  const cy = getY(p.actualScore);
                  const targetCy = getY(p.targetScore);
                  const isHovered = hoveredIndex === i;

                  return (
                    <g
                      key={p.id}
                      className="cursor-pointer transition-transform"
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${p.name}: 实际 ${p.actualScore}分, 目标 ${p.targetScore}分`}
                    >
                      {/* Target node dot */}
                      <circle
                        cx={cx}
                        cy={targetCy}
                        r="2.5"
                        fill="#fbbf24"
                        opacity={isHovered ? 1 : 0.6}
                      />

                      {/* Actual node dot with glow */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isHovered ? "6" : "4"}
                        fill="#2dd4bf"
                        opacity={isHovered ? 0.4 : 0.2}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isHovered ? "3.5" : "2.5"}
                        fill="#2dd4bf"
                        stroke="#0e1619"
                        strokeWidth="1"
                      />

                      {/* Text label for score */}
                      <text
                        x={cx}
                        y={cy - 7}
                        fill={isHovered ? "#5eead4" : "#e4e4e7"}
                        fontSize={isHovered ? "11" : "9"}
                        fontWeight={isHovered ? "bold" : "normal"}
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {p.actualScore}分
                      </text>

                      {/* Date label at bottom */}
                      <text
                        x={cx}
                        y={chartHeight - 4}
                        fill="#71717a"
                        fontSize="8.5"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {formatDate(p.examDate).slice(5)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        ) : (
          <div className="my-4 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-5 text-center">
            <BarChart3 className="mx-auto h-7 w-7 text-zinc-500" aria-hidden="true" />
            <h3 className="mt-2 text-xs font-medium text-zinc-300">暂无已确认模考历史数据</h3>
            <p className="mt-1 text-[11px] text-zinc-500 max-w-sm mx-auto">
              完成首场全真模考并确认事实后，系统将自动在此绘制满分基准线、目标分数线及分科得分轨迹。
            </p>
            <div className="mt-3">
              <Link
                href="/test/simulations"
                className="inline-flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300 hover:bg-teal-500/20"
              >
                <span>创建全真模考</span>
                <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* 3. Sub-Scores Breakdown for the Active Exam */}
      {activeExam && activeExam.subjectScores.length > 0 ? (
        <div className="mt-3 border-t border-white/5 pt-2.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Layers size={13} className="text-zinc-500" />
              <span>
                分科成绩构成 · <strong>{activeExam.name}</strong>
              </span>
            </span>
            <span className="font-mono text-zinc-400">
              总得分: <strong className="text-teal-300 font-semibold">{activeExam.actualScore}</strong> / {activeExam.fullScore}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {activeExam.subjectScores.map((sub, idx) => {
              const subDelta = sub.actualScore - sub.targetScore;
              return (
                <div
                  key={idx}
                  className="flex flex-col justify-between rounded border border-white/5 bg-white/[0.02] p-2 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium text-zinc-300">
                      {sub.subjectName}
                    </span>
                    <span
                      className={`text-[10px] font-mono ${
                        subDelta >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {subDelta >= 0 ? `+${subDelta}` : subDelta}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-1">
                    <span className="text-sm font-bold font-mono text-white">
                      {sub.actualScore}
                      <span className="text-[10px] font-normal text-zinc-500">/{sub.paperFullScore}</span>
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      目: {sub.targetScore}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
