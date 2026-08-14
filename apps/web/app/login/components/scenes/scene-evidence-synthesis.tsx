"use client";

import React from "react";
import { Award, Cpu, FileCheck2, Sparkles } from "lucide-react";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneEvidenceSynthesis: React.FC<StageSceneProps> = ({
  isActive,
}) => {
  return (
    <div className="relative flex h-full min-h-[380px] w-full flex-col items-center justify-center overflow-hidden select-none">
      {/* 1. Converging Energy Beams (3 Inflows) */}
      <svg className="absolute inset-0 h-full w-full pointer-events-none">
        <defs>
          <linearGradient id="cyanBeam" x1="0%" y1="0%" x2="50%" y2="50%">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="amberBeam" x1="100%" y1="0%" x2="50%" y2="50%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="purpleBeam" x1="50%" y1="100%" x2="50%" y2="50%">
            <stop offset="0%" stopColor="#c084fc" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#c084fc" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 3 Converging Light Rays */}
        <path d="M 50 40 Q 200 120 50% 50%" stroke="#2dd4bf" strokeWidth="2" strokeDasharray="6,4" fill="none" opacity="0.6" />
        <path d="M 950 40 Q 800 120 50% 50%" stroke="#fbbf24" strokeWidth="2" strokeDasharray="6,4" fill="none" opacity="0.6" />
        <path d="M 50% 360 Q 50% 280 50% 50%" stroke="#c084fc" strokeWidth="2" strokeDasharray="6,4" fill="none" opacity="0.6" />
      </svg>

      {/* 2. Floating 3D Holographic Evidence Chip */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Chip Outer Glow */}
        <div className="relative flex w-80 sm:w-96 flex-col rounded-2xl border border-amber-500/40 bg-[#171512]/90 p-5 shadow-[0_0_50px_rgba(251,191,36,0.2)] backdrop-blur-xl transition-all duration-500">
          {/* Chip Header Bar */}
          <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
            <div className="flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40">
                <Cpu className="size-4 animate-pulse" />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-white tracking-wider">
                  EVIDENCE CHIP
                </div>
                <div className="font-mono text-[10px] text-amber-400/80">
                  HASH: #EVID-2026-8921
                </div>
              </div>
            </div>

            {/* Verified Stamp */}
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] font-bold text-emerald-400">
              <FileCheck2 className="size-3" />
              <span>VERIFIED</span>
            </div>
          </div>

          {/* Chip Body Circuits & Data Points */}
          <div className="my-4 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-2.5 text-center">
              <div className="font-mono text-[10px] text-zinc-400">有效时长</div>
              <div className="font-mono text-base font-black text-teal-300">45 MIN</div>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-center">
              <div className="font-mono text-[10px] text-zinc-400">产出定理</div>
              <div className="font-mono text-base font-black text-amber-300">2 处推导</div>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-center">
              <div className="font-mono text-[10px] text-zinc-400">断层核销</div>
              <div className="font-mono text-base font-black text-emerald-300">100%</div>
            </div>
          </div>

          {/* Laser Holographic Seal Strip */}
          <div className="relative overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-300">
              <Sparkles className="size-3.5 text-amber-400" />
              <span>泰勒中值定理 · 完整闭环证据</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-500">GRADE-A</span>
            
            {/* Shimmer Glint */}
            {isActive && (
              <div
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent will-change-transform"
                style={{ animation: "af-glint-sweep 4s ease-in-out infinite" }}
              />
            )}
          </div>
        </div>
      </div>

      {/* 3. Minimal Bottom Status */}
      <div className="absolute bottom-3 flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-950/40 px-3 py-1 font-mono text-xs text-amber-300 shadow-md backdrop-blur-md">
        <Award className="size-3.5 text-amber-400" />
        <span>研学证据已凝结熔铸 · 存证不可篡改</span>
      </div>
    </div>
  );
};
