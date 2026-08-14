"use client";

import React from "react";
import { Crosshair, Sparkles, Target } from "lucide-react";
import type { LearningLoopNode, TrackMode } from "../../constants/learning-loop";

export interface StageSceneProps {
  node: LearningLoopNode;
  activeTrack?: TrackMode;
  localProgress: number;
  globalProgress: number;
  isActive: boolean;
}

interface KnowledgeNode {
  id: string;
  name: string;
  category: string;
  x: number; // percentage
  y: number; // percentage
  status: "locked" | "active" | "ready";
  weight: string;
}

const KNOWLEDGE_NODES: KnowledgeNode[] = [
  { id: "k1", name: "ε-δ 极限定义", category: "基础理论", x: 22, y: 28, status: "ready", weight: "12%" },
  { id: "k2", name: "泰勒级数展开", category: "高频压轴", x: 74, y: 26, status: "locked", weight: "25%" },
  { id: "k3", name: "拉格朗日中值定理", category: "核心证明", x: 80, y: 72, status: "ready", weight: "18%" },
  { id: "k4", name: "二重积分极坐标", category: "几何应用", x: 20, y: 74, status: "ready", weight: "15%" },
  { id: "k5", name: "微分方程降阶法", category: "综合计算", x: 48, y: 16, status: "ready", weight: "10%" },
];

export const SceneTargetIntent: React.FC<StageSceneProps> = ({
  isActive,
}) => {
  return (
    <div className="relative flex h-full min-h-[380px] w-full flex-col items-center justify-center overflow-hidden select-none">
      {/* 1. Concentric Radar Grid & Scanning Sweep */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Radar Rings */}
        <div className="absolute size-[220px] rounded-full border border-blue-500/10" />
        <div className="absolute size-[360px] rounded-full border border-blue-500/15 border-dashed" />
        <div className="absolute size-[500px] rounded-full border border-blue-500/10" />

        {/* Crosshair Axis Lines */}
        <div className="absolute h-px w-full max-w-[560px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
        <div className="absolute h-full max-h-[400px] w-px bg-gradient-to-b from-transparent via-blue-500/20 to-transparent" />

        {/* Radar Rotating Scan Cone */}
        {isActive && (
          <div
            className="absolute size-[480px] rounded-full opacity-40 will-change-transform"
            style={{
              background: "conic-gradient(from 0deg, rgba(59,130,246,0.25) 0deg, rgba(59,130,246,0) 60deg, transparent 60deg)",
              animation: "spin 8s linear infinite",
            }}
          />
        )}
      </div>

      {/* 2. Constellation SVG Connectors */}
      <svg className="absolute inset-0 h-full w-full pointer-events-none">
        <defs>
          <linearGradient id="blueLineGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        {/* Connection from Center (50%, 50%) to each peripheral node */}
        {KNOWLEDGE_NODES.map((k) => (
          <line
            key={`line-${k.id}`}
            x1="50%"
            y1="50%"
            x2={`${k.x}%`}
            y2={`${k.y}%`}
            stroke="url(#blueLineGlow)"
            strokeWidth="1.5"
            strokeDasharray={k.status === "locked" ? "none" : "3,3"}
            className="transition-all duration-700"
          />
        ))}
      </svg>

      {/* 3. Center Knowledge Core Hub */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        {/* Core Pulsing Rings */}
        <div className="relative flex size-24 sm:size-28 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping opacity-30" />
          <div className="absolute -inset-2 rounded-full border border-blue-400/40 animate-pulse" />
          
          <div className="relative flex size-20 sm:size-24 flex-col items-center justify-center rounded-full border border-blue-400/50 bg-[#151d2e] shadow-[0_0_35px_rgba(59,130,246,0.4)] backdrop-blur-md">
            <Target className="size-6 text-blue-400 animate-pulse" />
            <span className="mt-1 font-mono text-[11px] font-black tracking-tight text-blue-200">
              高等数学
            </span>
            <span className="text-[9px] font-mono text-blue-400/80">
              CORE HUB
            </span>
          </div>
        </div>
      </div>

      {/* 4. Peripheral Constellation Nodes */}
      <div className="absolute inset-0 pointer-events-none">
        {KNOWLEDGE_NODES.map((k) => {
          const isTargeted = k.status === "locked";
          return (
            <div
              key={k.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-500"
              style={{ left: `${k.x}%`, top: `${k.y}%` }}
            >
              {isTargeted ? (
                /* Targeted Node with Active Reticle */
                <div className="relative flex flex-col items-center">
                  {/* HUD Reticle Brackets */}
                  <div className="absolute -inset-3 rounded-lg border-2 border-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.6)] animate-pulse pointer-events-none">
                    <Crosshair className="absolute -top-3 -right-3 size-4 text-blue-300 animate-spin" style={{ animationDuration: "6s" }} />
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-blue-400/60 bg-[#1c273d] px-3.5 py-2 shadow-[0_0_25px_rgba(59,130,246,0.35)]">
                    <span className="size-2 rounded-full bg-blue-400 animate-ping" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white tracking-wide">{k.name}</span>
                        <span className="rounded bg-blue-500/20 px-1 py-0.5 font-mono text-[9px] font-bold text-blue-300">
                          {k.weight}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-blue-400/90 font-medium">
                        [LOCKED TARGET]
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Subtle Inactive Node */
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#14161c]/80 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
                  <span className="size-1.5 rounded-full bg-zinc-500" />
                  <span className="font-mono text-[11px] text-zinc-400">{k.name}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 5. Minimal HUD Bottom Status Indicator */}
      <div className="absolute bottom-3 flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-950/40 px-3 py-1 font-mono text-xs text-blue-300 shadow-md backdrop-blur-md">
        <Sparkles className="size-3.5 text-blue-400" />
        <span>目标已精确锁定 · 准备切入深度心流</span>
      </div>
    </div>
  );
};
