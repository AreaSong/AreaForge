"use client";

import Image from "next/image";
import React, { useSyncExternalStore } from "react";
import {
  Cpu,
  Database,
  LockKeyhole,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { AmbientBackground } from "./components/ambient-background";
import { JourneyTimeline } from "./components/journey-timeline";
import { ShowcaseStage } from "./components/showcase-stage";
import { LEARNING_LOOP_NODES } from "./constants/learning-loop";
import { useContinuousTimeline } from "./hooks/use-continuous-timeline";

export function LoginClient({ returnTo }: { returnTo: string }) {
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    getMotionPreference,
    getServerMotionPreference
  );

  const [
    { activeStageIndex, globalProgress, localProgress, isPlaying, isInteracting },
    { seekToStage, seekToProgress, togglePlay },
  ] = useContinuousTimeline({
    stageCount: LEARNING_LOOP_NODES.length,
    stageDurationMs: 6000,
    autoPlay: true,
    reducedMotion,
  });

  const activeNode = LEARNING_LOOP_NODES[activeStageIndex] || LEARNING_LOOP_NODES[0];
  const isPaused = !isPlaying || isInteracting || reducedMotion;

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-[#090a0d] text-zinc-100 selection:bg-teal-500/30 font-sans">
      {/* 1. Hardware Ambient Background Atmosphere */}
      <AmbientBackground
        activeNodeIndex={activeStageIndex}
        localProgress={localProgress}
        reducedMotion={reducedMotion}
        isLoginFocused={isInteracting}
      />

      {/* 2. Panoramic Screen Canvas Wrapper */}
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1920px] flex-col justify-between px-3 py-2.5 sm:px-6 sm:py-4 lg:px-8 xl:px-12">
        {/* Top CAD Telemetry & Header Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 pb-1 sm:pb-2">
          {/* Brand Lockup & Version Badge */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Image
              alt="AreaForge"
              className="h-7 w-auto object-contain opacity-95 sm:h-8"
              height={98}
              priority
              src="/brand/areaforge-logo-lockup.svg"
              width={300}
            />
            <span className="hidden rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[10px] font-medium text-zinc-400 sm:inline">
              v1.1.2 · 研学行动中心
            </span>
          </div>

          {/* Center Blueprint CAD Coordinates & Telemetry Badge (Desktop) */}
          <div className="hidden lg:flex items-center gap-2 font-mono text-[10px] text-zinc-400 rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1 backdrop-blur-md">
            <span className="flex items-center gap-1 text-teal-400 font-bold">
              <span className="size-1.5 rounded-full bg-teal-400 animate-ping" />
              LATENCY: 0.4ms
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-300">CAS_LOCK: ACTIVE</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400">RETENTION: 98.6%</span>
            <span className="text-zinc-600">·</span>
            <span className="text-purple-300 font-medium">CAD_GRID: 48x48</span>
          </div>

          {/* Right Status & Cruise Control Pill */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#141518]/90 px-2.5 py-1.5 font-mono text-xs text-zinc-300 shadow-sm backdrop-blur-md hover:border-teal-400/40 hover:text-white transition-all cursor-pointer"
              title={isPlaying ? "点击暂停自动巡航" : "点击恢复自动巡航"}
            >
              <span
                aria-hidden
                className="size-2 rounded-full shadow-[0_0_8px_currentColor] animate-pulse"
                style={{ backgroundColor: activeNode.accent }}
              />
              <span className="font-bold">
                {isPlaying && !reducedMotion ? "巡航中" : "定格中"}
              </span>
              {isPlaying && !reducedMotion ? (
                <Pause className="size-3 text-zinc-400" />
              ) : (
                <Play className="size-3 text-amber-400" />
              )}
            </button>
          </div>
        </header>

        {/* 1. Main Horizon: Showcase Stage (Left ~78%) & Frosted Glass Login Center Console (Right ~22%) */}
        <div className="my-1 sm:my-2 flex-1 grid w-full items-stretch gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_370px] lg:gap-6 xl:gap-8 min-h-0">
          {/* Main Hero Animation Stage (Left) */}
          <div className="order-2 flex h-full min-w-0 flex-col min-h-0 lg:order-1">
            <ShowcaseStage
              activeNode={activeNode}
              activeStageIndex={activeStageIndex}
              globalProgress={globalProgress}
              localProgress={localProgress}
              paused={isPaused}
            />
          </div>

          {/* Frosted Glass Login Center Console (Right ~22%) */}
          <aside
            aria-label="登录 AreaForge"
            className="order-1 flex h-full items-center justify-center mx-auto w-full max-w-[360px] lg:order-2"
          >
            <div className="relative w-full">
              {/* Dynamic Outer Aura Glow */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-3 rounded-3xl blur-3xl transition-opacity duration-700 opacity-25"
                style={{ backgroundColor: activeNode.accent }}
              />

              <LoginForm returnTo={returnTo} />
            </div>
          </aside>
        </div>

        {/* 2. Full-Width Bottom Section: Continuous 6-Stage Journey Timeline */}
        <div className="w-full mt-2 sm:mt-3">
          <JourneyTimeline
            activeNodeIndex={activeStageIndex}
            globalProgress={globalProgress}
            isPlaying={isPlaying}
            onAutoPlayChange={togglePlay}
            onNodeSelect={(idx) => seekToStage(idx, true)}
            onProgressScrub={(p) => seekToProgress(p)}
            paused={isPaused}
            reducedMotion={reducedMotion}
          />
        </div>

        {/* Footer HUD with Security Badges & Design Manifesto */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-2.5 sm:pt-3 font-mono text-[11px] text-zinc-500">
          <div className="flex flex-wrap items-center gap-2">
            <span>AREAFORGE · 面向个人长期备考的自我锻造与考研督战系统</span>
            <span className="hidden sm:inline text-zinc-700">|</span>
            <span className="hidden md:inline-flex items-center gap-1 text-zinc-400">
              <Sparkles className="size-3 text-teal-400" />
              <span>AWWWARDS DESIGN TIER</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 text-zinc-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3 text-teal-400" />
              <span>安全研学工作区</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span className="flex items-center gap-1">
              <LockKeyhole className="size-3 text-teal-400" />
              <span>CAS 会话互斥</span>
            </span>
            <span className="hidden sm:inline text-zinc-700">·</span>
            <span className="hidden sm:flex items-center gap-1">
              <Database className="size-3 text-teal-400" />
              <span>本地优先存证</span>
            </span>
            <span className="hidden lg:inline text-zinc-700">·</span>
            <span className="hidden lg:flex items-center gap-1">
              <Cpu className="size-3 text-teal-400" />
              <span>纯数学运动学</span>
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function subscribeToMotionPreference(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new MutationObserver(onStoreChange);
  mediaQuery.addEventListener("change", onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-af-motion"],
  });

  return () => {
    mediaQuery.removeEventListener("change", onStoreChange);
    observer.disconnect();
  };
}

function getMotionPreference(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.afMotion === "reduce"
  );
}

function getServerMotionPreference(): boolean {
  return false;
}
