"use client";

import { MousePointer2, Sparkles, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { getRouteTitle } from "@/lib/navigation/batch7";
import { useWindowSystem } from "@/components/window-system";

type AiEndpoint = "learning-tree" | "knowledge-card" | "plan" | "motivation";

interface SelectionItem {
  id: string;
  label: string;
  text: string;
  rect: { top: number; left: number; width: number; height: number } | null;
}

export function GlobalAiAssistant({ userId, placement = "floating" }: { userId: string; placement?: "floating" | "header" }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageContextKey = `${pathname}?${searchParams.toString()}`;
  const [selecting, setSelecting] = useState(false);
  const [endpoint, setEndpoint] = useState<AiEndpoint>("knowledge-card");
  const [items, setItems] = useState<SelectionItem[]>([]);
  const [dragRect, setDragRect] = useState<SelectionItem["rect"]>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragMoved = useRef(false);
  const suppressClick = useRef(false);
  const textSelectionCaptured = useRef(false);
  const pageContextKeyRef = useRef(pageContextKey);
  const mountedContextKeyRef = useRef<string | null>(null);
  const { openWindow, registerWindow, refreshWindow, requestCloseWindow, windows } = useWindowSystem();
  const isOpen = windows.some((window) => window.key === "ai-assistant" && !window.minimized);

  const selectedText = useMemo(() => items.map((item) => item.text).join("\n\n").slice(0, 10_000), [items]);
  const contentRef = useRef<React.ReactNode>(null);

  useEffect(() => {
    const previousContextKey = mountedContextKeyRef.current;
    mountedContextKeyRef.current = pageContextKey;
    pageContextKeyRef.current = pageContextKey;
    if (previousContextKey === null || previousContextKey === pageContextKey) return;
    const resetTimer = window.setTimeout(() => {
      requestCloseWindow("ai-assistant");
      setSelecting(false);
      setItems([]);
      setDragRect(null);
      dragStart.current = null;
      dragMoved.current = false;
      suppressClick.current = false;
      textSelectionCaptured.current = false;
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [pageContextKey, requestCloseWindow]);

  const addCurrentObject = useCallback(() => {
    const target = document.querySelector("[data-ai-current-object]")
      ?? document.querySelector("[data-ai-page-context]");
    const item = target instanceof Element ? selectionFromElement(target, target === document.querySelector("[data-ai-page-context]") ? getRouteTitle(pathname) : undefined) : null;
    if (!item) return;
    setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
  }, [pathname]);

  function openAssistant() {
    openWindow("ai-assistant");
    if (!items.length) {
      const openedContext = pageContextKey;
      window.setTimeout(() => {
        if (pageContextKeyRef.current === openedContext) addCurrentObject();
      }, 0);
    }
  }

  useEffect(() => {
    if (!selecting || !isOpen) return;
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
      if (item) setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
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
      const item: SelectionItem = {
        id: `text:${hashText(text)}`,
        label: "选中文本",
        text: text.slice(0, 3_000),
        rect: rect ? rectToValue(rect) : null,
      };
      setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
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
        const item: SelectionItem = {
          id: `text:${hashText(selectedText)}`,
          label: "选中文本",
          text: selectedText.slice(0, 3_000),
          rect: rangeRect ? rectToValue(rangeRect) : null,
        };
        setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
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
        .filter((item): item is SelectionItem => Boolean(item));
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
  }, [isOpen, selecting]);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const content = useMemo(() => (
    <div className="space-y-4" data-global-ai-ui="true">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-300 hover:bg-white/[0.05]" onClick={addCurrentObject}>
          <Sparkles size={15} aria-hidden="true" />加入当前对象
        </button>
        <button type="button" className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${selecting ? "border-teal-300/60 text-teal-200" : "border-white/10 text-zinc-300"}`} onClick={() => setSelecting((current) => !current)}>
          <MousePointer2 size={15} aria-hidden="true" />{selecting ? "结束框选" : "框选内容"}
        </button>
        {selecting ? <span className="text-xs text-zinc-500">点击元素或拖选文本，可连续添加多个。</span> : null}
      </div>
      {items.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><p className="text-xs font-medium text-zinc-400">已选 {items.length} 项</p><button type="button" className="text-xs text-zinc-500 hover:text-white" onClick={() => setItems([])}>清空</button></div>
          <div className="space-y-2">{items.map((item) => (
            <div key={item.id} className="flex items-start gap-2 rounded-md border border-white/10 p-2">
              <div className="min-w-0 flex-1"><p className="text-xs text-teal-200">{item.label}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-400">{item.text}</p></div>
              <button type="button" className="text-zinc-500 hover:text-white" onClick={() => removeItem(item.id)} aria-label={`移除${item.label}`} title="移除"><X size={14} aria-hidden="true" /></button>
            </div>
          ))}</div>
        </div>
      ) : <p className="border-y border-white/10 py-3 text-sm text-zinc-500">还没有上下文。打开框选后选择任意页面元素或文本。</p>}
      <label className="grid gap-2 text-sm text-zinc-300">草稿用途
        <select value={endpoint} onChange={(event) => setEndpoint(event.target.value as AiEndpoint)} className="h-10 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-2 text-white">
          <option value="knowledge-card">知识卡片</option><option value="learning-tree">学习树</option><option value="plan">计划草稿</option><option value="motivation">动机内容</option>
        </select>
      </label>
      <div className="border-t border-white/10 pt-4"><AiDraftPanel key={`${endpoint}:${pageContextKey}:${selectedText}`} endpoint={endpoint} userId={userId} defaultText={selectedText} draftContextKey={`${pageContextKey}:${selectedText}`} /></div>
    </div>
  ), [addCurrentObject, endpoint, items, pageContextKey, removeItem, selecting, selectedText, userId]);

  useEffect(() => {
    contentRef.current = content;
    refreshWindow("ai-assistant");
  }, [content, refreshWindow]);

  useEffect(() => registerWindow({
    key: "ai-assistant",
    kind: "ai-assistant",
    title: "AI 助手",
    closePolicy: "confirmDiscard",
    render: () => contentRef.current,
  }), [registerWindow]);

  return (
    <>
      {selecting ? items.map((item) => item.rect ? <div key={item.id} className="pointer-events-none fixed z-40 border-2 border-teal-300/80 bg-teal-300/10" style={{ top: item.rect.top, left: item.rect.left, width: item.rect.width, height: item.rect.height }} aria-hidden="true" /> : null) : null}
      {selecting && dragRect ? <div className="pointer-events-none fixed z-[60] border-2 border-dashed border-amber-300 bg-amber-300/10" style={{ top: dragRect.top, left: dragRect.left, width: dragRect.width, height: dragRect.height }} aria-hidden="true" /> : null}
      <button
        type="button"
        data-global-ai-ui="true"
        className={placement === "floating"
          ? "fixed bottom-20 right-4 z-40 inline-flex size-11 items-center justify-center rounded-full border border-teal-300/50 bg-[#0d1117] text-teal-200 shadow-lg hover:bg-teal-400/10 lg:bottom-6 lg:right-6"
          : "inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/40 px-2.5 text-xs text-teal-200 hover:bg-teal-300/10 sm:px-3"}
        onClick={openAssistant}
        aria-label="打开 AI 助手"
        title="AI 助手"
      >
        <Sparkles size={18} aria-hidden="true" />
        {placement === "header" ? <span className="hidden min-[900px]:inline">AI 助手</span> : null}
      </button>
    </>
  );
}

function isAiAssistantUiTarget(target: Element): boolean {
  return Boolean(target.closest("[data-global-ai-ui=\"true\"]") || target.closest('[role="dialog"]'));
}

function selectionFromElement(target: Element, explicitLabel?: string): SelectionItem | null {
  const element = target.closest("[data-ai-selectable]") ?? target;
  const text = element.textContent?.replace(/\s+/g, " ").trim().slice(0, 3_000) ?? "";
  if (!text) return null;
  const rect = element.getBoundingClientRect();
  const label = explicitLabel ?? (element.getAttribute("aria-label") || element.getAttribute("data-ai-label") || element.tagName.toLowerCase());
  return { id: `element:${hashText(`${label}:${text}`)}`, label, text, rect: rectToValue(rect) };
}

function rectToValue(rect: DOMRect): SelectionItem["rect"] {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function makeRect(startX: number, startY: number, endX: number, endY: number): NonNullable<SelectionItem["rect"]> {
  return {
    top: Math.min(startY, endY),
    left: Math.min(startX, endX),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function intersects(rect: NonNullable<SelectionItem["rect"]>, target: DOMRect): boolean {
  return rect.left < target.right
    && rect.left + rect.width > target.left
    && rect.top < target.bottom
    && rect.top + rect.height > target.top;
}

function mergeSelectionItems(current: SelectionItem[], additions: SelectionItem[]): SelectionItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of additions) byId.set(item.id, item);
  return [...byId.values()];
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}
