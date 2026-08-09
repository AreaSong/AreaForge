"use client";

import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useWindowSystem, type WindowInstance } from "@/components/window-system";
import { calculateVisibleWindowCount } from "@/lib/study/window-system-state";

export function WindowDock() {
  const { windows, foregroundKey, focusWindow, requestCloseWindow } = useWindowSystem();
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(windows.length);
  const dockRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const background = windows.filter((window) => window.key !== foregroundKey);
  const backgroundSignature = background.map((window) => `${window.key}:${window.title}:${window.closePolicy}`).join("|");
  const visible = background.slice(0, visibleCount);
  const hidden = background.slice(visibleCount);
  const menuOpen = expanded && hidden.length >= 2;

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
      const itemWidths = measurement
        ? Array.from(measurement.querySelectorAll<HTMLElement>("[data-window-measure-item]")).map((item) => item.getBoundingClientRect().width)
        : [];
      if (itemWidths.length !== background.length) return;
      const moreWidths = new Map<number, number>();
      measurement?.querySelectorAll<HTMLElement>("[data-window-measure-more]").forEach((item) => {
        const hiddenCount = Number(item.dataset.windowMeasureMore);
        if (Number.isFinite(hiddenCount)) moreWidths.set(hiddenCount, item.getBoundingClientRect().width);
      });
      setVisibleCount(calculateVisibleWindowCount(dockRef.current?.clientWidth ?? 0, itemWidths, moreWidths));
    };

    update();
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (dockRef.current) observer?.observe(dockRef.current);
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
    <div ref={dockRef} className="relative flex min-w-0 flex-1 items-center justify-end gap-2 overflow-visible" data-window-dock="true" aria-label="后台窗口">
      <div ref={measureRef} className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max gap-2 overflow-hidden" aria-hidden="true">
        {background.map((window) => <DockMeasureItem key={window.key} window={window} />)}
        {Array.from({ length: Math.max(2, background.length) }, (_, index) => index + 1).map((hiddenCount) => (
          <span key={hiddenCount} data-window-measure-more={hiddenCount} className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-2 text-xs">更多窗口 {hiddenCount}</span>
        ))}
      </div>

      {visible.map((window) => (
        <DockItem key={window.key} window={window} onOpen={() => focusWindow(window.key)} onClose={() => requestCloseWindow(window.key)} />
      ))}

      {hidden.length >= 2 ? (
        <div className="relative shrink-0">
          <button
            ref={moreTriggerRef}
            type="button"
            className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-white/10 px-2 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls={menuId}
          >
            <ChevronDown size={14} aria-hidden="true" />更多窗口 {hidden.length}
          </button>
          {menuOpen ? (
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="更多后台窗口"
              className="fixed right-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[var(--af-layer-shell-popover)] w-64 min-w-0 max-w-[calc(100vw-2rem)] rounded-md border border-white/15 bg-[#101419] p-2 shadow-xl lg:absolute lg:right-0 lg:bottom-10"
              onKeyDown={(event) => handleMenuKeyDown(event, menuRef.current, moreTriggerRef.current, () => setExpanded(false))}
            >
              {hidden.map((window) => (
                <DockItem
                  key={window.key}
                  window={window}
                  menuItem
                  onOpen={() => {
                    setExpanded(false);
                    focusWindow(window.key);
                  }}
                  onClose={() => {
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
  );
}

function DockMeasureItem({ window }: { window: WindowInstance }) {
  return (
    <span data-window-measure-item className="flex w-max min-w-20 max-w-48 shrink items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-xs">
      <span className="min-w-0 truncate">{window.title}</span>
      {window.closePolicy !== "minimizeOnly" ? <span className="inline-flex size-5 shrink-0" aria-hidden="true"><X size={12} /></span> : null}
    </span>
  );
}

function DockItem(props: { window: WindowInstance; onOpen: () => void; onClose: () => void; menuItem?: boolean }) {
  return (
    <div role={props.menuItem ? "none" : undefined} className="flex min-w-20 max-w-48 shrink items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-xs text-zinc-300">
      <button type="button" role={props.menuItem ? "menuitem" : undefined} className="min-w-0 flex-1 truncate text-left hover:text-white" onClick={props.onOpen} title={`打开${props.window.title}`}>{props.window.title}</button>
      {props.window.closePolicy !== "minimizeOnly" ? (
        <button type="button" role={props.menuItem ? "menuitem" : undefined} className="inline-flex size-5 shrink-0 items-center justify-center rounded text-zinc-600 hover:bg-white/10 hover:text-zinc-200" onClick={props.onClose} aria-label={`关闭${props.window.title}`} title="关闭"><X size={12} aria-hidden="true" /></button>
      ) : null}
    </div>
  );
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
