"use client";

import React, { useId } from "react";
import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle,
  CheckCircle2,
  Clock,
  Layers,
  Radio,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  clamp,
  getStampTransform,
  interpolateCounterValue,
  interpolateStrokeDashoffset,
} from "../../utils/kinematics";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneDailyOrbit: React.FC<StageSceneProps> = ({
  node,
  activeTrack = "mastery",
  track,
  localProgress = 0,
  isReducedMotion = false,
  reducedMotion = false,
  className = "",
}) => {
  const motionReduced = isReducedMotion || reducedMotion;
  const currentTrack = track || activeTrack;
  const p = motionReduced ? 1.0 : clamp(localProgress, 0, 1);
  const isMastery = currentTrack === "mastery";
  const idPrefix = useId();

  const ring1Offset = interpolateStrokeDashoffset(p, 600, 0.05, 0.75);
  const ring2Offset = interpolateStrokeDashoffset(p, 450, 0.15, 0.8);
  const ring3Offset = interpolateStrokeDashoffset(p, 300, 0.25, 0.85);

  const durationHours = interpolateCounterValue(p, isMastery ? 5.2 : 4.2, 0.0, 0.1, 0.7).toFixed(1);
  const gapsResolved = Math.round(interpolateCounterValue(p, isMastery ? 4 : 3, 0, 0.15, 0.75));
  const tasksCompleted = Math.round(interpolateCounterValue(p, isMastery ? 5 : 4, 0, 0.2, 0.8));

  const stamp = getStampTransform(p, 0.65, 0.85);
  const rotationAngle = (p * 360) % 360;

  return (
    <div
      className={`relative flex h-full min-h-[460px] sm:min-h-[480px] w-full flex-col justify-between overflow-hidden rounded-xl bg-[#090b0e]/95 p-3.5 sm:p-5 text-zinc-100 select-none ${className}`}
      data-scene="daily-orbit"
      data-track={currentTrack}
      data-testid="scene-daily-orbit"
    >
      {/* Background Watermark & Atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-emerald-600/10 blur-[90px]" />
        <div className="absolute -right-20 -bottom-20 size-80 rounded-full bg-teal-600/10 blur-[90px]" />
        <div className="absolute right-4 top-4 font-mono text-[6rem] sm:text-[8rem] font-black text-emerald-500/[0.03] leading-none select-none">
          05
        </div>
      </div>

      {/* Main 3-Wing Horizon */}
      <div className="relative z-10 grid flex-1 grid-cols-1 items-stretch gap-3 sm:gap-4 lg:grid-cols-[28%_44%_28%] min-h-0">
        {/* WING 1: LEFT CONTEXT WING (28%) - Daily Audit Journal */}
        <section
          aria-label="今日研学对账明细与核销记录"
          className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c1612]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                <Calendar className="size-3.5 text-emerald-400" />
                <span>今日研学对账明细</span>
              </div>
              <span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                {isMastery ? "满额闭环" : "诚实对账"}
              </span>
            </div>

            <div className="mt-2.5 font-mono text-xs font-bold text-zinc-100">
              三环同心对账 · 拒绝虚假完成度
            </div>

            <div className="mt-3 flex flex-col gap-2 font-mono text-[10px]">
              {/* Ring 1 Summary */}
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-2.5">
                <div className="flex items-center justify-between text-emerald-300 font-bold">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3 text-emerald-400" />
                    投入时长环 (104%)
                  </span>
                  <span>{durationHours}h / 5.0h</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  净专注有效投入 · 单会话无冲突存证
                </div>
              </div>

              {/* Ring 2 Summary */}
              <div className="rounded-lg border border-teal-500/25 bg-teal-950/20 p-2.5">
                <div className="flex items-center justify-between text-teal-300 font-bold">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="size-3 text-teal-400" />
                    断层核销环 ({isMastery ? "100%" : "75%"})
                  </span>
                  <span>{gapsResolved} / {isMastery ? 4 : 4} 项</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  {isMastery ? "今日盲区全部闭合 · 零遗留欠账" : "未决断层已精准排入明日复测池"}
                </div>
              </div>

              {/* Ring 3 Summary */}
              <div className="rounded-lg border border-blue-500/25 bg-blue-950/20 p-2.5">
                <div className="flex items-center justify-between text-blue-300 font-bold">
                  <span className="flex items-center gap-1">
                    <Layers className="size-3 text-blue-400" />
                    核心任务环 ({isMastery ? "100%" : "80%"})
                  </span>
                  <span>{tasksCompleted} / 5 项</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  考纲大纲主线任务达成 · 扎实推进
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-950/40 px-2.5 py-1.5 font-mono text-[10px] text-emerald-300">
            <div className="flex items-center gap-1.5">
              <Scale className="size-3 text-emerald-400" />
              <span>日终数据天平已平衡</span>
            </div>
            <span className="font-bold text-emerald-400">100% 锁存</span>
          </div>
        </section>

        {/* WING 2: CENTER KINETIC CORE (44%) - Tri-Ring Concentric Orbit Radar */}
        <section
          aria-label="三环同心对账引力轨道核心"
          className="relative flex flex-col items-center justify-between rounded-xl border border-emerald-500/20 bg-[#0a1712]/90 p-4 shadow-inner min-h-[280px] overflow-hidden"
        >
          {/* SVG Concentric Rings */}
          <div className="relative flex flex-1 w-full items-center justify-center min-h-[220px]">
            <div className="relative flex size-56 sm:size-64 lg:size-72 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-2xl" />

              {/* Outer Dashed Orbit */}
              <div
                className="absolute inset-0 rounded-full border border-dashed border-emerald-500/20 will-change-transform"
                style={{ transform: `rotate(${rotationAngle}deg)` }}
              />

              <svg className="absolute inset-0 size-full -rotate-90">
                <defs>
                  <linearGradient id={`${idPrefix}-orbitGreen`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                  <linearGradient id={`${idPrefix}-orbitTeal`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2dd4bf" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                  <linearGradient id={`${idPrefix}-orbitBlue`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>

                {/* Track 1: Outer Ring (Duration 5.2h) */}
                <circle cx="50%" cy="50%" r="44%" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                <circle
                  cx="50%"
                  cy="50%"
                  r="44%"
                  fill="none"
                  stroke={`url(#${idPrefix}-orbitGreen)`}
                  strokeWidth="7"
                  strokeDasharray="600"
                  strokeDashoffset={motionReduced ? 0 : ring1Offset}
                  strokeLinecap="round"
                  className="transition-all duration-75"
                />

                {/* Track 2: Middle Ring (Gap Closure 100%) */}
                <circle cx="50%" cy="50%" r="33%" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                <circle
                  cx="50%"
                  cy="50%"
                  r="33%"
                  fill="none"
                  stroke={`url(#${idPrefix}-orbitTeal)`}
                  strokeWidth="7"
                  strokeDasharray="450"
                  strokeDashoffset={motionReduced ? 0 : ring2Offset}
                  strokeLinecap="round"
                  className="transition-all duration-75"
                />

                {/* Track 3: Inner Ring (Task 5/5) */}
                <circle cx="50%" cy="50%" r="22%" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                <circle
                  cx="50%"
                  cy="50%"
                  r="22%"
                  fill="none"
                  stroke={`url(#${idPrefix}-orbitBlue)`}
                  strokeWidth="7"
                  strokeDasharray="300"
                  strokeDashoffset={motionReduced ? 0 : ring3Offset}
                  strokeLinecap="round"
                  className="transition-all duration-75"
                />
              </svg>

              {/* Center Reconciled Hub */}
              <div className="relative flex size-24 sm:size-28 flex-col items-center justify-center rounded-full border border-emerald-500/40 bg-[#0d1d17]/95 shadow-[0_0_35px_rgba(52,211,153,0.4)] backdrop-blur-md">
                <CheckCircle className="size-6 text-emerald-400 animate-bounce" />
                <span className="font-mono text-xs font-black text-emerald-200 mt-1">100%</span>
                <span className="font-mono text-[9px] text-emerald-400 font-bold">对账闭环</span>
              </div>
            </div>
          </div>

          {/* Telemetry Indicator Row */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
            <div className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-950/40 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              <span>时长: {durationHours}h (104%)</span>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-950/40 px-2 py-0.5 font-mono text-[10px] text-teal-300">
              <span className="size-1.5 rounded-full bg-teal-400" />
              <span>断层: {gapsResolved}/4 项</span>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-950/40 px-2 py-0.5 font-mono text-[10px] text-blue-300">
              <span className="size-1.5 rounded-full bg-blue-400" />
              <span>任务: {tasksCompleted}/5 项</span>
            </div>
          </div>

          <div className="absolute bottom-2.5 flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/60 px-3 py-0.5 font-mono text-[10px] text-emerald-300 shadow-md backdrop-blur-md">
            <Radio className="size-3 text-emerald-400 animate-pulse" />
            <span>三环同心对账完成 · 无遗留未决债务</span>
          </div>
        </section>

        {/* WING 3: RIGHT METRICS WING (28%) - Debt Ledger & Stamp */}
        <section
          aria-label="债务结转台账与日快照印章"
          className="relative flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c1612]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              <div className="flex items-center gap-1.5">
                <Activity className="size-3.5 text-emerald-400" />
                <span>日终快照与结转</span>
              </div>
              <span className="text-[10px] text-zinc-400">SNAPSHOT</span>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400">
                  <span>对账闭环状态</span>
                  <span className="text-emerald-300 font-bold">RECONCILED</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <div className="font-mono text-xl font-black text-white">
                    {isMastery ? "零欠账超前" : "债务受控"}
                  </div>
                  <ShieldCheck className="size-5 text-emerald-400" />
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  {isMastery
                    ? "今日无遗留欠账，超前解锁明日级数专题"
                    : "未决断层已精准排入明日 08:30 专项复测池"}
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 font-mono text-[10px]">
                <div className="flex items-center justify-between text-zinc-300">
                  <span className="font-bold">明日战线规划</span>
                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                    QUEUED
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400 leading-tight">
                  {isMastery ? "高等数学级数专题 · 明日已解锁" : "泰勒展开余项证明 · 排入明日 08:30"}
                </div>
              </div>
            </div>
          </div>

          {/* Holographic Stamp: [DAY_RECONCILED] */}
          <div className="relative my-2 flex items-center justify-center py-1 min-h-[56px]">
            <div
              className="flex items-center gap-2 rounded-lg border-2 border-emerald-400/90 bg-gradient-to-br from-emerald-950/90 via-[#0d2119] to-teal-950/90 px-3.5 py-2 shadow-[0_0_25px_rgba(52,211,153,0.6)] backdrop-blur-md will-change-transform"
              style={{
                transform: `scale(${motionReduced ? 1.0 : stamp.scale}) rotate(${motionReduced ? -6 : stamp.rotateDeg}deg) translateY(${motionReduced ? 0 : stamp.translateY}px)`,
                opacity: motionReduced ? 1.0 : stamp.opacity,
              }}
            >
              <ShieldCheck className="size-4 text-emerald-400" />
              <div className="font-mono text-xs font-black tracking-wider text-emerald-200">
                {isMastery ? "[SURPLUS_RECONCILED]" : "[DEBT_RECONCILED]"}
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>下一阶段</span>
              <span className="flex items-center gap-1 font-bold text-emerald-300">
                STEP 06 阶段调整
                <ArrowRight className="size-3 text-emerald-400" />
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* BOTTOM STREAM RELAY */}
      <footer
        aria-label="研学流水接力管道"
        className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/30 px-3.5 py-2 font-mono text-[11px] text-zinc-300 shadow-sm backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-bold text-emerald-400">
            <CheckCircle2 className="size-3" />
            {node?.inputLabel || "承接"}:
          </span>
          <span className="text-white font-medium">{node?.inputValue || "掌握判断"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-emerald-300 font-bold">{node?.actionLabel || "完成今日对账"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-zinc-400">{node?.outputLabel || "形成"}</span>
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-bold text-emerald-300">
            {node?.outputValue || "日证据快照"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/90 font-bold">
          <Sparkles className="size-3 text-emerald-400" />
          <span>{node?.nextLabel || "让连续日证据进入周期判断"}</span>
        </div>
      </footer>
    </div>
  );
};
