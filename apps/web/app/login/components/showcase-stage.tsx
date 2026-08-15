"use client";

import React, { useState, type CSSProperties } from "react";
import {
  Sparkles,
  Zap,
} from "lucide-react";
import { LEARNING_LOOP_NODES, type LearningLoopNode, type TrackMode } from "../constants/learning-loop";
import { SceneTargetIntent } from "./scenes/scene-target-intent";
import { SceneDeepFocus } from "./scenes/scene-deep-focus";
import { SceneEvidenceSynthesis } from "./scenes/scene-evidence-synthesis";
import { SceneProofVerification } from "./scenes/scene-proof-verification";
import { SceneDailyOrbit } from "./scenes/scene-daily-orbit";
import { SceneMacroAdjust } from "./scenes/scene-macro-adjust";

interface ShowcaseStageProps {
  activeNode: LearningLoopNode;
  activeStageIndex: number;
  localProgress: number;
  globalProgress: number;
  paused: boolean;
}

export function ShowcaseStage({
  activeNode,
  activeStageIndex,
  localProgress,
  globalProgress,
  paused,
}: ShowcaseStageProps) {
  const [activeTrack, setActiveTrack] = useState<TrackMode>("mastery");

  const style = {
    "--af-route-accent": activeNode.accent,
    "--af-route-accent-soft": activeNode.accentSoft,
    "--af-route-accent-rgb": activeNode.accentRgb,
  } as CSSProperties;

  return (
    <section
      aria-label={`学习闭环第 ${activeNode.step} 步：${activeNode.navTitle}`}
      className="group/stage relative flex flex-1 h-full min-h-[500px] sm:min-h-[540px] lg:min-h-[580px] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141518]/90 p-4 sm:p-6 lg:p-7 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl transition-all duration-500"
      data-paused={paused ? "true" : "false"}
      style={style}
    >
      {/* 1. CAD 4-Corner Crosshairs & Blueprint Watermarks */}
      <div aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span>+</span>
        <span className="text-[8px] text-white/10">[00.00]</span>
      </div>
      <div aria-hidden className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span className="text-[8px] text-white/10">[01.00]</span>
        <span>+</span>
      </div>
      <div aria-hidden className="pointer-events-none absolute left-2.5 bottom-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span>+</span>
        <span className="text-[8px] text-white/10">[00.99]</span>
      </div>
      <div aria-hidden className="pointer-events-none absolute right-2.5 bottom-2.5 flex items-center gap-1 font-mono text-[9px] text-white/20 select-none">
        <span className="text-[8px] text-white/10">[01.99]</span>
        <span>+</span>
      </div>

      {/* Dynamic Background Stage Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 size-96 rounded-full blur-[120px] transition-all duration-700 opacity-25"
        style={{ backgroundColor: activeNode.accent }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--af-route-accent)] to-transparent opacity-60"
      />

      {/* 2. Top Ultra-Clean Stage Header & Track Switcher */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3 sm:pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-xs font-bold uppercase tracking-wider"
              style={{ color: activeNode.accent }}
            >
              {activeNode.kicker}
            </span>
            <span className="text-[10px] font-mono text-zinc-600">/</span>
            <span className="font-mono text-[10px] text-zinc-400">
              STAGE 0{activeNode.step}
            </span>
          </div>
          <h2 className="mt-0.5 text-xl font-black tracking-tight text-white sm:text-2xl">
            {activeNode.title}
          </h2>
        </div>

        {/* Right Header Controls: Interactive Track Mode Selector & Telemetry Chip */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Dual-Track Mode Switcher */}
          <div className="flex items-center rounded-xl border border-white/[0.08] bg-white/[0.02] p-0.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setActiveTrack("mastery")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition-all cursor-pointer ${
                activeTrack === "mastery"
                  ? "bg-teal-500/20 text-teal-300 border border-teal-500/40 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Sparkles className="size-3 text-teal-400" />
              <span>优势扩展</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTrack("remedial")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-bold transition-all cursor-pointer ${
                activeTrack === "remedial"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Zap className="size-3 text-amber-400" />
              <span>瓶颈攻坚</span>
            </button>
          </div>

          {/* Current Navigation Badge */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1 font-mono text-xs text-zinc-300">
            <span className="size-2 rounded-full animate-pulse" style={{ backgroundColor: activeNode.accent }} />
            <span>{activeNode.navTitle}</span>
          </div>
        </div>
      </div>

      {/* 3. Persistent Multi-Scene Viewport Stack (Zero DOM Unmount Flashes) */}
      <div className="relative z-10 my-3 sm:my-4 flex-1 min-h-[340px]">
        {LEARNING_LOOP_NODES.map((node, index) => {
          const isActive = index === activeStageIndex;
          const isPrev = index === (activeStageIndex - 1 + 6) % 6;
          return (
            <div
              key={node.id}
              aria-hidden={!isActive}
              className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isActive
                  ? "z-10 opacity-100 scale-100 translate-x-0 blur-0 pointer-events-auto"
                  : isPrev
                  ? "z-0 opacity-0 scale-[0.98] -translate-x-4 blur-xs pointer-events-none"
                  : "z-0 opacity-0 scale-[0.98] translate-x-4 blur-xs pointer-events-none"
              }`}
            >
              {index === 0 && (
                <SceneTargetIntent
                  node={node}
                  activeTrack={activeTrack}
                  localProgress={isActive ? localProgress : 0}
                  globalProgress={globalProgress}
                  isActive={isActive}
                />
              )}
              {index === 1 && (
                <SceneDeepFocus
                  node={node}
                  activeTrack={activeTrack}
                  localProgress={isActive ? localProgress : 0}
                  globalProgress={globalProgress}
                  isActive={isActive}
                />
              )}
              {index === 2 && (
                <SceneEvidenceSynthesis
                  node={node}
                  activeTrack={activeTrack}
                  localProgress={isActive ? localProgress : 0}
                  globalProgress={globalProgress}
                  isActive={isActive}
                />
              )}
              {index === 3 && (
                <SceneProofVerification
                  node={node}
                  activeTrack={activeTrack}
                  localProgress={isActive ? localProgress : 0}
                  globalProgress={globalProgress}
                  isActive={isActive}
                />
              )}
              {index === 4 && (
                <SceneDailyOrbit
                  node={node}
                  activeTrack={activeTrack}
                  localProgress={isActive ? localProgress : 0}
                  globalProgress={globalProgress}
                  isActive={isActive}
                />
              )}
              {index === 5 && (
                <SceneMacroAdjust
                  node={node}
                  activeTrack={activeTrack}
                  localProgress={isActive ? localProgress : 0}
                  globalProgress={globalProgress}
                  isActive={isActive}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
