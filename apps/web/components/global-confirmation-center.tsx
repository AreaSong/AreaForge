"use client";

import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { isUnauthorized } from "@/lib/client/api-errors";

import {
  ArrowLeft,
  Bot,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  Flag,
  RefreshCw,
  Repeat2,
  Sparkles,
} from "lucide-react";
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
      <nav className="flex items-center gap-1 border-b border-white/10 pb-2" aria-label="确认中心视图">
        <SegmentedControl
          label="确认中心视图"
          value={props.filter}
          onChange={props.onFilterChange}
          options={[
            { value: "pending", label: "待确认" },
            { value: "history", label: "已处理" },
          ]}
        />
      </nav>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-400">
          {props.filter === "pending"
            ? "需要你决定的报告、建议和检验结果会集中在这里。"
            : "已经确认或驳回的决定会保留在这里，便于回放。"}
        </p>
        <IconButton
          label="刷新确认事项"
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          onClick={props.onRetry}
          aria-label="刷新确认事项"
          title="刷新"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </IconButton>
      </div>
      {props.error ? (
        <div className="space-y-2 rounded-xl border border-red-400/30 bg-red-400/[0.06] p-3 text-sm text-red-200">
          <p>{props.error}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="!h-auto !p-0 !text-teal-200 hover:!underline"
            onClick={props.onRetry}
          >
            重试
          </Button>
        </div>
      ) : null}
      {props.loading && props.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">正在加载确认事项...</p>
      ) : null}
      {!props.loading && !props.error && props.items.length === 0 ? (
        <EmptyState
          title={props.filter === "pending" ? "当前没有待确认事项" : "还没有已处理记录"}
          description={
            props.filter === "pending"
              ? "完成学习、复盘或检验后，需要你决定的结果会出现在这里。"
              : "确认或驳回事项后，记录会出现在这里。"
          }
        />
      ) : null}
      {props.items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3">
          {props.items.map((item) => (
            <ConfirmationListRow
              key={`${item.kind}-${item.id}`}
              item={item}
              onSelect={props.onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConfirmationListRow(props: {
  item: ConfirmationItemDto;
  onSelect: (id: string) => void;
}) {
  const Icon =
    props.item.kind === "periodic_report"
      ? ClipboardCheck
      : props.item.kind === "stage_adjustment"
        ? Flag
        : props.item.kind === "knowledge_retest"
          ? Repeat2
          : props.item.kind === "ai_draft"
            ? Bot
            : FileCheck2;
  const statusLabel =
    props.item.status === "PENDING"
      ? "待确认"
      : props.item.status === "REJECTED"
        ? "已驳回"
        : "已确认并冻结";
  const statusTone =
    props.item.status === "PENDING"
      ? "warning"
      : props.item.status === "REJECTED"
        ? "neutral"
        : "success";

  return (
    <Card
      variant="subtle"
      padding="md"
      className="group flex flex-col justify-between gap-3 transition-all hover:border-teal-500/30 hover:bg-white/[0.04]"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.15)] group-hover:border-teal-400/40 group-hover:shadow-[0_0_16px_rgba(45,212,191,0.3)]">
          <Icon size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words font-semibold text-zinc-100 group-hover:text-teal-200">
              {props.item.title}
            </span>
            <Badge tone={statusTone}>{statusLabel}</Badge>
            <Badge tone="neutral">v{props.item.revision}</Badge>
          </div>
          <p className="break-words text-xs leading-relaxed text-zinc-400">
            {props.item.summary}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 pt-2 text-xs text-zinc-500">
        <span>
          来源: <span className="text-zinc-400">{props.item.sourceLabel}</span>
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => props.onSelect(props.item.id)}
        >
          {props.item.status === "PENDING" ? "处理决策" : "查看详情"}
        </Button>
      </div>
    </Card>
  );
}

function ConfirmationDetail(props: {
  item: ConfirmationItemDto;
  onBack: () => void;
  onCompleted: () => Promise<void>;
  onNavigate: () => void;
}) {
  const statusLabel =
    props.item.status === "PENDING"
      ? "待确认"
      : props.item.status === "REJECTED"
        ? "已驳回"
        : "已确认并冻结";

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="!px-0 text-zinc-400 hover:text-zinc-200"
        onClick={props.onBack}
        leftIcon={<ArrowLeft size={15} aria-hidden="true" />}
      >
        返回列表
      </Button>

      <Card variant="master" padding="lg" className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-white">
              {props.item.title}
            </h3>
            <Badge
              tone={
                props.item.status === "PENDING"
                  ? "warning"
                  : props.item.status === "REJECTED"
                    ? "neutral"
                    : "success"
              }
            >
              {statusLabel}
            </Badge>
            <Badge tone="neutral">v{props.item.revision}</Badge>
          </div>
          <p className="text-sm leading-relaxed text-zinc-300">
            {props.item.summary}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card variant="subtle" padding="sm">
            <span className="text-xs text-zinc-400">事项类型</span>
            <p className="mt-1 break-words text-sm font-medium text-white">
              {props.item.sourceLabel}
            </p>
          </Card>
          <Card variant="subtle" padding="sm">
            <span className="text-xs text-zinc-400">版本标识</span>
            <p className="mt-1 break-words text-sm font-medium text-white">
              v{props.item.revision}
            </p>
          </Card>
          <Card
            variant="subtle"
            padding="sm"
            className="col-span-2 sm:col-span-1"
          >
            <span className="text-xs text-zinc-400">当前状态</span>
            <p className="mt-1 break-words text-sm font-medium text-teal-300">
              {statusLabel}
            </p>
          </Card>
        </div>

        <Card
          variant="subtle"
          padding="md"
          className="space-y-2 border border-teal-500/20 bg-teal-950/10"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-300">
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>决策比对与事实核验指引</span>
          </div>
          <p className="text-xs leading-relaxed text-zinc-300">
            {props.item.kind === "ai_draft"
              ? "AI 草稿必须由你人工逐项核实后方可采纳。确认中心已锁定原始凭据，请点击来源页面完成比对并应用。"
              : props.item.kind === "stage_adjustment"
                ? "阶段目标调整会直接影响后续任务生成的权重与计划基准线。确认前请仔细核对调整幅度与执行能力。"
                : props.item.kind === "periodic_report"
                  ? "周期复盘报告确认后将作为当前周期的终态基准并冻结归档，后续不可静默篡改。"
                  : "检验与复测结果将更新知识点掌握状态，确认后作为真实学习成果记入档案。"}
          </p>
        </Card>

        <div className="pt-1">
          <Link
            href={props.item.sourceHref}
            className="inline-flex items-center gap-1.5 text-xs text-teal-300 hover:text-teal-200"
            onClick={(event) => handleWindowNavigation(event, props.onNavigate)}
          >
            <ExternalLink size={14} aria-hidden="true" />
            打开来源页面核对详情
          </Link>
        </div>
      </Card>

      <ConfirmationDetailActions
        item={props.item}
        sourceHref={props.item.sourceHref}
        onCompleted={props.onCompleted}
        onNavigate={props.onNavigate}
      />
    </div>
  );
}

function handleWindowNavigation(
  event: React.MouseEvent,
  onNavigate: () => void,
): void {
  if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)
    onNavigate();
}
