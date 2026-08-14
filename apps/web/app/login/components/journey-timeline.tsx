"use client";

import type { CSSProperties } from "react";
import React, { useRef } from "react";
import { Check, Sparkles } from "lucide-react";
import { LEARNING_LOOP_NODES } from "../constants/learning-loop";

interface JourneyTimelineProps {
  activeNodeIndex: number;
  globalProgress: number;
  isPlaying: boolean;
  paused: boolean;
  reducedMotion: boolean;
  onNodeSelect: (index: number) => void;
  onAutoPlayChange: (playing: boolean) => void;
  onProgressScrub?: (progress: number) => void;
}

export function JourneyTimeline({
  activeNodeIndex,
  globalProgress,
  paused = false,
  onNodeSelect,
  onProgressScrub,
}: JourneyTimelineProps) {
  const current = LEARNING_LOOP_NODES[activeNodeIndex] || LEARNING_LOOP_NODES[0];
  const progressBarRef = useRef<HTMLDivElement>(null);

  const clampedProgress = Math.min(1, Math.max(0, globalProgress));
  const progressPercent = clampedProgress * 100;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !onProgressScrub) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newProgress = Math.max(0, Math.min(1, clickX / rect.width));
    onProgressScrub(newProgress);
  };

  return (
    <nav
      aria-label="学习闭环连续时间轴"
      className="relative mt-5 rounded-xl border border-white/[0.08] bg-[#18191c]/80 p-4 backdrop-blur-md transition-all sm:p-5 shadow-lg"
    >
      {/* Top Status & Controls Row */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full animate-pulse"
              style={{ backgroundColor: current.accent }}
            />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
              阶段 {String(current.step).padStart(2, "0")} / 06
            </span>
          </div>
          <span className="hidden sm:inline text-zinc-600">|</span>
          <span className="hidden sm:inline text-xs text-zinc-300 font-medium">
            {current.navTitle} · {current.outputValue}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Progress Readout */}
          <span className="font-mono text-xs font-bold text-teal-400">
            {progressPercent.toFixed(1)}%
          </span>
          <span className="size-1.5 rounded-full bg-teal-400 animate-ping" />
        </div>
      </div>

      {/* Continuous GPU-Accelerated Progress Track */}
      <div
        ref={progressBarRef}
        onClick={handleTrackClick}
        className="group/track relative my-4 h-2 w-full cursor-pointer rounded-full bg-white/[0.06] overflow-hidden"
        title="点击时间轴任意位置快速跳转"
      >
        {/* GPU Hardware Accelerated Progress Bar */}
        <div
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-blue-500 via-teal-400 to-purple-400 will-change-transform"
          style={{ transform: `scaleX(${clampedProgress})` }}
        />
      </div>

      {/* 6 Interactive Stage Selector Nodes */}
      <ol className="relative grid grid-cols-6 gap-2">
        {LEARNING_LOOP_NODES.map((node, index) => {
          const Icon = node.icon;
          const isActive = index === activeNodeIndex;
          const isComplete = index < activeNodeIndex;

          return (
            <li className="min-w-0" key={node.id}>
              <button
                aria-current={isActive ? "step" : undefined}
                aria-label={`第 ${node.step} 步：${node.navTitle}`}
                className="group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg p-1.5 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 cursor-pointer"
                onClick={() => onNodeSelect(index)}
                type="button"
              >
                {/* Node Pill / Icon Box */}
                <span
                  className={`relative grid size-9 sm:size-10 place-items-center rounded-xl border transition-all duration-300 ${
                    isActive
                      ? "scale-105 shadow-[0_0_16px_var(--af-node-accent)] font-bold"
                      : isComplete
                      ? "border-white/20 bg-white/[0.04] text-zinc-300 group-hover:border-white/30"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-600 group-hover:border-white/20 group-hover:text-zinc-400"
                  }`}
                  style={{
                    borderColor: isActive ? node.accent : undefined,
                    backgroundColor: isActive ? `rgba(${node.accentRgb}, 0.15)` : undefined,
                    color: isActive ? node.accent : undefined,
                    "--af-node-accent": node.accent,
                  } as CSSProperties}
                >
                  {isComplete ? (
                    <Check size={14} className="text-zinc-300" />
                  ) : (
                    <Icon aria-hidden size={15} strokeWidth={isActive ? 2.4 : 1.8} />
                  )}

                  {/* Active Pulse Ring */}
                  {isActive && !paused && (
                    <span
                      aria-hidden="true"
                      className="absolute -inset-1 rounded-xl border animate-ping opacity-25"
                      style={{ borderColor: node.accent }}
                    />
                  )}
                </span>

                {/* Node Label */}
                <span
                  className={`truncate font-mono text-[11px] sm:text-xs transition-colors ${
                    isActive
                      ? "font-bold text-white"
                      : isComplete
                      ? "text-zinc-400"
                      : "text-zinc-500 group-hover:text-zinc-300"
                  }`}
                >
                  {node.navTitle}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Loopback Footer Note */}
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] font-mono text-zinc-500">
        <span className="flex items-center gap-1">
          <Sparkles className="size-3 text-purple-400" />
          <span>连续研学流 · 0% → 100% 闭环推进</span>
        </span>
        <div className="flex items-center gap-1.5 text-zinc-400">
          <span>STEP 06 阶段调整</span>
          <span>↺</span>
          <span className="text-blue-400">STEP 01 开始学习</span>
        </div>
      </div>
    </nav>
  );
}
