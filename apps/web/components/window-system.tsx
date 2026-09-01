"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteRegistryWindow,
  emptyWindowRegistry,
  getRegistryWindow,
  hasRegistryWindow,
  materializeWindowInstances,
  maxWindowRegistryCounter,
  mergeWindowRegistries,
  migrateLegacyWindowRegistry,
  minimizeForegroundWindow,
  normalizeWindowRegistry,
  touchRegistryWindow,
  updateRegistryWindowMetadata,
  updateRegistryWindowWorkState,
  upsertRegistryWindow,
  windowRegistriesEqual,
  type WindowClosePolicy,
  type WindowInstance,
  type WindowRegistryState,
  type WindowVersionStamp,
  type WindowWorkState,
} from "@/lib/client/window-system-state";
import { getBrowserStoragePort } from "@/lib/client/storage-port";

export type { WindowClosePolicy, WindowInstance, WindowWorkState } from "@/lib/client/window-system-state";
export type WindowSizePreset = "medium" | "large" | "wide";

export interface WindowDefinition {
  key: string;
  kind: string;
  title: string;
  closePolicy?: WindowClosePolicy;
  size?: WindowSizePreset;
  onDiscard?: () => void;
  render: () => React.ReactNode;
}

export interface WindowSystemValue {
  windows: WindowInstance[];
  foregroundKey: string | null;
  definitionVersion: number;
  getWindowDefinition: (key: string) => WindowDefinition | null;
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
const PERSISTENCE_PREFIX = "af.window-system.v2";
const LEGACY_PERSISTENCE_PREFIX = "af.window-system.v1";
const WINDOW_CHANNEL = "areaforge-window-system-v2";
const LEGACY_TOOL_WINDOW_KEYS = ["quick-create", "recovery-help"] as const;

function storageKey(userId: string): string {
  return `${PERSISTENCE_PREFIX}:${userId}`;
}

function legacyStorageKey(userId: string): string {
  return `${LEGACY_PERSISTENCE_PREFIX}:${userId}`;
}

function readPersistedRegistry(userId: string): WindowRegistryState {
  if (typeof window === "undefined") return emptyWindowRegistry();
  try {
    const localStorage = getBrowserStoragePort("local");
    const sessionStorage = getBrowserStoragePort("session");
    const raw = localStorage?.getItem(storageKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isV2RegistryShape(parsed)) return normalizeWindowRegistry(parsed);
    }

    const legacyRaw = localStorage?.getItem(legacyStorageKey(userId))
      ?? sessionStorage?.getItem(legacyStorageKey(userId));
    return legacyRaw ? migrateLegacyWindowRegistry(JSON.parse(legacyRaw) as unknown) : emptyWindowRegistry();
  } catch {
    return emptyWindowRegistry();
  }
}

function persistRegistry(userId: string, state: WindowRegistryState): void {
  if (typeof window === "undefined") return;
  try {
    getBrowserStoragePort("local")?.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Window recovery is best effort and must never block business actions.
  }
}

export function WindowSystemProvider(props: { userId: string; children: React.ReactNode }) {
  return <WindowSystemProviderState key={props.userId} {...props} />;
}

function WindowSystemProviderState(props: { userId: string; children: React.ReactNode }) {
  const definitionsRef = useRef(new Map<string, WindowDefinition>());
  const [definitionVersion, setDefinitionVersion] = useState(0);
  const [registry, setRegistry] = useState<WindowRegistryState>(emptyWindowRegistry);
  const registryRef = useRef(registry);
  const clockRef = useRef(0);
  const sourceIdRef = useRef(createSourceId());
  const [foregroundKey, setForegroundKeyState] = useState<string | null>(null);
  const foregroundKeyRef = useRef<string | null>(null);
  const [closeDiscardDialog, setCloseDiscardDialog] = useState<{ key: string; title: string } | null>(null);
  const pendingOpenKeysRef = useRef(new Set<string>());
  const restoreFocusRef = useRef(new Map<string, HTMLElement>());

  const setForegroundKey = useCallback((key: string | null) => {
    foregroundKeyRef.current = key;
    setForegroundKeyState(key);
  }, []);

  const rememberFocus = useCallback((key: string) => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active.closest('[role="dialog"], [role="alertdialog"]')) return;
    restoreFocusRef.current.set(key, active);
  }, []);

  const restoreFocus = useCallback((key: string) => {
    const rememberedTarget = restoreFocusRef.current.get(key);
    restoreFocusRef.current.delete(key);
    const target = rememberedTarget?.isConnected
      ? rememberedTarget
      : document.querySelector<HTMLElement>("[data-window-focus-fallback]");
    if (!target) return;
    window.setTimeout(() => {
      if (target.isConnected && !target.hasAttribute("disabled")) target.focus({ preventScroll: true });
    }, 0);
  }, []);

  const broadcastRegistry = useCallback((state: WindowRegistryState) => {
    persistRegistry(props.userId, state);
    try {
      if (typeof BroadcastChannel === "undefined") return;
      const channel = new BroadcastChannel(WINDOW_CHANNEL);
      channel.postMessage({ userId: props.userId, sourceId: sourceIdRef.current, registry: state });
      channel.close();
    } catch {
      // Storage events remain the cross-tab fallback.
    }
  }, [props.userId]);

  const installRegistry = useCallback((next: WindowRegistryState, broadcast: boolean) => {
    registryRef.current = next;
    clockRef.current = Math.max(clockRef.current, maxWindowRegistryCounter(next));
    setRegistry(next);
    if (broadcast) broadcastRegistry(next);

    const foreground = foregroundKeyRef.current;
    if (foreground && !hasRegistryWindow(next, foreground)) {
      setForegroundKey(null);
      setCloseDiscardDialog((current) => current?.key === foreground ? null : current);
      restoreFocus(foreground);
    }
  }, [broadcastRegistry, restoreFocus, setForegroundKey]);

  const commitRegistry = useCallback((updater: (
    current: WindowRegistryState,
    stamp: WindowVersionStamp,
  ) => WindowRegistryState): { state: WindowRegistryState; changedByUpdater: boolean } => {
    const persisted = readPersistedRegistry(props.userId);
    const base = mergeWindowRegistries(registryRef.current, persisted);
    clockRef.current = Math.max(clockRef.current, maxWindowRegistryCounter(base));
    const stamp = { counter: clockRef.current + 1, actorId: sourceIdRef.current };
    const next = updater(base, stamp);
    const changedByUpdater = !windowRegistriesEqual(base, next);
    const changedFromLocal = !windowRegistriesEqual(registryRef.current, next);
    if (changedFromLocal) {
      installRegistry(next, true);
    } else {
      // The ref can lead React state while persistence restoration and a local
      // open happen in the same turn. Reconcile the rendered state without
      // broadcasting an unchanged registry back to other tabs.
      setRegistry(next);
    }
    return { state: next, changedByUpdater };
  }, [installRegistry, props.userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const persisted = readPersistedRegistry(props.userId);
      const merged = mergeWindowRegistries(registryRef.current, persisted);
      if (!windowRegistriesEqual(registryRef.current, merged)) installRegistry(merged, false);
      persistRegistry(props.userId, merged);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [installRegistry, props.userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      commitRegistry((current, stamp) => LEGACY_TOOL_WINDOW_KEYS.reduce(
        (next, key) => deleteRegistryWindow(next, key, stamp),
        current,
      ));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [commitRegistry]);

  useEffect(() => {
    const onExternalRegistry = (incoming: unknown, sourceId?: string) => {
      if (sourceId && sourceId === sourceIdRef.current) return;
      if (!isV2RegistryShape(incoming)) return;
      const normalized = normalizeWindowRegistry(incoming);
      clockRef.current = Math.max(clockRef.current, maxWindowRegistryCounter(normalized));
      const merged = mergeWindowRegistries(registryRef.current, normalized);
      if (windowRegistriesEqual(registryRef.current, merged)) return;
      installRegistry(merged, true);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey(props.userId) || !event.newValue) return;
      try {
        onExternalRegistry(JSON.parse(event.newValue) as unknown);
      } catch {
        // Ignore malformed external state; local windows remain usable.
      }
    };
    window.addEventListener("storage", onStorage);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(WINDOW_CHANNEL);
        channel.addEventListener("message", (event: MessageEvent) => {
          const message = event.data as { userId?: unknown; sourceId?: unknown; registry?: unknown } | null;
          if (message?.userId !== props.userId || typeof message.sourceId !== "string") return;
          onExternalRegistry(message.registry, message.sourceId);
        });
      } catch {
        channel = null;
      }
    }

    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [installRegistry, props.userId]);

  const getWindowDefinition = useCallback((key: string) => definitionsRef.current.get(key) ?? null, []);

  const registerWindow = useCallback((definition: WindowDefinition) => {
    definitionsRef.current.set(definition.key, definition);
    setDefinitionVersion((version) => version + 1);
    if (pendingOpenKeysRef.current.delete(definition.key)) {
      commitRegistry((current, stamp) => upsertRegistryWindow(current, definition, Date.now(), stamp));
      setForegroundKey(definition.key);
    }
    return () => {
      // Persisted windows need the last render definition across route remounts.
    };
  }, [commitRegistry, setForegroundKey]);

  const ensureWindow = useCallback((definition: WindowDefinition) => {
    definitionsRef.current.set(definition.key, definition);
    setDefinitionVersion((version) => version + 1);
    let created = false;
    commitRegistry((current, stamp) => {
      if (hasRegistryWindow(current, definition.key)) return current;
      created = true;
      return upsertRegistryWindow(current, definition, Date.now(), stamp);
    });
    if (created) setForegroundKey(definition.key);
  }, [commitRegistry, setForegroundKey]);

  const hasWindow = useCallback((key: string) => hasRegistryWindow(registryRef.current, key), []);

  const openWindow = useCallback((key: string) => {
    const definition = definitionsRef.current.get(key);
    rememberFocus(key);
    if (!definition) {
      pendingOpenKeysRef.current.add(key);
      return;
    }
    commitRegistry((current, stamp) => {
      const now = Date.now();
      const opened = upsertRegistryWindow(current, definition, now, stamp);
      return touchRegistryWindow(opened, key, now, stamp);
    });
    setForegroundKey(key);
  }, [commitRegistry, rememberFocus, setForegroundKey]);

  const focusWindow = useCallback((key: string) => {
    if (!hasRegistryWindow(registryRef.current, key)) return;
    rememberFocus(key);
    commitRegistry((current, stamp) => touchRegistryWindow(current, key, Date.now(), stamp));
    setForegroundKey(key);
  }, [commitRegistry, rememberFocus, setForegroundKey]);

  const minimizeWindow = useCallback((key: string) => {
    const next = minimizeForegroundWindow(foregroundKeyRef.current, key);
    if (next === foregroundKeyRef.current) return;
    setForegroundKey(next);
    restoreFocus(key);
  }, [restoreFocus, setForegroundKey]);

  const closeWindow = useCallback((key: string) => {
    pendingOpenKeysRef.current.delete(key);
    if (!hasRegistryWindow(registryRef.current, key)) return;
    commitRegistry((current, stamp) => deleteRegistryWindow(current, key, stamp));
    if (foregroundKeyRef.current === key) setForegroundKey(null);
    setCloseDiscardDialog((current) => current?.key === key ? null : current);
    restoreFocus(key);
  }, [commitRegistry, restoreFocus, setForegroundKey]);

  const requestCloseWindow = useCallback((key: string) => {
    pendingOpenKeysRef.current.delete(key);
    const target = getRegistryWindow(registryRef.current, key);
    if (!target) return;
    if (target.closePolicy === "minimizeOnly") {
      minimizeWindow(key);
      return;
    }
    if (target.closePolicy === "confirmDiscard" && target.workState !== "clean" && target.workState !== "completed") {
      setCloseDiscardDialog({ key, title: target.title });
      return;
    }
    closeWindow(key);
  }, [closeWindow, minimizeWindow]);

  const setWindowWorkState = useCallback((key: string, state: WindowWorkState) => {
    commitRegistry((current, stamp) => updateRegistryWindowWorkState(current, key, state, Date.now(), stamp));
  }, [commitRegistry]);

  const updateWindowMetadata = useCallback((key: string, metadata: Pick<WindowDefinition, "kind" | "title" | "closePolicy">) => {
    commitRegistry((current, stamp) => updateRegistryWindowMetadata(current, key, metadata, Date.now(), stamp));
  }, [commitRegistry]);

  const refreshWindow = useCallback((key: string) => {
    if (definitionsRef.current.has(key)) setDefinitionVersion((version) => version + 1);
  }, []);

  const confirmDiscard = useCallback(() => {
    const key = closeDiscardDialog?.key;
    setCloseDiscardDialog(null);
    if (!key) return;
    definitionsRef.current.get(key)?.onDiscard?.();
    closeWindow(key);
  }, [closeDiscardDialog, closeWindow]);

  const cancelDiscard = useCallback(() => setCloseDiscardDialog(null), []);
  const windows = useMemo(() => materializeWindowInstances(registry, foregroundKey), [foregroundKey, registry]);

  const value = useMemo<WindowSystemValue>(() => ({
    windows,
    foregroundKey,
    definitionVersion,
    getWindowDefinition,
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
  }), [windows, foregroundKey, definitionVersion, getWindowDefinition, registerWindow, ensureWindow, hasWindow, openWindow, focusWindow, minimizeWindow, closeWindow, requestCloseWindow, setWindowWorkState, updateWindowMetadata, refreshWindow, closeDiscardDialog, confirmDiscard, cancelDiscard]);

  return <WindowSystemContext.Provider value={value}>{props.children}</WindowSystemContext.Provider>;
}

export function useWindowSystem(): WindowSystemValue {
  const value = useContext(WindowSystemContext);
  if (!value) throw new Error("useWindowSystem must be used inside WindowSystemProvider");
  return value;
}

function isV2RegistryShape(value: unknown): value is WindowRegistryState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WindowRegistryState>;
  return candidate.version === 2 && Array.isArray(candidate.records);
}

function createSourceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
