"use client";

import { Button, IconButton } from "@/components/ui/button";
import { isUnauthorized } from "@/lib/client/api-errors";

import { ArrowLeft, Bot, ClipboardCheck, ExternalLink, FileCheck2, Flag, RefreshCw, Repeat2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmationDetailActions } from "@/components/confirmation-detail-actions";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { getConfirmationWindowRouteRequest } from "@/lib/navigation/confirmation-route";
import type { ConfirmationItemDto } from "@/lib/contracts";
import { useWindowSystem } from "@/components/window-system";
import { listConfirmationViews } from "@/lib/api/confirmation";

export const CONFIRMATION_WINDOW_EVENT = "areaforge:open-confirmation-window";
export function GlobalConfirmationCenter(props: { pathname: string; userId: string }) {
  const [items, setItems] = useState<ConfirmationItemDto[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "history">("pending");
  const {
    closeWindow,
    focusWindow,
    foregroundKey,
    hasWindow,
    openWindow,
    registerWindow,
    refreshWindow,
  } = useWindowSystem();
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const isOpen = foregroundKey === "confirmation-center";

  const loadItems = useCallback(async (nextFilter: "pending" | "history" | "all", signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listConfirmationViews(nextFilter, signal);
      if (isUnauthorized(result)) return;
      if (!result.ok) throw new Error("CONFIRMATIONS_UNAVAILABLE");
      setPendingCount(result.pending.length);
      setItems(nextFilter === "all"
        ? [...result.pending, ...result.history]
        : nextFilter === "pending" ? result.pending : result.history);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("确认事项暂时无法加载，请稍后重试。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const handleCompleted = useCallback(async () => {
    setSelectedId(null);
    await loadItems(filter);
  }, [filter, loadItems]);

  const closeCenter = useCallback(() => {
    if (foregroundKey === "confirmation-center") closeWindow("confirmation-center");
  }, [closeWindow, foregroundKey]);

  const content = useMemo(() => (
    <ConfirmationWindowContent
      selected={selected}
      items={items}
      loading={loading}
      error={error}
      filter={filter}
      onFilterChange={(nextFilter) => {
        setFilter(nextFilter);
        setSelectedId(null);
        void loadItems(nextFilter);
      }}
      onSelect={setSelectedId}
      onBack={() => setSelectedId(null)}
      onRetry={() => void loadItems(filter)}
      onCompleted={handleCompleted}
      onNavigate={closeCenter}
    />
  ), [closeCenter, error, filter, handleCompleted, items, loadItems, loading, selected]);

  // Keep the registered window identity stable while list loading/filter state
  // changes. Re-registering the whole definition replaces the live dialog DOM
  // and can make a just-resolved control lose its connection before click.
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
    refreshWindow("confirmation-center");
  }, [content, refreshWindow]);

  useEffect(() => {
    const request = getConfirmationWindowRouteRequest(props.pathname);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const requestedFilter = request?.filter ?? "pending";
      if (request) {
        setFilter(requestedFilter);
        setSelectedId(request.confirmationId ?? null);
        openWindow("confirmation-center");
      }
      void loadItems(request?.confirmationId ? "all" : requestedFilter, controller.signal).then(() => {
        if (request?.confirmationId && !controller.signal.aborted) setSelectedId(request.confirmationId);
      });
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadItems, openWindow, props.pathname, props.userId]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = window.setInterval(() => void loadItems(filter), 60_000);
    return () => window.clearInterval(interval);
  }, [filter, loadItems, isOpen]);

  useEffect(() => registerWindow({
    key: "confirmation-center",
    kind: "confirmation-center",
    title: "确认中心",
    closePolicy: "free",
    size: "large",
    render: () => contentRef.current,
  }), [registerWindow]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ filter?: "pending" | "history"; confirmationId?: string }>).detail;
      const requestedFilter = detail?.filter ?? "pending";
      setFilter(requestedFilter);
      setSelectedId(detail?.confirmationId ?? null);
      openWindow("confirmation-center");
      void loadItems(detail?.confirmationId ? "all" : requestedFilter).then(() => {
        if (detail?.confirmationId) setSelectedId(detail.confirmationId);
      });
    };
    window.addEventListener(CONFIRMATION_WINDOW_EVENT, onOpen);
    return () => window.removeEventListener(CONFIRMATION_WINDOW_EVENT, onOpen);
  }, [loadItems, openWindow]);

  function openCenter() {
    if (hasWindow("confirmation-center")) {
      focusWindow("confirmation-center");
      return;
    }
    setFilter("pending");
    setSelectedId(null);
    openWindow("confirmation-center");
    void loadItems("pending");
  }

  return (
    <>
      <Button
        type="button"
        className="relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 hover:bg-white/5 max-[359px]:w-9 max-[359px]:justify-center max-[359px]:px-0 sm:px-3"
        onClick={openCenter}
        aria-label={`确认中心${pendingCount ? `，${pendingCount} 项待确认` : "，当前没有待确认事项"}`}
        aria-expanded={isOpen}
        title="打开确认中心"
      >
        <ClipboardCheck size={16} aria-hidden="true" />
        <span className="hidden min-[1720px]:inline">确认</span>
        {pendingCount > 0 ? <span className="min-w-4 rounded-full bg-amber-300 px-1 text-center text-[10px] font-semibold text-slate-950 max-[359px]:absolute max-[359px]:-right-1 max-[359px]:-top-1">{pendingCount > 99 ? "99+" : pendingCount}</span> : null}
      </Button>
    </>
  );
}

function ConfirmationWindowContent(props: {
  selected: ConfirmationItemDto | null;
  items: ConfirmationItemDto[];
  loading: boolean;
  error: string | null;
  filter: "pending" | "history";
  onFilterChange: (filter: "pending" | "history") => void;
  onSelect: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
  onCompleted: () => Promise<void>;
  onNavigate: () => void;
}) {
  if (props.selected) {
    return <ConfirmationDetail item={props.selected} onBack={props.onBack} onCompleted={props.onCompleted} onNavigate={props.onNavigate} />;
  }
  return <ConfirmationList items={props.items} loading={props.loading} error={props.error} filter={props.filter} onFilterChange={props.onFilterChange} onSelect={props.onSelect} onRetry={props.onRetry} onNavigate={props.onNavigate} />;
}

function ConfirmationList(props: {
  items: ConfirmationItemDto[];
  loading: boolean;
  error: string | null;
  filter: "pending" | "history";
  onFilterChange: (filter: "pending" | "history") => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 border-b border-white/10" aria-label="确认中心视图">
        {([['pending', '待确认'], ['history', '已处理']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${props.filter === value ? "border-teal-300 text-teal-200" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}
            aria-current={props.filter === value ? "page" : undefined}
            onClick={() => props.onFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">{props.filter === "pending" ? "需要你决定的报告、建议和检验结果会集中在这里。" : "已经确认或驳回的决定会保留在这里，便于回放。"}</p>
        <IconButton label="刷新确认事项" type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200" onClick={props.onRetry} aria-label="刷新确认事项" title="刷新">
          <RefreshCw size={15} aria-hidden="true" />
        </IconButton>
      </div>
      {props.error ? <div className="space-y-2 rounded-md border border-red-400/30 bg-red-400/[0.06] p-3 text-sm text-red-200"><p>{props.error}</p><button type="button" className="text-teal-200 hover:underline" onClick={props.onRetry}>重试</button></div> : null}
      {props.loading && props.items.length === 0 ? <p className="py-8 text-center text-sm text-zinc-500">正在加载确认事项...</p> : null}
      {!props.loading && !props.error && props.items.length === 0 ? <EmptyState title={props.filter === "pending" ? "当前没有待确认事项" : "还没有已处理记录"} description={props.filter === "pending" ? "完成学习、复盘或检验后，需要你决定的结果会出现在这里。" : "确认或驳回事项后，记录会出现在这里。"} /> : null}
      {props.items.length > 0 ? <div className="divide-y divide-white/10 border-y border-white/10">{props.items.map((item) => <ConfirmationListRow key={`${item.kind}-${item.id}`} item={item} onSelect={props.onSelect} />)}</div> : null}
    </div>
  );
}

function ConfirmationListRow(props: { item: ConfirmationItemDto; onSelect: (id: string) => void }) {
  const Icon = props.item.kind === "periodic_report" ? ClipboardCheck : props.item.kind === "stage_adjustment" ? Flag : props.item.kind === "knowledge_retest" ? Repeat2 : props.item.kind === "ai_draft" ? Bot : FileCheck2;
  const statusLabel = props.item.status === "PENDING" ? "待确认" : props.item.status === "REJECTED" ? "已驳回" : "已确认并冻结";
  const statusTone = props.item.status === "PENDING" ? "warning" : props.item.status === "REJECTED" ? "neutral" : "success";
  return (
    <button
      type="button"
      className="group flex w-full items-start gap-3 rounded-lg px-2 py-3.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
      onClick={() => props.onSelect(props.item.id)}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-teal-300">
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words font-medium text-zinc-100 group-hover:text-teal-200">
            {props.item.title}
          </span>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>
        <p className="mt-1 break-words text-xs leading-relaxed text-zinc-400">
          {props.item.summary}
        </p>
      </div>
      <span className="shrink-0 pt-0.5 text-xs text-teal-300 group-hover:underline">
        查看
      </span>
    </button>
  );
}

function ConfirmationDetail(props: { item: ConfirmationItemDto; onBack: () => void; onCompleted: () => Promise<void>; onNavigate: () => void }) {
  const statusLabel = props.item.status === "PENDING" ? "待确认" : props.item.status === "REJECTED" ? "已驳回" : "已确认并冻结";
  return (
    <div className="space-y-5">
      <button type="button" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors" onClick={props.onBack}><ArrowLeft size={15} aria-hidden="true" />返回列表</button>
      <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold text-white">{props.item.title}</h3><Badge tone={props.item.status === "PENDING" ? "warning" : props.item.status === "REJECTED" ? "neutral" : "success"}>{statusLabel}</Badge></div><p className="text-sm leading-6 text-zinc-400">{props.item.summary}</p></div>
      <dl className="af-content-grid-two grid gap-3 border-y border-white/10 py-4 text-sm"><div><dt className="text-zinc-500">类型</dt><dd className="mt-1 break-words text-zinc-200">{props.item.sourceLabel}</dd></div><div><dt className="text-zinc-500">版本</dt><dd className="mt-1 break-words text-zinc-200">v{props.item.revision}</dd></div></dl>
      <div className="flex flex-wrap gap-3"><Link href={props.item.sourceHref} className="inline-flex items-center gap-1.5 text-sm text-teal-300 hover:text-teal-200" onClick={(event) => handleWindowNavigation(event, props.onNavigate)}><ExternalLink size={15} aria-hidden="true" />打开来源页面</Link></div>
      <ConfirmationDetailActions item={props.item} sourceHref={props.item.sourceHref} onCompleted={props.onCompleted} onNavigate={props.onNavigate} />
    </div>
  );
}

function handleWindowNavigation(event: React.MouseEvent, onNavigate: () => void): void {
  if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate();
}
