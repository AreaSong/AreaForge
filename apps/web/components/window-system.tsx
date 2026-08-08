"use client";

import {
  ChevronDown,
  Minimize2,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  closeOrMinimizeWindow,
  calculateVisibleWindowCount,
  closeWindow as removeWindow,
  focusWindow as focusWindowState,
  minimizeWindow as minimizeWindowState,
  mergeExternalWindows,
  mergeRestoredWindows,
  nextForegroundKey,
  normalizePersistedWindows,
  upsertWindow,
  type WindowClosePolicy,
  type WindowInstance,
  type WindowWorkState,
} from "@/lib/study/window-system-state";

export type { WindowClosePolicy, WindowInstance, WindowWorkState } from "@/lib/study/window-system-state";

export interface WindowDefinition {
  key: string;
  kind: string;
  title: string;
  closePolicy?: WindowClosePolicy;
  render: () => React.ReactNode;
}

interface WindowSystemValue {
  windows: WindowInstance[];
  foregroundKey: string | null;
  registerWindow: (definition: WindowDefinition) => () => void;
  ensureWindow: (definition: WindowDefinition) => void;
  hasWindow: (key: string) => boolean;
  openWindow: (key: string) => void;
  focusWindow: (key: string) => void;
  minimizeWindow: (key: string) => void;
  closeWindow: (key: string) => void;
  requestCloseWindow: (key: string) => void;
  setWindowWorkState: (key: string, state: WindowWorkState) => void;
  updateWindowMetadata: (key: string, metadata: Pick<WindowDefinition, "kind" | "title" | "closePolicy">) => void;
  refreshWindow: (key: string) => void;
  closeDiscardDialog: { key: string; title: string } | null;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
}

const WindowSystemContext = createContext<WindowSystemValue | null>(null);
const PERSISTENCE_PREFIX = "af.window-system.v1";
const WINDOW_CHANNEL = "areaforge-window-system-v1";

interface PersistedWindowState {
  revision: number;
  windows: WindowInstance[];
}

function storageKey(userId: string): string {
  return `${PERSISTENCE_PREFIX}:${userId}`;
}

function readPersistedWindows(userId: string): PersistedWindowState {
  if (typeof window === "undefined") return { revision: 0, windows: [] };
  try {
    const raw = window.localStorage.getItem(storageKey(userId)) ?? window.sessionStorage.getItem(storageKey(userId));
    if (!raw) return { revision: 0, windows: [] };
    const parsed = JSON.parse(raw) as unknown;
    const state = Array.isArray(parsed)
      ? { revision: 0, windows: parsed }
      : parsed && typeof parsed === "object"
        ? parsed as Partial<PersistedWindowState>
        : null;
    if (!state || !Array.isArray(state.windows)) return { revision: 0, windows: [] };
    return {
      revision: typeof state.revision === "number" && Number.isFinite(state.revision) ? state.revision : 0,
      windows: normalizePersistedWindows(state.windows),
    };
  } catch {
    return { revision: 0, windows: [] };
  }
}

function persistWindows(userId: string, state: PersistedWindowState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Window persistence is best effort and must never block business actions.
  }
}

export function WindowSystemProvider(props: { userId: string; children: React.ReactNode }) {
  return <WindowSystemProviderState key={props.userId} {...props} />;
}

function WindowSystemProviderState(props: { userId: string; children: React.ReactNode }) {
  const definitionsRef = useRef(new Map<string, WindowDefinition>());
  const [definitionsVersion, setDefinitionsVersion] = useState(0);
  // Do not read browser storage during the render that hydrates the server
  // tree. Restoring persisted windows in an effect keeps the first HTML tree
  // identical while still recovering windows immediately after mount.
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const [foregroundKey, setForegroundKey] = useState<string | null>(null);
  const foregroundKeyRef = useRef<string | null>(null);
  const [closeDiscardDialog, setCloseDiscardDialog] = useState<{ key: string; title: string } | null>(null);
  const windowsRef = useRef(windows);
  const pendingOpenKeysRef = useRef(new Set<string>());
  const restoreFocusRef = useRef(new Map<string, HTMLElement>());
  const revisionRef = useRef(0);
  const sourceIdRef = useRef<string>(createSourceId());

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    foregroundKeyRef.current = foregroundKey;
  }, [foregroundKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const persisted = readPersistedWindows(props.userId);
      revisionRef.current = persisted.revision;
      const restoredBase = mergeRestoredWindows(windowsRef.current, persisted.windows);
      // A window may be opened during the async restore gap. Preserve that
      // local foreground intent when the older persisted snapshot arrives;
      // otherwise the restored minimized flag hides the newly requested UI.
      const foregroundIntent = foregroundKeyRef.current;
      const restored = foregroundIntent && restoredBase.some((window) => window.key === foregroundIntent)
        ? focusWindowState(restoredBase, foregroundIntent, Date.now())
        : restoredBase;
      windowsRef.current = restored;
      setWindows(restored);
      if (foregroundIntent && restored.some((window) => window.key === foregroundIntent)) {
        setForegroundKey(foregroundIntent);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.userId]);

  useEffect(() => {
    const onExternalState = (state: PersistedWindowState, sourceId?: string) => {
      if (sourceId && sourceId === sourceIdRef.current) return;
      if (state.revision <= revisionRef.current) return;
      revisionRef.current = state.revision;
      const normalized = normalizePersistedWindows(state.windows);
      const merged = mergeExternalWindows(windowsRef.current, normalized, foregroundKeyRef.current);
      windowsRef.current = merged.windows;
      setWindows(merged.windows);
      foregroundKeyRef.current = merged.foregroundKey;
      setForegroundKey(merged.foregroundKey);
      setCloseDiscardDialog(null);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey(props.userId) || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as PersistedWindowState;
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.windows)) onExternalState(parsed);
      } catch {
        // Ignore malformed cross-tab state; local state remains usable.
      }
    };
    window.addEventListener("storage", onStorage);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(WINDOW_CHANNEL);
        channel.addEventListener("message", (event: MessageEvent) => {
          const message = event.data as { userId?: unknown; sourceId?: unknown; state?: PersistedWindowState } | null;
          if (message?.userId !== props.userId || !message.state || typeof message.sourceId !== "string") return;
          onExternalState(message.state, message.sourceId);
        });
      } catch {
        channel = null;
      }
    }

    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [props.userId]);

  const commitWindows = useCallback((updater: (current: WindowInstance[]) => WindowInstance[]) => {
    const current = windowsRef.current;
    const next = updater(current);
    // Effects that reconcile a global window may run repeatedly while the
    // route or activity status changes. Do not create a new revision or
    // broadcast when the updater did not change any window instance.
    if (next.length === current.length && next.every((window, index) => window === current[index])) return;
    windowsRef.current = next;
    const state: PersistedWindowState = { revision: revisionRef.current + 1, windows: next };
    revisionRef.current = state.revision;
    setWindows(next);
    persistWindows(props.userId, state);
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(WINDOW_CHANNEL);
        channel.postMessage({ userId: props.userId, sourceId: sourceIdRef.current, state });
        channel.close();
      }
    } catch {
      // BroadcastChannel is optional; storage persistence is sufficient fallback.
    }
  }, [props.userId]);

  const registerWindow = useCallback((definition: WindowDefinition) => {
    definitionsRef.current.set(definition.key, definition);
    setDefinitionsVersion((version) => version + 1);
    if (pendingOpenKeysRef.current.delete(definition.key)) {
      const now = Date.now();
      commitWindows((current) => upsertWindow(current, definition, now));
      foregroundKeyRef.current = definition.key;
      setForegroundKey(definition.key);
    }
    return () => {
      // Keep the last definition available while an instance is persisted or
      // minimized. Route transitions can temporarily unmount the component
      // that owns a public window; deleting the definition here would leave a
      // foreground instance with no renderable content. A new registration
      // replaces this closure, and the provider is recreated on logout/user
      // change, so retaining it has bounded lifetime and no stale cross-user
      // visibility.
    };
  }, [commitWindows]);

  const ensureWindow = useCallback((definition: WindowDefinition) => {
    definitionsRef.current.set(definition.key, definition);
    setDefinitionsVersion((version) => version + 1);
    // Existing instances may have been intentionally minimized by the user.
    // Ensuring a definition must not steal the foreground on every status
    // refresh; only a missing instance gets its initial foreground state.
    if (!windowsRef.current.some((window) => window.key === definition.key)) {
      const now = Date.now();
      commitWindows((current) => upsertWindow(current, definition, now));
      foregroundKeyRef.current = definition.key;
      setForegroundKey(definition.key);
    }
  }, [commitWindows]);

  const hasWindow = useCallback((key: string) => windowsRef.current.some((window) => window.key === key), []);

  const rememberFocus = useCallback((key: string) => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.closest('[role="dialog"]')) return;
    restoreFocusRef.current.set(key, active);
  }, []);

  const restoreFocus = useCallback((key: string) => {
    const target = restoreFocusRef.current.get(key);
    restoreFocusRef.current.delete(key);
    if (!target) return;
    window.setTimeout(() => {
      if (target.isConnected && !target.hasAttribute("disabled")) target.focus();
    }, 0);
  }, []);

  const openWindow = useCallback((key: string) => {
    const definition = definitionsRef.current.get(key);
    rememberFocus(key);
    if (!definition) {
      // Effects can request a global window before the component that owns its
      // render definition has registered. Keep the intent until registration
      // completes instead of silently dropping the open request.
      pendingOpenKeysRef.current.add(key);
      return;
    }
    const now = Date.now();
    commitWindows((current) => upsertWindow(current, definition, now));
    foregroundKeyRef.current = key;
    setForegroundKey(key);
  }, [commitWindows, rememberFocus]);

  const focusWindow = useCallback((key: string) => {
    commitWindows((current) => focusWindowState(current, key, Date.now()));
    foregroundKeyRef.current = key;
    setForegroundKey(key);
  }, [commitWindows]);

  const minimizeWindow = useCallback((key: string) => {
    commitWindows((current) => minimizeWindowState(current, key));
    if (foregroundKeyRef.current === key) foregroundKeyRef.current = null;
    setForegroundKey((current) => current === key ? null : current);
    restoreFocus(key);
  }, [commitWindows, restoreFocus]);

  const closeWindow = useCallback((key: string) => {
    pendingOpenKeysRef.current.delete(key);
    const nextWindows = removeWindow(windowsRef.current, key);
    commitWindows(() => nextWindows);
    if (foregroundKeyRef.current === key) {
      const nextKey = nextForegroundKey(nextWindows, key);
      foregroundKeyRef.current = nextKey;
      setForegroundKey(nextKey);
      if (nextKey) {
        commitWindows((current) => focusWindowState(current, nextKey, Date.now()));
      }
    }
    setCloseDiscardDialog((current) => current?.key === key ? null : current);
    restoreFocus(key);
  }, [commitWindows, restoreFocus]);

  const requestCloseWindow = useCallback((key: string) => {
    pendingOpenKeysRef.current.delete(key);
    const target = windowsRef.current.find((window) => window.key === key);
    if (!target) return;
    if (target.closePolicy === "confirmDiscard" && target.workState !== "clean" && target.workState !== "completed") {
      setCloseDiscardDialog({ key, title: target.title });
      return;
    }

    const nextWindows = closeOrMinimizeWindow(windowsRef.current, key);
    commitWindows(() => nextWindows);
    if (foregroundKeyRef.current === key) {
      const nextKey = nextForegroundKey(nextWindows, key);
      foregroundKeyRef.current = nextKey;
      setForegroundKey(nextKey);
      if (nextKey) commitWindows((current) => focusWindowState(current, nextKey, Date.now()));
    }
    restoreFocus(key);
  }, [commitWindows, restoreFocus]);

  const setWindowWorkState = useCallback((key: string, state: WindowWorkState) => {
    commitWindows((current) => current.map((window) => window.key === key ? { ...window, workState: state, updatedAt: Date.now() } : window));
  }, [commitWindows]);

  const updateWindowMetadata = useCallback((key: string, metadata: Pick<WindowDefinition, "kind" | "title" | "closePolicy">) => {
    const current = windowsRef.current.find((window) => window.key === key);
    if (!current) return;
    const closePolicy = metadata.closePolicy ?? current.closePolicy;
    if (current.kind === metadata.kind && current.title === metadata.title && current.closePolicy === closePolicy) return;
    commitWindows((windows) => windows.map((window) => window.key === key
      ? { ...window, kind: metadata.kind, title: metadata.title, closePolicy, updatedAt: Date.now() }
      : window));
  }, [commitWindows]);

  const refreshWindow = useCallback((key: string) => {
    // Window content is kept in a stable render closure so open windows do not
    // lose form state. Consumers still need a host render when that closure's
    // current React node changes (for example, list -> detail navigation).
    if (!definitionsRef.current.has(key)) return;
    setDefinitionsVersion((version) => version + 1);
  }, []);

  const confirmDiscard = useCallback(() => {
    const key = closeDiscardDialog?.key;
    setCloseDiscardDialog(null);
    if (!key) return;
    const nextWindows = removeWindow(windowsRef.current, key);
    commitWindows(() => nextWindows);
    if (foregroundKeyRef.current === key) {
      const nextKey = nextForegroundKey(nextWindows, key);
      foregroundKeyRef.current = nextKey;
      setForegroundKey(nextKey);
      if (nextKey) commitWindows((current) => focusWindowState(current, nextKey, Date.now()));
    }
  }, [closeDiscardDialog, commitWindows]);

  const cancelDiscard = useCallback(() => setCloseDiscardDialog(null), []);

  const value = useMemo<WindowSystemValue>(() => ({
    windows,
    foregroundKey,
    registerWindow,
    ensureWindow,
    hasWindow,
    openWindow,
    focusWindow,
    minimizeWindow,
    closeWindow,
    requestCloseWindow,
    setWindowWorkState,
    updateWindowMetadata,
    refreshWindow,
    closeDiscardDialog,
    confirmDiscard,
    cancelDiscard,
  }), [windows, foregroundKey, registerWindow, ensureWindow, hasWindow, openWindow, focusWindow, minimizeWindow, closeWindow, requestCloseWindow, setWindowWorkState, updateWindowMetadata, refreshWindow, closeDiscardDialog, confirmDiscard, cancelDiscard]);

  return <WindowSystemContext.Provider value={value}>{props.children}<WindowHost definitionsRef={definitionsRef} definitionsVersion={definitionsVersion} /><WindowDiscardDialog /></WindowSystemContext.Provider>;
}

export function useWindowSystem(): WindowSystemValue {
  const value = useContext(WindowSystemContext);
  if (!value) throw new Error("useWindowSystem must be used inside WindowSystemProvider");
  return value;
}

function WindowHost(props: { definitionsRef: React.MutableRefObject<Map<string, WindowDefinition>>; definitionsVersion: number }) {
  const { windows, foregroundKey, minimizeWindow, requestCloseWindow, focusWindow } = useWindowSystem();
  const panelRef = useRef<HTMLElement>(null);
  const foreground = foregroundKey ? windows.find((window) => window.key === foregroundKey) : null;
  const definition = foreground ? props.definitionsRef.current.get(foreground.key) : null;
  const foregroundWindowKey = foreground?.key ?? null;
  const foregroundMinimized = foreground?.minimized ?? false;

  useEffect(() => {
    if (!foregroundWindowKey || foregroundMinimized || !definition) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target = panel.querySelector<HTMLElement>([
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",")) ?? panel;
    const timer = window.setTimeout(() => {
      target.focus({ preventScroll: true });
      if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [definition, foregroundWindowKey, foregroundMinimized]);

  if (!foreground || foreground.minimized || !definition) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={foreground.title}
        tabIndex={-1}
        className="pointer-events-auto absolute left-1/2 top-1/2 flex h-[min(760px,calc(100dvh-8rem))] w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-white/15 bg-[#101419] shadow-2xl shadow-black/50"
        onMouseDown={() => focusWindow(foreground.key)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            requestCloseWindow(foreground.key);
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>([
            "button:not([disabled])",
            "a[href]",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            '[tabindex]:not([tabindex="-1"])',
          ].join(",")) ?? []);
          if (focusable.length === 0) {
            event.preventDefault();
            panelRef.current?.focus({ preventScroll: true });
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
        }}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0d1117] px-4">
          <span className="size-2 rounded-full bg-teal-300" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{foreground.title}</h2>
          <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white" onClick={() => minimizeWindow(foreground.key)} aria-label="最小化窗口" title="最小化">
            <Minimize2 size={15} aria-hidden="true" />
          </button>
          <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white" onClick={() => requestCloseWindow(foreground.key)} aria-label="关闭窗口" title="关闭">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">{definition.render()}</div>
      </section>
    </div>
  );
}

function WindowDiscardDialog() {
  const { closeDiscardDialog, confirmDiscard, cancelDiscard } = useWindowSystem();
  if (!closeDiscardDialog) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="window-discard-title" className="w-full max-w-sm rounded-lg border border-white/15 bg-[#101419] p-5 shadow-2xl">
        <h2 id="window-discard-title" className="text-base font-semibold text-white">放弃未保存内容？</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">“{closeDiscardDialog.title}”中有未提交内容。可以返回窗口继续，或确认放弃。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm text-zinc-300 hover:bg-white/10" onClick={cancelDiscard}>返回窗口</button>
          <button type="button" className="h-10 rounded-md bg-red-400/90 px-3 text-sm font-medium text-red-950 hover:bg-red-300" onClick={confirmDiscard}>放弃并关闭</button>
        </div>
      </section>
    </div>
  );
}

function createSourceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  const backgroundSignature = background.map((window) => `${window.key}:${window.title}`).join("|");

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && dockRef.current?.contains(target)) return;
      setExpanded(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  const visible = background.slice(0, visibleCount);
  const hidden = background.slice(visibleCount);
  const menuOpen = expanded && hidden.length > 0;

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menuOpen]);

  useEffect(() => {
    const measurement = measureRef.current;
    const update = () => {
      const width = measureAvailableDockWidth(dockRef.current);
      const itemWidths = measurement
        ? Array.from(measurement.querySelectorAll<HTMLElement>("[data-window-measure-item]")).map((item) => item.getBoundingClientRect().width)
        : [];
      if (itemWidths.length !== background.length) return;
      const moreWidths = new Map<number, number>();
      measurement?.querySelectorAll<HTMLElement>("[data-window-measure-more]").forEach((item) => {
        const hiddenCount = Number(item.dataset.windowMeasureMore);
        if (Number.isFinite(hiddenCount)) moreWidths.set(hiddenCount, item.getBoundingClientRect().width);
      });
      if (moreWidths.size === 0) moreWidths.set(1, 112);
      setVisibleCount(calculateVisibleWindowCount(width, itemWidths, moreWidths));
    };
    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(update);
    const dock = dockRef.current;
    const parent = dock?.parentElement ?? null;
    if (dock) observer?.observe(dock);
    if (measurement) observer?.observe(measurement);
    if (parent) {
      observer?.observe(parent);
      for (const child of Array.from(parent.children)) observer?.observe(child);
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [background.length, backgroundSignature]);

  if (background.length === 0) return null;

  return (
    <div ref={dockRef} className="relative flex min-w-0 flex-1 items-center justify-end gap-2 overflow-visible" data-window-dock="true" aria-label="后台窗口">
      <div ref={measureRef} className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max gap-2 overflow-hidden" aria-hidden="true">
        {background.map((window) => <DockMeasureItem key={window.key} window={window} />)}
        {Array.from({ length: Math.max(1, background.length) }, (_, index) => index + 1).map((hiddenCount) => (
          <span key={hiddenCount} data-window-measure-more={hiddenCount} className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-2 text-xs">更多窗口 {hiddenCount}</span>
        ))}
      </div>
      {visible.map((window) => <DockItem key={window.key} window={window} onOpen={() => focusWindow(window.key)} onClose={() => requestCloseWindow(window.key)} />)}
      {hidden.length > 0 ? (
        <div className="relative">
          <button
            ref={moreTriggerRef}
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-2 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls={menuId}
          >
            <ChevronDown size={14} aria-hidden="true" />更多窗口 {hidden.length}
          </button>
          {menuOpen ? (
            <div ref={menuRef} id={menuId} role="menu" aria-label="更多后台窗口" className="absolute right-0 bottom-10 z-[90] min-w-64 rounded-md border border-white/15 bg-[#101419] p-2 shadow-xl" onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setExpanded(false);
                moreTriggerRef.current?.focus({ preventScroll: true });
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
              if (items.length === 0) return;
              event.preventDefault();
              const currentIndex = items.indexOf(document.activeElement as HTMLElement);
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
              items[nextIndex]?.focus({ preventScroll: true });
            }}>
              {hidden.map((window) => <DockItem key={window.key} window={window} menuItem onOpen={() => { setExpanded(false); focusWindow(window.key); }} onClose={() => requestCloseWindow(window.key)} />)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DockMeasureItem({ window }: { window: WindowInstance }) {
  return (
    <span data-window-measure-item className="flex max-w-48 items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-xs">
      <span className="min-w-0 truncate">{window.title}</span>
      <span className="inline-flex size-5 shrink-0" aria-hidden="true"><X size={12} /></span>
    </span>
  );
}

function DockItem(props: { window: WindowInstance; onOpen: () => void; onClose: () => void; menuItem?: boolean }) {
  return (
    <div role={props.menuItem ? "none" : undefined} className="flex max-w-48 items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-xs text-zinc-300">
      <button type="button" role={props.menuItem ? "menuitem" : undefined} className="min-w-0 flex-1 truncate text-left hover:text-white" onClick={props.onOpen} title={`打开${props.window.title}`}>{props.window.title}</button>
      <button type="button" className="inline-flex size-5 items-center justify-center rounded text-zinc-600 hover:bg-white/10 hover:text-zinc-200" onClick={props.onClose} aria-label={`关闭${props.window.title}`} title="关闭"><X size={12} aria-hidden="true" /></button>
    </div>
  );
}

function measureAvailableDockWidth(dock: HTMLElement | null): number {
  if (!dock) return 0;
  const ownWidth = dock.clientWidth;
  const parent = dock.parentElement;
  if (!parent) return ownWidth;

  const siblingWidth = Array.from(parent.children)
    .filter((child) => child !== dock)
    .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
  const style = window.getComputedStyle(parent);
  const parsedGap = Number.parseFloat(style.columnGap || style.gap || "0");
  const gap = Number.isFinite(parsedGap) ? parsedGap : 0;
  const gapWidth = Math.max(0, parent.children.length - 1) * gap;
  const availableWidth = parent.clientWidth - siblingWidth - gapWidth;

  return Math.max(0, ownWidth, availableWidth);
}
