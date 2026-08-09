"use client";

import { ArrowRight, Clock3, ExternalLink, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader, SectionHeader } from "@/components/ui/page";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type {
  BridgedReviewScheduleDto,
  RecentReviewEventDto,
  ReviewQueueItemDto,
  ReviewWorkbenchSummaryDto,
} from "@/lib/study/review-schedule-service";

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
  const next = props.dueItems[0] ?? null;
  const subsequentDueItems = props.dueItems.slice(1);
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

      <section className="grid gap-4 border-b border-white/10 pb-6 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(8rem,1fr))]">
        <div className="min-w-0">
          <div className="flex items-end justify-between gap-3 text-sm"><span className="text-zinc-400">今日进度</span><span className="text-zinc-200">{props.summary.completedTodayCount} / {totalToday}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-white/10" role="progressbar" aria-label="今日复习进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full bg-teal-400" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <Metric label="已逾期" value={`${props.summary.overdueCount} 项`} tone={props.summary.overdueCount ? "warning" : "neutral"} />
        <Metric label="今日到期" value={`${props.summary.dueTodayCount} 项`} />
        <Metric label="预计剩余（每项 5 分钟）" value={`${props.dueItems.length * 5} 分钟`} />
      </section>

      {next ? (
        <section className="grid gap-4 border-b border-white/10 pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className="text-xs font-medium text-teal-300">下一项</p>
            <h2 className="mt-1 truncate text-xl font-medium text-white">{next.target.title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{next.target.subtitle} · {dueLabel(next.schedule.dueDate)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={withReturnTo(next.target.canonicalHref, returnTo)} variant="ghost"><ExternalLink size={15} aria-hidden />查看对象</ButtonLink>
            <ButtonLink href={quickReviewHref(next.schedule.id)} variant="primary"><Play size={15} aria-hidden />开始复习</ButtonLink>
          </div>
        </section>
      ) : (
        <EmptyState title="当前复习已清空" description="没有到期且可执行的复习对象。可以查看近期结果，或回到知识概览继续整理证据。" action={<ButtonLink href="/knowledge" variant="secondary">返回知识概览</ButtonLink>} />
      )}

      <section className="space-y-4">
        <SectionHeader title="后续队列" description="当前下一项不在这里重复；切换状态不会离开当前工作台。" />
        <div className="inline-flex max-w-full overflow-x-auto rounded-md border border-white/10 p-1" role="tablist" aria-label="复习队列筛选">
          <QueueTab active={view === "due"} onClick={() => setView("due")}>待处理 {subsequentDueItems.length}</QueueTab>
          <QueueTab active={view === "paused"} onClick={() => setView("paused")}>已暂停 {props.pausedItems.length}</QueueTab>
          <QueueTab active={view === "bridged"} onClick={() => setView("bridged")}>正式任务 {props.bridgedSchedules.length}</QueueTab>
          <QueueTab active={view === "recent"} onClick={() => setView("recent")}>近期完成 {props.recentEvents.length}</QueueTab>
        </div>

        {view === "due" ? <QueueList empty="当前下一项之后没有其他待处理复习。">{subsequentDueItems.map((item) => <ScheduleRow key={item.schedule.id} item={item} />)}</QueueList> : null}
        {view === "paused" ? <QueueList empty="当前没有暂停的复习。">{props.pausedItems.map((item) => <ScheduleRow key={item.schedule.id} item={item} paused />)}</QueueList> : null}
        {view === "bridged" ? <QueueList empty="当前没有转为正式任务的复习。">{props.bridgedSchedules.map((item) => <BridgedRow key={`${item.schedule.id}-${item.canonicalTask.id}`} item={item} />)}</QueueList> : null}
        {view === "recent" ? <QueueList empty="尚无已确认的复习结果。">{props.recentEvents.map((event) => <RecentRow key={event.id} event={event} />)}</QueueList> : null}
      </section>
    </div>
  );
}

function QueueList(props: { empty: string; children: React.ReactNode }) {
  const hasItems = Array.isArray(props.children) ? props.children.length > 0 : Boolean(props.children);
  return (
    <ul className="divide-y divide-white/10 border-y border-white/10">
      {hasItems ? props.children : <li className="px-1 py-8 text-sm text-zinc-500">{props.empty}</li>}
    </ul>
  );
}

function ScheduleRow({ item, paused = false }: { item: ReviewQueueItemDto; paused?: boolean }) {
  const { schedule, target } = item;
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium text-zinc-100">{target.title}</p>{paused ? <Badge>已暂停</Badge> : isOverdue(schedule.dueDate) ? <Badge tone="warning">已逾期</Badge> : <Badge tone="info">今日到期</Badge>}</div>
        <p className="mt-1 text-xs text-zinc-500">{target.subtitle} · {paused ? pauseReason(schedule.pausedReason) : dueLabel(schedule.dueDate)} · 连续通过 {schedule.consecutivePassCount} 次</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link href={withReturnTo(target.canonicalHref, returnTo)} className="grid size-9 place-items-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-white" title="查看对象" aria-label={`查看 ${target.title}`}><ExternalLink size={16} aria-hidden /></Link>
        {!paused ? <ButtonLink href={quickReviewHref(schedule.id)} variant="primary" size="sm"><Play size={14} aria-hidden />开始</ButtonLink> : null}
        <ListDetailLink href={detailHref(schedule.id)} focusId={`review-detail-${schedule.id}`} className="grid size-9 place-items-center rounded-md text-teal-300 hover:bg-white/[0.06]"><span className="sr-only">查看 {target.title} 的排期详情</span><ArrowRight size={16} aria-hidden /></ListDetailLink>
      </div>
    </li>
  );
}

function BridgedRow({ item }: { item: BridgedReviewScheduleDto }) {
  return <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-medium text-zinc-100">{item.target.title}</p><p className="mt-1 text-xs text-zinc-500">{item.target.subtitle} · 已转为正式任务，结果由任务闭环确认</p><p className="mt-2 text-sm text-zinc-300">{item.canonicalTask.title} · {taskStatusLabel(item.canonicalTask.status)}</p></div><ButtonLink href={taskHref(item.canonicalTask.href)} variant="secondary" size="sm">打开任务<ArrowRight size={14} aria-hidden /></ButtonLink></li>;
}

function RecentRow({ event }: { event: RecentReviewEventDto }) {
  return <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium text-zinc-100">{event.target.title}</p><Badge tone={event.result === "PASSED" ? "success" : event.result === "PARTIAL" ? "warning" : "danger"}>{resultLabel(event.result)}</Badge></div><p className="mt-1 text-xs text-zinc-500">{event.target.subtitle} · {formatDuration(event.durationSeconds)} · 下次 {formatDate(event.nextDueDate)}</p></div><ButtonLink href={detailHref(event.schedule.id)} variant="ghost" size="sm"><Clock3 size={14} aria-hidden />查看历史</ButtonLink></li>;
}

function QueueTab(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={props.active} onClick={props.onClick} className={`h-9 shrink-0 rounded px-3 text-sm ${props.active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>{props.children}</button>;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warning" }) {
  return <div className="border-l border-white/10 pl-3"><p className="text-xs text-zinc-500">{label}</p><p className={`mt-1 text-lg ${tone === "warning" ? "text-amber-200" : "text-white"}`}>{value}</p></div>;
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

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未设置";
}

function isOverdue(value: string | null) {
  if (!value) return false;
  const due = new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  return due < today;
}

function dueLabel(value: string | null) { return isOverdue(value) ? `逾期至 ${formatDate(value)}` : `今天 ${formatDate(value)}`; }
function pauseReason(value: string | null) { return value === "TARGET_ARCHIVED" ? "对象已归档" : value ? `暂停原因：${value}` : "暂停原因未说明"; }
function resultLabel(value: RecentReviewEventDto["result"]) { return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过"; }
function taskStatusLabel(value: BridgedReviewScheduleDto["canonicalTask"]["status"]) { return value === "TODO" ? "待开始" : value === "IN_PROGRESS" ? "进行中" : "已延期"; }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const remainder = seconds % 60; return minutes ? `${minutes} 分 ${remainder} 秒` : `${remainder} 秒`; }
