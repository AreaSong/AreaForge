"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { MousePointer2, Sparkles, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { useGlobalTools } from "@/components/global-tool-system";
import {
  loadAiAssistantContext,
  removeAiAssistantContext,
  saveAiAssistantContext,
  type AiAssistantEndpoint,
} from "@/lib/client/ai-assistant-context";
import { getAiDraftFormStorageKey } from "@/lib/client/ai-draft-form-key";
import {
  appendSelectionItem,
  createAiSelectionItem,
  getElementSelectionSource,
  getRangeSelectionSource,
  mergeSelectionItems,
  type AiSelectionItem,
} from "@/lib/client/ai-assistant-selection";
import { removePrivateBusinessDraft } from "@/lib/client/private-business-drafts";
import { getRouteTitle } from "@/lib/navigation/app-navigation";
import { useWindowSystem, type WindowWorkState } from "@/components/window-system";

export function GlobalAiAssistant({ userId, placement = "floating" }: { userId: string; placement?: "floating" | "header" }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageContextKey = `${pathname}?${searchParams.toString()}`;
  const [assistantContextKey, setAssistantContextKey] = useState(pageContextKey);
  const [assistantContextReady, setAssistantContextReady] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectionReturnTarget, setSelectionReturnTarget] = useState<"tool" | "window" | null>(null);
  const [assistantWorkState, setAssistantWorkState] = useState<WindowWorkState>("clean");
  const [endpoint, setEndpoint] = useState<AiAssistantEndpoint>("knowledge-card");
  const [items, setItems] = useState<AiSelectionItem[]>([]);
  const [dragRect, setDragRect] = useState<AiSelectionItem["rect"]>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragMoved = useRef(false);
  const suppressClick = useRef(false);
  const textSelectionCaptured = useRef(false);
  const pageContextKeyRef = useRef(pageContextKey);
  const mountedContextKeyRef = useRef<string | null>(null);
  const discardWindowRef = useRef<() => void>(() => undefined);
  const assistantWorkStateRef = useRef<WindowWorkState>("clean");
  const {
    closeWindow,
    focusWindow,
    foregroundKey,
    hasWindow,
    minimizeWindow,
    openWindow,
    registerWindow,
    refreshWindow,
    setWindowWorkState,
    windows,
  } = useWindowSystem();
  const {
    activeKey,
    closeTool,
    openTool,
    registerTool,
    refreshTool,
    toggleTool,
  } = useGlobalTools();
  const isForeground = foregroundKey === "ai-assistant";
  const isQuickOpen = activeKey === "ai-assistant";
  const assistantWindow = windows.find((window) => window.key === "ai-assistant") ?? null;

  const selectedText = useMemo(() => items.map((item) => item.text).join("\n\n").slice(0, 10_000), [items]);
  const draftContextKey = `${assistantContextKey}:${selectedText}`;
  const contextIsCurrent = assistantContextKey === pageContextKey;
  const contentRef = useRef<React.ReactNode>(null);

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setDragRect(null);
    dragStart.current = null;
    dragMoved.current = false;
    suppressClick.current = false;
    textSelectionCaptured.current = false;
    setSelectionReturnTarget(null);
  }, []);

  const resetAssistantContext = useCallback((contextKey: string) => {
    stopSelecting();
    setItems([]);
    setAssistantContextKey(contextKey);
  }, [stopSelecting]);

  const clearAssistantContext = useCallback((contextKey: string) => {
    removeAiAssistantContext(userId);
    resetAssistantContext(contextKey);
  }, [resetAssistantContext, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const persisted = loadAiAssistantContext(userId);
      if (persisted) {
        setAssistantContextKey(persisted.contextKey);
        setEndpoint(persisted.endpoint);
        setItems(persisted.items.map((item) => ({ ...item, rect: null })));
      }
      setAssistantContextReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId]);

  useEffect(() => {
    if (!assistantContextReady || (!assistantWindow && !isQuickOpen)) return;
    saveAiAssistantContext(userId, {
      schemaVersion: 2,
      contextKey: assistantContextKey,
      endpoint,
      items: items.map(({ identity, fingerprint, label, text }) => ({ identity, fingerprint, label, text })),
    });
  }, [assistantContextKey, assistantContextReady, assistantWindow, endpoint, isQuickOpen, items, userId]);

  useEffect(() => {
    const previousContextKey = mountedContextKeyRef.current;
    mountedContextKeyRef.current = pageContextKey;
    pageContextKeyRef.current = pageContextKey;
    if (previousContextKey === null || previousContextKey === pageContextKey) return;
    const workState = assistantWindow?.workState ?? assistantWorkState;
    const preserveDraft = (assistantWindow || isQuickOpen)
      && workState !== "clean"
      && workState !== "completed";
    const resetTimer = window.setTimeout(() => {
      if (preserveDraft) {
        minimizeWindow("ai-assistant");
        if (isQuickOpen) closeTool(false);
        stopSelecting();
        return;
      }
      if (assistantWindow) closeWindow("ai-assistant");
      if (isQuickOpen) closeTool(false);
      clearAssistantContext(pageContextKey);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [assistantWindow, assistantWorkState, clearAssistantContext, closeTool, closeWindow, isQuickOpen, minimizeWindow, pageContextKey, stopSelecting]);

  const addCurrentObject = useCallback(() => {
    const target = document.querySelector("[data-ai-current-object]")
      ?? document.querySelector("[data-ai-page-context]");
    const item = target instanceof Element ? selectionFromElement(target, target === document.querySelector("[data-ai-page-context]") ? getRouteTitle(pathname) : undefined) : null;
    if (!item) return;
    setItems((current) => appendSelectionItem(current, item));
  }, [pathname]);

  const prepareAssistant = useCallback(() => {
    const startingFresh = !hasWindow("ai-assistant");
    if (startingFresh && items.length === 0) {
      if (assistantContextReady) clearAssistantContext(pageContextKey);
      else resetAssistantContext(pageContextKey);
    }
  }, [assistantContextReady, clearAssistantContext, hasWindow, items.length, pageContextKey, resetAssistantContext]);

  function openAssistant(trigger: HTMLButtonElement) {
    if (hasWindow("ai-assistant")) {
      focusWindow("ai-assistant");
      return;
    }
    toggleTool("ai-assistant", trigger);
  }

  const beginSelecting = useCallback(() => {
    if (isForeground) {
      setSelectionReturnTarget("window");
      minimizeWindow("ai-assistant");
    } else if (isQuickOpen) {
      setSelectionReturnTarget("tool");
      closeTool(false);
    } else {
      return;
    }
    setSelecting(true);
  }, [closeTool, isForeground, isQuickOpen, minimizeWindow]);

  const finishSelecting = useCallback(() => {
    const target = selectionReturnTarget;
    setSelecting(false);
    setDragRect(null);
    dragStart.current = null;
    dragMoved.current = false;
    suppressClick.current = false;
    textSelectionCaptured.current = false;
    setSelectionReturnTarget(null);
    if (target === "window") focusWindow("ai-assistant");
    if (target === "tool") openTool("ai-assistant");
  }, [focusWindow, openTool, selectionReturnTarget]);

  useEffect(() => {
    if (!selecting) return;
    const onClick = (event: MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (!target || isAiAssistantUiTarget(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const item = selectionFromElement(target);
      if (item) setItems((current) => appendSelectionItem(current, item));
    };
    const onMouseUp = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || isAiAssistantUiTarget(target)) return;
      if (textSelectionCaptured.current) {
        textSelectionCaptured.current = false;
        return;
      }
      if (dragMoved.current) {
        dragMoved.current = false;
        return;
      }
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!text) return;
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      const item = selectionFromText(text, range, target, rect ? rectToValue(rect) : null);
      setItems((current) => appendSelectionItem(current, item));
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || isAiAssistantUiTarget(target)) return;
      dragStart.current = { x: event.clientX, y: event.clientY };
      dragMoved.current = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      const start = dragStart.current;
      if (!start) return;
      const rect = makeRect(start.x, start.y, event.clientX, event.clientY);
      if (rect.width < 6 && rect.height < 6) return;
      dragMoved.current = true;
      setDragRect(rect);
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = dragStart.current;
      dragStart.current = null;
      const target = event.target instanceof Element ? event.target : null;
      if (!start || !target || isAiAssistantUiTarget(target)) {
        dragMoved.current = false;
        setDragRect(null);
        return;
      }
      const hadDrag = dragMoved.current;
      dragMoved.current = false;
      const rect = makeRect(start.x, start.y, event.clientX, event.clientY);

      // Native text selection must win over rectangle selection. Pointer events
      // arrive before mouseup, so capture it here and suppress the follow-up
      // click without turning the selected text into an element selection.
      const selectedText = hadDrag ? window.getSelection()?.toString().trim() ?? "" : "";
      if (selectedText) {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const rangeRect = range?.getBoundingClientRect();
        const item = selectionFromText(
          selectedText,
          range,
          target,
          rangeRect ? rectToValue(rangeRect) : null,
        );
        setItems((current) => appendSelectionItem(current, item));
        textSelectionCaptured.current = true;
        suppressClick.current = true;
        setDragRect(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (rect.width < 8 || rect.height < 8) {
        setDragRect(null);
        return;
      }
      const selected = Array.from(document.querySelectorAll("[data-ai-selectable]"))
        .filter((element) => intersects(rect, element.getBoundingClientRect()))
        .map((element) => selectionFromElement(element))
        .filter((item): item is AiSelectionItem => Boolean(item));
      if (selected.length) {
        setItems((current) => mergeSelectionItems(current, selected));
      }
      suppressClick.current = true;
      setDragRect(null);
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      dragStart.current = null;
      textSelectionCaptured.current = false;
      setDragRect(null);
    };
  }, [selecting]);

  const handleWorkStateChange = useCallback((state: WindowWorkState) => {
    assistantWorkStateRef.current = state;
    setAssistantWorkState(state);
    setWindowWorkState("ai-assistant", state);
  }, [setWindowWorkState]);

  const handleNavigate = useCallback(() => {
    closeWindow("ai-assistant");
    clearAssistantContext(pageContextKeyRef.current);
  }, [clearAssistantContext, closeWindow]);

  const discardAssistantDraft = useCallback(() => {
    removePrivateBusinessDraft(getAiDraftFormStorageKey(endpoint, userId, draftContextKey));
    clearAssistantContext(pageContextKeyRef.current);
  }, [clearAssistantContext, draftContextKey, endpoint, userId]);

  useEffect(() => {
    discardWindowRef.current = discardAssistantDraft;
  }, [discardAssistantDraft]);

  const removeItem = useCallback((identity: string) => {
    setItems((current) => current.filter((item) => item.identity !== identity));
  }, []);

  const content = useMemo(() => (
    <div className="space-y-4" data-global-ai-ui="true">
      {!contextIsCurrent ? (
        <p role="status" className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-100">
          当前保留的是“{getRouteTitle(assistantContextKey.split("?")[0] ?? "/focus")}”中的未完成草稿。完成或放弃后，才能改选本页内容。
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!contextIsCurrent} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-300 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40" onClick={addCurrentObject}>
          <Sparkles size={15} aria-hidden="true" />加入当前对象
        </Button>
        <Button type="button" disabled={!contextIsCurrent} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40" onClick={beginSelecting}>
          <MousePointer2 size={15} aria-hidden="true" />框选内容
        </Button>
      </div>
      {items.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><p className="text-xs font-medium text-zinc-400">已选 {items.length} 项</p><Button type="button" className="text-xs text-zinc-500 hover:text-white" onClick={() => setItems([])}>清空</Button></div>
          <div className="space-y-2">{items.map((item) => (
            <div key={item.identity} className="flex items-start gap-2 rounded-md border border-white/10 p-2">
              <div className="min-w-0 flex-1"><p className="text-xs text-teal-200">{item.label}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-400">{item.text}</p></div>
              <Button type="button" className="text-zinc-500 hover:text-white" onClick={() => removeItem(item.identity)} aria-label={`移除${item.label}`} title="移除"><X size={14} aria-hidden="true" /></Button>
            </div>
          ))}</div>
        </div>
      ) : <p className="border-y border-white/10 py-3 text-sm text-zinc-500">还没有上下文。打开框选后选择任意页面元素或文本。</p>}
      <label className="grid gap-2 text-sm text-zinc-300">草稿用途
        <Select value={endpoint} onChange={(event) => setEndpoint(event.target.value as AiAssistantEndpoint)} className="h-10 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-2 text-white">
          <option value="knowledge-card">知识卡片</option><option value="learning-tree">学习树</option><option value="plan">计划草稿</option><option value="motivation">动机内容</option>
        </Select>
      </label>
      <div className="border-t border-white/10 pt-4"><AiDraftPanel key={`${endpoint}:${draftContextKey}`} endpoint={endpoint} userId={userId} defaultText={selectedText} draftContextKey={draftContextKey} onWorkStateChange={handleWorkStateChange} onNavigate={handleNavigate} /></div>
    </div>
  ), [addCurrentObject, assistantContextKey, beginSelecting, contextIsCurrent, draftContextKey, endpoint, handleNavigate, handleWorkStateChange, items, removeItem, selectedText, userId]);

  useEffect(() => {
    contentRef.current = content;
    refreshWindow("ai-assistant");
    refreshTool("ai-assistant");
  }, [content, refreshTool, refreshWindow]);

  useEffect(() => registerWindow({
    key: "ai-assistant",
    kind: "ai-assistant",
    title: "AI 助手",
    closePolicy: "confirmDiscard",
    size: "wide",
    onDiscard: () => discardWindowRef.current(),
    render: () => contentRef.current,
  }), [registerWindow]);

  useEffect(() => registerTool({
    key: "ai-assistant",
    title: "AI 助手",
    size: "wide",
    onOpen: prepareAssistant,
    onExpand: () => {
      openWindow("ai-assistant");
      setWindowWorkState("ai-assistant", assistantWorkStateRef.current);
    },
    render: () => contentRef.current,
  }), [openWindow, prepareAssistant, registerTool, setWindowWorkState]);

  return (
    <>
      {selecting ? items.map((item) => item.rect ? <div key={item.identity} className="pointer-events-none fixed z-[var(--af-layer-selection)] border-2 border-teal-300/80 bg-teal-300/10" style={{ top: item.rect.top, left: item.rect.left, width: item.rect.width, height: item.rect.height }} aria-hidden="true" /> : null) : null}
      {selecting && dragRect ? <div className="pointer-events-none fixed z-[var(--af-layer-selection)] border-2 border-dashed border-amber-300 bg-amber-300/10" style={{ top: dragRect.top, left: dragRect.left, width: dragRect.width, height: dragRect.height }} aria-hidden="true" /> : null}
      {selecting ? (
        <div className="fixed left-1/2 top-4 z-[var(--af-layer-selection)] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-md border border-teal-300/40 bg-[#101419] px-3 py-2 shadow-xl" data-global-ai-ui="true" role="status">
          <span className="truncate text-xs text-zinc-300">选择页面内容，已选 {items.length} 项</span>
          <Button type="button" className="h-8 shrink-0 rounded-md bg-teal-300 px-3 text-xs font-medium text-slate-950 hover:bg-teal-200" onClick={finishSelecting}>完成框选</Button>
        </div>
      ) : null}
      <Button
        type="button"
        data-global-ai-ui="true"
        className={placement === "floating"
          ? "fixed bottom-20 right-4 z-[var(--af-layer-selection)] inline-flex size-11 items-center justify-center rounded-full border border-teal-300/50 bg-[#0d1117] text-teal-200 shadow-lg hover:bg-teal-400/10 lg:bottom-6 lg:right-6"
          : "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-teal-300/40 px-2.5 text-xs text-teal-200 hover:bg-teal-300/10 max-[359px]:w-9 max-[359px]:justify-center max-[359px]:px-0 sm:px-3"}
        onClick={(event) => openAssistant(event.currentTarget)}
        aria-label="打开 AI 助手"
        aria-expanded={isForeground || isQuickOpen}
        title="AI 助手"
      >
        <Sparkles size={18} aria-hidden="true" />
        {placement === "header" ? <span className="hidden min-[1720px]:inline">AI 助手</span> : null}
      </Button>
    </>
  );
}

function isAiAssistantUiTarget(target: Element): boolean {
  return Boolean(target.closest("[data-global-ai-ui=\"true\"]") || target.closest('[role="dialog"]'));
}

function selectionFromElement(target: Element, explicitLabel?: string): AiSelectionItem | null {
  const element = target.closest("[data-ai-selectable]") ?? target;
  const text = element.textContent?.replace(/\s+/g, " ").trim().slice(0, 3_000) ?? "";
  if (!text) return null;
  const rect = element.getBoundingClientRect();
  const label = explicitLabel ?? (element.getAttribute("aria-label") || element.getAttribute("data-ai-label") || element.tagName.toLowerCase());
  return createAiSelectionItem({
    kind: "element",
    source: getElementSelectionSource(element),
    label,
    text,
    rect: rectToValue(rect),
  });
}

function selectionFromText(
  text: string,
  range: Range | null,
  target: Element,
  rect: AiSelectionItem["rect"],
): AiSelectionItem {
  return createAiSelectionItem({
    kind: "text",
    source: getRangeSelectionSource(range, target),
    label: "选中文本",
    text,
    rect,
  });
}

function rectToValue(rect: DOMRect): AiSelectionItem["rect"] {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function makeRect(startX: number, startY: number, endX: number, endY: number): NonNullable<AiSelectionItem["rect"]> {
  return {
    top: Math.min(startY, endY),
    left: Math.min(startX, endX),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function intersects(rect: NonNullable<AiSelectionItem["rect"]>, target: DOMRect): boolean {
  return rect.left < target.right
    && rect.left + rect.width > target.left
    && rect.top < target.bottom
    && rect.top + rect.height > target.top;
}
