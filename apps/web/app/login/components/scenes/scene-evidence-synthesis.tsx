"use client";

import React, { useId } from "react";
import {
  ArrowRight,
  Award,
  CheckCircle2,
  Cpu,
  Database,
  FileCheck2,
  Fingerprint,
  Layers,
  NotebookPen,
  Radio,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  clamp,
  getStampTransform,
  interpolateCounterValue,
  interpolateStrokeDashoffset,
  lerp,
  segmentProgress,
} from "../../utils/kinematics";
import type { StageSceneProps } from "./scene-target-intent";

export const SceneEvidenceSynthesis: React.FC<StageSceneProps> = ({
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

  const rayProgress = segmentProgress(p, 0.05, 0.55);
  const glintProgress = segmentProgress(p, 0.45, 0.85);
  const hashLength = Math.round(interpolateCounterValue(p, 32, 0, 0.35, 0.75));
  const fullHash = isMastery
    ? "8f9b4c2e7d12a9c3b4f5e6a10987dcba"
    : "3a7c1f8d9e42b651c084fc2dd4bf60a5";
  const displayedHash = fullHash.slice(0, hashLength) + (hashLength < 32 ? "..." : "");

  const durationMins = Math.round(interpolateCounterValue(p, isMastery ? 60 : 35, 0, 0.1, 0.6));
  const outputCount = Math.round(interpolateCounterValue(p, isMastery ? 3 : 2, 0, 0.15, 0.65));
  const gapClosurePct = Math.round(interpolateCounterValue(p, isMastery ? 100 : 80, 0, 0.2, 0.7));

  const stamp = getStampTransform(p, 0.65, 0.85);

  return (
    <div
      className={`relative flex h-full min-h-[460px] sm:min-h-[480px] w-full flex-col justify-between overflow-hidden rounded-xl bg-[#090b0e]/95 p-3.5 sm:p-5 text-zinc-100 select-none ${className}`}
      data-scene="evidence-synthesis"
      data-track={currentTrack}
      data-testid="scene-evidence-synthesis"
    >
      {/* Background Watermark & Atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-amber-600/10 blur-[90px]" />
        <div className="absolute -right-20 -bottom-20 size-80 rounded-full bg-yellow-600/10 blur-[90px]" />
        <div className="absolute right-4 top-4 font-mono text-[6rem] sm:text-[8rem] font-black text-amber-500/[0.03] leading-none select-none">
          03
        </div>
      </div>

      {/* Main 3-Wing Horizon */}
      <div className="relative z-10 grid flex-1 grid-cols-1 items-stretch gap-3 sm:gap-4 lg:grid-cols-[28%_44%_28%] min-h-0">
        {/* WING 1: LEFT CONTEXT WING (28%) - Three Inflow Streams */}
        <section
          aria-label="三路研学投入源汇聚"
          className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#14120e]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-400">
                <Layers className="size-3.5 text-amber-400" />
                <span>三路投入源归集</span>
              </div>
              <span className="rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                {isMastery ? "成果熔铸" : "断层归集"}
              </span>
            </div>

            <div className="mt-2.5 font-mono text-xs font-bold text-zinc-100">
              {isMastery ? "泰勒级数展开与母题模型提取" : "反常积分与极限审敛断层切片"}
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {/* Stream 1: Valid Duration */}
              <div className="rounded-lg border border-teal-500/30 bg-teal-950/20 p-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] font-bold text-teal-300">
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-teal-400" />
                    净专注时长
                  </span>
                  <span>{durationMins} MIN (96%)</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  单会话 CAS 互斥锁保护 · 0 中断纯净投入
                </div>
              </div>

              {/* Stream 2: Core Artifacts */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] font-bold text-amber-300">
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-amber-400" />
                    核心产出证明
                  </span>
                  <span>{outputCount} 处大题推导</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  {isMastery ? "压轴母题模型已提取 · 沉淀高阶凭据" : "概念盲区已定位 · 生成阶梯诊断卡"}
                </div>
              </div>

              {/* Stream 3: Gaps / Knowledge Grade */}
              <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] font-bold text-purple-300">
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-purple-400" />
                    {isMastery ? "图谱固化等级" : "断层核销进度"}
                  </span>
                  <span>{isMastery ? "Grade S 已达成" : `${gapClosurePct}% 闭合`}</span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  {isMastery ? "免除近期基础复测 · 激活长效固化" : "遗留卡点定向排入专项复测池"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-950/40 px-2.5 py-1.5 font-mono text-[10px] text-amber-300">
            <div className="flex items-center gap-1.5">
              <Zap className="size-3 text-amber-400" />
              <span>三路流能量汇聚中</span>
            </div>
            <span className="font-bold text-amber-400">100% 结构化</span>
          </div>
        </section>

        {/* WING 2: CENTER KINETIC CORE (44%) - 3D Holographic Evidence Chip */}
        <section
          aria-label="3D 浮空证据芯片与激光熔铸核心"
          className="relative flex flex-col items-center justify-between rounded-xl border border-amber-500/20 bg-[#12100c]/90 p-4 shadow-inner min-h-[280px] overflow-hidden"
        >
          {/* Converging Laser Energy Beams */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id={`${idPrefix}-tealBeam`} x1="0%" y1="0%" x2="50%" y2="50%">
                <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.1" />
              </linearGradient>
              <linearGradient id={`${idPrefix}-amberBeam`} x1="100%" y1="0%" x2="50%" y2="50%">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.1" />
              </linearGradient>
              <linearGradient id={`${idPrefix}-purpleBeam`} x1="50%" y1="100%" x2="50%" y2="50%">
                <stop offset="0%" stopColor="#c084fc" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.1" />
              </linearGradient>
            </defs>

            {/* Inflow Ray 1: Top-Left (Teal) */}
            <path
              d="M 30 30 Q 120 100 50% 50%"
              stroke={`url(#${idPrefix}-tealBeam)`}
              strokeWidth="2"
              strokeDasharray="6,4"
              strokeDashoffset={interpolateStrokeDashoffset(rayProgress, 200, 0, 1)}
              fill="none"
            />
            {/* Inflow Ray 2: Top-Right (Amber) */}
            <path
              d="M 370 30 Q 280 100 50% 50%"
              stroke={`url(#${idPrefix}-amberBeam)`}
              strokeWidth="2"
              strokeDasharray="6,4"
              strokeDashoffset={interpolateStrokeDashoffset(rayProgress, 200, 0, 1)}
              fill="none"
            />
            {/* Inflow Ray 3: Bottom-Center (Purple) */}
            <path
              d="M 50% 280 Q 50% 200 50% 50%"
              stroke={`url(#${idPrefix}-purpleBeam)`}
              strokeWidth="2"
              strokeDasharray="6,4"
              strokeDashoffset={interpolateStrokeDashoffset(rayProgress, 200, 0, 1)}
              fill="none"
            />
          </svg>

          {/* Central 3D Evidence Silicon Chip */}
          <div className="relative z-10 flex flex-1 w-full items-center justify-center min-h-[200px]">
            <div className="relative flex w-full max-w-[340px] sm:max-w-[380px] flex-col rounded-2xl border border-amber-500/40 bg-[#1a1610]/95 p-4 sm:p-5 shadow-[0_0_50px_rgba(251,191,36,0.25)] backdrop-blur-xl transition-all duration-300">
              {/* Chip Header Bar */}
              <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="grid size-8 place-items-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_12px_rgba(251,191,36,0.3)]">
                    <Cpu className="size-4 animate-pulse" />
                  </div>
                  <div>
                    <div className="font-mono text-xs font-black text-white tracking-wider">
                      EVIDENCE CHIP
                    </div>
                    <div className="font-mono text-[9px] text-amber-400/90 font-bold">
                      {isMastery ? "AF-EVID-ADV-8921" : "AF-EVID-GAP-4102"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400">
                  <FileCheck2 className="size-3" />
                  <span>SEALED</span>
                </div>
              </div>

              {/* Chip Body Circuits & Data Points */}
              <div className="my-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-2 text-center">
                  <div className="font-mono text-[9px] text-zinc-400">有效时长</div>
                  <div className="font-mono text-sm font-black text-teal-300">{durationMins} MIN</div>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-center">
                  <div className="font-mono text-[9px] text-zinc-400">产出证明</div>
                  <div className="font-mono text-sm font-black text-amber-300">{outputCount} 道大题</div>
                </div>
                <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2 text-center">
                  <div className="font-mono text-[9px] text-zinc-400">图谱状态</div>
                  <div className="font-mono text-sm font-black text-purple-300">
                    {isMastery ? "GRADE S" : "B+ 闭合"}
                  </div>
                </div>
              </div>

              {/* Dynamic SHA-256 Hash Digest Terminal */}
              <div className="rounded-lg border border-white/[0.08] bg-black/60 p-2 font-mono text-[9px]">
                <div className="flex items-center justify-between text-zinc-400 mb-0.5">
                  <span className="flex items-center gap-1 text-amber-400 font-bold">
                    <Fingerprint className="size-2.5" />
                    SHA-256 DIGEST:
                  </span>
                  <span className="text-[8px] text-emerald-400">VERIFIED</span>
                </div>
                <div className="text-zinc-300 truncate tracking-wider">{displayedHash}</div>
              </div>

              {/* Laser Holographic Seal Strip with Scrubbable Glint */}
              <div className="relative mt-2.5 overflow-hidden rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-amber-200 font-bold">
                  <Sparkles className="size-3 text-amber-400" />
                  <span>{isMastery ? "泰勒中值定理 · 完整高阶闭环" : "反常积分审敛 · 阶梯诊断凭据"}</span>
                </div>
                <span className="font-mono text-[9px] text-amber-400 font-bold">GRADE A</span>

                {/* Laser Scan Sweep Light */}
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent will-change-transform"
                  style={{
                    transform: `translateX(${lerp(-100, 100, glintProgress)}%)`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="absolute bottom-2.5 flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-950/60 px-3 py-0.5 font-mono text-[10px] text-amber-300 shadow-md backdrop-blur-md">
            <Radio className="size-3 text-amber-400 animate-pulse" />
            <span>研学证据已凝结熔铸 · 存证不可篡改</span>
          </div>
        </section>

        {/* WING 3: RIGHT METRICS WING (28%) - Cryptographic Verification & Stamp */}
        <section
          aria-label="密码学存证与复测路由"
          className="relative flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#14120e]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-amber-400">
              <div className="flex items-center gap-1.5">
                <Award className="size-3.5 text-amber-400" />
                <span>存证审计与路由</span>
              </div>
              <span className="text-[10px] text-zinc-400">AUDIT</span>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 p-2.5">
                <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400">
                  <span>凭证序列号</span>
                  <span className="text-amber-300 font-bold">AF-8921</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <div className="font-mono text-xl font-black text-white">SEALED</div>
                  <ShieldCheck className="size-5 text-amber-400" />
                </div>
                <div className="mt-1 text-[9px] text-zinc-400">
                  PostgreSQL 主状态存证 · 附件 Metadata 严格对账
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 font-mono text-[10px]">
                <div className="flex items-center justify-between text-zinc-300">
                  <div className="flex items-center gap-1.5">
                    <Database className="size-3.5 text-amber-400" />
                    <span className="font-bold">复测路由决策</span>
                  </div>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                    {isMastery ? "EXEMPT" : "QUEUED"}
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-400 leading-tight">
                  {isMastery
                    ? "解题逻辑严谨，母题已入库，免除近期基础复测"
                    : "去心邻域边界卡点已提取，排入明日专项复测池"}
                </div>
              </div>
            </div>
          </div>

          {/* Holographic Metal Stamp: [EVID_SEALED] */}
          <div className="relative my-2 flex items-center justify-center py-1 min-h-[56px]">
            <div
              className="flex items-center gap-2 rounded-lg border-2 border-amber-400/90 bg-gradient-to-br from-amber-950/90 via-[#1f190e] to-amber-900/90 px-3.5 py-2 shadow-[0_0_25px_rgba(251,191,36,0.6)] backdrop-blur-md will-change-transform"
              style={{
                transform: `scale(${motionReduced ? 1.0 : stamp.scale}) rotate(${motionReduced ? -6 : stamp.rotateDeg}deg) translateY(${motionReduced ? 0 : stamp.translateY}px)`,
                opacity: motionReduced ? 1.0 : stamp.opacity,
              }}
            >
              <ShieldCheck className="size-4 text-amber-400" />
              <div className="font-mono text-xs font-black tracking-wider text-amber-200">
                {isMastery ? "[ADVANCED_SEALED]" : "[GAP_REGISTERED]"}
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>下一阶段</span>
              <span className="flex items-center gap-1 font-bold text-amber-300">
                STEP 04 证据复测
                <ArrowRight className="size-3 text-amber-400" />
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* BOTTOM STREAM RELAY */}
      <footer
        aria-label="研学流水接力管道"
        className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-950/30 px-3.5 py-2 font-mono text-[11px] text-zinc-300 shadow-sm backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-bold text-amber-400">
            <NotebookPen className="size-3" />
            {node?.inputLabel || "承接"}:
          </span>
          <span className="text-white font-medium">{node?.inputValue || "学习活动"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-amber-300 font-bold">{node?.actionLabel || "提交结果与问题"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-zinc-400">{node?.outputLabel || "形成"}</span>
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-bold text-amber-300">
            {node?.outputValue || "学习证据"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90 font-bold">
          <CheckCircle2 className="size-3 text-amber-400" />
          <span>{node?.nextLabel || "用证据安排复测"}</span>
        </div>
      </footer>
    </div>
  );
};
