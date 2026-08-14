"use client";

import React from "react";
import { Activity, Flame } from "lucide-react";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneDeepFocus: React.FC<StageSceneProps> = ({
  isActive,
}) => {
  // Generate 32 equalizer bars with staggered animations
  const bars = [
    35, 65, 45, 85, 55, 95, 75, 40, 60, 90, 100, 70, 80, 50, 65, 85,
    95, 60, 75, 88, 45, 70, 92, 58, 40, 78, 85, 62, 50, 70, 45, 30,
  ];

  return (
    <div className="relative flex h-full min-h-[380px] w-full flex-col items-center justify-center overflow-hidden select-none">
      {/* 1. Holographic Large Circular Dial */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        {/* Outer Glowing Energy Orbit */}
        <div className="relative flex size-52 sm:size-60 items-center justify-center">
          {/* Animated Ambient Halo */}
          <div className="absolute inset-0 rounded-full bg-teal-500/10 blur-xl animate-pulse" />

          {/* SVG Circular Progress Ring */}
          <svg className="absolute inset-0 size-full -rotate-90">
            {/* Background Track */}
            <circle
              cx="50%"
              cy="50%"
              r="44%"
              fill="none"
              stroke="rgba(20, 184, 166, 0.15)"
              strokeWidth="6"
            />
            {/* Active Glowing Progress Arc */}
            <circle
              cx="50%"
              cy="50%"
              r="44%"
              fill="none"
              stroke="url(#tealGlowGrad)"
              strokeWidth="6"
              strokeDasharray="600"
              strokeDashoffset="160"
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
            <defs>
              <linearGradient id="tealGlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2dd4bf" />
                <stop offset="100%" stopColor="#14b8a6" />
              </linearGradient>
            </defs>
          </svg>

          {/* Outer Rotating Gear Ring */}
          {isActive && (
            <div
              className="absolute inset-0 rounded-full border border-teal-500/20 border-dashed will-change-transform"
              style={{ animation: "spin 20s linear infinite" }}
            />
          )}

          {/* Inner Display Pod */}
          <div className="relative flex size-40 sm:size-44 flex-col items-center justify-center rounded-full border border-teal-500/30 bg-[#121c1f]/90 shadow-[0_0_35px_rgba(45,212,191,0.25)] backdrop-blur-md">
            <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-teal-400">
              <Flame className="size-3.5 text-teal-400 animate-bounce" />
              <span>心流状态 · 0 次中断</span>
            </div>

            {/* Big Digital Countdown */}
            <div className="my-1 font-mono text-4xl sm:text-5xl font-black tracking-tight text-white drop-shadow-[0_0_15px_rgba(45,212,191,0.4)]">
              42:18
            </div>

            <div className="flex items-center gap-1.5 rounded-full bg-teal-500/15 px-2.5 py-0.5 font-mono text-[10px] font-bold text-teal-300">
              <span className="size-1.5 rounded-full bg-teal-400 animate-ping" />
              <span>泰勒级数展开 · 证明中</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Real-Time Equalizer Waveform Bars (Focus Soundscape) */}
      <div className="relative z-10 mt-6 flex items-end justify-center gap-1 sm:gap-1.5 h-10 w-full max-w-md px-4">
        {bars.map((height, i) => (
          <div
            key={i}
            className="flex-1 rounded-full bg-gradient-to-t from-teal-500/40 via-teal-400/80 to-teal-300 transition-all duration-300"
            style={{
              height: isActive ? `${height}%` : "20%",
              animation: isActive ? `af-wave-pulse 1.2s ease-in-out ${i * 0.04}s infinite alternate` : "none",
            }}
          />
        ))}
      </div>

      {/* 3. Minimal Bottom Status */}
      <div className="absolute bottom-3 flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-950/40 px-3 py-1 font-mono text-xs text-teal-300 shadow-md backdrop-blur-md">
        <Activity className="size-3.5 text-teal-400" />
        <span>专注心流引擎持续运行中</span>
      </div>
    </div>
  );
};
