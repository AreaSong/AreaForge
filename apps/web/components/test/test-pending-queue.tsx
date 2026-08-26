"use client";

import React from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileCheck2,
  Flame,
  Plus,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { CompactBadge } from "@/components/ui/micro-charts";
import type { PendingTestQueueItem } from "./test-support";

export interface TestPendingQueueProps {
  queue: PendingTestQueueItem[];
  className?: string;
}

export function TestPendingQueue({ queue, className = "" }: TestPendingQueueProps) {
  const hasItems = queue.length > 0;
  const overdueCount = queue.filter((i) => i.dueStatus === "overdue").length;
  const draftCount = queue.filter((i) => i.dueStatus === "draft_pending").length;

  return (
    <Card
      variant="master"
      className={`p-3.5 sm:p-4 bg-[#0e1619]/90 border border-white/10 flex flex-col justify-between ${className}`.trim()}
    >
      <div>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300">
              <Zap size={15} aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">今日待测与待收口队列</h2>
                {hasItems ? (
                  <Badge tone={overdueCount > 0 ? "warning" : "neutral"} className="font-mono">
                    {queue.length} 项待办
                  </Badge>
                ) : null}
              </div>
              <p className="text-[11px] text-zinc-400">
                到期专项复测与未收口全真模考的即时行动中心
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {overdueCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-400 font-mono">
                <Flame size={13} className="animate-pulse" />
                {overdueCount} 项已逾期
              </span>
            ) : null}

            {draftCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-mono">
                <Clock size={13} />
                {draftCount} 场模考待确认
              </span>
            ) : null}
          </div>
        </div>

        {/* Queue Items List */}
        {hasItems ? (
          <div className="mt-3 space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {queue.map((item) => {
              const isRetest = item.kind === "retest";

              return (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 hover:border-teal-400/30 hover:bg-white/[0.04] transition-all"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {/* Item Kind Icon */}
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-md mt-0.5 ${
                        isRetest
                          ? "border border-teal-500/20 bg-teal-500/10 text-teal-300"
                          : "border border-amber-500/20 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {isRetest ? (
                        <ClipboardCheck size={14} aria-hidden="true" />
                      ) : (
                        <FileCheck2 size={14} aria-hidden="true" />
                      )}
                    </span>

                    {/* Title & Metadata */}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Due Badge */}
                        <CompactBadge
                          tone={
                            item.dueStatus === "overdue"
                              ? "rose"
                              : item.dueStatus === "in_progress"
                                ? "teal"
                                : item.dueStatus === "draft_pending"
                                  ? "amber"
                                  : "sky"
                          }
                          size="xs"
                        >
                          {item.dueText}
                        </CompactBadge>

                        {/* Title */}
                        <h4 className="text-xs font-semibold text-zinc-200 group-hover:text-teal-200 transition-colors truncate max-w-[220px] sm:max-w-[320px]">
                          {isRetest ? item.title : item.name}
                        </h4>
                      </div>

                      {/* Sub metadata */}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                        {isRetest ? (
                          <>
                            <span>{item.method}</span>
                            <span>·</span>
                            <span>{item.pointCount} 个知识点</span>
                            {item.pointTitles.length > 0 ? (
                              <span className="truncate text-zinc-500 max-w-[180px]">
                                ({item.pointTitles.slice(0, 2).join(", ")}
                                {item.pointTitles.length > 2 ? "..." : ""})
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span>全真模考</span>
                            <span>·</span>
                            <span>{item.subjectCount} 科成绩已录入</span>
                            <span>·</span>
                            <span className="text-amber-400/90">待完成失分分析与事实冻结</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 1-Click Instant Action CTA Button */}
                  <div className="flex items-center justify-end shrink-0 sm:self-center pt-1 sm:pt-0 border-t border-white/5 sm:border-t-0">
                    <Link
                      href={item.actionUrl}
                      className="inline-flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/10 px-2.5 py-1 text-xs font-medium text-teal-300 hover:bg-teal-500/20 hover:border-teal-400/50 hover:shadow-[0_0_12px_rgba(45,212,191,0.2)] transition-all"
                      aria-label={`${item.actionLabel} ${isRetest ? item.title : item.name}`}
                    >
                      <span>{item.actionLabel}</span>
                      <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="my-6 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-5 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-400" aria-hidden="true" />
            <h3 className="mt-2 text-xs font-medium text-zinc-300">今日待测队列已清空</h3>
            <p className="mt-1 text-[11px] text-zinc-500 max-w-xs mx-auto">
              当前没有逾期或今日到期的专项复测，也没有未收口的模考草稿。
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <Link
                href="/test/retests/new"
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 transition-colors"
              >
                <Plus size={12} />
                <span>安排新复测</span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Footer info & Quick Gateway Links */}
      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-zinc-500">
        <span>检验规则：复测更新知识点掌握状态，模考验证整体实力</span>
        <div className="flex items-center gap-3 font-medium text-zinc-400">
          <Link href="/test/retests" className="hover:text-teal-300 transition-colors">
            全部复测 →
          </Link>
          <Link href="/test/simulations" className="hover:text-teal-300 transition-colors">
            全部模考 →
          </Link>
        </div>
      </div>
    </Card>
  );
}
