"use client";

import React, { useId } from "react";
import {
  Activity,
  Compass,
  LineChart,
  Radio,
  RefreshCw,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  clamp,
  getLoopbackRayPosition,
  getStampTransform,
  interpolateCounterValue,
  interpolateStrokeDashoffset,
} from "../../utils/kinematics";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneMacroAdjust: React.FC<StageSceneProps> = ({
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

  const curveProgress = interpolateStrokeDashoffset(p, 450, 0.05, 0.7);
  const mathSurge = interpolateCounterValue(p, isMastery ? 23.4 : 8.2, 0.0, 0.1, 0.65).toFixed(1);
  const csSurge = interpolateCounterValue(p, isMastery ? 15.2 : 10.1, 0.0, 0.15, 0.7).toFixed(1);
  const engSurge = interpolateCounterValue(p, isMastery ? 11.5 : 7.4, 0.0, 0.2, 0.75).toFixed(1);

  const indexValue = interpolateCounterValue(p, 92.4, 75.0, 0.2, 0.8).toFixed(1);
  const stamp = getStampTransform(p, 0.65, 0.85);

  const ray = getLoopbackRayPosition(
    p,
    { x: 340, y: 15 },
    { x: 380, y: 110 },
    { x: 40, y: 110 },
    { x: 20, y: 20 },
    0.7,
    0.98
  );

  return (
    <div
      className={`relative flex h-full min-h-[460px] sm:min-h-[480px] w-full flex-col justify-between overflow-hidden rounded-xl bg-[#090b0e]/95 p-3.5 sm:p-5 text-zinc-100 select-none ${className}`}
      data-scene="macro-adjust"
      data-track={currentTrack}
      data-testid="scene-macro-adjust"
    >
      {/* Background Watermark & Atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-purple-600/10 blur-[90px]" />
        <div className="absolute -right-20 -bottom-20 size-80 rounded-full bg-indigo-600/10 blur-[90px]" />
        <div className="absolute right-4 top-4 font-mono text-[6rem] sm:text-[8rem] font-black text-purple-500/[0.03] leading-none select-none">
          06
        </div>
      </div>

      {/* Main 3-Wing Horizon */}
      <div className="relative z-10 grid flex-1 grid-cols-1 items-stretch gap-3 sm:gap-4 lg:grid-cols-[28%_44%_28%] min-h-0">
        {/* WING 1: LEFT CONTEXT WING (28%) - 14-Day Multi-Subject Corridor */}
        <section
          aria-label="14 日多维学科掌握度走廊"
          className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#140e1c]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-purple-400">
                <LineChart className="size-3.5 text-purple-400" />
                <span>14日多维学科走廊</span>
              </div>
              <span className="rounded border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-purple-300">
                {isMastery ? "优势扩展" : "瓶颈攻坚"}
              </span>
            </div>

            <div className="mt-2.5 font-mono text-xs font-bold text-zinc-100">
              置信走廊持续收窄 · 稳步上扬
            </div>

            <div className="mt-3 flex flex-col gap-2 font-mono text-[10px]">
              {/* Subject 1: Math */}
              <div className="rounded-lg border border-blue-500/25 bg-blue-950/20 p-2.5">
                <div className="flex items-center justify-between text-blue-300 font-bold">
                  <span>高等数学 (MATH-01)</span>
                  <span className="text-blue-400">+{mathSurge}%</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  {isMastery ? "微积分大题稳态跃升 · 基础稳固" : "反常积分审敛存在平台期 · 需加固"}
                </div>
              </div>

              {/* Subject 2: CS408 */}
              <div className="rounded-lg border border-teal-500/25 bg-teal-950/20 p-2.5">
                <div className="flex items-center justify-between text-teal-300 font-bold">
                  <span>408 计算机综合</span>
                  <span className="text-teal-400">+{csSurge}%</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  数据结构与树算法不变式稳步突破
                </div>
              </div>

              {/* Subject 3: English */}
              <div className="rounded-lg border border-purple-500/25 bg-purple-950/20 p-2.5">
                <div className="flex items-center justify-between text-purple-300 font-bold">
                  <span>考研英语精读</span>
                  <span className="text-purple-400">+{engSurge}%</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  长难句主干抽离熟练度常态保持
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-purple-500/20 bg-purple-950/40 px-2.5 py-1.5 font-mono text-[10px] text-purple-300">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="size-3 text-purple-400" />
              <span>宏观能力指数</span>
            </div>
            <span className="font-bold text-purple-400">{indexValue} 达标</span>
          </div>
        </section>

        {/* WING 2: CENTER KINETIC CORE (44%) - Bezier Trend Wave & Loopback Ray */}
        <section
          aria-label="多层发光贝塞尔趋势与能量回流核心"
          className="relative flex flex-col items-center justify-between rounded-xl border border-purple-500/20 bg-[#120a1c]/90 p-4 shadow-inner min-h-[280px] overflow-hidden"
        >
          {/* Dynamic SVG Wave Chart with Loopback Vector */}
          <div className="relative flex flex-1 w-full flex-col justify-center min-h-[200px]">
            <div className="relative my-auto h-40 w-full">
              <svg className="h-full w-full overflow-visible" viewBox="0 0 400 130">
                <defs>
                  <linearGradient id={`${idPrefix}-purpleAreaGrad`} x1="0%" y1="0%" x2="0%" y2="1">
                    <stop offset="0%" stopColor="#c084fc" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#c084fc" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id={`${idPrefix}-purpleStrokeGrad`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="50%" stopColor="#c084fc" />
                    <stop offset="100%" stopColor="#f472b6" />
                  </linearGradient>
                  <linearGradient id={`${idPrefix}-loopbackGrad`} x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#f472b6" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#c084fc" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.9" />
                  </linearGradient>
                </defs>

                {/* Grid Lines */}
                <line x1="0" y1="30" x2="400" y2="30" stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
                <line x1="0" y1="70" x2="400" y2="70" stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
                <line x1="0" y1="110" x2="400" y2="110" stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />

                {/* Shaded Area Under Curve */}
                <path
                  d="M 20 100 C 100 90, 160 60, 240 45 S 340 25, 380 15 L 380 120 L 20 120 Z"
                  fill={`url(#${idPrefix}-purpleAreaGrad)`}
                />

                {/* Primary Glowing Bezier Curve */}
                <path
                  d="M 20 100 C 100 90, 160 60, 240 45 S 340 25, 380 15"
                  fill="none"
                  stroke={`url(#${idPrefix}-purpleStrokeGrad)`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray="450"
                  strokeDashoffset={motionReduced ? 0 : curveProgress}
                  className="transition-all duration-75"
                />

                {/* Keyframe Nodes */}
                <circle cx="20" cy="100" r="4" fill="#818cf8" />
                <circle cx="240" cy="45" r="4" fill="#c084fc" />
                <circle cx="380" cy="15" r="5" fill="#f472b6" className="animate-ping opacity-75" />
                <circle cx="380" cy="15" r="5" fill="#f472b6" />

                {/* Loopback Curved Vector (STEP 06 -> STEP 01) */}
                <path
                  d="M 380 15 C 410 120, 100 135, 15 25"
                  stroke={`url(#${idPrefix}-loopbackGrad)`}
                  strokeWidth="2"
                  strokeDasharray="6,4"
                  fill="none"
                  opacity={ray.opacity}
                  className="transition-opacity duration-300"
                />
                {/* Loopback Traveling Photon Dot */}
                {ray.opacity > 0 && (
                  <circle cx={ray.x} cy={ray.y} r="4" fill="#60a5fa" className="shadow-[0_0_12px_#60a5fa]" />
                )}
              </svg>

              {/* Probe Badge */}
              <div className="absolute top-0 right-2 -translate-y-2 rounded-md border border-pink-500/40 bg-[#251528] px-2 py-0.5 font-mono text-[9px] font-black text-pink-300 shadow-lg">
                能力指数 {indexValue} (目标达成)
              </div>
            </div>

            {/* AI Adaptation Proposal Box */}
            <div className="mt-2 flex items-center justify-between rounded-lg border border-purple-500/30 bg-purple-950/40 p-2.5 font-mono text-[10px]">
              <div className="flex items-center gap-2 text-purple-200">
                <Compass className="size-4 text-purple-400 animate-spin" style={{ animationDuration: "12s" }} />
                <span>
                  {isMastery
                    ? "AI 建议: 基础稳固，建议在下阶段将「真题综合压轴题」权重提升至 40%"
                    : "AI 建议: 检测到反常积分审敛存在反复，建议下阶段增加 35% 专项复测权重"}
                </span>
              </div>
              <Repeat className="size-3.5 text-purple-400 shrink-0 ml-2" />
            </div>
          </div>

          <div className="absolute bottom-2.5 flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-950/60 px-3 py-0.5 font-mono text-[10px] text-purple-300 shadow-md backdrop-blur-md">
            <Radio className="size-3 text-purple-400 animate-pulse" />
            <span>自适应策略已就绪 · 能量回流至下一次开始学习</span>
          </div>
        </section>

        {/* WING 3: RIGHT METRICS WING (28%) - AI Proposal & Loopback Stamp */}
        <section
          aria-label="宏观调整提案与回流印章"
          className="relative flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#140e1c]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-purple-400">
              <div className="flex items-center gap-1.5">
                <Activity className="size-3.5 text-purple-400" />
                <span>阶段策略提案</span>
              </div>
              <span className="text-[10px] text-zinc-400">ADAPT</span>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="rounded-lg border border-purple-500/25 bg-purple-950/20 p-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400">
                  <span>策略调整案</span>
                  <span className="text-purple-300 font-bold">PROPOSAL</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <div className="font-mono text-xl font-black text-white">
                    {isMastery ? "进阶冲顶" : "专项补强"}
                  </div>
                  <ShieldCheck className="size-5 text-purple-400" />
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  {isMastery
                    ? "确认后立即重构下周计划并回流至 STEP 01"
                    : "确认后自动生成补强专题包并回流至 STEP 01"}
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 font-mono text-[10px]">
                <div className="flex items-center justify-between text-zinc-300">
                  <span className="font-bold">闭环流向</span>
                  <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-bold text-blue-300">
                    STEP 01
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400 leading-tight">
                  回流启动新一轮「锁定目标」· 研学永动机闭环
                </div>
              </div>
            </div>
          </div>

          {/* Holographic Stamp: [PROPOSAL_READY] */}
          <div className="relative my-2 flex items-center justify-center py-1 min-h-[56px]">
            <div
              className="flex items-center gap-2 rounded-lg border-2 border-purple-400/90 bg-gradient-to-br from-purple-950/90 via-[#1a0f26] to-indigo-950/90 px-3.5 py-2 shadow-[0_0_25px_rgba(192,132,252,0.6)] backdrop-blur-md will-change-transform"
              style={{
                transform: `scale(${motionReduced ? 1.0 : stamp.scale}) rotate(${motionReduced ? -6 : stamp.rotateDeg}deg) translateY(${motionReduced ? 0 : stamp.translateY}px)`,
                opacity: motionReduced ? 1.0 : stamp.opacity,
              }}
            >
              <RefreshCw className="size-4 text-purple-400" />
              <div className="font-mono text-xs font-black tracking-wider text-purple-200">
                [PROPOSAL_READY]
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>完成闭环</span>
              <span className="flex items-center gap-1 font-bold text-blue-400">
                <RotateCcw className="size-3 text-blue-400" />
                <span>回到 STEP 01 开始学习</span>
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* BOTTOM STREAM RELAY */}
      <footer
        aria-label="研学流水接力管道"
        className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-500/20 bg-purple-950/30 px-3.5 py-2 font-mono text-[11px] text-zinc-300 shadow-sm backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-bold text-purple-400">
            <LineChart className="size-3" />
            {node?.inputLabel || "承接"}:
          </span>
          <span className="text-white font-medium">{node?.inputValue || "日证据快照"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-purple-300 font-bold">{node?.actionLabel || "识别周期偏差"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-zinc-400">{node?.outputLabel || "形成"}</span>
          <span className="rounded bg-purple-500/20 px-1.5 py-0.5 font-bold text-purple-300">
            {node?.outputValue || "待确认调整"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-purple-400/90 font-bold">
          <Sparkles className="size-3 text-purple-400" />
          <span>{node?.nextLabel || "确认后回到下一次开始学习"}</span>
        </div>
      </footer>
    </div>
  );
};
