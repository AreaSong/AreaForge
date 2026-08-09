"use client";

import { Activity, TriangleAlert } from "lucide-react";
import { useWindowSystem } from "@/components/window-system";
import { BrandMark } from "@/components/brand-logo";
import { GlobalActivitySlot } from "@/components/global-activity-slot";
import { GlobalAiAssistant } from "@/components/global-ai-assistant";
import { GlobalConfirmationCenter } from "@/components/global-confirmation-center";
import { GlobalQuickCreate } from "@/components/global-quick-create";
import { GlobalCommandPalette } from "@/components/global-command-palette";
import type { GlobalCommandAction } from "@/lib/navigation/command-palette";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { StudySessionDto } from "@/lib/study/types";

const toneClass: Record<string, string> = {
  gray: "border-zinc-600 text-zinc-400",
  blue: "border-sky-400/50 text-sky-200",
  green: "border-emerald-400/50 text-emerald-200",
  amber: "border-amber-400/50 text-amber-200",
  red: "border-red-400/50 text-red-200",
};

export function GlobalTopBar(props: {
  pathname: string;
  userId: string;
  statusTone: string;
  statusSummary: string;
  activeSession: StudySessionDto | null;
  offlineSession: StudySessionDto | null;
  quickReviewClaim: QuickReviewActivityClaim | null;
  onOpenStatus: () => void;
  statusOpen: boolean;
  onOpenMotivationHelp: () => void;
}) {
  const { openWindow } = useWindowSystem();
  const statusToneClass = toneClass[props.statusTone] ?? toneClass.gray;
  const hasActivity = Boolean(props.activeSession || props.offlineSession || props.quickReviewClaim);

  function handleGlobalAction(action: GlobalCommandAction) {
    if (action === "recovery-help") {
      props.onOpenMotivationHelp();
      return;
    }
    openWindow(actionToWindowKey(action));
  }

  return (
    <header
      className="af-shell-header z-[var(--af-layer-shell-base)] shrink-0 border-b border-white/10 bg-[color:var(--af-canvas)]/95 px-4 py-3 backdrop-blur max-[359px]:px-2 max-[359px]:py-2 sm:px-6 xl:px-8"
      data-layout-region="global-top-bar"
      data-global-ai-ui="true"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:gap-3 lg:grid-cols-[minmax(13rem,1fr)_minmax(14rem,2fr)_auto]">
        <div className="flex min-w-0 items-center gap-2 max-[359px]:col-span-2 max-[359px]:row-start-1">
          <div className="flex shrink-0 items-center gap-2 lg:hidden max-[359px]:hidden">
            <BrandMark size={20} />
            <span className="hidden text-sm text-teal-300 min-[360px]:inline">AreaForge</span>
          </div>
          <div className="min-w-0 flex-1 lg:flex lg:items-center">
            {hasActivity ? (
              <GlobalActivitySlot
                activeSession={props.activeSession}
                offlineSession={props.offlineSession}
                quickReviewClaim={props.quickReviewClaim}
              />
            ) : (
              <button
                type="button"
                className="inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-xs text-zinc-200 hover:bg-white/[0.07] sm:px-3"
                onClick={props.onOpenStatus}
                aria-label={`今日状态：${accessibleSummary(props.statusSummary)}`}
                aria-expanded={props.statusOpen}
              >
                <Activity size={15} className={statusToneClass} aria-hidden="true" />
                <span className="shrink-0">今日状态</span>
                <span className="max-w-52 truncate text-zinc-500">{props.statusSummary}</span>
              </button>
            )}
          </div>
        </div>

        <div className="col-span-2 row-start-2 min-w-0 max-[359px]:col-span-1 max-[359px]:col-start-1 max-[359px]:row-start-2 max-[359px]:w-9 lg:col-span-1 lg:col-start-2 lg:row-start-1">
          <GlobalCommandPalette
            trigger={<span className="text-zinc-500">搜索或输入命令…</span>}
            triggerLabel="打开全局搜索和命令面板"
            onOpenAction={handleGlobalAction}
            compactOnNarrow
          />
        </div>

        <div className="col-start-2 row-start-1 flex min-w-0 shrink-0 items-center justify-end gap-1 max-[359px]:col-span-1 max-[359px]:col-start-2 max-[359px]:row-start-2 sm:gap-1.5 lg:col-start-3 lg:row-start-1">
          <GlobalConfirmationCenter pathname={props.pathname} userId={props.userId} />
          <GlobalAiAssistant userId={props.userId} placement="header" />
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 hover:bg-white/5 max-[359px]:w-9 max-[359px]:justify-center max-[359px]:px-0 sm:px-3"
            onClick={props.onOpenMotivationHelp}
            aria-label="我学不下去了"
            title="我学不下去了"
          >
            <TriangleAlert size={16} aria-hidden="true" />
            <span className="hidden xl:inline">我学不下去了</span>
          </button>
          {/* 快捷创建固定为全局工具组的最后一个入口。 */}
          <GlobalQuickCreate />
        </div>
      </div>
    </header>
  );
}

function actionToWindowKey(action: Exclude<GlobalCommandAction, "recovery-help">): string {
  if (action === "confirmation-center") return "confirmation-center";
  if (action === "ai-assistant") return "ai-assistant";
  return "quick-create";
}

function accessibleSummary(summary: string): string {
  return summary.replace(/，可继续$/, "");
}
