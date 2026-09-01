"use client";

import type React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GlobalCommandAction } from "@/lib/navigation/command-palette";
import type {
  DynamicIslandAuraTheme,
  DynamicIslandEveningReviewProps,
} from "./dynamic-island-types";

export function HubConfirmationClosureGuide(props: {
  pendingConfirmationsCount?: number;
  eveningReview?: DynamicIslandEveningReviewProps | null;
  onOpenAction?: (action: GlobalCommandAction) => void;
  onClose: () => void;
  auraTheme?: DynamicIslandAuraTheme;
}) {
  const {
    pendingConfirmationsCount = 0,
    eveningReview,
    onOpenAction,
    onClose,
  } = props;

  return (
    <div className="flex flex-col gap-3 py-1 text-xs">
      {pendingConfirmationsCount > 0 ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck2 size={15} className="text-amber-400" />
              <span className="font-semibold text-amber-200">
                待确认中心决策
              </span>
            </div>
            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
              {pendingConfirmationsCount} 项待处理
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed">
            阶段建议、AI
            报告、专项复测与模拟考试结果统一在此汇聚，等待你的最终审核与确认。
          </p>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onClose();
                onOpenAction?.("confirmation-center");
              }}
              className="flex h-7 items-center !gap-1.5 rounded bg-amber-400 text-[#071011] !px-3 font-semibold hover:bg-amber-300 text-xs shadow-[0_0_8px_rgba(251,191,36,0.2)]"
            >
              <span>打开确认中心</span>
              <ArrowRight size={11} />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-indigo-400/30 bg-indigo-400/10 p-3">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <Moon size={15} className="text-indigo-300 fill-indigo-400/20" />
            <span className="font-semibold text-indigo-200">晚间收口指引</span>
          </div>
          <span className="text-[11px] text-zinc-400 font-mono">
            20:00 每日闭环
          </span>
        </div>
        <div className="mt-2.5 space-y-1.5 rounded-md border border-white/5 bg-white/[0.02] p-2">
          <div className="flex items-center justify-between text-zinc-300">
            <span>最低有效行动</span>
            {eveningReview?.minimumActionDone ? (
              <span className="flex items-center gap-1 text-teal-300 font-medium">
                <CheckCircle2 size={12} />
                已达成
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-300 font-medium">
                <AlertCircle size={12} />
                待完成
              </span>
            )}
          </div>
          <div className="flex items-center justify-between text-zinc-300">
            <span>今日每日复盘</span>
            {eveningReview?.dailyReviewDone ? (
              <span className="flex items-center gap-1 text-teal-300 font-medium">
                <CheckCircle2 size={12} />
                已提交
              </span>
            ) : (
              <span className="flex items-center gap-1 text-indigo-300 font-medium">
                <Clock3 size={12} />
                待沉淀
              </span>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex justify-end">
          <Link
            href={eveningReview?.reviewHref || "/roadmap/reviews/daily"}
            onClick={onClose}
            className="flex h-7 items-center gap-1.5 rounded bg-indigo-500/30 border border-indigo-400/50 text-indigo-100 px-3 font-semibold hover:bg-indigo-500/40 transition-colors text-xs"
          >
            <span>前往每日复盘</span>
            <ArrowRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}
