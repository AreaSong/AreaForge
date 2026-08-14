"use client";

import React from "react";
import { CheckCircle, Sparkles } from "lucide-react";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneDailyOrbit: React.FC<StageSceneProps> = ({
  isActive,
}) => {
  return (
    <div className="relative flex h-full min-h-[380px] w-full flex-col items-center justify-center overflow-hidden select-none">
      {/* 1. Large 3-Ring Concentric Orbit Radar */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        <div className="relative flex size-64 sm:size-72 items-center justify-center">
          {/* Radial Ambient Glow */}
          <div className="absolute inset-0 rounded-full bg-emerald-500/15 blur-2xl animate-pulse" />

          {/* SVG Concentric Rings */}
          <svg className="absolute inset-0 size-full -rotate-90">
            <defs>
              <linearGradient id="orbitGreen" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
              <linearGradient id="orbitTeal" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2dd4bf" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
              <linearGradient id="orbitBlue" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>

            {/* Track 1: Outer Ring (Duration 5.2h) */}
            <circle cx="50%" cy="50%" r="44%" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
            <circle
              cx="50%"
              cy="50%"
              r="44%"
              fill="none"
              stroke="url(#orbitGreen)"
              strokeWidth="8"
              strokeDasharray="600"
              strokeDashoffset="60"
              strokeLinecap="round"
              className="transition-all duration-1000"
            />

            {/* Track 2: Middle Ring (Gap Closure 100%) */}
            <circle cx="50%" cy="50%" r="33%" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
            <circle
              cx="50%"
              cy="50%"
              r="33%"
              fill="none"
              stroke="url(#orbitTeal)"
              strokeWidth="8"
              strokeDasharray="450"
              strokeDashoffset="0"
              strokeLinecap="round"
              className="transition-all duration-1000"
            />

            {/* Track 3: Inner Ring (Task 4/4) */}
            <circle cx="50%" cy="50%" r="22%" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
            <circle
              cx="50%"
              cy="50%"
              r="22%"
              fill="none"
              stroke="url(#orbitBlue)"
              strokeWidth="8"
              strokeDasharray="300"
              strokeDashoffset="0"
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
          </svg>

          {/* Orbiting Rotating Satellites */}
          {isActive && (
            <div
              className="absolute inset-0 rounded-full border border-emerald-500/20 border-dashed will-change-transform"
              style={{ animation: "spin 12s linear infinite" }}
            />
          )}

          {/* Center Reconciled Hub */}
          <div className="relative flex size-24 sm:size-28 flex-col items-center justify-center rounded-full border border-emerald-500/40 bg-[#0d1d17]/95 shadow-[0_0_30px_rgba(52,211,153,0.35)] backdrop-blur-md">
            <CheckCircle className="size-6 text-emerald-400 animate-bounce" />
            <span className="font-mono text-xs font-black text-emerald-200 mt-1">
              100%
            </span>
            <span className="font-mono text-[9px] text-emerald-400 font-bold">
              对账闭环
            </span>
          </div>
        </div>

        {/* Orbit Telemetry Pill Row */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-xs text-emerald-300">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span>投入时长 5.2h / 5.0h</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1 font-mono text-xs text-teal-300">
            <span className="size-2 rounded-full bg-teal-400" />
            <span>断层核销 100%</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 font-mono text-xs text-blue-300">
            <span className="size-2 rounded-full bg-blue-400" />
            <span>核心任务 4/4 达成</span>
          </div>
        </div>
      </div>

      {/* 2. Minimal Bottom Status */}
      <div className="absolute bottom-3 flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-950/40 px-3 py-1 font-mono text-xs text-emerald-300 shadow-md backdrop-blur-md">
        <Sparkles className="size-3.5 text-emerald-400" />
        <span>今日研学三路数据完全平衡 · 无遗留欠账</span>
      </div>
    </div>
  );
};
