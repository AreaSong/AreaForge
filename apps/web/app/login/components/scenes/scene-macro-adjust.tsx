"use client";

import React from "react";
import { ArrowUpRight, Compass, RefreshCw, TrendingUp } from "lucide-react";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneMacroAdjust: React.FC<StageSceneProps> = ({
  isActive,
}) => {
  return (
    <div className="relative flex h-full min-h-[380px] w-full flex-col items-center justify-center overflow-hidden select-none">
      {/* 1. Large Glowing Multi-Layer Bezier Trend Wave */}
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-2xl border border-purple-500/30 bg-[#161220]/90 p-5 shadow-[0_0_40px_rgba(192,132,252,0.2)] backdrop-blur-xl">
        {/* Trend Header */}
        <div className="flex items-center justify-between border-b border-purple-500/20 pb-3">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-lg bg-purple-500/20 text-purple-400">
              <TrendingUp className="size-4" />
            </div>
            <div>
              <div className="font-mono text-xs font-bold text-white">
                宏观研学能力走势
              </div>
              <div className="font-mono text-[10px] text-purple-400">
                MACRO CAPABILITY PROJECTION
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-purple-300">
            <ArrowUpRight className="size-3 text-purple-400" />
            <span>稳步上行 +24.3%</span>
          </div>
        </div>

        {/* Dynamic SVG Wave Chart */}
        <div className="relative my-4 h-36 w-full">
          <svg className="h-full w-full overflow-visible" viewBox="0 0 400 120">
            <defs>
              <linearGradient id="purpleAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c084fc" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#c084fc" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="purpleStrokeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="50%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#f472b6" />
              </linearGradient>
            </defs>

            {/* Grid Lines */}
            <line x1="0" y1="30" x2="400" y2="30" stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
            <line x1="0" y1="70" x2="400" y2="70" stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
            <line x1="0" y1="110" x2="400" y2="110" stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />

            {/* Shaded Area Under Curve */}
            <path
              d="M 20 100 C 100 90, 160 60, 240 45 S 340 25, 380 15 L 380 120 L 20 120 Z"
              fill="url(#purpleAreaGrad)"
            />

            {/* Primary Glowing Bezier Curve */}
            <path
              d="M 20 100 C 100 90, 160 60, 240 45 S 340 25, 380 15"
              fill="none"
              stroke="url(#purpleStrokeGrad)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="450"
              strokeDashoffset={isActive ? 0 : 450}
              className="transition-all duration-1000"
            />

            {/* Milestone Keyframe Dots */}
            <circle cx="20" cy="100" r="4" fill="#818cf8" className="shadow-sm" />
            <circle cx="240" cy="45" r="4" fill="#c084fc" />
            <circle cx="380" cy="15" r="5" fill="#f472b6" className="animate-ping" />
            <circle cx="380" cy="15" r="5" fill="#f472b6" />
          </svg>

          {/* Current Probe Value Pill */}
          <div className="absolute top-0 right-2 -translate-y-2 rounded-md border border-pink-500/40 bg-[#251528] px-2 py-0.5 font-mono text-[10px] font-black text-pink-300 shadow-lg">
            指数 92.4 (目标达成)
          </div>
        </div>

        {/* Course Correction & Looping Ribbon Indicator */}
        <div className="flex items-center justify-between rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-2">
          <div className="flex items-center gap-2 font-mono text-xs text-purple-200">
            <Compass className="size-4 text-purple-400 animate-spin" style={{ animationDuration: "12s" }} />
            <span>AI 宏观建议: 提前进入真题模考，加大压轴题权重</span>
          </div>
          <RefreshCw className="size-3.5 text-purple-400" />
        </div>
      </div>

      {/* 2. Minimal Bottom Status */}
      <div className="absolute bottom-3 flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-950/40 px-3 py-1 font-mono text-xs text-purple-300 shadow-md backdrop-blur-md">
        <RefreshCw className="size-3.5 text-purple-400 animate-spin" style={{ animationDuration: "10s" }} />
        <span>周期研学自适应校准完成 · 自动回流至下一次开始学习</span>
      </div>
    </div>
  );
};
