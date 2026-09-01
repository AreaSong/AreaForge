"use client";

import { IconButton } from "@/components/ui/button";
import { useFocusScope, usePortalReady } from "@/components/ui/focus-scope";
import { OverlayBackdrop } from "@/components/ui/overlays";
import { Maximize2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type GlobalToolKey = "confirmation-center" | "ai-assistant" | "recovery-help" | "quick-create";
export type GlobalToolSize = "compact" | "medium" | "wide";

export interface GlobalToolDefinition {
  key: GlobalToolKey;
  title: string;
  size?: GlobalToolSize;
  onOpen?: () => void;
  onClose?: () => void;
  onExpand?: () => void;
  render: () => React.ReactNode;
}

interface GlobalToolSystemValue {
  activeKey: GlobalToolKey | null;
  definitionVersion: number;
  registerTool: (definition: GlobalToolDefinition) => () => void;
  getToolDefinition: (key: GlobalToolKey) => GlobalToolDefinition | null;
  openTool: (key: GlobalToolKey, trigger?: HTMLElement | null) => void;
  toggleTool: (key: GlobalToolKey, trigger?: HTMLElement | null) => void;
  closeTool: (restoreFocus?: boolean) => void;
  refreshTool: (key: GlobalToolKey) => void;
}

const GlobalToolSystemContext = createContext<GlobalToolSystemValue | null>(null);

const sizeClass: Record<GlobalToolSize, string> = {
  compact: "md:w-[20rem]",
  medium: "md:w-[30rem]",
  wide: "md:w-[42rem]",
};

export function GlobalToolProvider(props: { children: React.ReactNode }) {
  const definitionsRef = useRef(new Map<GlobalToolKey, GlobalToolDefinition>());
  const triggerRef = useRef<HTMLElement | null>(null);
  const activeKeyRef = useRef<GlobalToolKey | null>(null);
  const [activeKey, setActiveKey] = useState<GlobalToolKey | null>(null);
  const [definitionVersion, setDefinitionVersion] = useState(0);

  const registerTool = useCallback((definition: GlobalToolDefinition) => {
    definitionsRef.current.set(definition.key, definition);
    setDefinitionVersion((version) => version + 1);
    return () => {
      if (definitionsRef.current.get(definition.key) !== definition) return;
      definitionsRef.current.delete(definition.key);
      setDefinitionVersion((version) => version + 1);
    };
  }, []);

  const getToolDefinition = useCallback((key: GlobalToolKey) => (
    definitionsRef.current.get(key) ?? null
  ), []);

  const openTool = useCallback((key: GlobalToolKey, trigger?: HTMLElement | null) => {
    const definition = definitionsRef.current.get(key);
    if (!definition) return;
    const current = activeKeyRef.current;
    if (current && current !== key) definitionsRef.current.get(current)?.onClose?.();
    triggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    definition.onOpen?.();
    activeKeyRef.current = key;
    setActiveKey(key);
  }, []);

  const closeTool = useCallback((restoreFocus = true) => {
    const current = activeKeyRef.current;
    if (current) definitionsRef.current.get(current)?.onClose?.();
    activeKeyRef.current = null;
    setActiveKey(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (!restoreFocus || !trigger) return;
    window.setTimeout(() => {
      if (trigger.isConnected && !trigger.hasAttribute("disabled")) trigger.focus({ preventScroll: true });
    }, 0);
  }, []);

  const toggleTool = useCallback((key: GlobalToolKey, trigger?: HTMLElement | null) => {
    if (activeKeyRef.current === key) {
      closeTool();
      return;
    }
    openTool(key, trigger);
  }, [closeTool, openTool]);

  const refreshTool = useCallback((key: GlobalToolKey) => {
    if (definitionsRef.current.has(key)) setDefinitionVersion((version) => version + 1);
  }, []);

  const value = useMemo<GlobalToolSystemValue>(() => ({
    activeKey,
    definitionVersion,
    registerTool,
    getToolDefinition,
    openTool,
    toggleTool,
    closeTool,
    refreshTool,
  }), [activeKey, closeTool, definitionVersion, getToolDefinition, openTool, refreshTool, registerTool, toggleTool]);

  return <GlobalToolSystemContext.Provider value={value}>{props.children}</GlobalToolSystemContext.Provider>;
}

export function GlobalToolLayer() {
  const {
    activeKey,
    getToolDefinition,
    closeTool,
  } = useGlobalTools();
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const definition = activeKey ? getToolDefinition(activeKey) : null;
  const portalReady = usePortalReady();
  const active = definition !== null && portalReady;

  useFocusScope({
    active,
    panelRef,
    allowEscape: true,
    onEscape: closeTool,
    restoreFocus: false,
  });

  if (!active || !definition) return null;
  const toolSize = definition.size ?? "medium";

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--af-layer-modal)] bg-black/25 md:bg-black/15"
      role="presentation"
      data-layout-region="global-tool-layer"
      data-global-ai-ui="true"
    >
      <OverlayBackdrop
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => closeTool()}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`af-global-tool-panel absolute flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/15 bg-[#101419] shadow-2xl shadow-black/60 ${sizeClass[toolSize]}`}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-[#0d1117] px-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{definition.title}</h2>
          {definition.onExpand ? (
            <IconButton
              label={`将${definition.title}展开为工作窗口`}
              className="!size-8 text-zinc-400 hover:bg-white/10 hover:text-white"
              onClick={() => {
                closeTool(false);
                definition.onExpand?.();
              }}
              title="展开为工作窗口"
            >
              <Maximize2 size={15} aria-hidden="true" />
            </IconButton>
          ) : null}
          <IconButton
            label={`关闭${definition.title}`}
            className="!size-8 text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={() => closeTool()}
            title="关闭"
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="af-responsive-surface min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">{definition.render()}</div>
      </section>
    </div>,
    document.body,
  );
}

export function useGlobalTools(): GlobalToolSystemValue {
  const value = useContext(GlobalToolSystemContext);
  if (!value) throw new Error("useGlobalTools must be used inside GlobalToolProvider");
  return value;
}
