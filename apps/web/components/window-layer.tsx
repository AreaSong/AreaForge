"use client";

import { Bot, ClipboardCheck, Minimize2, TimerReset, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useWindowSystem } from "@/components/window-system";
import type { WindowSizePreset } from "@/components/window-system";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const windowSizeClass: Record<WindowSizePreset, string> = {
  medium: "sm:max-w-2xl sm:h-[min(42rem,calc(100dvh-2rem))]",
  large: "sm:max-w-4xl sm:h-[min(46rem,calc(100dvh-2rem))]",
  wide: "sm:max-w-5xl sm:h-[min(50rem,calc(100dvh-2rem))]",
};

const workStateLabel = {
  clean: "已保存",
  dirty: "未保存",
  submitting: "正在提交",
  syncPending: "等待同步",
  conflict: "需要处理冲突",
  completed: "已完成",
} as const;

export function WindowLayer() {
  const {
    windows,
    foregroundKey,
    getWindowDefinition,
    minimizeWindow,
    requestCloseWindow,
  } = useWindowSystem();
  const panelRef = useRef<HTMLElement>(null);
  const foreground = foregroundKey ? windows.find((window) => window.key === foregroundKey) : null;
  const definition = foreground ? getWindowDefinition(foreground.key) : null;
  const foregroundWindowKey = foreground?.key ?? null;
  const hasDefinition = definition !== null;

  useEffect(() => {
    if (!foregroundWindowKey || !hasDefinition) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target = panel.querySelector<HTMLElement>(focusableSelector) ?? panel;
    const timer = window.setTimeout(() => {
      target.focus({ preventScroll: true });
      if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    }, 0);
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-window-backdrop]")) {
        minimizeWindow(foregroundWindowKey);
        return;
      }
      if (!panel.contains(event.target as Node)) target.focus({ preventScroll: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        minimizeWindow(foregroundWindowKey);
        return;
      }
      if (event.key === "Tab") trapWindowFocus(event, panel);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [foregroundWindowKey, hasDefinition, minimizeWindow]);

  if (!foreground || !definition || typeof document === "undefined") return null;
  const size = definition.size ?? "large";

  return createPortal(
    <div className="fixed inset-0 z-[var(--af-layer-workspace-window)] flex items-center justify-center overflow-hidden bg-black/50 p-2 backdrop-blur-[2px] sm:p-4" data-layout-region="global-window-portal" data-global-ai-ui="true" role="presentation">
      <button
        type="button"
        data-window-backdrop="true"
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
        aria-label="返回页面并最小化窗口"
        onPointerDown={(event) => {
          event.preventDefault();
          minimizeWindow(foreground.key);
        }}
        onClick={() => minimizeWindow(foreground.key)}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={foreground.title}
        tabIndex={-1}
        className={`relative z-10 flex h-[calc(100dvh-1rem)] w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-white/15 bg-[#101419] shadow-2xl shadow-black/60 sm:w-[calc(100vw-2rem)] ${windowSizeClass[size]}`}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0d1117] px-4">
          <WindowKindIcon kind={foreground.kind} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{foreground.title}</h2>
          <span className={`hidden shrink-0 text-xs sm:inline ${foreground.workState === "conflict" ? "text-red-200" : foreground.workState === "dirty" || foreground.workState === "syncPending" ? "text-amber-200" : "text-zinc-500"}`} role="status">
            {workStateLabel[foreground.workState]}
          </span>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={() => minimizeWindow(foreground.key)}
            aria-label="最小化窗口"
            title="最小化"
          >
            <Minimize2 size={15} aria-hidden="true" />
          </button>
          {foreground.closePolicy !== "minimizeOnly" ? (
            <button
              type="button"
              data-window-close="true"
              className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
              onClick={() => requestCloseWindow(foreground.key)}
              aria-label="关闭窗口"
              title="关闭"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">{definition.render()}</div>
      </section>
    </div>,
    document.body,
  );
}

export function WindowDiscardDialog() {
  const { closeDiscardDialog, confirmDiscard, cancelDiscard } = useWindowSystem();
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!closeDiscardDialog) return;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelDiscard();
        return;
      }
      if (event.key === "Tab") trapWindowFocus(event, panelRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [cancelDiscard, closeDiscardDialog]);

  if (!closeDiscardDialog || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[var(--af-layer-critical)] grid place-items-center bg-black/60 p-4" role="presentation" data-global-ai-ui="true">
      <section ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="w-full max-w-sm rounded-lg border border-white/15 bg-[#101419] p-5 shadow-2xl">
        <h2 id={titleId} className="text-base font-semibold text-white">放弃未保存内容？</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">“{closeDiscardDialog.title}”中有未提交内容。可以返回窗口继续，或确认放弃。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm text-zinc-300 hover:bg-white/10" onClick={cancelDiscard}>返回窗口</button>
          <button type="button" className="h-10 rounded-md bg-red-400/90 px-3 text-sm font-medium text-red-950 hover:bg-red-300" onClick={confirmDiscard}>放弃并关闭</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function trapWindowFocus(event: React.KeyboardEvent | KeyboardEvent, panel: HTMLElement | null): void {
  if (!panel) return;
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus({ preventScroll: true });
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && currentIndex <= 0) {
    event.preventDefault();
    focusable[focusable.length - 1]?.focus({ preventScroll: true });
  } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
    event.preventDefault();
    focusable[0]?.focus({ preventScroll: true });
  }
}

function WindowKindIcon({ kind }: { kind: string }) {
  const Icon = kind === "confirmation-center"
    ? ClipboardCheck
    : kind === "ai-assistant"
      ? Bot
      : TimerReset;
  return <Icon size={16} className="shrink-0 text-teal-300" aria-hidden="true" />;
}
