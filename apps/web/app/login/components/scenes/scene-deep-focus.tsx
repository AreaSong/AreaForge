"use client";

import React from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock3,
  Database,
  Flame,
  Lock,
  Radio,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import type { LearningLoopNode, TrackMode } from "../../constants/learning-loop";
import {
  clamp,
  getStampTransform,
  interpolateCounterValue,
  interpolateStrokeDashoffset,
  lerp,
  segmentProgress,
} from "../../utils/kinematics";

export interface StageSceneProps {
  node: LearningLoopNode;
  activeTrack?: TrackMode;
  track?: TrackMode;
  localProgress?: number;
  globalProgress?: number;
  isActive?: boolean;
  isReducedMotion?: boolean;
  reducedMotion?: boolean;
  className?: string;
}

interface DerivationStep {
  id: number;
  title: string;
  latex: string;
  explanation: string;
  start: number;
  end: number;
}

const TAYLOR_MASTERY_STEPS: DerivationStep[] = [
  {
    id: 1,
    title: "1. 构造柯西辅助函数对",
    latex: "F(t) = f(x) - \\sum_{k=0}^n \\frac{f^{(k)}(t)}{k!}(x-t)^k, \\quad G(t) = (x-t)^{n+1}",
    explanation: "在区间 [x_0, x] 上构造连续可微辅助函数对，且满足 F(x)=G(x)=0",
    start: 0.05,
    end: 0.28,
  },
  {
    id: 2,
    title: "2. 乘积微商项逐阶抵消",
    latex: "F'(t) = -\\frac{f^{(n+1)}(t)}{n!}(x-t)^n, \\quad G'(t) = -(n+1)(x-t)^n",
    explanation: "展开求导时相邻阶导数项正负对称相消，仅存留最高阶微分项",
    start: 0.3,
    end: 0.58,
  },
  {
    id: 3,
    title: "3. 柯西中值定理确立拉格朗日余项",
    latex: "\\frac{F(x)-F(x_0)}{G(x)-G(x_0)} = \\frac{F'(\\xi)}{G'(\\xi)} \\implies R_n(x) = \\frac{f^{(n+1)}(\\xi)}{(n+1)!}(x-x_0)^{n+1}",
    explanation: "存在 ξ ∈ (x_0, x) 满足柯西定理，严格导出拉格朗日余项 (Q.E.D.)",
    start: 0.6,
    end: 0.88,
  },
];

const CS408_REMEDIAL_STEPS: DerivationStep[] = [
  {
    id: 1,
    title: "1. 线索二叉树不变式判定",
    latex: "Thread(P) = \\{ ltag==1 ? pred : lchild, \\; rtag==1 ? succ : rchild \\}",
    explanation: "Tag 标记空指针域并替换为中序遍历前驱/后继直接线索",
    start: 0.05,
    end: 0.28,
  },
  {
    id: 2,
    title: "2. 定位中序直接后继算法",
    latex: "q = p\\to\\text{right}; \\quad \\text{while}(q\\to\\text{ltag} == 0) \\; q = q\\to\\text{left};",
    explanation: "若 rtag==0 则沿右孩子的最左子链遍历至最左下节点",
    start: 0.3,
    end: 0.58,
  },
  {
    id: 3,
    title: "3. 原地无栈遍历复杂度证明",
    latex: "T(n) = O(1) \\text{ 均摊单步定位}, \\quad S(n) = O(1) \\text{ 零额外栈开销}",
    explanation: "线索化消除递归系统栈依赖，达成高效原地双向遍历",
    start: 0.6,
    end: 0.88,
  },
];

export const SceneDeepFocus: React.FC<StageSceneProps> = ({
  node,
  activeTrack = "mastery",
  track,
  localProgress = 0,
  isActive = true,
  isReducedMotion = false,
  reducedMotion = false,
  className = "",
}) => {
  const motionReduced = isReducedMotion || reducedMotion;
  const currentTrack = track || activeTrack;
  const p = motionReduced ? 1.0 : clamp(localProgress, 0, 1);
  const isMastery = currentTrack === "mastery";
  const steps = isMastery ? TAYLOR_MASTERY_STEPS : CS408_REMEDIAL_STEPS;

  const targetSeconds = isMastery ? 2538 : 1125;
  const currentTotalSeconds = Math.floor(
    interpolateCounterValue(p, targetSeconds, 0, 0.05, 0.85)
  );
  const clampedSecs = Math.max(0, Math.min(5999, currentTotalSeconds));
  const mins = Math.floor(clampedSecs / 60);
  const secs = clampedSecs % 60;
  const timerString = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const subSecString = String(Math.floor((p * 1000) % 100)).padStart(2, "0");

  const arcDashoffset = interpolateStrokeDashoffset(p, 600, 0.05, 0.88);
  const clockHandAngle = lerp(0, 360, p);

  const bars = Array.from({ length: 32 }, (_, i) => {
    if (motionReduced || !isActive) {
      return 20 + Math.round(50 * Math.sin((Math.PI * i) / 31));
    }
    const wave =
      20 +
      70 *
        Math.abs(
          Math.sin(2 * Math.PI * (p * 4 + i / 32)) *
            Math.cos(i * 0.35 + p * 2)
        );
    return Math.round(clamp(wave, 10, 100));
  });

  const stabilityValue = interpolateCounterValue(p, 98.6, 72.0, 0.1, 0.8);
  const stabilityFormatted = `${stabilityValue.toFixed(1)}%`;
  const stamp = getStampTransform(p, 0.65, 0.85);

  return (
    <div
      className={`relative flex h-full min-h-[460px] sm:min-h-[480px] w-full flex-col justify-between overflow-hidden rounded-xl bg-[#090b0e]/95 p-3.5 sm:p-5 text-zinc-100 select-none ${className}`}
      data-scene="deep-focus"
      data-track={currentTrack}
      data-testid="scene-deep-focus"
    >
      {/* Background Watermark & Atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-teal-600/10 blur-[90px]" />
        <div className="absolute -right-20 -bottom-20 size-80 rounded-full bg-emerald-600/10 blur-[90px]" />
        <div className="absolute right-4 top-4 font-mono text-[6rem] sm:text-[8rem] font-black text-teal-500/[0.03] leading-none select-none">
          02
        </div>
      </div>

      {/* 3-Wing Horizon */}
      <div className="relative z-10 grid flex-1 grid-cols-1 items-stretch gap-3 sm:gap-4 lg:grid-cols-[28%_44%_28%] min-h-0">
        {/* LEFT WING (28%): Academic Derivation */}
        <section
          aria-label="学术推导与证明上下文"
          className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c1316]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-teal-400">
                <Waves className="size-3.5 text-teal-400" />
                <span>{isMastery ? "高等数学 · MATH-01" : "408 计算机 · CS-408"}</span>
              </div>
              <span className="rounded border border-teal-500/30 bg-teal-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-teal-300">
                {isMastery ? "深度心流" : "靶向攻坚"}
              </span>
            </div>

            <div className="mt-2.5 font-mono text-xs font-bold text-zinc-100">
              {isMastery ? "泰勒中值定理与拉格朗日余项推导" : "中序线索二叉树后继遍历算法推演"}
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {steps.map((step) => {
                const stepProg = segmentProgress(p, step.start, step.end);
                const isPassed = stepProg >= 1.0;
                const isCurrent = stepProg > 0.0 && stepProg < 1.0;

                return (
                  <div
                    key={step.id}
                    className={`rounded-lg border p-2.5 transition-all duration-300 ${
                      isPassed || isCurrent
                        ? "border-teal-500/40 bg-teal-950/25 shadow-[0_0_15px_rgba(45,212,191,0.08)]"
                        : "border-white/[0.05] bg-white/[0.01] opacity-50"
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] font-bold">
                      <span className={isPassed || isCurrent ? "text-teal-300" : "text-zinc-400"}>
                        {step.title}
                      </span>
                      {isPassed ? (
                        <CheckCircle2 className="size-3.5 text-teal-400" />
                      ) : isCurrent ? (
                        <Radio className="size-3.5 text-teal-300 animate-pulse" />
                      ) : (
                        <Circle className="size-3 text-zinc-600" />
                      )}
                    </div>

                    <div className="mt-1.5 font-mono text-[10px] font-semibold text-teal-200/90 break-all bg-black/40 px-2 py-1 rounded border border-teal-500/15">
                      {step.latex}
                    </div>

                    <div className="mt-1 text-[9px] text-zinc-400 leading-tight">
                      {step.explanation}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-teal-500/20 bg-teal-950/40 px-2.5 py-1.5 font-mono text-[10px] text-teal-300">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-teal-400 animate-ping" />
              <span>Alpha 脑波共振 · 12 Hz</span>
            </div>
            <span className="font-bold text-teal-400">心流深度 96%</span>
          </div>
        </section>

        {/* CENTER KINETIC CORE (44%): 3D Chrono-Sphere & Equalizer */}
        <section
          aria-label="3D 引力时钟与声学均衡核心"
          className="relative flex flex-col items-center justify-between rounded-xl border border-teal-500/20 bg-[#0c1417]/90 p-4 shadow-inner min-h-[280px] overflow-hidden"
        >
          <div className="absolute inset-0 bg-[radial-gradient(#2dd4bf_1px,transparent_1px)] [background-size:20px_20px] opacity-10 pointer-events-none" />

          {/* 3D Chrono-Sphere Viewport */}
          <div className="relative flex flex-1 w-full items-center justify-center min-h-[200px]">
            <div className="relative flex size-52 sm:size-60 lg:size-68 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-teal-500/10 blur-2xl" />

              {/* Concentric Dashed Orbit */}
              <div
                className="absolute inset-0 rounded-full border border-dashed border-teal-500/25 will-change-transform"
                style={{ transform: `rotate(${clockHandAngle * 0.5}deg)` }}
              />

              {/* 12 Chrono Gear Tick Marks */}
              <div className="absolute inset-2 rounded-full border border-teal-500/15 pointer-events-none">
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
                  <div
                    key={deg}
                    className="absolute top-0 left-1/2 -ml-px h-2 w-0.5 bg-teal-400/40 origin-[50%_100px] sm:origin-[50%_116px] lg:origin-[50%_132px]"
                    style={{ transform: `rotate(${deg}deg)` }}
                  />
                ))}
              </div>

              {/* SVG Circular Progress Arc */}
              <svg className="absolute inset-0 size-full -rotate-90">
                <defs>
                  <linearGradient id="chronoTealGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2dd4bf" />
                    <stop offset="60%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="#0d9488" />
                  </linearGradient>
                </defs>
                <circle
                  cx="50%"
                  cy="50%"
                  r="44%"
                  fill="none"
                  stroke="rgba(20, 184, 166, 0.12)"
                  strokeWidth="7"
                />
                <circle
                  cx="50%"
                  cy="50%"
                  r="44%"
                  fill="none"
                  stroke="url(#chronoTealGlow)"
                  strokeWidth="7"
                  strokeDasharray="600"
                  strokeDashoffset={motionReduced ? 0 : arcDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-75"
                />
              </svg>

              {/* Chrono-Hand Needle */}
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none will-change-transform"
                style={{ transform: `rotate(${clockHandAngle}deg)` }}
              >
                <div className="absolute top-6 h-14 sm:h-16 w-0.5 bg-gradient-to-t from-teal-400 to-transparent" />
                <div className="absolute top-5 size-2 rounded-full bg-teal-300 shadow-[0_0_8px_#2dd4bf]" />
              </div>

              {/* Center Display Pod */}
              <div className="relative flex size-36 sm:size-40 lg:size-44 flex-col items-center justify-center rounded-full border border-teal-500/40 bg-[#0f1b1f]/95 shadow-[0_0_40px_rgba(45,212,191,0.3)] backdrop-blur-lg">
                <div className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-teal-400">
                  <Flame className="size-3 text-teal-400 animate-bounce" />
                  <span>心流状态 · 0 中断</span>
                </div>

                <div className="my-0.5 flex items-baseline font-mono font-black tracking-tight text-white drop-shadow-[0_0_18px_rgba(45,212,191,0.5)]">
                  <span className="text-3xl sm:text-4xl">{timerString}</span>
                  <span className="text-xs sm:text-sm font-bold text-teal-400/80 ml-0.5">.{subSecString}</span>
                </div>

                <div className="flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 font-mono text-[9px] font-bold text-teal-300">
                  <span className="size-1.5 rounded-full bg-teal-400 animate-ping" />
                  <span>{isMastery ? "泰勒级数展开 · 证明中" : "二叉树线索化 · 诊断中"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 32-Column Equalizer Spectrum */}
          <div className="w-full mt-2">
            <div className="flex items-center justify-between font-mono text-[9px] text-zinc-500 mb-1 px-1">
              <span>20 Hz</span>
              <span className="text-teal-400/80 font-bold">32-BAND EQUALIZER SPECTRUM</span>
              <span>20 kHz</span>
            </div>
            <div className="flex items-end justify-center gap-0.5 sm:gap-1 h-9 sm:h-10 w-full px-1">
              {bars.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-full bg-gradient-to-t from-teal-500/30 via-teal-400/70 to-teal-300 transition-[height] duration-150 ease-out"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </section>

        {/* RIGHT WING (28%): Real-Time Telemetry & Stamp */}
        <section
          aria-label="实时专注遥测与固化印章"
          className="relative flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c1316]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-teal-400">
              <div className="flex items-center gap-1.5">
                <Activity className="size-3.5 text-teal-400" />
                <span>实时专注遥测</span>
              </div>
              <span className="text-[10px] text-zinc-400">TELEMETRY</span>
            </div>

            <div className="mt-3 rounded-lg border border-teal-500/25 bg-teal-950/20 p-2.5">
              <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400">
                <span>专注稳定性</span>
                <span className="text-teal-400 font-bold">极佳稳态</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <div className="font-mono text-2xl font-black text-white drop-shadow-[0_0_10px_rgba(45,212,191,0.4)]">
                  {stabilityFormatted}
                </div>
                <ShieldCheck className="size-5 text-teal-400" />
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-black/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-300 transition-all duration-300"
                  style={{ width: `${stabilityValue}%` }}
                />
              </div>
            </div>

            <div className="mt-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 font-mono text-[10px]">
              <div className="flex items-center justify-between text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <Lock className="size-3.5 text-teal-400" />
                  <span className="font-bold">CAS 单会话互斥</span>
                </div>
                <span className="rounded bg-teal-500/20 px-1.5 py-0.5 text-[9px] font-bold text-teal-300">
                  ACTIVE
                </span>
              </div>
              <div className="mt-1 text-[9px] text-zinc-400 leading-tight">
                乐观并发锁保护中 · 0 次中断 · 毫秒级防重叠
              </div>
            </div>

            <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 font-mono text-[10px]">
              <div className="flex items-center justify-between text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <Database className="size-3.5 text-teal-400" />
                  <span className="font-bold">本地优先存证</span>
                </div>
                <span className="text-[9px] text-teal-400 font-bold">SYNCED</span>
              </div>
              <div className="mt-1 text-[9px] text-zinc-400 leading-tight">
                IndexedDB 毫秒级写入 · 认知熵 0.018 (STABLE)
              </div>
            </div>
          </div>

          {/* Holographic Stamp: [FLOW_ENGAGED] */}
          <div className="relative mt-2 mb-1 flex items-center justify-center min-h-[56px]">
            <div
              className="relative rounded-lg border-2 border-teal-400 bg-teal-950/80 px-3.5 py-2 text-center shadow-[0_0_25px_rgba(45,212,191,0.5)] backdrop-blur-md will-change-transform"
              style={{
                transform: `scale(${motionReduced ? 1.0 : stamp.scale}) rotate(${motionReduced ? -6 : stamp.rotateDeg}deg) translateY(${motionReduced ? 0 : stamp.translateY}px)`,
                opacity: motionReduced ? 1.0 : stamp.opacity,
              }}
            >
              <div className="absolute inset-0.5 rounded border border-dashed border-teal-400/60 pointer-events-none" />
              <div className="flex items-center justify-center gap-1.5 font-mono text-xs font-black tracking-wider text-teal-300">
                <Sparkles className="size-3.5 text-teal-300" />
                <span>[FLOW_ENGAGED]</span>
              </div>
              <div className="font-mono text-[9px] font-bold text-teal-400/90 tracking-tight">
                42 MIN · IMMUTABLE
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>下一阶段</span>
              <span className="flex items-center gap-1 font-bold text-teal-300">
                STEP 03 证据归档
                <ArrowRight className="size-3 text-teal-400" />
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* BOTTOM STREAM RELAY */}
      <footer
        aria-label="研学流水接力管道"
        className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-500/20 bg-teal-950/30 px-3.5 py-2 font-mono text-[11px] text-zinc-300 backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-bold text-teal-400">
            <Clock3 className="size-3" />
            {node?.inputLabel || "承接"}:
          </span>
          <span className="text-white font-medium">{node?.inputValue || "学习意图 (高等数学)"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-teal-300 font-bold">{node?.actionLabel || "42 分钟持续投入"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-zinc-400">{node?.outputLabel || "形成"}</span>
          <span className="rounded bg-teal-500/20 px-1.5 py-0.5 font-bold text-teal-300">
            {node?.outputValue || "学习活动"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-teal-400/90 font-bold">
          <CheckCircle2 className="size-3 text-teal-400" />
          <span>{node?.nextLabel || "把时间送入学习收口"}</span>
        </div>
      </footer>
    </div>
  );
};
