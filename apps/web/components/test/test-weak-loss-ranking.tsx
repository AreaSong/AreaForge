"use client";

import React, { useState } from "react";
import { BookOpen, ChevronRight, PieChart, Zap } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CompactBadge } from "@/components/ui/micro-charts";
import {
  getLossReasonMeta,
  type LossReasonDistributionSummary,
  type WeakModuleLossRankItem,
} from "./test-support";

export interface TestWeakLossRankingProps {
  rankings: WeakModuleLossRankItem[];
  distribution: LossReasonDistributionSummary;
  className?: string;
}

export function TestWeakLossRanking({
  rankings,
  distribution,
  className = "",
}: TestWeakLossRankingProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  const hasRankings = rankings.length > 0;
  const hasDistribution = distribution.items.length > 0;

  return (
    <div className={`@container grid grid-cols-1 gap-4 @[64rem]:grid-cols-12 ${className}`.trim()}>
      {/* 1. Left Panel: Weak Module Loss Ranking Table (7 cols on @[64rem]) */}
      <Card
        variant="master"
        className="@[64rem]:col-span-7 p-4 sm:p-5 bg-[#0e1619]/90 border border-white/10 flex flex-col justify-between"
      >
        <div>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-white">薄弱模块失分排行榜</h2>
              <p className="text-[11px] text-zinc-400">
                按模考丢分严重程度排序的 Top 5 重点突破考点
              </p>
            </div>

            <Link
              href="/test/retests/new"
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-300 hover:text-teal-200 transition-colors"
            >
              <Zap size={13} />
              <span>安排针对性复测</span>
            </Link>
          </div>

          {/* Table / List */}
          {hasRankings ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] font-mono text-zinc-500">
                    <th className="pb-2 pl-1 w-7">#</th>
                    <th className="pb-2 font-medium">考点 / 模块名称</th>
                    <th className="pb-2 font-medium w-14 sm:w-16">科目</th>
                    <th className="pb-2 font-medium text-right w-18 sm:w-20">累计失分</th>
                    <th className="pb-2 font-medium text-center w-16 sm:w-18">主要死因</th>
                    <th className="pb-2 font-medium text-right pr-1 w-14 sm:w-16">动作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-sans">
                  {rankings.map((item) => {
                    const rankTone =
                      item.rank === 1
                        ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                        : item.rank === 2
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : item.rank === 3
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : "bg-white/5 text-zinc-400 border-white/10";

                    return (
                      <tr
                        key={item.id}
                        className="group hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Rank Badge */}
                        <td className="py-2.5 pl-1">
                          <span
                            className={`inline-flex size-5 items-center justify-center rounded text-[11px] font-bold font-mono border ${rankTone}`}
                          >
                            {item.rank}
                          </span>
                        </td>

                        {/* Title & Notes */}
                        <td className="py-2.5 pr-2 min-w-0">
                          <div className="font-medium text-zinc-200 group-hover:text-white transition-colors truncate">
                            {item.title}
                          </div>
                          {item.notes[0] ? (
                            <div className="text-[10px] text-zinc-500 truncate">
                              {item.notes[0]}
                            </div>
                          ) : (
                            <div className="text-[10px] text-zinc-500">
                              共暴露 {item.lossCount} 次失误
                            </div>
                          )}
                        </td>

                        {/* Subject */}
                        <td className="py-2.5">
                          <span className="inline-block rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-300 font-mono">
                            {item.subjectName}
                          </span>
                        </td>

                        {/* Lost Score */}
                        <td className="py-2.5 text-right font-mono">
                          <span className="inline-block font-bold text-rose-400">
                            -{item.totalLostScore}
                          </span>
                          <span className="text-[10px] text-zinc-500 ml-0.5">分</span>
                        </td>

                        {/* Primary Reason Badge */}
                        <td className="py-2.5 text-center">
                          <CompactBadge
                            tone={getLossReasonMeta(item.primaryReason).tone}
                            size="xs"
                          >
                            {item.primaryReasonLabel}
                          </CompactBadge>
                        </td>

                        {/* Action Link */}
                        <td className="py-2.5 pr-1 text-right">
                          <Link
                            href={`/test/retests/new?title=${encodeURIComponent(
                              `针对性复测: ${item.title}`,
                            )}`}
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-teal-300 hover:text-teal-200 hover:underline"
                            aria-label={`为 ${item.title} 安排复测`}
                          >
                            <span>复测</span>
                            <ChevronRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="my-6 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-5 text-center">
              <BookOpen className="mx-auto h-7 w-7 text-zinc-500" aria-hidden="true" />
              <h3 className="mt-2 text-xs font-medium text-zinc-300">暂无失分考点归因记录</h3>
              <p className="mt-1 text-[11px] text-zinc-500 max-w-xs mx-auto">
                在模拟考试中录入分科丢分和考点关联后，这里将自动呈现丢分最严重的薄弱考点排行榜。
              </p>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-zinc-500">
          <span>高分攻坚策略：针对前 3 名薄弱考点安排闭环复测</span>
          <Link href="/test/retests" className="text-zinc-400 hover:text-teal-300 transition-colors">
            查看历史复测记录 →
          </Link>
        </div>
      </Card>

      {/* 2. Right Panel: Loss Reason Distribution Bar & Legend (5 cols on @[64rem]) */}
      <Card
        variant="master"
        className="@[64rem]:col-span-5 p-4 sm:p-5 bg-[#0e1619]/90 border border-white/10 flex flex-col justify-between"
      >
        <div>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-white">失分原因结构分布</h2>
              <p className="text-[11px] text-zinc-400">
                全真模拟考丢分溯源比例（概念/计算/时间等）
              </p>
            </div>

            <span className="text-[11px] font-mono text-zinc-400">
              累计失分 <strong className="text-rose-400 font-bold">-{distribution.totalLostScore}</strong> 分
            </span>
          </div>

          {/* Segmented Distribution Bar */}
          {hasDistribution ? (
            <div className="mt-3 space-y-3">
              {/* Segmented Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5 gap-0.5 p-0.5 border border-white/10">
                  {distribution.items.map((item) => {
                    const isSelected = selectedReason === item.reason;
                    return (
                      <div
                        key={item.reason}
                        style={{
                          width: `${Math.max(4, item.percentage)}%`,
                          backgroundColor: item.meta.color,
                        }}
                        className={`h-full rounded-full transition-all duration-200 cursor-pointer ${
                          isSelected ? "ring-2 ring-white scale-y-110 shadow-lg" : "hover:opacity-90"
                        }`}
                        title={`${item.meta.shortLabel}: -${item.totalLostScore}分 (${item.percentage}%)`}
                        onClick={() =>
                          setSelectedReason(selectedReason === item.reason ? null : item.reason)
                        }
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>共归因 {distribution.totalLossItemsCount} 条失误事实</span>
                  <span>100% 全量占比</span>
                </div>
              </div>

              {/* Loss Reason Breakdown List */}
              <div className="divide-y divide-white/5">
                {distribution.items.map((item) => {
                  const isSelected = selectedReason === item.reason;
                  return (
                    <div
                      key={item.reason}
                      className={`flex items-center justify-between py-2 cursor-pointer transition-colors px-1 rounded ${
                        isSelected ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                      }`}
                      onClick={() =>
                        setSelectedReason(selectedReason === item.reason ? null : item.reason)
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: item.meta.color }}
                        />
                        <span className="text-xs text-zinc-300 truncate font-medium">
                          {item.meta.shortLabel}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {item.itemCount}次
                        </span>
                      </div>

                      <div className="flex items-center gap-3 font-mono">
                        <span className="text-xs font-semibold text-rose-400">
                          -{item.totalLostScore}分
                        </span>
                        <span className="text-[11px] text-zinc-400 w-12 text-right">
                          {item.percentage}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="my-6 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-5 text-center">
              <PieChart className="mx-auto h-7 w-7 text-zinc-500" aria-hidden="true" />
              <h3 className="mt-2 text-xs font-medium text-zinc-300">暂无失分分类结构数据</h3>
              <p className="mt-1 text-[11px] text-zinc-500 max-w-xs mx-auto">
                在模拟考试中针对每道错题标记「概念漏洞」「计算失误」「时间失控」等原因后生成分布图谱。
              </p>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-zinc-500">
          <span>死因归类驱动针对性复习</span>
          <Link href="/test/simulations" className="text-zinc-400 hover:text-teal-300 transition-colors">
            去模考完善归因 →
          </Link>
        </div>
      </Card>
    </div>
  );
}
