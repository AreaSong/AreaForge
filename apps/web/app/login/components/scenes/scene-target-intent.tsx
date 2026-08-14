"use client";

import React, { useId, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Crosshair,
  Gauge,
  Languages,
  Lock,
  Radio,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import type { LearningLoopNode, SubjectTelemetry, TrackMode } from "../../constants/learning-loop";
import {
  clamp,
  easeOutBack,
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
  reducedMotion?: boolean;
  isReducedMotion?: boolean;
  className?: string;
  onSelectSubject?: (subjectId: string) => void;
}

interface ConstellationNode {
  id: string;
  name: string;
  enName: string;
  category: string;
  x: number;
  y: number;
  weight: string;
  isTarget?: boolean;
}

const CONSTELLATION_DATA: Record<string, ConstellationNode[]> = {
  math: [
    { id: "k1", name: "ε-δ 极限定义", enName: "Epsilon-Delta", category: "基础理论", x: 22, y: 28, weight: "15%" },
    { id: "k2", name: "泰勒中值定理", enName: "Taylor Theorem", category: "核心攻坚", x: 74, y: 26, weight: "28%", isTarget: true },
    { id: "k3", name: "柯西中值定理", enName: "Cauchy MVT", category: "辅助构造", x: 80, y: 72, weight: "18%" },
    { id: "k4", name: "二重积分极坐标", enName: "Polar Integral", category: "对称代换", x: 20, y: 74, weight: "20%" },
    { id: "k5", name: "齐次微分方程", enName: "Homogeneous ODE", category: "特征根系", x: 48, y: 16, weight: "19%" },
  ],
  cs408: [
    { id: "k1", name: "红黑树不变式", enName: "Red-Black Tree", category: "核心算法", x: 74, y: 26, weight: "28%", isTarget: true },
    { id: "k2", name: "线索二叉树", enName: "Threaded Tree", category: "数据结构", x: 22, y: 28, weight: "20%" },
    { id: "k3", name: "虚拟内存页表", enName: "Page Table", category: "操作系统", x: 80, y: 72, weight: "18%" },
    { id: "k4", name: "TCP 拥塞控制", enName: "Congestion Ctrl", category: "网络协议", x: 20, y: 74, weight: "19%" },
    { id: "k5", name: "拓扑排序关键路径", enName: "Critical Path", category: "图论算法", x: 48, y: 16, weight: "15%" },
  ],
  english: [
    { id: "k1", name: "长难句主干剖析", enName: "Matrix Clause", category: "深度精读", x: 74, y: 26, weight: "30%", isTarget: true },
    { id: "k2", name: "同位语与定语判别", enName: "Appositive Clause", category: "语法结构", x: 22, y: 28, weight: "22%" },
    { id: "k3", name: "倒装与强调句型", enName: "Inversion Pattern", category: "句法修辞", x: 80, y: 72, weight: "18%" },
    { id: "k4", name: "熟词生义解构", enName: "Semantic Nuance", category: "词汇突破", x: 20, y: 74, weight: "15%" },
    { id: "k5", name: "篇章代词指代", enName: "Discourse Cohesion", category: "逻辑推断", x: 48, y: 16, weight: "15%" },
  ],
};

const DEFAULT_SUBJECTS: SubjectTelemetry[] = [
  {
    id: "math",
    name: "高等数学",
    enName: "ADVANCED MATH",
    code: "MATH-01",
    topic: "多元微分学极值判定与 Hessian 矩阵二次型证明",
    tier: "高阶攻坚 · 压轴综合",
    targetDuration: "60 MIN",
    confidence: "92%",
    formula: "f(x,y) = f(x_0,y_0) + df + \\frac{1}{2!}d^2f + R_n, \\quad \\mathbf{H} \\succ 0 \\Rightarrow \\text{Min}",
    active: true,
  },
  {
    id: "cs408",
    name: "408 计算机学科",
    enName: "CS 408 COMPREHENSIVE",
    code: "CS-408",
    topic: "红黑树 5 大不变式性质与插入旋转重平衡",
    tier: "数据结构 · 算法核心",
    targetDuration: "60 MIN",
    confidence: "88%",
    formula: "RB-Insert-Fixup(T, z): Case 1/2/3 Recolor and Rotations",
    active: false,
  },
  {
    id: "english",
    name: "考研英语",
    enName: "ENGLISH ACADEMIC",
    code: "ENG-01",
    topic: "学术社论超长难句多层嵌套从句主干剖析与修辞解构",
    tier: "英语精读 · 深度剖析",
    targetDuration: "45 MIN",
    confidence: "90%",
    formula: "Clause(Matrix) \\oplus Relative[that/which] \\Rightarrow Core Proposition",
    active: false,
  },
];

export const SceneTargetIntent: React.FC<StageSceneProps> = ({
  node,
  activeTrack = "mastery",
  track,
  localProgress = 0,
  isActive = true,
  reducedMotion = false,
  isReducedMotion = false,
  className = "",
  onSelectSubject,
}) => {
  const isMotionReduced = reducedMotion || isReducedMotion;
  const currentTrack = track || activeTrack;
  const p = isMotionReduced ? 1.0 : clamp(localProgress, 0, 1);
  const maskId = useId();

  // Dual track telemetry source
  const trackData = currentTrack === "remedial" ? node.remedialTrack : node.masteryTrack;
  const subjects: SubjectTelemetry[] =
    trackData?.subjects && trackData.subjects.length > 0
      ? trackData.subjects
      : (node?.telemetry?.subjects as SubjectTelemetry[]) || DEFAULT_SUBJECTS;

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("math");
  const activeSubject =
    subjects.find((s) => s.id === selectedSubjectId) || subjects[0] || DEFAULT_SUBJECTS[0];

  const constellationNodes =
    CONSTELLATION_DATA[selectedSubjectId] || CONSTELLATION_DATA.math;
  const targetNode =
    constellationNodes.find((n) => n.isTarget) || constellationNodes[1];

  // Kinematic calculations
  const loadIndex = interpolateCounterValue(p, 0.78, 0.0, 0.15, 0.65).toFixed(2);
  const intensityVal = Math.round(interpolateCounterValue(p, 95, 40, 0.1, 0.6));
  const activeNodeCount = Math.round(interpolateCounterValue(p, 5, 1, 0.05, 0.45));
  const stamp = getStampTransform(p, 0.65, 0.85);

  // Reticle scale and lock
  const reticleProgress = segmentProgress(p, 0.15, 0.55);
  const reticleScale = isMotionReduced ? 1.0 : lerp(1.6, 1.0, easeOutBack(reticleProgress, 1.2));
  const isLocked = p >= 0.55 || isMotionReduced;
  const radarAngle = isMotionReduced || !isActive ? 45 : (p * 720) % 360;

  const handleSubjectClick = (subId: string) => {
    setSelectedSubjectId(subId);
    if (onSelectSubject) onSelectSubject(subId);
  };

  return (
    <div
      className={`relative flex h-full min-h-[460px] sm:min-h-[480px] w-full flex-col justify-between overflow-hidden rounded-xl bg-[#090b0e]/95 p-3.5 sm:p-5 text-zinc-100 select-none ${className}`}
      data-scene="target-intent"
      data-track={currentTrack}
      data-testid="scene-target-intent"
    >
      {/* Ambient Background Grid & Noise Watermark */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-blue-600/10 blur-[90px]" />
        <div className="absolute -right-20 -bottom-20 size-80 rounded-full bg-indigo-600/10 blur-[90px]" />
        <div className="absolute right-4 top-4 font-mono text-[6rem] sm:text-[8rem] font-black text-blue-500/[0.03] leading-none select-none">
          01
        </div>
      </div>

      {/* Main 3-Wing Panoramic Horizon */}
      <div className="relative z-10 grid flex-1 grid-cols-1 items-stretch gap-3 sm:gap-4 lg:grid-cols-[28%_44%_28%] min-h-0">
        {/* WING 1: LEFT CONTEXT WING (28%) */}
        <section
          aria-label="考点上下文与学科意图池"
          className="flex flex-col justify-between rounded-xl border border-white/[0.07] bg-[#121418]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md"
        >
          <div>
            <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-black/40 p-1">
              {[
                { id: "math", label: "高数", icon: Target },
                { id: "cs408", label: "408", icon: Cpu },
                { id: "english", label: "英语", icon: Languages },
              ].map((tab) => {
                const isSelected = selectedSubjectId === tab.id;
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleSubjectClick(tab.id)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 font-mono text-[11px] font-bold transition-all ${
                      isSelected
                        ? "border border-blue-400/40 bg-blue-500/20 text-blue-200 shadow-[0_0_12px_rgba(59,130,246,0.3)]"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                    }`}
                  >
                    <IconComponent className="size-3 text-blue-400" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-blue-300">
                  {activeSubject.code} · {activeSubject.tier}
                </span>
                <span className="font-mono text-[10px] text-zinc-400">
                  {activeSubject.targetDuration}
                </span>
              </div>

              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">{activeSubject.name}</h3>
                <p className="mt-1 text-xs text-zinc-300 leading-relaxed font-medium">{activeSubject.topic}</p>
              </div>

              <div className="rounded-lg border border-blue-500/20 bg-[#0a0d14] p-2.5 font-mono text-[11px] text-blue-200/90 shadow-inner">
                <div className="mb-1 flex items-center justify-between text-[9px] text-blue-400/70 uppercase">
                  <span>CORE PROPOSITION</span>
                  <Sparkles className="size-2.5 text-blue-400" />
                </div>
                <div className="overflow-x-auto whitespace-pre-wrap break-all leading-normal">{activeSubject.formula}</div>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400 flex items-center gap-1">
                <Activity className="size-3 text-blue-400" />
                攻坚强度
              </span>
              <span className="font-bold text-blue-300">{intensityVal}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300"
                style={{ width: `${intensityVal}%` }}
              />
            </div>
          </div>
        </section>

        {/* WING 2: CENTER KINETIC CORE (44%) */}
        <section
          aria-label="动态拓扑星座与雷达聚焦核心"
          className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-blue-500/20 bg-[#0d1017]/90 p-4 shadow-inner min-h-[280px]"
        >
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="absolute size-[160px] sm:size-[200px] rounded-full border border-blue-500/10" />
            <div className="absolute size-[260px] sm:size-[320px] rounded-full border border-blue-500/15 border-dashed" />
            <div className="absolute size-[360px] sm:size-[440px] rounded-full border border-blue-500/10" />
            <div className="absolute h-px w-full max-w-[480px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
            <div className="absolute h-full max-h-[360px] w-px bg-gradient-to-b from-transparent via-blue-500/20 to-transparent" />
            <div
              className="absolute size-[360px] sm:size-[440px] rounded-full opacity-35 will-change-transform"
              style={{
                background: `conic-gradient(from ${radarAngle}deg, rgba(59,130,246,0.32) 0deg, rgba(59,130,246,0) 60deg, transparent 60deg)`,
              }}
            />
          </div>

          {/* SVG Constellation Connectors */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <linearGradient id={`${maskId}-lineGlow`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.3" />
              </linearGradient>
            </defs>
            {constellationNodes.map((nodeItem) => {
              const dashOffset = interpolateStrokeDashoffset(p, 160, 0.08, 0.48);
              return (
                <line
                  key={`line-${nodeItem.id}`}
                  x1="50%"
                  y1="50%"
                  x2={`${nodeItem.x}%`}
                  y2={`${nodeItem.y}%`}
                  stroke={`url(#${maskId}-lineGlow)`}
                  strokeWidth={nodeItem.isTarget ? "2" : "1.2"}
                  strokeDasharray={nodeItem.isTarget ? "none" : "3,3"}
                  strokeDashoffset={isMotionReduced ? 0 : dashOffset}
                  className="transition-all duration-300"
                />
              );
            })}
          </svg>

          {/* Center Hub Core */}
          <div className="relative z-10 flex flex-col items-center justify-center">
            <div className="relative flex size-20 sm:size-24 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping opacity-25" />
              <div className="absolute -inset-2 rounded-full border border-blue-400/40 animate-pulse" />
              <div className="relative flex size-16 sm:size-20 flex-col items-center justify-center rounded-full border border-blue-400/60 bg-[#121826] shadow-[0_0_30px_rgba(59,130,246,0.45)] backdrop-blur-md">
                <Target className="size-5 sm:size-6 text-blue-400 animate-pulse" />
                <span className="mt-0.5 font-mono text-[10px] font-black tracking-tight text-blue-200">{activeSubject.code}</span>
                <span className="text-[8px] font-mono text-blue-400/80 uppercase">INTENT HUB</span>
              </div>
            </div>
          </div>

          {/* Peripheral Nodes */}
          <div className="pointer-events-none absolute inset-0">
            {constellationNodes.map((k) => {
              const isTargeted = k.isTarget;
              return (
                <div
                  key={k.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-500"
                  style={{ left: `${k.x}%`, top: `${k.y}%` }}
                >
                  {isTargeted ? (
                    <div className="relative flex flex-col items-center">
                      <div
                        className={`absolute -inset-3.5 rounded-lg border-2 border-blue-400 shadow-[0_0_24px_rgba(96,165,250,0.7)] transition-transform duration-300 ${
                          isLocked ? "scale-100" : ""
                        }`}
                        style={{ transform: `scale(${reticleScale})` }}
                      >
                        <Crosshair
                          className="absolute -top-3 -right-3 size-4 text-blue-300 animate-spin"
                          style={{ animationDuration: isMotionReduced ? "0s" : "6s" }}
                        />
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-blue-400/80 bg-[#162238] px-3 py-1.5 shadow-[0_0_25px_rgba(59,130,246,0.5)]">
                        <span className="size-2 rounded-full bg-blue-400 animate-ping" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white tracking-wide">{k.name}</span>
                            <span className="rounded bg-blue-500/25 px-1 py-0.5 font-mono text-[9px] font-bold text-blue-300">{k.weight}</span>
                          </div>
                          <div className="font-mono text-[9px] text-blue-300 font-bold">[TARGET_FOCUSED]</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#10131a]/85 px-2 py-1 shadow-sm backdrop-blur-sm">
                      <span className="size-1.5 rounded-full bg-zinc-500" />
                      <span className="font-mono text-[10px] text-zinc-400">{k.name}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="absolute bottom-2.5 flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-950/60 px-3 py-0.5 font-mono text-[10px] text-blue-300 shadow-md backdrop-blur-md">
            <Radio className="size-3 text-blue-400 animate-pulse" />
            <span>拓扑知识网已建立 · 准星锁定核心考点</span>
          </div>
        </section>

        {/* WING 3: RIGHT METRICS WING (28%) */}
        <section
          aria-label="指标遥测与固化印章"
          className="relative flex flex-col justify-between rounded-xl border border-white/[0.07] bg-[#121418]/80 p-3.5 sm:p-4 shadow-lg backdrop-blur-md overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
              <span className="flex items-center gap-1.5 font-mono text-xs font-bold text-white">
                <Gauge className="size-3.5 text-blue-400" />
                研学遥测指标
              </span>
              <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[9px] text-blue-300 font-bold">
                LIVE
              </span>
            </div>

            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-white/[0.05] bg-black/30 p-2.5">
                <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400">
                  <span>认知负荷指数</span>
                  <span className="font-bold text-white text-xs">{loadIndex}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-400">
                  <span>高负荷需心流护航</span>
                  <span className="text-blue-400 font-mono">0.78 MAX</span>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.05] bg-black/30 p-2.5">
                <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400">
                  <span>预估专注时长</span>
                  <span className="font-bold text-blue-300 text-xs">45 MIN</span>
                </div>
                <div className="mt-1 text-[10px] text-zinc-400">建议切入连续无中断心流</div>
              </div>

              <div className="rounded-lg border border-white/[0.05] bg-black/30 p-2.5">
                <div className="flex items-center justify-between font-mono text-[11px] text-zinc-400">
                  <span>活跃拓扑节点</span>
                  <span className="font-bold text-white text-xs">{activeNodeCount} / 12</span>
                </div>
                <div className="mt-1 text-[10px] text-zinc-400">边界清晰 · 具备攻坚条件</div>
              </div>
            </div>
          </div>

          {/* Holographic Metal Stamp [TARGET_LOCKED] */}
          <div className="relative my-2 flex items-center justify-center py-2 min-h-[56px]">
            <div
              className="flex items-center gap-2 rounded-lg border-2 border-blue-400/90 bg-gradient-to-br from-blue-950/90 via-[#0e172a] to-blue-900/90 px-3.5 py-2 shadow-[0_0_25px_rgba(59,130,246,0.6)] backdrop-blur-md will-change-transform"
              style={{
                transform: `scale(${isMotionReduced ? 1.0 : stamp.scale}) rotate(${isMotionReduced ? -6 : stamp.rotateDeg}deg) translateY(${isMotionReduced ? 0 : stamp.translateY}px)`,
                opacity: isMotionReduced ? 1.0 : stamp.opacity,
              }}
            >
              <ShieldCheck className="size-4 text-blue-400" />
              <div className="font-mono text-xs font-black tracking-wider text-blue-200">
                {currentTrack === "remedial" ? "[GAP_PINPOINTED]" : "[TARGET_LOCKED]"}
              </div>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>下一阶段</span>
              <span className="flex items-center gap-1 font-bold text-blue-300">
                STEP 02 专注投入
                <ArrowRight className="size-3 text-blue-400" />
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* BOTTOM STREAM RELAY */}
      <footer
        aria-label="研学流水接力管道"
        className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-500/20 bg-blue-950/30 px-3.5 py-2 font-mono text-[11px] text-zinc-300 shadow-sm backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-bold text-blue-400">
            <Lock className="size-3" />
            {node?.inputLabel || "当前目标"}:
          </span>
          <span className="text-white font-medium">{activeSubject.name} · {targetNode.name}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-blue-300 font-bold">{node?.actionLabel || "选择科目与边界"}</span>
          <span className="text-zinc-600">→</span>
          <span className="text-zinc-400">{node?.outputLabel || "形成"}</span>
          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 font-bold text-blue-300">
            {node?.outputValue || "学习意图"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-blue-400/90 font-bold">
          <CheckCircle2 className="size-3 text-blue-400" />
          <span>{node?.nextLabel || "带着明确目标进入专注"}</span>
        </div>
      </footer>
    </div>
  );
};
