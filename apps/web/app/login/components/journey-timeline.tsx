"use client";

import type { CSSProperties } from "react";
import React, { useRef, useState } from "react";
import {
  Check,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
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
  isPlaying,
  paused = false,
  onNodeSelect,
  onAutoPlayChange,
  onProgressScrub,
}: JourneyTimelineProps) {
  const current = LEARNING_LOOP_NODES[activeNodeIndex] || LEARNING_LOOP_NODES[0];
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [hoverProgress, setHoverProgress] = useState<number | null>(null);

  const clampedProgress = Math.min(1, Math.max(0, globalProgress));
  const progressPercent = clampedProgress * 100;
  const currentSeconds = (clampedProgress * 36).toFixed(1);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !onProgressScrub) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newProgress = Math.max(0, Math.min(1, clickX / rect.width));
    onProgressScrub(newProgress);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const hoverRatio = Math.max(0, Math.min(1, clickX / rect.width));
    setHoverProgress(hoverRatio);
  };

  const handleMouseLeave = () => {
    setHoverProgress(null);
  };

  return (
    <nav
      aria-label="学习闭环连续时间轴"
      className="group/timeline relative rounded-2xl border border-white/[0.08] bg-[#141518]/90 p-3.5 sm:p-5 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl transition-all"
    >
      {/* 1. CAD 4-Corner Crosshairs */}
      <div aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span>+</span>
        <span className="text-[8px] text-white/10">[TL.00]</span>
      </div>
      <div aria-hidden className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span className="text-[8px] text-white/10">[TL.01]</span>
        <span>+</span>
      </div>
      <div aria-hidden className="pointer-events-none absolute left-2.5 bottom-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span>+</span>
        <span className="text-[8px] text-white/10">[TL.99]</span>
      </div>
      <div aria-hidden className="pointer-events-none absolute right-2.5 bottom-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span className="text-[8px] text-white/10">[TL.100]</span>
        <span>+</span>
      </div>

      {/* Top Status & Interactive Controls Row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Play/Pause Scrub Toggle Button */}
          <button
            type="button"
            onClick={() => onAutoPlayChange(!isPlaying)}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] font-bold text-zinc-300 transition-all hover:border-teal-400/40 hover:bg-teal-500/10 hover:text-teal-300 cursor-pointer"
            title={isPlaying ? "点击暂停巡航" : "点击恢复自动巡航"}
          >
            {isPlaying ? (
              <>
                <Pause className="size-3 text-teal-400" />
                <span>自动巡航</span>
              </>
            ) : (
              <>
                <Play className="size-3 text-amber-400" />
                <span>暂停定格</span>
              </>
            )}
          </button>

          <span className="hidden sm:inline text-zinc-700">|</span>

          {/* Current Stage Indicator */}
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full animate-pulse shadow-[0_0_8px_currentColor]"
              style={{ backgroundColor: current.accent }}
            />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-200">
              阶段 {String(current.step).padStart(2, "0")} / 06
            </span>
          </div>

          <span className="hidden md:inline text-xs text-zinc-400 font-medium">
            {current.navTitle} · {current.outputValue}
          </span>
        </div>

        {/* Right Timestamp & Percentage Telemetry */}
        <div className="flex items-center gap-2.5 sm:gap-3 font-mono text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-0.5 text-[11px] text-zinc-400">
            <span>{currentSeconds}s</span>
            <span className="text-zinc-600">/</span>
            <span>36.0s</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-teal-400">
              {progressPercent.toFixed(1)}%
            </span>
            <span className="size-1.5 rounded-full bg-teal-400 animate-ping" />
          </div>
        </div>
      </div>

      {/* 2. Continuous GPU-Accelerated Scrubbable Progress Track with Hover Tooltip */}
      <div
        ref={progressBarRef}
        onClick={handleTrackClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="group/track relative my-3 h-2.5 w-full cursor-pointer rounded-full bg-white/[0.06] overflow-hidden transition-all hover:h-3"
        title="拖拽或点击时间轴任意位置快速洗牌"
      >
        {/* GPU Hardware Accelerated Progress Bar */}
        <div
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-blue-500 via-teal-400 to-purple-400 will-change-transform shadow-[0_0_12px_rgba(45,212,191,0.5)]"
          style={{ transform: `scaleX(${clampedProgress})` }}
        />

        {/* Hover Scrub Preview Pin */}
        {hoverProgress !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_8px_white]"
            style={{ left: `${hoverProgress * 100}%` }}
          />
        )}
      </div>

      {/* 3. 6 Interactive Stage Selector Nodes */}
      <ol className="relative grid grid-cols-6 gap-1.5 sm:gap-2">
        {LEARNING_LOOP_NODES.map((node, index) => {
          const Icon = node.icon;
          const isActive = index === activeNodeIndex;
          const isComplete = index < activeNodeIndex;

          return (
            <li className="min-w-0" key={node.id}>
              <button
                aria-current={isActive ? "step" : undefined}
                aria-label={`第 ${node.step} 步：${node.navTitle}`}
                className="group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg p-1 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 cursor-pointer"
                onClick={() => onNodeSelect(index)}
                type="button"
              >
                {/* Node Pill / Icon Box */}
                <span
                  className={`relative grid size-8 sm:size-10 place-items-center rounded-xl border transition-all duration-300 ${
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
                  className={`truncate font-mono text-[10px] sm:text-xs transition-colors ${
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

      {/* 4. Loopback Footer Note */}
      <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] font-mono text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3 text-purple-400" />
          <span>连续研学流 · 0% → 100% 毫秒级闭环推进</span>
        </span>
        <div className="flex items-center gap-1.5 text-zinc-400">
          <span>STEP 06 阶段调整</span>
          <RotateCcw className="size-3 text-zinc-400" />
          <span className="text-blue-400 font-bold">STEP 01 开始学习</span>
        </div>
      </div>
    </nav>
  );
}
