"use client";

import { MousePointer2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { Drawer } from "@/components/ui/overlays";

type AiEndpoint = "learning-tree" | "knowledge-card" | "plan" | "motivation";

interface SelectionItem {
  id: string;
  label: string;
  text: string;
  rect: { top: number; left: number; width: number; height: number } | null;
}

export function GlobalAiAssistant({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [endpoint, setEndpoint] = useState<AiEndpoint>("knowledge-card");
  const [items, setItems] = useState<SelectionItem[]>([]);

  const selectedText = useMemo(() => items.map((item) => item.text).join("\n\n").slice(0, 10_000), [items]);

  useEffect(() => {
    if (!selecting) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-global-ai-ui=\"true\"]")) return;
      event.preventDefault();
      event.stopPropagation();
      const item = selectionFromElement(target);
      if (item) setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
    };
    const onMouseUp = () => {
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
    document.addEventListener("click", onClick, true);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [selecting]);

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <>
      {selecting ? items.map((item) => item.rect ? <div key={item.id} className="pointer-events-none fixed z-40 border-2 border-teal-300/80 bg-teal-300/10" style={{ top: item.rect.top, left: item.rect.left, width: item.rect.width, height: item.rect.height }} aria-hidden="true" /> : null) : null}
      <button
        type="button"
        data-global-ai-ui="true"
        className="fixed bottom-20 right-4 z-40 inline-flex size-11 items-center justify-center rounded-full border border-teal-300/50 bg-[#0d1117] text-teal-200 shadow-lg hover:bg-teal-400/10 lg:bottom-6 lg:right-6"
        onClick={() => setOpen(true)}
        aria-label="打开 AI 助手"
        title="AI 助手"
      >
        <Sparkles size={18} aria-hidden="true" />
      </button>
      <Drawer open={open} title="AI 助手" onClose={() => { setOpen(false); setSelecting(false); }}>
        <div data-global-ai-ui="true" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${selecting ? "border-teal-300/60 text-teal-200" : "border-white/10 text-zinc-300"}`} onClick={() => setSelecting((current) => !current)}><MousePointer2 size={15} aria-hidden="true" />{selecting ? "结束框选" : "框选内容"}</button>
            {selecting ? <span className="text-xs text-zinc-500">点击元素或拖选文本，可连续添加多个。</span> : null}
          </div>
          {items.length ? <div className="space-y-2"><div className="flex items-center justify-between"><p className="text-xs font-medium text-zinc-400">已选 {items.length} 项</p><button type="button" className="text-xs text-zinc-500 hover:text-white" onClick={() => setItems([])}>清空</button></div><div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-start gap-2 rounded-md border border-white/10 p-2"><div className="min-w-0 flex-1"><p className="text-xs text-teal-200">{item.label}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-400">{item.text}</p></div><button type="button" className="text-zinc-500 hover:text-white" onClick={() => removeItem(item.id)} aria-label={`移除${item.label}`} title="移除"><X size={14} aria-hidden="true" /></button></div>)}</div></div> : <p className="border-y border-white/10 py-3 text-sm text-zinc-500">还没有上下文。打开框选后选择任意页面元素或文本。</p>}
          <label className="grid gap-2 text-sm text-zinc-300">草稿用途<select value={endpoint} onChange={(event) => setEndpoint(event.target.value as AiEndpoint)} className="h-10 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-2 text-white"><option value="knowledge-card">知识卡片</option><option value="learning-tree">学习树</option><option value="plan">计划草稿</option><option value="motivation">动机内容</option></select></label>
          <div className="border-t border-white/10 pt-4"><AiDraftPanel key={`${endpoint}:${selectedText}`} endpoint={endpoint} userId={userId} defaultText={selectedText} /></div>
        </div>
      </Drawer>
    </>
  );
}

function selectionFromElement(target: Element): SelectionItem | null {
  const element = target.closest("[data-ai-selectable]") ?? target;
  const text = element.textContent?.replace(/\s+/g, " ").trim().slice(0, 3_000) ?? "";
  if (!text) return null;
  const rect = element.getBoundingClientRect();
  const label = element.getAttribute("aria-label") || element.getAttribute("data-ai-label") || element.tagName.toLowerCase();
  return { id: `element:${hashText(`${label}:${text}`)}`, label, text, rect: rectToValue(rect) };
}

function rectToValue(rect: DOMRect): SelectionItem["rect"] {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}
