"use client";

import { Bot, ChevronDown, ClipboardCheck, PanelsTopLeft, TimerReset, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWindowSystem, type WindowInstance } from "@/components/window-system";
import {
  calculateWindowDockLayout,
  type WindowDockLayout,
} from "@/lib/client/window-system-state";

const dockFocusableSelector = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function WindowDock(props: { excludeKeys?: readonly string[] }) {
  const { windows, foregroundKey, focusWindow, requestCloseWindow } = useWindowSystem();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [layout, setLayout] = useState<WindowDockLayout>({ mode: "full", visibleCount: windows.length });
  const dockRef = useRef<HTMLDivElement>(null);
  const desktopRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const background = useMemo(() => windows
    .filter((window) => window.key !== foregroundKey && !props.excludeKeys?.includes(window.key))
    .sort(compareDockWindows), [foregroundKey, props.excludeKeys, windows]);
  const backgroundSignature = background.map((window) => `${window.key}:${window.title}:${window.updatedAt}:${window.closePolicy}`).join("|");
  const visible = background.slice(0, layout.visibleCount);
  const hidden = background.slice(layout.visibleCount);
  const menuOpen = expanded && hidden.length >= 2;

  const focusDockReturnTarget = () => {
    document.querySelector<HTMLElement>("[data-window-focus-fallback]")?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (hidden.length >= 2) return;
    const timer = window.setTimeout(() => setExpanded(false), 0);
    return () => window.clearTimeout(timer);
  }, [hidden.length]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && dockRef.current?.contains(target)) return;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menuOpen]);

  useEffect(() => {
    const measurement = measureRef.current;
    const update = () => {
      const fullWidths = measurement
        ? Array.from(measurement.querySelectorAll<HTMLElement>("[data-window-measure-full]")).map((item) => item.getBoundingClientRect().width)
        : [];
      const compactWidths = measurement
        ? Array.from(measurement.querySelectorAll<HTMLElement>("[data-window-measure-compact]")).map((item) => item.getBoundingClientRect().width)
        : [];
      if (fullWidths.length !== background.length || compactWidths.length !== background.length) return;
      const moreWidths = new Map<number, number>();
      measurement?.querySelectorAll<HTMLElement>("[data-window-measure-more]").forEach((item) => {
        const hiddenCount = Number(item.dataset.windowMeasureMore);
        if (Number.isFinite(hiddenCount)) moreWidths.set(hiddenCount, item.getBoundingClientRect().width);
      });
      setLayout(calculateWindowDockLayout(desktopRef.current?.clientWidth ?? 0, fullWidths, compactWidths, moreWidths));
    };

    update();
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (desktopRef.current) observer?.observe(desktopRef.current);
    if (measureRef.current) observer?.observe(measureRef.current);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [background.length, backgroundSignature]);

  if (background.length === 0) return null;

  return (
    <div ref={dockRef} className="relative flex min-w-0 flex-1 items-center justify-end overflow-visible" data-window-dock="true" aria-label="后台窗口">
      <button
        ref={mobileTriggerRef}
        type="button"
        className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-white/10 px-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white md:hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        aria-label={`打开后台窗口，共 ${background.length} 个`}
      >
        <PanelsTopLeft size={13} aria-hidden="true" />
        <span>后台 {background.length}</span>
      </button>

      <div ref={desktopRef} className="hidden min-w-0 flex-1 items-center justify-end gap-2 overflow-visible md:flex">
        <div ref={measureRef} className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max gap-2 overflow-hidden" aria-hidden="true">
          {background.map((window) => <DockMeasureItems key={window.key} window={window} />)}
          {Array.from({ length: Math.max(2, background.length) }, (_, index) => index + 1).map((hiddenCount) => (
            <span key={hiddenCount} data-window-measure-more={hiddenCount} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-xs">更多窗口 {hiddenCount}</span>
          ))}
        </div>

        {visible.map((window) => (
          <DockItem
            key={window.key}
            window={window}
            compact={layout.mode === "compact"}
            onOpen={() => {
              focusDockReturnTarget();
              focusWindow(window.key);
            }}
            onClose={() => {
              focusDockReturnTarget();
              requestCloseWindow(window.key);
            }}
          />
        ))}

        {hidden.length >= 2 ? (
          <div className="relative shrink-0">
            <button
              ref={moreTriggerRef}
              type="button"
              className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-white/10 px-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-controls={menuId}
            >
              <ChevronDown size={13} aria-hidden="true" />更多窗口 {hidden.length}
            </button>
            {menuOpen ? (
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label="更多后台窗口"
                className="absolute bottom-9 right-0 z-[var(--af-layer-shell-popover)] w-64 min-w-0 max-w-[calc(100vw-2rem)] rounded-md border border-white/15 bg-[#101419] p-2 shadow-xl"
                onKeyDown={(event) => handleMenuKeyDown(event, menuRef.current, moreTriggerRef.current, () => setExpanded(false))}
              >
                {hidden.map((window) => (
                  <DockItem
                    key={window.key}
                    window={window}
                    menuItem
                    onOpen={() => {
                      focusDockReturnTarget();
                      setExpanded(false);
                      focusWindow(window.key);
                    }}
                    onClose={() => {
                      focusDockReturnTarget();
                      setExpanded(false);
                      requestCloseWindow(window.key);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <MobileDockSheet
        open={mobileOpen}
        windows={background}
        onClose={() => setMobileOpen(false)}
        onOpenWindow={(key) => {
          focusDockReturnTarget();
          setMobileOpen(false);
          focusWindow(key);
        }}
        onCloseWindow={(key) => {
          focusDockReturnTarget();
          setMobileOpen(false);
          requestCloseWindow(key);
        }}
      />
    </div>
  );
}

function DockMeasureItems({ window }: { window: WindowInstance }) {
  return (
    <>
      <span data-window-measure-full className="inline-flex h-7 w-max max-w-48 items-center gap-1.5 rounded-md border border-white/10 px-2 text-xs">
        <WindowDockIcon kind={window.kind} /><span>{window.title}</span>
        {window.closePolicy !== "minimizeOnly" ? <X size={12} aria-hidden="true" /> : null}
      </span>
      <span data-window-measure-compact className="inline-flex h-7 w-max max-w-32 items-center gap-1.5 rounded-md border border-white/10 px-2 text-xs">
        <WindowDockIcon kind={window.kind} /><span>{window.title}</span>
      </span>
    </>
  );
}

function DockItem(props: {
  window: WindowInstance;
  onOpen: () => void;
  onClose: () => void;
  compact?: boolean;
  menuItem?: boolean;
}) {
  return (
    <div
      role={props.menuItem ? "none" : undefined}
      className={`group/dock flex min-w-0 shrink items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white ${
        props.menuItem ? "h-9 w-full" : `h-7 ${props.compact ? "max-w-32" : "max-w-48"}`
      }`}
    >
      <button
        type="button"
        role={props.menuItem ? "menuitem" : undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-zinc-300 transition-colors group-hover/dock:text-white focus-visible:outline-none"
        onClick={props.onOpen}
        title={`打开${props.window.title}`}
      >
        <WindowDockIcon kind={props.window.kind} />
        <span className="truncate">{props.window.title}</span>
      </button>
      {!props.compact && props.window.closePolicy !== "minimizeOnly" ? (
        <button
          type="button"
          aria-label={`关闭${props.window.title}`}
          className="flex size-4 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-none"
          onClick={props.onClose}
          title="关闭"
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function MobileDockSheet(props: {
  open: boolean;
  windows: readonly WindowInstance[];
  onClose: () => void;
  onOpenWindow: (key: string) => void;
  onCloseWindow: (key: string) => void;
}) {
  const { onClose, onCloseWindow, onOpenWindow, open, windows } = props;
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusInitial = () => (panel?.querySelector<HTMLElement>(dockFocusableSelector) ?? panel)?.focus({ preventScroll: true });
    focusInitial();
    const onFocusIn = (event: FocusEvent) => {
      if (panel?.contains(event.target as Node)) return;
      focusInitial();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab" && panel) trapDockFocus(event, panel);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[var(--af-layer-modal)] bg-black/55" role="presentation">
      <button type="button" className="absolute inset-0 h-full w-full border-0 p-0 cursor-default bg-transparent" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="af-bottom-sheet af-responsive-surface absolute inset-x-0 bottom-0 z-10 overflow-y-auto overscroll-contain rounded-t-lg border-t border-white/15 bg-[#101419] pt-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold text-white">后台窗口</h2>
          <button type="button" aria-label="关闭后台窗口列表" className="flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="grid gap-2">
          {windows.map((window) => <DockItem key={window.key} window={window} menuItem onOpen={() => onOpenWindow(window.key)} onClose={() => onCloseWindow(window.key)} />)}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function trapDockFocus(event: KeyboardEvent, panel: HTMLElement): void {
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(dockFocusableSelector));
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus({ preventScroll: true });
    return;
  }
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && activeIndex <= 0) {
    event.preventDefault();
    focusable.at(-1)?.focus({ preventScroll: true });
  } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
    event.preventDefault();
    focusable[0]?.focus({ preventScroll: true });
  }
}

function compareDockWindows(left: WindowInstance, right: WindowInstance): number {
  const leftPriority = left.kind === "session-closeout" ? 1 : 0;
  const rightPriority = right.kind === "session-closeout" ? 1 : 0;
  return rightPriority - leftPriority || right.updatedAt - left.updatedAt || left.key.localeCompare(right.key);
}

function WindowDockIcon({ kind }: { kind: string }) {
  if (kind === "confirmation-center") return <ClipboardCheck size={13} className="shrink-0" aria-hidden="true" />;
  if (kind === "ai-assistant") return <Bot size={13} className="shrink-0" aria-hidden="true" />;
  if (kind === "session-closeout") return <TimerReset size={13} className="shrink-0" aria-hidden="true" />;
  return <PanelsTopLeft size={13} className="shrink-0" aria-hidden="true" />;
}

function handleMenuKeyDown(
  event: React.KeyboardEvent,
  menu: HTMLElement | null,
  trigger: HTMLElement | null,
  close: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    trigger?.focus({ preventScroll: true });
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  if (items.length === 0) return;
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
  items[nextIndex]?.focus({ preventScroll: true });
}
