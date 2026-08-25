"use client";

import { Input } from "@/components/ui/field";
import { useState, useEffect, useCallback, useRef } from "react";
import { Pause, Play, Square, Maximize2, Minimize2, StickyNote, X, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FocusTimerWorkspaceProps {
  heading: string;
  elapsedLabel: string;
  elapsedSeconds: number;
  timerLabel: string;
  status: "running" | "paused";
  commandBusy?: boolean;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  embeddedInWorkbench?: boolean;
}

export function FocusTimerWorkspace({
  heading,
  elapsedLabel,
  elapsedSeconds,
  timerLabel,
  status,
  commandBusy = false,
  onPause,
  onResume,
  onEnd,
  embeddedInWorkbench,
}: FocusTimerWorkspaceProps) {
  const [isZenMode, setIsZenMode] = useState(false);
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [savedNotes, setSavedNotes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasRunningBeforeConfirmRef = useRef(false);

  const toggleZenMode = useCallback(() => {
    setIsZenMode((prev) => {
      const next = !prev;
      if (next) {
        if (typeof document !== "undefined" && !document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
      } else {
        if (typeof document !== "undefined" && document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        }
      }
      return next;
    });
  }, []);

  const handleRequestEnd = useCallback(() => {
    if (commandBusy) return;
    if (status === "running") {
      wasRunningBeforeConfirmRef.current = true;
      onPause();
    } else {
      wasRunningBeforeConfirmRef.current = false;
    }
    setConfirmEndOpen(true);
  }, [commandBusy, onPause, status]);

  const handleCancelEnd = useCallback(() => {
    setConfirmEndOpen(false);
    if (wasRunningBeforeConfirmRef.current) {
      wasRunningBeforeConfirmRef.current = false;
      onResume();
    }
  }, [onResume]);

  const handleConfirmEnd = useCallback(() => {
    setConfirmEndOpen(false);
    wasRunningBeforeConfirmRef.current = false;
    onEnd();
  }, [onEnd]);

  // Keyboard blind-controls: Space = Pause/Resume, Enter = End (with pause & confirm), F = Zen, N = Note
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputActive = target && ["INPUT", "TEXTAREA"].includes(target.tagName);

      if (confirmEndOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          handleCancelEnd();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (commandBusy) return;
          handleConfirmEnd();
        }
        return;
      }

      if (isInputActive) {
        if (e.key === "Escape") {
          setShowScratchpad(false);
        }
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (commandBusy) return;
        if (status === "running") {
          onPause();
        } else {
          onResume();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleRequestEnd();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleZenMode();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setShowScratchpad(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      } else if (e.key === "Escape") {
        if (isZenMode) toggleZenMode();
        if (showScratchpad) setShowScratchpad(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, commandBusy, onPause, onResume, handleRequestEnd, handleCancelEnd, handleConfirmEnd, isZenMode, showScratchpad, confirmEndOpen, toggleZenMode]);

  const handleSaveNote = useCallback(() => {
    if (!noteInput.trim()) return;
    setSavedNotes((prev) => [noteInput.trim(), ...prev]);
    setNoteInput("");
    setShowScratchpad(false);
  }, [noteInput]);

  // Second hand calculation (0-59 sec -> 0-354 deg)
  const currentSecond = elapsedSeconds % 60;
  const secondAngle = currentSecond * 6;

  // 60-second precise dial geometry
  const radius = 42;

  return (
    <div
      className={`relative flex w-full transition-all duration-500 ease-out select-none ${
        isZenMode
          ? "af-overlay-viewport fixed inset-0 z-[999] overflow-hidden bg-[#070b0d]"
          : embeddedInWorkbench
          ? "h-full min-h-0 flex-1"
          : "min-h-full"
      } animate-[fade-in_0.25s_ease-out]`}
    >
      {/* Zen Mode Exit / Fullscreen Toggle button */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <Button
          type="button"
          onClick={() => {
            setShowScratchpad((prev) => !prev);
            if (!showScratchpad) setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
            showScratchpad
              ? "border-teal-400/50 bg-teal-500/20 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.2)]"
              : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
          }`}
          title="记个闪念 (快捷键 N)"
        >
          <StickyNote className="size-3.5 text-teal-300" />
          <span className="hidden sm:inline">闪念便签</span>
          {savedNotes.length > 0 ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-teal-500 text-[10px] font-bold text-black">
              {savedNotes.length}
            </span>
          ) : null}
        </Button>

        <Button
          type="button"
          onClick={() => setIsZenMode((prev) => !prev)}
          className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
          title={isZenMode ? "退出全屏禅定 (Esc / F)" : "全屏禅定模式 (F)"}
          aria-label={isZenMode ? "退出全屏" : "进入全屏"}
        >
          {isZenMode ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>

      <section className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 py-8 text-center min-h-[34rem]">
        <div className="relative z-10 flex flex-col items-center animate-[scale-in_0.3s_cubic-bezier(0.16,1,0.3,1)]">
          {/* Header & Mode Badge */}
          <div className="flex flex-col items-center space-y-1.5">
            <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">
              {heading}
            </h1>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-3 py-0.5 text-xs text-zinc-400">
              <span
                className={`size-2 rounded-full ${
                  status === "running" ? "bg-teal-400 animate-pulse" : "bg-amber-400"
                }`}
              />
              <span className="font-medium text-zinc-300">
                {status === "running" ? "深度专注中" : "已暂停"}
              </span>
              {status === "running" && timerLabel ? (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="text-teal-300/90 font-mono text-[11px]">{timerLabel}</span>
                </>
              ) : null}
            </div>
          </div>

          {/* Minimalist 60-Second Circular Dial */}
          <div
            className={`relative mt-7 grid place-items-center rounded-full border border-white/10 bg-[var(--af-surface)] shadow-[0_16px_50px_rgba(0,0,0,0.6)] transition-all duration-500 ${
              isZenMode
                ? "size-80 sm:size-96"
                : "size-64 sm:size-72 md:size-80"
            }`}
          >
            {/* Ambient inner soft ring */}
            <div
              className={`absolute inset-3 rounded-full border transition-colors duration-700 ${
                status === "running"
                  ? "border-teal-400/20 shadow-[inset_0_0_30px_rgba(45,212,191,0.06)]"
                  : "border-amber-400/15 shadow-[inset_0_0_20px_rgba(251,191,36,0.04)]"
              }`}
            />

            {/* High-Precision Circular SVG Dial */}
            <svg
              className="absolute inset-0 size-full p-4 text-white/20 pointer-events-none overflow-visible"
              viewBox="0 0 100 100"
              aria-hidden="true"
            >
              {/* Base Outer Circular Track */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1.5"
              />

              {/* 60 Precision Second Ticks (12 o'clock = 0s) */}
              {Array.from({ length: 60 }).map((_, i) => {
                const angleDeg = i * 6 - 90;
                const angle = (angleDeg * Math.PI) / 180;
                const isMajor = i % 5 === 0;
                const isPassed = status === "running" && i <= currentSecond;
                const tickLength = isMajor ? 4 : 2;
                const rOuter = radius + 2;
                const rInner = rOuter - tickLength;

                const x1 = 50 + rOuter * Math.cos(angle);
                const y1 = 50 + rOuter * Math.sin(angle);
                const x2 = 50 + rInner * Math.cos(angle);
                const y2 = 50 + rInner * Math.sin(angle);

                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={
                      isPassed
                        ? "#2dd4bf"
                        : isMajor
                        ? "rgba(255,255,255,0.3)"
                        : "rgba(255,255,255,0.1)"
                    }
                    strokeWidth={isMajor ? "1.2" : "0.75"}
                    strokeLinecap="round"
                    className="transition-colors duration-200"
                  />
                );
              })}

              {/* Sweeping Second Hand (starts at 12 o'clock, perfectly aligned with ticks) */}
              <line
                x1="50"
                y1="50"
                x2="50"
                y2="14"
                stroke={status === "running" ? "#2dd4bf" : "#fbbf24"}
                strokeWidth="1.5"
                strokeLinecap="round"
                style={{
                  transformOrigin: "50px 50px",
                  transform: `rotate(${secondAngle}deg)`,
                  transition: "transform 0.3s cubic-bezier(0.4, 2.08, 0.55, 0.44)",
                  filter: status === "running" ? "drop-shadow(0 0 4px rgba(45,212,191,0.8))" : "none",
                }}
              />

              {/* Center Pivot Core */}
              <circle
                cx="50"
                cy="50"
                r="3"
                fill={status === "running" ? "#2dd4bf" : "#fbbf24"}
                className="transition-colors duration-500"
              />
              <circle cx="50" cy="50" r="1.2" fill="#070b0d" />
            </svg>

            {/* Central Big Typography Time Display */}
            <div className="relative z-10 flex flex-col items-center justify-center">
              <p
                className={`font-mono font-semibold tabular-nums text-white tracking-tight transition-all duration-300 ${
                  isZenMode
                    ? "text-6xl sm:text-7xl lg:text-8xl"
                    : "text-5xl sm:text-6xl"
                }`}
              >
                {elapsedLabel}
              </p>
            </div>
          </div>

          {/* Minimal Controls + Keyboard Guide */}
          <div className="mt-8 flex flex-col items-center space-y-3">
            <div className="flex flex-wrap items-center justify-center gap-3.5">
              {status === "running" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  disabled={commandBusy}
                  onClick={onPause}
                  className="h-11 px-6 text-sm font-medium border-white/10 hover:border-white/20 hover:bg-white/5 active:scale-95 transition-all group"
                  title="暂停计时 (Space)"
                >
                  <Pause className="size-4 text-zinc-300 group-hover:scale-110 transition-transform" />
                  <span>暂停</span>
                  <kbd className="ml-1.5 hidden rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline">
                    Space
                  </kbd>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  disabled={commandBusy}
                  onClick={onResume}
                  className="h-11 px-6 text-sm font-medium shadow-[0_0_24px_rgba(45,212,191,0.3)] hover:scale-105 active:scale-95 transition-all group"
                  title="继续计时 (Space)"
                >
                  <Play className="size-4 fill-current group-hover:scale-110 transition-transform" />
                  <span>继续</span>
                  <kbd className="ml-1.5 hidden rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-teal-950 font-bold sm:inline">
                    Space
                  </kbd>
                </Button>
              )}

              <Button
                type="button"
                variant={status === "running" ? "primary" : "secondary"}
                size="lg"
                disabled={commandBusy}
                onClick={handleRequestEnd}
                className={`h-11 px-6 text-sm font-medium transition-all group ${
                  status === "running"
                    ? "shadow-[0_0_24px_rgba(45,212,191,0.35)] hover:scale-105 active:scale-95"
                    : "border-teal-400/40 text-teal-200 bg-teal-500/10 hover:bg-teal-500/20 active:scale-95"
                }`}
                title="结束并收口 (Enter)"
              >
                <Square className="size-4 fill-current group-hover:scale-110 transition-transform" />
                <span>结束并收口</span>
                <kbd className="ml-1.5 hidden rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px] opacity-80 sm:inline">
                  Enter
                </kbd>
              </Button>
            </div>

            {/* Discreet keyboard shortcuts guide */}
            <p className="text-[11px] text-zinc-500">
              快捷键：<kbd className="text-zinc-400">Space</kbd> 暂停/继续 · <kbd className="text-zinc-400">Enter</kbd> 收口 · <kbd className="text-zinc-400">F</kbd> 全屏禅定 · <kbd className="text-zinc-400">N</kbd> 记闪念
            </p>
          </div>

          {/* Minimalist Floating Scratchpad Drawer (Summoned via N or Button) */}
          {showScratchpad ? (
            <div className="mt-5 w-full max-w-md animate-[fade-in-up_0.2s_ease-out] rounded-xl border border-teal-500/30 bg-[#0d1417] p-3 shadow-2xl">
              <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs text-zinc-400">
                <span className="flex items-center gap-1 text-teal-300 font-medium">
                  <StickyNote className="size-3.5" /> 闪念随手记（不打断专注）
                </span>
                <Button
                  type="button"
                  onClick={() => setShowScratchpad(false)}
                  className="rounded p-0.5 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  ref={inputRef}
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveNote();
                  }}
                  placeholder="记下突发想法，回车即存..."
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-teal-400 focus:outline-none"
                />
                <Button
                  type="button"
                  onClick={handleSaveNote}
                  className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-teal-400 transition-colors"
                >
                  <CornerDownLeft className="size-3" />
                  <span>存</span>
                </Button>
              </div>
              {savedNotes.length > 0 ? (
                <ul className="mt-2.5 max-h-24 overflow-y-auto space-y-1 text-left focus-scrollbar">
                  {savedNotes.map((note, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between text-[11px] text-zinc-300 bg-white/5 rounded px-2 py-1"
                    >
                      <span className="truncate pr-2">• {note}</span>
                      <Button
                        type="button"
                        onClick={() => setSavedNotes((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-zinc-500 hover:text-red-400 shrink-0"
                      >
                        <X className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Confirm End Focus Modal */}
      {confirmEndOpen ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-[fade-in_0.15s_ease-out]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-end-title"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-[#0f1519] p-6 shadow-2xl animate-[scale-in_0.2s_cubic-bezier(0.16,1,0.3,1)] text-left">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-teal-500/30 bg-teal-500/10 text-teal-300">
                <Square className="size-5 fill-current" aria-hidden="true" />
              </div>
              <div>
                <h2 id="confirm-end-title" className="text-lg font-semibold text-white">
                  结束本次专注？
                </h2>
                <p className="text-xs text-zinc-400">
                  当前已专注 <span className="font-mono font-semibold text-teal-300">{elapsedLabel}</span> · 计时已自动暂停
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-zinc-300">
              结束计时后将冻结本次学习时长，并进入收口成果沉淀与复盘环节。
            </p>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={handleCancelEnd}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                继续专注
              </button>
              <button
                type="button"
                autoFocus
                disabled={commandBusy}
                onClick={handleConfirmEnd}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-teal-400 px-5 text-sm font-semibold text-[#071011] shadow-[0_0_20px_rgba(45,212,191,0.3)] transition-all hover:bg-teal-300 hover:shadow-[0_0_28px_rgba(45,212,191,0.5)] active:scale-[0.98]"
              >
                确认结束
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
