"use client";

import { ArrowLeft, Bot, ClipboardCheck, ExternalLink, FileCheck2, Flag, RefreshCw, Repeat2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmationDetailActions } from "@/components/confirmation-detail-actions";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import type { ConfirmationItemDto } from "@/lib/study/confirmation-service";

export function GlobalConfirmationCenter(props: { pathname: string; userId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConfirmationItemDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/confirmations?filter=pending", { cache: "no-store", signal });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("CONFIRMATIONS_UNAVAILABLE");
      const body = await response.json() as { items?: ConfirmationItemDto[] };
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("确认事项暂时无法加载，请稍后重试。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadItems(controller.signal), 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadItems, props.pathname, props.userId]);

  useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => void loadItems(), 60_000);
    return () => window.clearInterval(interval);
  }, [loadItems, open]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  function openCenter() {
    setOpen(true);
    void loadItems();
  }

  async function handleCompleted() {
    setSelectedId(null);
    await loadItems();
  }

  return (
    <>
      <button
        type="button"
        className="relative inline-flex h-9 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 hover:bg-white/5 sm:px-3"
        onClick={openCenter}
        aria-label={`确认中心${items.length ? `，${items.length} 项待确认` : "，当前没有待确认事项"}`}
        aria-expanded={open}
        title="打开确认中心"
      >
        <ClipboardCheck size={16} aria-hidden="true" />
        <span className="hidden sm:inline">确认</span>
        {items.length > 0 ? <span className="min-w-4 rounded-full bg-amber-300 px-1 text-center text-[10px] font-semibold text-slate-950">{items.length > 99 ? "99+" : items.length}</span> : null}
      </button>
      <Drawer open={open} title={selected ? "确认事项" : "确认中心"} onClose={() => { setOpen(false); setSelectedId(null); }}>
        {selected ? (
          <ConfirmationDetail item={selected} onBack={() => setSelectedId(null)} onCompleted={handleCompleted} />
        ) : (
          <ConfirmationList
            items={items}
            loading={loading}
            error={error}
            onSelect={setSelectedId}
            onRetry={() => void loadItems()}
          />
        )}
      </Drawer>
    </>
  );
}

function ConfirmationList(props: {
  items: ConfirmationItemDto[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">需要你决定的报告、建议和检验结果会集中在这里。</p>
        <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200" onClick={props.onRetry} aria-label="刷新确认事项" title="刷新">
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>
      {props.error ? <div className="space-y-2 rounded-md border border-red-400/30 bg-red-400/[0.06] p-3 text-sm text-red-200"><p>{props.error}</p><button type="button" className="text-teal-200 hover:underline" onClick={props.onRetry}>重试</button></div> : null}
      {props.loading && props.items.length === 0 ? <p className="py-8 text-center text-sm text-zinc-500">正在加载确认事项...</p> : null}
      {!props.loading && !props.error && props.items.length === 0 ? <EmptyState title="当前没有待确认事项" description="完成学习、复盘或检验后，需要你决定的结果会出现在这里。" /> : null}
      {props.items.length > 0 ? <div className="divide-y divide-white/10 border-y border-white/10">{props.items.map((item) => <ConfirmationListRow key={`${item.kind}-${item.id}`} item={item} onSelect={props.onSelect} />)}</div> : null}
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-sm">
        <Link href="/confirmations" className="inline-flex items-center gap-1.5 text-teal-300 hover:text-teal-200"><ExternalLink size={14} aria-hidden="true" />打开完整确认中心</Link>
        <Link href="/confirmations/history" className="text-zinc-500 hover:text-zinc-200">查看已处理</Link>
      </div>
    </div>
  );
}

function ConfirmationListRow(props: { item: ConfirmationItemDto; onSelect: (id: string) => void }) {
  const Icon = props.item.kind === "periodic_report" ? ClipboardCheck : props.item.kind === "stage_adjustment" ? Flag : props.item.kind === "knowledge_retest" ? Repeat2 : props.item.kind === "ai_draft" ? Bot : FileCheck2;
  return (
    <button type="button" className="grid w-full gap-2 py-4 text-left hover:bg-white/[0.03] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center" onClick={() => props.onSelect(props.item.id)}>
      <span className="hidden size-8 place-items-center rounded-md border border-white/10 text-teal-300 sm:grid"><Icon size={15} aria-hidden="true" /></span>
      <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="truncate font-medium text-zinc-100">{props.item.title}</span><Badge tone="warning">待确认</Badge></span><span className="mt-1 block line-clamp-2 text-sm leading-5 text-zinc-500">{props.item.summary}</span></span>
      <span className="text-xs text-teal-300">查看</span>
    </button>
  );
}

function ConfirmationDetail(props: { item: ConfirmationItemDto; onBack: () => void; onCompleted: () => Promise<void> }) {
  const statusLabel = props.item.status === "PENDING" ? "待确认" : props.item.status === "REJECTED" ? "已驳回" : "已确认并冻结";
  return (
    <div className="space-y-5">
      <button type="button" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200" onClick={props.onBack}><ArrowLeft size={15} aria-hidden="true" />返回列表</button>
      <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold text-white">{props.item.title}</h3><Badge tone={props.item.status === "PENDING" ? "warning" : props.item.status === "REJECTED" ? "neutral" : "success"}>{statusLabel}</Badge></div><p className="text-sm leading-6 text-zinc-400">{props.item.summary}</p></div>
      <dl className="grid gap-3 border-y border-white/10 py-4 text-sm sm:grid-cols-2"><div><dt className="text-zinc-500">类型</dt><dd className="mt-1 text-zinc-200">{props.item.sourceLabel}</dd></div><div><dt className="text-zinc-500">版本</dt><dd className="mt-1 text-zinc-200">v{props.item.revision}</dd></div></dl>
      <div className="flex flex-wrap gap-3"><Link href={props.item.sourceHref} className="inline-flex items-center gap-1.5 text-sm text-teal-300 hover:text-teal-200"><ExternalLink size={15} aria-hidden="true" />打开来源页面</Link></div>
      <ConfirmationDetailActions item={props.item} sourceHref={props.item.sourceHref} onCompleted={props.onCompleted} />
    </div>
  );
}
