"use client";

import React, { useState, type CSSProperties } from "react";
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
  const [activeTrack] = useState<TrackMode>("mastery");

  const style = {
    "--af-route-accent": activeNode.accent,
    "--af-route-accent-soft": activeNode.accentSoft,
    "--af-route-accent-rgb": activeNode.accentRgb,
  } as CSSProperties;

  return (
    <section
      aria-label={`学习闭环第 ${activeNode.step} 步：${activeNode.navTitle}`}
      className="relative flex flex-1 h-full min-h-[500px] sm:min-h-[540px] lg:min-h-[580px] w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#18191c]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-all duration-500 sm:p-6 lg:p-7"
      data-paused={paused ? "true" : "false"}
      style={style}
    >
      {/* Dynamic Background Stage Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 size-96 rounded-full blur-[120px] transition-all duration-700 opacity-25"
        style={{ backgroundColor: activeNode.accent }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--af-route-accent)] to-transparent opacity-50"
      />

      {/* 1. Ultra-Clean Stage Header */}
      <div className="relative z-10 flex items-center justify-between border-b border-white/[0.06] pb-3 sm:pb-4">
        <div>
          <span
            className="font-mono text-xs font-bold uppercase tracking-wider"
            style={{ color: activeNode.accent }}
          >
            {activeNode.kicker}
          </span>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">
            {activeNode.title}
          </h2>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1 font-mono text-xs text-zinc-400">
          <span className="size-2 rounded-full animate-pulse" style={{ backgroundColor: activeNode.accent }} />
          <span>{activeNode.navTitle}</span>
        </div>
      </div>

      {/* 2. Persistent Multi-Scene Viewport Stack (Zero DOM Unmount Flashes) */}
      <div className="relative z-10 my-4 flex-1 min-h-[340px]">
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
