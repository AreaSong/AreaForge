"use client";

import { rescheduleReview } from "@/lib/api/review-schedule";
import { ArrowRight, CalendarClock, Check, Clock3, ExternalLink, Play, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/field";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";
import { PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import {
  formatDate,
  formatDateKey,
  formatDuration,
  formatTaskStatus,
  shanghaiDateInputToIso,
  shiftShanghaiDateInput,
} from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type {
  BridgedReviewScheduleDto,
  RecentReviewEventDto,
  ReviewQueueItemDto,
  ReviewScheduleDto,
  ReviewWorkbenchSummaryDto,
} from "@/lib/contracts";

const returnTo = "/knowledge/reviews";
type QueueView = "due" | "paused" | "bridged" | "recent";

export function ReviewScheduleQueue(props: {
  dueItems: ReviewQueueItemDto[];
  pausedItems: ReviewQueueItemDto[];
  bridgedSchedules: BridgedReviewScheduleDto[];
  recentEvents: RecentReviewEventDto[];
  summary: ReviewWorkbenchSummaryDto;
}) {
  useRestoreListReturn();
  const [targetFilter, setTargetFilter] = useState<"all" | "MISTAKE">("all");
  const [resultFilter, setResultFilter] = useState<"all" | "FAILED" | "PARTIAL">("all");
  const filteredDueItems = useMemo(() => filterQueueItems(props.dueItems, targetFilter, resultFilter), [props.dueItems, resultFilter, targetFilter]);
  const filteredPausedItems = useMemo(() => filterQueueItems(props.pausedItems, targetFilter, resultFilter), [props.pausedItems, resultFilter, targetFilter]);
  const next = filteredDueItems[0] ?? null;
  const subsequentDueItems = filteredDueItems.slice(1);
  const [view, setView] = useState<QueueView>(() => initialQueueView(subsequentDueItems, props));
  const totalToday = props.summary.completedTodayCount + props.dueItems.length;
  const progress = totalToday > 0 ? Math.round((props.summary.completedTodayCount / totalToday) * 100) : 100;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="知识证据"
        title="统一复习"
        description="一次只处理一个到期对象，确认后继续下一项。"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card variant="subtle" className="p-3.5">
          <div className="flex items-end justify-between gap-3 text-xs text-zinc-400">
            <span>今日进度（全部）</span>
            <span className="text-zinc-200">{props.summary.completedTodayCount} / {totalToday}</span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="今日复习进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-teal-400 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </Card>
        <Card variant="subtle" className="p-3.5">
          <Metric
            label="已逾期"
            value={<span className={`font-normal ${props.summary.overdueCount ? "text-amber-200" : "text-white"}`}>{props.summary.overdueCount} 项</span>}
            valueSize="lg"
            layout="compact"
          />
        </Card>
        <Card variant="subtle" className="p-3.5">
          <Metric
            label="今日到期"
            value={<span className="font-normal text-white">{props.summary.dueTodayCount} 项</span>}
            valueSize="lg"
            layout="compact"
          />
        </Card>
        <Card variant="subtle" className="p-3.5">
          <Metric
            label="预计剩余（每项 5 分钟）"
            value={<span className="font-normal text-white">{filteredDueItems.length * 5} 分钟</span>}
            valueSize="lg"
            layout="compact"
          />
        </Card>
      </div>

      <Toolbar label="复习队列筛选">
        <label className="flex items-center gap-2 text-xs text-zinc-400">对象<Select aria-label="复习对象筛选" className="!h-9 !w-auto rounded-xl bg-[#0b0e12] px-2 text-xs text-zinc-200" value={targetFilter} onChange={(event) => setTargetFilter(event.target.value as "all" | "MISTAKE")}><option value="all">全部对象</option><option value="MISTAKE">仅错题</option></Select></label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">最近结果<Select aria-label="复习结果筛选" className="!h-9 !w-auto rounded-xl bg-[#0b0e12] px-2 text-xs text-zinc-200" value={resultFilter} onChange={(event) => setResultFilter(event.target.value as "all" | "FAILED" | "PARTIAL")}><option value="all">全部结果</option><option value="FAILED">最近未通过</option><option value="PARTIAL">最近部分掌握</option></Select></label>
        <p className="text-xs text-zinc-500">筛选只改变当前队列视图，不会改变排期。</p>
      </Toolbar>

      {next ? (
        <Card variant="accent" className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">下一项</p>
              <h2 className="mt-1.5 truncate text-xl font-semibold text-white">{next.target.title}</h2>
              <p className="mt-1 text-xs text-zinc-400">{next.target.subtitle} · {dueLabel(next.schedule.dueDate)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink href={withReturnTo(next.target.canonicalHref, returnTo)} variant="ghost" size="sm"><ExternalLink size={15} aria-hidden />查看对象</ButtonLink>
              <ButtonLink href={quickReviewHref(next.schedule.id)} variant="primary"><Play size={15} aria-hidden />开始复习</ButtonLink>
              <QuickDeferActions item={next} />
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState title="当前复习已清空" description="没有到期且可执行的复习对象。可以查看近期结果，或回到知识概览继续整理证据。" action={<ButtonLink href="/knowledge" variant="secondary">返回知识概览</ButtonLink>} />
      )}

      <section className="space-y-4">
        <SectionHeader title="后续队列" description="当前下一项不在这里重复；切换状态不会离开当前工作台。" />
        <SegmentedControl
          value={view}
          label="复习队列筛选"
          options={[
            { value: "due", label: `待处理 ${subsequentDueItems.length}` },
            { value: "paused", label: `已暂停 ${props.pausedItems.length}` },
            { value: "bridged", label: `正式任务 ${props.bridgedSchedules.length}` },
            { value: "recent", label: `近期完成 ${props.recentEvents.length}` },
          ]}
          onChange={setView}
          className="af-horizontal-scroll"
        />

        {view === "due" ? <QueueList empty="当前下一项之后没有其他待处理复习。">{subsequentDueItems.map((item) => <ScheduleRow key={item.schedule.id} item={item} />)}</QueueList> : null}
        {view === "paused" ? <QueueList empty="当前没有暂停的复习。">{filteredPausedItems.map((item) => <ScheduleRow key={item.schedule.id} item={item} paused />)}</QueueList> : null}
        {view === "bridged" ? <QueueList empty="当前没有转为正式任务的复习。">{props.bridgedSchedules.map((item) => <BridgedRow key={`${item.schedule.id}-${item.canonicalTask.id}`} item={item} />)}</QueueList> : null}
        {view === "recent" ? <QueueList empty="尚无已确认的复习结果。">{props.recentEvents.map((event) => <RecentRow key={event.id} event={event} />)}</QueueList> : null}
      </section>
    </div>
  );
}

function QueueList(props: { empty: string; children: React.ReactNode }) {
  const hasItems = Array.isArray(props.children) ? props.children.length > 0 : Boolean(props.children);
  return hasItems ? (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {props.children}
    </div>
  ) : (
    <EmptyState title="队列为空" description={props.empty} />
  );
}

function ScheduleRow({ item, paused = false }: { item: ReviewQueueItemDto; paused?: boolean }) {
  const { schedule, target } = item;
  return (
    <Card variant="master" className="flex flex-col justify-between p-4 sm:p-5 transition-all hover:border-white/20">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {paused ? <Badge>已暂停</Badge> : isOverdue(schedule.dueDate) ? <Badge tone="warning">已逾期</Badge> : isToday(schedule.dueDate) ? <Badge tone="info">今日到期</Badge> : <Badge>待复习</Badge>}
        </div>
        <h3 className="mt-2 truncate text-base font-semibold text-white">{target.title}</h3>
        <p className="mt-1 text-xs text-zinc-400">{target.subtitle} · {paused ? pauseReason(schedule.pausedReason) : dueLabel(schedule.dueDate)} · 连续通过 {schedule.consecutivePassCount} 次</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
        <div className="flex items-center gap-1.5">
          <Link href={withReturnTo(target.canonicalHref, returnTo)} className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-white" title="查看对象" aria-label={`查看 ${target.title}`}><ExternalLink size={15} aria-hidden /></Link>
          <ListDetailLink href={detailHref(schedule.id)} focusId={`review-detail-${schedule.id}`} className="grid size-8 place-items-center rounded-lg text-teal-300 hover:bg-white/[0.06]"><span className="sr-only">查看 {target.title} 的排期详情</span><ArrowRight size={15} aria-hidden /></ListDetailLink>
        </div>
        <div className="flex items-center gap-2">
          {!paused ? <QuickDeferActions item={item} /> : null}
          {!paused ? <ButtonLink href={quickReviewHref(schedule.id)} variant="primary" size="sm"><Play size={14} aria-hidden />开始</ButtonLink> : null}
        </div>
      </div>
    </Card>
  );
}

function BridgedRow({ item }: { item: BridgedReviewScheduleDto }) {
  return (
    <Card variant="master" className="flex flex-col justify-between p-4 sm:p-5">
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-white">{item.target.title}</h3>
        <p className="mt-1 text-xs text-zinc-400">{item.target.subtitle} · 已转为正式任务，结果由任务闭环确认</p>
        <p className="mt-2 text-sm text-zinc-300">{item.canonicalTask.title} · {formatTaskStatus(item.canonicalTask.status)}</p>
      </div>
      <div className="mt-4 flex justify-end border-t border-white/5 pt-3">
        <ButtonLink href={taskHref(item.canonicalTask.href)} variant="secondary" size="sm">打开任务<ArrowRight size={14} aria-hidden /></ButtonLink>
      </div>
    </Card>
  );
}

function RecentRow({ event }: { event: RecentReviewEventDto }) {
  return (
    <Card variant="master" className="flex flex-col justify-between p-4 sm:p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={event.result === "PASSED" ? "success" : event.result === "PARTIAL" ? "warning" : "danger"}>{resultLabel(event.result)}</Badge>
        </div>
        <h3 className="mt-2 truncate text-base font-semibold text-white">{event.target.title}</h3>
        <p className="mt-1 text-xs text-zinc-400">{event.target.subtitle} · {formatDuration(event.durationSeconds)} · 下次 {formatDate(event.nextDueDate)}</p>
      </div>
      <div className="mt-4 flex justify-end border-t border-white/5 pt-3">
        <ButtonLink href={detailHref(event.schedule.id)} variant="ghost" size="sm"><Clock3 size={14} aria-hidden />查看历史</ButtonLink>
      </div>
    </Card>
  );
}

function QuickDeferActions({ item }: { item: ReviewQueueItemDto }) {
  const router = useRouter();
  const [choice, setChoice] = useState<1 | 3 | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DeferConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  if (choice !== null) {
    return <>
      <span className="flex flex-wrap items-center gap-1 rounded-md border border-amber-300/20 bg-amber-300/5 p-1"><span className="px-1 text-xs text-amber-100">{choice === 1 ? "跳过今天并改到明天？" : `延期 ${choice} 天？`}</span><IconButton label="确认延期" type="button" size="sm" disabled={pending} className="grid !size-8 place-items-center rounded text-teal-200 hover:bg-white/10 disabled:opacity-50" onClick={() => void defer(choice)}><Check size={14} aria-hidden /></IconButton><IconButton label="取消延期" type="button" size="sm" disabled={pending} className="grid !size-8 place-items-center rounded text-zinc-400 hover:bg-white/10 disabled:opacity-50" onClick={() => { setChoice(null); setConflict(null); setConflictOpen(false); }}><X size={14} aria-hidden /></IconButton>{error ? <span className="w-full text-xs text-red-200">{error}</span> : null}</span>
      {conflict && !conflictOpen ? <span className="flex flex-wrap gap-2 text-xs"><Button type="button" variant="secondary" size="sm" onClick={() => setConflictOpen(true)}>处理延期冲突</Button><Button type="button" variant="ghost" size="sm" onClick={retryOnLatest}>保留延期并重试</Button></span> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理复习延期冲突"
        description="复习排期已在其他页面或设备变化。延期日期仍保留，系统不会自动覆盖或重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? deferConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={prepareRetry}
        mergeLabel="保留延期并重试"
      />
    </>;
  }
  async function defer(days: 1 | 3) {
    const dueDate = shanghaiDateInputToIso(
      shiftShanghaiDateInput(formatDateKey(new Date()), days),
    );
    await submitDefer({
      days,
      expectedRevision: item.schedule.revision,
      dueDate,
    });
  }

  async function submitDefer(command: DeferCommand) {
    setPending(true);
    setError(null);
    try {
      const response = await rescheduleReview(item.schedule.id, {
        expectedRevision: command.expectedRevision,
        dueDate: command.dueDate,
      });
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，延期日期仍保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !body?.schedule) {
        if (isConflict(response)) {
          setConflict({
            command: freezeDeferCommand(command),
            latest: isReviewScheduleDto(body?.latest) ? body.latest : null,
            conflictFields: body?.conflictFields ?? ["revision", "dueDate"],
          });
          setConflictOpen(true);
        }
        setError(body?.error ?? "排期未改变，延期日期仍保留；请处理冲突后显式重试。");
        return;
      }
      setChoice(null);
      setConflict(null);
      setConflictOpen(false);
      router.refresh();
    } catch {
      setError("网络不可用，延期日期仍保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }
  function adoptServerVersion() {
    if (!conflict) return;
    setConflict(null);
    setConflictOpen(false);
    setError(conflict.latest
      ? `已采用服务端排期 r${conflict.latest.revision}，延期命令没有自动重放。`
      : "服务端没有可采用的排期版本，请刷新后确认当前状态。");
    router.refresh();
  }

  function prepareRetry() {
    setConflictOpen(false);
    if (conflict) setError("延期日期已保留，请点击“保留延期并重试”；系统不会自动重放。");
  }

  function retryOnLatest() {
    if (!conflict || pending) return;
    const command: DeferCommand = {
      ...conflict.command,
      expectedRevision: conflict.latest?.revision ?? conflict.command.expectedRevision,
    };
    setConflict(null);
    setConflictOpen(false);
    void submitDefer(command);
  }

  return <span className="flex items-center gap-1"><IconButton type="button" label={`跳过 ${item.target.title} 今天，延期到明天`} title="跳过今天，延期到明天" className="grid size-9 place-items-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={() => setChoice(1)}><CalendarClock size={15} aria-hidden /></IconButton><Button type="button" variant="ghost" size="sm" className="inline-flex h-9 items-center rounded-md px-2 text-xs text-zinc-400 hover:bg-white/[0.06] hover:text-white" title="延期到 3 天后" aria-label={`延期 ${item.target.title} 到 3 天后`} onClick={() => setChoice(3)}>3 天</Button></span>;
}

interface DeferCommand {
  days: 1 | 3;
  expectedRevision: number;
  dueDate: string;
}

interface DeferConflict {
  command: DeferCommand;
  latest: ReviewScheduleDto | null;
  conflictFields: string[];
}

function freezeDeferCommand(command: DeferCommand): DeferCommand {
  return { ...command };
}

function isReviewScheduleDto(value: unknown): value is ReviewScheduleDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schedule = value as Partial<ReviewScheduleDto>;
  return typeof schedule.id === "string"
    && typeof schedule.revision === "number"
    && (schedule.status === "ACTIVE" || schedule.status === "PAUSED")
    && typeof schedule.updatedAt === "string";
}

function deferConflictComparisons(conflict: DeferConflict) {
  return [
    { field: "revision", label: "排期 revision", local: conflict.command.expectedRevision, server: conflict.latest?.revision ?? "未知" },
    { field: "dueDate", label: "延期日期", local: conflict.command.dueDate, server: conflict.latest?.dueDate ?? "未设置" },
    { field: "status", label: "排期状态", local: "ACTIVE", server: conflict.latest?.status ?? "未知" },
  ];
}

function filterQueueItems(items: ReviewQueueItemDto[], targetFilter: "all" | "MISTAKE", resultFilter: "all" | "FAILED" | "PARTIAL") {
  return items.filter((item) => (targetFilter === "all" || item.schedule.targetType === targetFilter) && (resultFilter === "all" || item.target.latestResult === resultFilter));
}

function quickReviewHref(scheduleId: string) {
  return withReturnTo(`/knowledge/reviews/${scheduleId}`, returnTo);
}

function detailHref(scheduleId: string) {
  return withReturnTo(`/knowledge/reviews/${scheduleId}`, returnTo);
}

function taskHref(href: string) {
  return withReturnTo(href, returnTo);
}

function initialQueueView(
  subsequentDueItems: ReviewQueueItemDto[],
  props: Pick<Parameters<typeof ReviewScheduleQueue>[0], "pausedItems" | "bridgedSchedules" | "recentEvents">,
): QueueView {
  if (subsequentDueItems.length) return "due";
  if (props.pausedItems.length) return "paused";
  if (props.bridgedSchedules.length) return "bridged";
  if (props.recentEvents.length) return "recent";
  return "due";
}

function isOverdue(value: string | null) {
  const due = dateKey(value);
  const today = dateKey(new Date().toISOString());
  return due !== null && today !== null && due < today;
}

function isToday(value: string | null) {
  const due = dateKey(value);
  const today = dateKey(new Date().toISOString());
  return due !== null && today !== null && due === today;
}

function dueLabel(value: string | null) {
  if (!value) return "未设置日期";
  if (isOverdue(value)) return `逾期至 ${formatDate(value)}`;
  if (isToday(value)) return `今天 ${formatDate(value)}`;
  if (dateKey(value) === shiftShanghaiDateInput(formatDateKey(new Date()), 1)) return `明天 ${formatDate(value)}`;
  return `待复习至 ${formatDate(value)}`;
}

function dateKey(value: string | null) {
  return value ? formatDateKey(value) : null;
}

function pauseReason(value: string | null) { return value === "TARGET_ARCHIVED" ? "对象已归档" : value ? `暂停原因：${value}` : "暂停原因未说明"; }
function resultLabel(value: RecentReviewEventDto["result"]) { return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过"; }
