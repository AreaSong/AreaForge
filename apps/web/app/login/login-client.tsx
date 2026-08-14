"use client";

import Image from "next/image";
import React, { useSyncExternalStore } from "react";
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
    <main className="relative min-h-screen w-full overflow-x-hidden bg-[#121316] text-zinc-100 selection:bg-teal-500/30">
      {/* 1. Ambient Background Atmosphere */}
      <AmbientBackground activeNodeIndex={activeStageIndex} isLoginFocused={isInteracting} />

      {/* 2. Panoramic Screen Wrapper */}
      <div className="relative z-10 mx-auto flex min-h-screen w-full flex-col justify-between px-4 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-4 xl:px-12">
        {/* Header Bar */}
        <header className="flex items-center justify-between gap-4 pb-1 sm:pb-2">
          <div className="flex items-center gap-3">
            <Image
              alt="AreaForge"
              className="h-8 w-auto object-contain opacity-95 sm:h-9"
              height={98}
              priority
              src="/brand/areaforge-logo-lockup.svg"
              width={300}
            />
            <span className="hidden rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline">
              v1.1.2 · 研学行动中心
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#18191c]/80 px-3 py-1.5 font-mono text-xs text-zinc-300 shadow-sm backdrop-blur-md">
            <span
              aria-hidden
              className="size-2 rounded-full shadow-[0_0_8px_currentColor] animate-pulse"
              style={{ backgroundColor: activeNode.accent }}
            />
            <span>六步研学闭环 · 巡航中</span>
          </div>
        </header>

        {/* Panoramic Full-Height Main Grid */}
        <div className="my-1 sm:my-2 flex-1 grid w-full items-stretch gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_440px] lg:gap-6 xl:gap-8 min-h-0">
          {/* Main Hero Animation Stage (Allocation >= 75%) */}
          <div className="order-2 flex h-full min-w-0 flex-col justify-between gap-3 sm:gap-4 lg:order-1">
            <div className="flex-1 flex flex-col min-h-0">
              <ShowcaseStage
                activeNode={activeNode}
                activeStageIndex={activeStageIndex}
                globalProgress={globalProgress}
                localProgress={localProgress}
                paused={isPaused}
              />
            </div>

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

          {/* Frosted Glass Login Center Console (Allocation <= 25%) */}
          <aside
            aria-label="登录 AreaForge"
            className="order-1 flex items-center justify-center mx-auto w-full max-w-[420px] lg:order-2"
          >
            <div className="relative w-full">
              {/* Dynamic Outer Aura Glow */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-1.5 rounded-3xl blur-2xl transition-opacity duration-500 opacity-25"
                style={{ backgroundColor: activeNode.accent }}
              />

              <LoginForm returnTo={returnTo} />
            </div>
          </aside>
        </div>

        {/* Footer info */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-2 sm:pt-3 font-mono text-[11px] text-zinc-500">
          <div>
            <span>AREAFORGE · 面向个人长期备考的自我锻造与考研督战系统</span>
          </div>
          <div className="flex items-center gap-3">
            <span>安全研学工作区</span>
            <span>·</span>
            <span>认证通行</span>
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
