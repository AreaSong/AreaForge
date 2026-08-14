"use client";

import React from "react";
import { CheckCircle2, ShieldCheck, Zap } from "lucide-react";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneProofVerification: React.FC<StageSceneProps> = ({
  isActive,
}) => {
  return (
    <div className="relative flex h-full min-h-[380px] w-full flex-col items-center justify-center overflow-hidden select-none">
      {/* 1. Ebbinghaus Memory Retention Grid Wave Background */}
      <svg className="absolute inset-0 h-full w-full pointer-events-none opacity-40">
        <defs>
          <linearGradient id="skyWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#818cf8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {/* Retention Sine Waves */}
        <path
          d="M 20 280 Q 250 80 500 200 T 980 120"
          stroke="url(#skyWaveGrad)"
          strokeWidth="3"
          fill="none"
          strokeDasharray="400"
          strokeDashoffset={isActive ? 0 : 400}
          className="transition-all duration-1000"
        />
        <path
          d="M 20 300 Q 250 140 500 240 T 980 180"
          stroke="rgba(56, 189, 248, 0.2)"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>

      {/* 2. Automated Floating Proof & Mastery Showcase Pod */}
      <div className="relative z-10 grid w-full max-w-lg grid-cols-1 sm:grid-cols-2 gap-3 p-2">
        {/* Card 1: Question & Retrieval Proof */}
        <div className="flex flex-col justify-between rounded-2xl border border-sky-500/30 bg-[#101726]/95 p-4 shadow-[0_0_35px_rgba(56,189,248,0.2)] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-300">
              真题变式盲测
            </span>
            <span className="font-mono text-[10px] text-zinc-400">MATH-2024-T17</span>
          </div>

          <div className="my-2 space-y-1">
            <div className="text-xs font-bold text-white tracking-wide">
              证明：泰勒定理余项在导数连续下的严格收敛性
            </div>
            <p className="text-[11px] text-zinc-400 font-mono">
              构造辅助函数 F(x) 消除一阶项偏差
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-white/[0.03] p-2 font-mono text-[11px]">
            <span className="text-zinc-500">盲测用时:</span>
            <span className="font-bold text-sky-400">03:42 秒 (达标)</span>
          </div>
        </div>

        {/* Card 2: Instant Mastery Boost Result */}
        <div className="flex flex-col justify-between rounded-2xl border border-emerald-500/40 bg-[#0d1f18]/95 p-4 shadow-[0_0_35px_rgba(52,211,153,0.25)] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-400" />
              <span className="font-mono text-[11px] font-bold text-emerald-300">掌握度已拉升</span>
            </div>
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
              7天维持
            </span>
          </div>

          <div className="my-2 flex items-center justify-around">
            <div className="text-center">
              <div className="font-mono text-[10px] text-zinc-400">前序状态</div>
              <div className="font-mono text-base font-bold text-zinc-500 line-through">68%</div>
            </div>
            <Zap className="size-4 text-emerald-400 animate-bounce" />
            <div className="text-center">
              <div className="font-mono text-[10px] text-emerald-400">复测核准</div>
              <div className="font-mono text-2xl font-black text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]">
                94%
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-1 font-mono text-[10px] text-emerald-400">
            <ShieldCheck className="size-3" />
            <span>逻辑推导严密 · 记忆曲线稳固</span>
          </div>
        </div>
      </div>

      {/* 3. Minimal Bottom Status */}
      <div className="absolute bottom-3 flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-950/40 px-3 py-1 font-mono text-xs text-sky-300 shadow-md backdrop-blur-md">
        <ShieldCheck className="size-3.5 text-sky-400" />
        <span>主动回忆与真题盲测已验证 · 掌握度达标</span>
      </div>
    </div>
  );
};
