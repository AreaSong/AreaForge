"use client";

import type React from "react";
import {
  Clock3,
  Moon,
  Pause,
  RefreshCw,
  Square,
  Zap,
} from "lucide-react";
import type {
  DynamicIslandActiveItem,
  DynamicIslandCapsuleKind,
  DynamicIslandCapsuleState,
  DynamicIslandStateKind,
} from "./dynamic-island-types";
import { getSatelliteBubbleGlowClass } from "./dynamic-island-glow";

export interface SatelliteBubbleProps {
  satelliteItem?: DynamicIslandActiveItem | null;
  satelliteState?: DynamicIslandCapsuleState | null;
  onSwapFluidFocus?: (kind: DynamicIslandCapsuleKind | DynamicIslandStateKind) => void;
  onSwap?: () => void;
  className?: string;
  animationClass?: string;
}

export function SatelliteBubble({
  satelliteItem,
  satelliteState,
  onSwapFluidFocus,
  onSwap,
  className,
  animationClass,
}: SatelliteBubbleProps) {
  const item = satelliteItem;
  const kind: DynamicIslandCapsuleKind = item?.kind ?? satelliteState?.kind ?? "idle";
  if (kind === "idle" && !item && !satelliteState) return null;

  const session = item?.session ?? satelliteState?.session;
  const stage = item?.stage ?? satelliteState?.stage ?? 1;
  const pendingCount =
    item?.pendingConfirmationsCount ?? satelliteState?.pendingConfirmationsCount ?? 0;

  const glowClass = getSatelliteBubbleGlowClass(kind);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSwapFluidFocus?.(kind);
    onSwap?.();
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    onSwapFluidFocus?.(kind);
    onSwap?.();
  };

  const tooltipText = (() => {
    if (item?.title) return `${item.title} (点击对调为主焦点)`;
    if (kind === "live_session_running") return `⏱ ${session?.subjectName || "专注学习"} 进行中，点击切换为主视角`;
    if (kind === "live_session_closing") return "待收口沉淀，点击切换为主视角";
    if (kind === "activity_paused") return `⏸ ${session?.subjectName || "专注学习"} 暂停中，点击切换为主视角`;
    if (kind === "recovery_active") return `⚡ 精力恢复第${stage}阶，点击切换为主视角`;
    if (kind === "evening_review_due") return "🌙 晚间复盘待收口，点击切换为主视角";
    if (kind === "sync_issue") return "离线待对账，点击切换为主视角";
    if (kind === "confirmations_pending") return `${pendingCount}项待确认，点击切换为主视角`;
    return "点击切换焦点";
  })();

  const renderIcon = () => {
    switch (kind) {
      case "live_session_running":
        return <Clock3 size={15} className="text-teal-300 animate-pulse shrink-0" />;
      case "live_session_closing":
        return <Square size={13} className="text-emerald-300 fill-emerald-300/40 shrink-0" />;
      case "activity_paused":
        return <Pause size={13} className="text-amber-300 fill-amber-300/40 shrink-0" />;
      case "recovery_active":
        return <Zap size={15} className="text-amber-400 animate-pulse fill-amber-400/40 shrink-0" />;
      case "evening_review_due":
        return <Moon size={15} className="text-indigo-300 fill-indigo-400/30 shrink-0" />;
      case "sync_issue":
        return <RefreshCw size={13} className="text-amber-400 animate-spin shrink-0" />;
      case "confirmations_pending":
        return pendingCount > 0 ? (
          <span className="text-[11px] font-bold text-amber-300 leading-none">{pendingCount}</span>
        ) : (
          <Zap size={13} className="text-amber-300 shrink-0" />
        );
      case "idle":
      default:
        return <span className="size-2 rounded-full bg-white/60" />;
    }
  };

  return (
    <div
      onClick={handleClick}
      onWheel={handleWheel}
      role="button"
      tabIndex={0}
      title={tooltipText}
      aria-label={tooltipText}
      className={`size-9 sm:size-[38px] rounded-full shrink-0 flex items-center justify-center cursor-pointer select-none bg-[#090e12]/98 backdrop-blur-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 ${glowClass} ${animationClass ?? ""} ${className ?? ""}`}
    >
      {renderIcon()}
    </div>
  );
}
