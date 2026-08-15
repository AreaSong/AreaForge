"use client";

import React, { useId } from "react";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  HelpCircle,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  clamp,
  getStampTransform,
  interpolateCardRotateY,
  interpolateCounterValue,
  interpolateStrokeDashoffset,
} from "../../utils/kinematics";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneProofVerification: React.FC<StageSceneProps> = ({
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

  const cardRotateY = motionReduced ? 180 : interpolateCardRotateY(p, 0, 180, 0.25, 0.7);
  const isCardFlipped = cardRotateY >= 90;

  const baselineMastery = isMastery ? 85 : 58;
  const targetMastery = isMastery ? 96 : 88;
  const currentMastery = Math.round(
    interpolateCounterValue(p, targetMastery, baselineMastery, 0.45, 0.85)
  );
  const leapDelta = currentMastery - baselineMastery;

  const latencySecs = interpolateCounterValue(p, 3.42, 0.0, 0.1, 0.55).toFixed(2);
  const stamp = getStampTransform(p, 0.65, 0.85);
  const waveOffset = interpolateStrokeDashoffset(p, 400, 0.05, 0.6);

  return (
    <div
      className={`relative flex h-full min-h-[460px] sm:min-h-[480px] w-full flex-col justify-between overflow-hidden rounded-xl bg-[#090b0e]/95 p-3.5 sm:p-5 text-zinc-100 select-none ${className}`}
      data-scene="proof-verification"
      data-track={currentTrack}
      data-testid="scene-proof-verification"
    >
      {/* Background Watermark & Atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-sky-600/10 blur-[90px]" />
        <div className="absolute -right-20 -bottom-20 size-80 rounded-full bg-indigo-600/10 blur-[90px]" />
        <div className="absolute right-4 top-4 font-mono text-[6rem] sm:text-[8rem] font-black text-sky-500/[0.03] leading-none select-none">
          04
        </div>
      </div>

      {/* Main 3-Wing Horizon */}
      <div className="relative z-10 grid flex-1 grid-cols-1 items-stretch gap-3 sm:gap-4 lg:grid-cols-[28%_44%_28%] min-h-0">
        {/* WING 1: LEFT CONTEXT WING (28%) - Ebbinghaus Decay & Retention */}
        <section
          aria-label="艾宾浩斯记忆衰减与复测拦截模型"
          className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c141c]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-sky-400">
                <BrainCircuit className="size-3.5 text-sky-400" />
                <span>艾宾浩斯记忆曲线</span>
              </div>
              <span className="rounded border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                {isMastery ? "盲测冲顶" : "阶梯诊断"}
              </span>
            </div>

            <div className="mt-2.5 font-mono text-xs font-bold text-zinc-100">
              主动回忆检测 · 拦截自然遗忘拐点
            </div>

            {/* SVG Ebbinghaus Curve */}
            <div className="my-3 relative h-20 w-full rounded-lg border border-sky-500/20 bg-black/40 p-1.5 overflow-hidden">
              <svg className="h-full w-full" viewBox="0 0 200 60">
                <defs>
                  <linearGradient id={`${idPrefix}-waveGrad`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="50%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="45" x2="200" y2="45" stroke="rgba(255,255,255,0.08)" strokeDasharray="3,3" />
                <path
                  d="M 5 10 Q 50 48 90 45 T 150 15 T 195 12"
                  stroke={`url(#${idPrefix}-waveGrad)`}
                  strokeWidth="2.5"
                  fill="none"
                  strokeDasharray="400"
                  strokeDashoffset={motionReduced ? 0 : waveOffset}
                  className="transition-all duration-150"
                />
                <circle cx="5" cy="10" r="3" fill="#38bdf8" />
                <circle cx="90" cy="45" r="3" fill="#f59e0b" />
                <circle cx="150" cy="15" r="3.5" fill="#34d399" />
              </svg>
              <div className="absolute top-1 left-2 font-mono text-[8px] text-sky-400">即时 100%</div>
              <div className="absolute bottom-1 left-[38%] font-mono text-[8px] text-amber-400">20m 衰减 58%</div>
              <div className="absolute top-1 right-2 font-mono text-[8px] text-emerald-400">复测激活 94%</div>
            </div>

            <div className="space-y-1.5 font-mono text-[10px]">
              <div className="flex items-center justify-between rounded bg-white/[0.02] px-2 py-1 text-zinc-300">
                <span className="text-zinc-400">20 分钟衰减拐点</span>
                <span className="text-amber-400 font-bold">58% 留存 (已拦截)</span>
              </div>
              <div className="flex items-center justify-between rounded bg-white/[0.02] px-2 py-1 text-zinc-300">
                <span className="text-zinc-400">24 小时首轮固化</span>
                <span className="text-sky-300 font-bold">92% 掌握激活</span>
              </div>
              <div className="flex items-center justify-between rounded bg-white/[0.02] px-2 py-1 text-zinc-300">
                <span className="text-zinc-400">7 天长效永久节点</span>
                <span className="text-emerald-400 font-bold">GRADE S 稳固</span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-sky-500/20 bg-sky-950/40 px-2.5 py-1.5 font-mono text-[10px] text-sky-300">
            <div className="flex items-center gap-1.5">
              <RotateCcw className="size-3 text-sky-400" />
              <span>闭卷盲测作答中</span>
            </div>
            <span className="font-bold text-sky-400">{latencySecs}s</span>
          </div>
        </section>

        {/* WING 2: CENTER KINETIC CORE (44%) - 3D Perspective Flip Card */}
        <section
          aria-label="3D 空间真题盲测与解析闪卡核心"
          className="relative flex flex-col items-center justify-between rounded-xl border border-sky-500/20 bg-[#09131d]/90 p-4 shadow-inner min-h-[280px] overflow-hidden"
          style={{ perspective: "1000px" }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:20px_20px] opacity-10 pointer-events-none" />

          {/* 3D Perspective Card Container */}
          <div className="relative z-10 flex flex-1 w-full items-center justify-center min-h-[220px]">
            <div
              className="relative size-full max-w-[360px] sm:max-w-[400px] h-[210px] sm:h-[220px] transition-transform duration-300 will-change-transform"
              style={{
                transformStyle: "preserve-3d",
                transform: `rotateY(${cardRotateY}deg)`,
              }}
            >
              {/* CARD FRONT (0deg): Challenge Question */}
              <div
                className={`absolute inset-0 flex flex-col justify-between rounded-2xl border border-sky-500/40 bg-[#0e192c]/95 p-4 shadow-[0_0_40px_rgba(56,189,248,0.3)] backdrop-blur-xl ${
                  isCardFlipped ? "pointer-events-none" : ""
                }`}
                style={{
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                }}
              >
                <div>
                  <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
                    <div className="flex items-center gap-1.5">
                      <HelpCircle className="size-3.5 text-sky-400" />
                      <span className="font-mono text-[11px] font-bold text-sky-300">
                        {isMastery ? "真题变式盲测 · PROMPT" : "概念诊断抽测 · QUESTION"}
                      </span>
                    </div>
                    <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-[9px] font-bold text-sky-300">
                      MATH-2024-T17
                    </span>
                  </div>

                  <div className="mt-2.5 text-xs font-bold text-white leading-snug">
                    {isMastery
                      ? "在多元极值判定中，若 Hessian 矩阵行列式为 0，如何构造高阶微元反例证明鞍点？"
                      : "为什么在 ε-δ 极限定义证明中，δ 的取值不仅取决于 ε，还必须受限于去心邻域边界？"}
                  </div>

                  <div className="mt-2 rounded-lg border border-sky-500/20 bg-black/40 p-2 font-mono text-[10px] text-sky-200/80 leading-relaxed">
                    提示：构造辅助函数消除一阶偏差，沿特定曲线方向展开 Taylor 多项式代入符号检验。
                  </div>
                </div>

                <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400 border-t border-white/[0.06] pt-2">
                  <span>盲测用时: {latencySecs}s</span>
                  <span className="text-sky-300 font-bold">翻转解析中 →</span>
                </div>
              </div>

              {/* CARD BACK (180deg): Rigorous Proof Breakdown */}
              <div
                className={`absolute inset-0 flex flex-col justify-between rounded-2xl border border-emerald-500/40 bg-[#0d2119]/95 p-4 shadow-[0_0_40px_rgba(52,211,153,0.35)] backdrop-blur-xl ${
                  !isCardFlipped ? "pointer-events-none" : ""
                }`}
                style={{
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                }}
              >
                <div>
                  <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-emerald-400" />
                      <span className="font-mono text-[11px] font-bold text-emerald-300">
                        核心证明解析 · PROOF RIGOR
                      </span>
                    </div>
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                      Q.E.D.
                    </span>
                  </div>

                  <div className="mt-2 rounded-lg border border-emerald-500/30 bg-black/50 p-2 font-mono text-[10px] text-emerald-200 leading-relaxed break-all">
                    {isMastery
                      ? "沿 y = kx² 抛物线方向展开 Taylor 多项式，代入检验符号变动，证得原点去心邻域内无极值。"
                      : "必须限制 |x - x₀| < 1 使待消公因式 |x + x₀| < 2|x₀| + 1 有确定上界，故取 δ = min{1, ε / (2|x₀| + 1)}。"}
                  </div>

                  <div className="mt-2 text-[10px] text-zinc-300 font-medium leading-tight">
                    逻辑推导完全严密 · 概念迁移稳固 · 具备压轴母题解决力
                  </div>
                </div>

                <div className="flex items-center justify-between font-mono text-[10px] text-emerald-400 border-t border-emerald-500/20 pt-2 font-bold">
                  <span>复测结论: 满分通过</span>
                  <span className="flex items-center gap-1">
                    <Sparkles className="size-3" />
                    掌握度已跃升
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="absolute bottom-2.5 flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-950/60 px-3 py-0.5 font-mono text-[10px] text-sky-300 shadow-md backdrop-blur-md">
            <Radio className="size-3 text-sky-400 animate-pulse" />
            <span>真题变式主动回忆 · 掌握度校准中</span>
          </div>
        </section>

        {/* WING 3: RIGHT METRICS WING (28%) - Quantum Mastery Leap */}
        <section
          aria-label="掌握度量子跃升与固化印章"
          className="relative flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c141c]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-sky-400">
              <div className="flex items-center gap-1.5">
                <Activity className="size-3.5 text-sky-400" />
                <span>掌握度校准遥测</span>
              </div>
              <span className="text-[10px] text-zinc-400">LEAP</span>
            </div>

            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/25 p-3">
              <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400">
                <span>前序基线 → 复测核准</span>
                <span className="text-emerald-400 font-bold">+{leapDelta}%</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-base text-zinc-500 line-through">
                    {baselineMastery}%
                  </span>
                  <span className="font-mono text-3xl font-black text-emerald-300 drop-shadow-[0_0_15px_rgba(52,211,153,0.6)]">
                    {currentMastery}%
                  </span>
                </div>
                <Zap className="size-5 text-emerald-400 animate-bounce" />
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-black/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${currentMastery}%` }}
                />
              </div>
            </div>

            <div className="mt-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 font-mono text-[10px]">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-bold">置信评级</span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-bold text-emerald-300">
                  {isMastery ? "GRADE S" : "GRADE A"}
                </span>
              </div>
              <div className="mt-1 text-[9px] text-zinc-400 leading-tight">
                {isMastery
                  ? "永久固化节点已激活 · 免除近期重复复测"
                  : "断层成功闭合 · 并入今日日终核销"}
              </div>
            </div>
          </div>

          {/* Holographic Stamp: [PROOF_VERIFIED] */}
          <div className="relative my-2 flex items-center justify-center py-1 min-h-[56px]">
            <div
              className="flex items-center gap-2 rounded-lg border-2 border-sky-400/90 bg-gradient-to-br from-sky-950/90 via-[#0e1b2e] to-emerald-950/90 px-3.5 py-2 shadow-[0_0_25px_rgba(56,189,248,0.6)] backdrop-blur-md will-change-transform"
              style={{
                transform: `scale(${motionReduced ? 1.0 : stamp.scale}) rotate(${motionReduced ? -6 : stamp.rotateDeg}deg) translateY(${motionReduced ? 0 : stamp.translateY}px)`,
                opacity: motionReduced ? 1.0 : stamp.opacity,
              }}
            >
              <ShieldCheck className="size-4 text-sky-400" />
              <div className="font-mono text-xs font-black tracking-wider text-sky-200">
                {isMastery ? "[RETRIEVAL_VERIFIED]" : "[GAP_REMEDIATED]"}
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>下一阶段</span>
              <span className="flex items-center gap-1 font-bold text-sky-300">
                STEP 05 今日闭环
                <ArrowRight className="size-3 text-sky-400" />
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* BOTTOM STREAM RELAY */}
      <footer
        aria-label="研学流水接力管道"
        className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/20 bg-sky-950/30 px-3.5 py-2 font-mono text-[11px] text-zinc-300 shadow-sm backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-bold text-sky-400">
            <BrainCircuit className="size-3" />
            {node?.inputLabel || "承接"}:
          </span>
          <span className="text-white font-medium">{node?.inputValue || "学习证据"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-sky-300 font-bold">{node?.actionLabel || "回忆与复测"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-zinc-400">{node?.outputLabel || "形成"}</span>
          <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-bold text-sky-300">
            {node?.outputValue || "掌握判断"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-sky-400/90 font-bold">
          <CheckCircle2 className="size-3 text-sky-400" />
          <span>{node?.nextLabel || "把掌握结果并入今日闭环"}</span>
        </div>
      </footer>
    </div>
  );
};
