"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LoginForm } from "@/components/login-form";
import { AmbientBackground } from "./components/ambient-background";
import { JourneyTimeline } from "./components/journey-timeline";
import { ShowcaseStage } from "./components/showcase-stage";
import { LEARNING_LOOP_DURATION_MS, LEARNING_LOOP_NODES } from "./constants/learning-loop";

export function LoginClient({ returnTo }: { returnTo: string }) {
  const [activeNodeIndex, setActiveNodeIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [isLoginHovered, setIsLoginHovered] = useState(false);
  const [isLoginFocused, setIsLoginFocused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, getMotionPreference, getServerMotionPreference);
  const loginEngaged = isLoginHovered || isLoginFocused;
  const paused = loginEngaged || !autoPlay || reducedMotion;
  const activeNode = LEARNING_LOOP_NODES[activeNodeIndex];

  useEffect(() => {
    if (paused) return;

    const timer = window.setTimeout(() => {
      if (activeNodeIndex === LEARNING_LOOP_NODES.length - 1) {
        setAutoPlay(false);
        return;
      }
      setActiveNodeIndex((current) => current + 1);
    }, LEARNING_LOOP_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, [activeNodeIndex, paused]);

  function selectNode(index: number) {
    setActiveNodeIndex(index);
    setAutoPlay(false);
  }

  function changeAutoPlay(playing: boolean) {
    if (playing && activeNodeIndex === LEARNING_LOOP_NODES.length - 1) {
      setActiveNodeIndex(0);
    }
    setAutoPlay(playing);
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#05080a] text-zinc-100 selection:bg-teal-500/30">
      <AmbientBackground activeNodeIndex={activeNodeIndex} isLoginFocused={loginEngaged} />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-5 py-6 sm:px-8 lg:px-10 lg:py-8 xl:px-16">
        <header className="flex items-center justify-between gap-4">
          <Image
            alt="AreaForge"
            className="h-9 w-auto object-contain opacity-90 sm:h-11"
            height={98}
            priority
            src="/brand/areaforge-logo-lockup.svg"
            width={300}
          />
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-zinc-500 sm:text-xs">
            <span aria-hidden className={`size-1.5 rounded-full ${activeNode.lineClass} shadow-[0_0_8px_currentColor]`} />
            六步学习闭环
          </div>
        </header>

        <div className="grid flex-1 items-center gap-8 py-7 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_430px] xl:gap-14">
          <aside
            aria-label="登录 AreaForge"
            className="order-1 mx-auto w-full max-w-[430px] lg:order-2"
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsLoginFocused(false);
            }}
            onFocusCapture={() => setIsLoginFocused(true)}
            onMouseEnter={() => setIsLoginHovered(true)}
            onMouseLeave={() => setIsLoginHovered(false)}
          >
            <div className="relative">
              <div
                aria-hidden
                className={`absolute -inset-1 rounded-lg blur-xl transition-opacity duration-500 ${activeNode.glowClass} ${loginEngaged ? "opacity-80" : "opacity-35"}`}
              />
              <div className={`relative border border-white/10 bg-[#070b0f]/92 p-7 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[border-color,transform] duration-500 sm:p-9 ${loginEngaged ? "border-white/20 lg:scale-[1.01]" : ""}`}>
                <LoginForm returnTo={returnTo} />
              </div>
            </div>
          </aside>

          <div className={`order-2 min-w-0 transition-[opacity,transform] duration-500 lg:order-1 ${loginEngaged ? "lg:-translate-x-2 lg:opacity-50" : "opacity-100"}`}>
            <ShowcaseStage key={activeNode.id} node={activeNode} paused={paused} />
            <JourneyTimeline
              activeNodeIndex={activeNodeIndex}
              autoPlay={autoPlay}
              onAutoPlayChange={changeAutoPlay}
              onNodeSelect={selectNode}
              paused={paused}
              reducedMotion={reducedMotion}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function subscribeToMotionPreference(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new MutationObserver(onStoreChange);
  mediaQuery.addEventListener("change", onStoreChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-af-motion"] });

  return () => {
    mediaQuery.removeEventListener("change", onStoreChange);
    observer.disconnect();
  };
}

function getMotionPreference(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.dataset.afMotion === "reduce";
}

function getServerMotionPreference(): boolean {
  return false;
}
