import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, ChevronDown, Circle, CornerDownRight, Inbox, TimerReset } from "lucide-react";
import type { ActionCenterTodayController } from "@/components/action-center-today-controller";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import {
  CompactBadge,
  HourlyHeatbar,
  StatusDot,
  SubjectProportionBar,
} from "@/components/ui/micro-charts";
import { Modal } from "@/components/ui/overlays";
import { SectionHeader } from "@/components/ui/page";
import type { ActionCenterTodayDto } from "@/lib/contracts";

export function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return date.toISOString().slice(0, 10);
}

export function withTodayReturnTo(href: string): string {
  if (!href.startsWith("/knowledge/reviews/") && !href.startsWith("/focus") && !href.startsWith("/roadmap/allocation/tasks/")) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent("/today")}`;
}

export function isSameActionTarget(currentHref: string, candidateHref: string): boolean {
  return currentHref.split("?")[0] === candidateHref.split("?")[0];
}

export function hasRemainingAction(
  itemsOrQueues: Array<{ href: string }> | ActionCenterTodayDto["queues"],
  primaryActionHref: string,
): boolean {
  const items = Array.isArray(itemsOrQueues)
    ? itemsOrQueues
    : [
        ...itemsOrQueues.formalTasks,
        ...itemsOrQueues.noteResourceSyllabusReviews,
        ...itemsOrQueues.mistakeReviews,
      ];
  return items.some((item) => !isSameActionTarget(primaryActionHref, item.href));
}

export function flattenShortcutNodes(nodes: ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"]) {
  const result: Array<{ id: string; subjectId: string; title: string; depth: number }> = [];
  function traverse(list: typeof nodes, depth: number) {
    for (const node of list) {
      result.push({ id: node.id, subjectId: node.subjectId, title: node.title, depth });
      if (node.children?.length) {
        traverse(node.children, depth + 1);
      }
    }
  }
  traverse(nodes, 0);
  return result;
}

export function getHourlySlots(today: ActionCenterTodayDto): number[] {
  return today.learningLoop.hourlyMinutes ?? Array(24).fill(0);
}

export function getSubjectProportionItems(today: ActionCenterTodayDto) {
  const colors = ["#2dd4bf", "#38bdf8", "#a78bfa", "#fb7185", "#fbbf24", "#34d399"];
  const validSubjects = today.subjectTimers.subjects.filter((s) => s.todayEffectiveMinutes > 0);
  return validSubjects.map((subject, index) => ({
    label: subject.title,
    minutes: subject.todayEffectiveMinutes,
    color: colors[index % colors.length],
  }));
}

export function dailyClosureLabel(today: ActionCenterTodayDto): string {
  if (today.learningLoop.reviewSubmitted) return "今日已闭环";
  if (today.learningLoop.effectiveSessionCount > 0) return "结束学习并复盘";
  return "完成今日复盘";
}

export function TodayLoopProgress({ today }: { today: ActionCenterTodayDto }) {
  const executionComplete = today.learningLoop.effectiveSessionCount > 0;
  const evidenceComplete = today.learningLoop.evidenceCount > 0;
  const reviewComplete = today.learningLoop.reviewSubmitted;
  const steps = [
    {
      label: "行动执行",
      detail: today.activity ? "活动进行中" : executionComplete ? `${today.learningLoop.effectiveSessionCount} 段有效学习` : "等待开始",
      complete: executionComplete,
      current: Boolean(today.activity) || (!executionComplete && !reviewComplete),
      optional: false,
    },
    {
      label: "证据接力",
      detail: evidenceComplete ? `${today.learningLoop.evidenceCount} 条证据` : executionComplete ? "可选补充" : "等待行动",
      complete: evidenceComplete,
      current: executionComplete && !reviewComplete && evidenceComplete,
      optional: !evidenceComplete,
    },
    {
      label: "每日复盘",
      detail: reviewComplete ? "今日已闭环" : executionComplete ? "可以收口" : "等待事实",
      complete: reviewComplete,
      current: executionComplete && !reviewComplete,
      optional: false,
    },
  ];

  return (
    <section className="border-y border-white/10 bg-white/[0.015] px-3 py-2.5 sm:px-4" aria-label="今日学习闭环进度">
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-0">
        {steps.map((step, index) => (
          <li
            key={step.label}
            aria-current={step.current ? "step" : undefined}
            className={`flex min-w-0 items-center gap-2.5 px-2 py-1.5 ${index > 0 ? "sm:border-l sm:border-white/10 sm:pl-4" : ""}`}
          >
            <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${
              step.complete
                ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
                : step.current
                  ? "border-teal-400/60 bg-teal-500/10 text-teal-300"
                  : "border-white/10 text-zinc-600"
            }`}>
              {step.complete ? <Check className="size-3.5" aria-hidden="true" /> : <Circle className="size-2.5" aria-hidden="true" />}
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-xs font-medium ${step.current || step.complete ? "text-zinc-100" : "text-zinc-500"}`}>
                {step.label}{step.optional ? " · 可选" : ""}
              </span>
              <span className="block truncate text-xs text-zinc-500">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TodayContinuation({ today }: { today: ActionCenterTodayDto }) {
  const continuation = today.continuation;
  if (!today.isToday || !continuation || today.activity || today.recovery?.effectiveStatus === "ACTIVE") return null;
  return (
    <section className="flex flex-col gap-3 border-y border-white/10 bg-sky-400/[0.035] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="断点续学">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-medium text-sky-300">
          <CornerDownRight className="size-3.5" aria-hidden="true" />
          续上次 · {continuation.subjectName}
        </p>
        <p className="mt-1 break-words text-sm text-zinc-200">{continuation.nextAction}</p>
        {continuation.taskTitle ? <p className="mt-1 truncate text-xs text-zinc-500">关联任务：{continuation.taskTitle}</p> : null}
      </div>
      <Link
        href={continuation.href}
        className={buttonClassName({ variant: "secondary", size: "sm", className: "shrink-0" })}
      >
        继续上次
      </Link>
    </section>
  );
}

export function QueueList(props: {
  items: ActionCenterTodayDto["queues"]["formalTasks"];
  actionLabel: string;
}) {
  if (props.items.length === 0) {
    return (
      <Card variant="subtle" padding="md" className="py-6 text-center">
        <Inbox className="mx-auto size-5 text-zinc-500" aria-hidden="true" />
        <p className="mt-1 text-xs text-zinc-400">当前推荐之外没有待办</p>
        <p className="mt-0.5 text-xs text-zinc-500">今日安排已全部就绪或已在推荐卡片中呈现</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {props.items.map((item) => {
        const isUrgent = item.reason.includes("逾期") || Boolean(item.softDependencyHint);
        const priorityTone = isUrgent ? "rose" : item.kind === "review" ? "sky" : "teal";
        const itemLabel = item.kind === "review"
          ? "到期复习"
          : item.kind === "activity"
            ? "进行中"
            : item.kind === "recovery"
              ? "恢复行动"
              : "计划任务";

        return (
          <Card
            key={item.id}
            variant="subtle"
            padding="md"
            className="group flex flex-col justify-between gap-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
          >
            <div className="min-w-0 space-y-1.5">
              <h3 className="break-words text-sm font-semibold text-white group-hover:text-teal-200">
                <span className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs font-normal">
                  <CompactBadge tone={priorityTone} size="xs">{itemLabel}</CompactBadge>
                </span>
                <span className="leading-snug">{item.title}</span>
              </h3>
              <p className="truncate text-xs leading-relaxed text-zinc-300">{item.reason}</p>
              {item.softDependencyHint ? (
                <div className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-xs text-amber-200">
                  <AlertCircle className="size-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                  <span className="truncate">{item.softDependencyHint}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end border-t border-white/5 pt-2">
              <Link
                href={withTodayReturnTo(item.href)}
                className={buttonClassName({
                  variant: "secondary",
                  size: "sm",
                  className: "!h-7 !px-2.5 !text-xs font-medium hover:border-teal-400/40 hover:text-teal-300",
                })}
              >
                {props.actionLabel}
              </Link>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function TodayMetric(props: { label: string; value: string }) {
  return <Metric {...props} layout="compact" valueSize="sm" className="first:pl-0 last:pr-0" />;
}

export function TodayLearningSummary({ today }: { today: ActionCenterTodayDto }) {
  const hourlySlots = getHourlySlots(today);
  const subjectProportionItems = getSubjectProportionItems(today);
  const activeSubjectCount = subjectProportionItems.length;
  const subjectProportionTotal = subjectProportionItems.reduce((sum, item) => sum + item.minutes, 0);
  const maxHourly = Math.max(0, ...hourlySlots);

  return (
    <SectionCard variant="master" padding="md" className="@container space-y-3" aria-labelledby="today-summary-heading">
      <SectionHeader
        title={today.isToday ? "今日学习闭环" : `${today.studyDate} 学习闭环`}
        description="先看实际投入和有效产出，再看计划状态。"
      />
      <div className="grid grid-cols-2 gap-2.5 @[36rem]:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <span className="text-xs font-medium text-zinc-400">实际投入</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-white">{today.learningLoop.totalMinutes}<span className="ml-1 text-xs font-normal text-zinc-400">分</span></span>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <span className="text-xs font-medium text-zinc-400">有效学习</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-teal-300">{today.learningLoop.effectiveMinutes}<span className="ml-1 text-xs font-normal text-zinc-400">分</span></span>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <span className="text-xs font-medium text-zinc-400">有效段数</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-white">{today.learningLoop.effectiveSessionCount}<span className="ml-1 text-xs font-normal text-zinc-400">段</span></span>
        </div>
        <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <span className="text-xs font-medium text-zinc-400">低效补充</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-amber-300">{today.learningLoop.lowConversionCount}<span className="ml-1 text-xs font-normal text-zinc-400">次</span></span>
        </div>
      </div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] divide-y divide-white/5 text-xs text-zinc-300">
        <div className="p-3 flex flex-wrap items-center justify-between gap-1.5 text-xs">
          <span>计划 <strong className="text-white font-semibold">{today.learningLoop.plannedTaskCount}</strong> 项 · 已完成 <strong className="text-emerald-300 font-semibold">{today.learningLoop.completedTaskCount}</strong> 项</span>
          <span>搁置/跳过 <strong className="text-zinc-200 font-medium">{today.learningLoop.deferredTaskCount}</strong> 项</span>
        </div>
        <div className="p-3 flex flex-wrap items-center justify-between gap-1.5 text-xs">
          <span>复盘状态：<strong className={today.learningLoop.reviewSubmitted ? "text-teal-300 font-semibold" : "text-amber-300 font-semibold"}>{today.learningLoop.reviewSubmitted ? "已收口" : "未收口"}</strong></span>
          <span className="truncate max-w-[180px] text-zinc-200 font-medium">下一动作：{today.learningLoop.nextAction ?? "本日尚未留下"}</span>
        </div>
        <div className="p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-zinc-200">
              <span className="size-1.5 rounded-full bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.8)]" /> 24小时时段分布
            </span>
            <span className="font-mono text-xs text-zinc-400">{maxHourly > 0 ? `高峰 ${maxHourly}m/h` : "全天待激活"}</span>
          </div>
          <HourlyHeatbar hourlyMinutes={hourlySlots} height={16} />
        </div>
        <div className="p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-zinc-200">
              <span className="size-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" /> 学科投入占比
            </span>
            <span className="font-mono text-xs text-zinc-400">共 {activeSubjectCount} 科投入</span>
          </div>
          {subjectProportionItems.length > 0 ? (
            <SubjectProportionBar items={subjectProportionItems} totalMinutes={subjectProportionTotal} height={5} showLegend />
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-zinc-500" role="status">
              今日尚无有效学习记录，完成一次收口后显示真实占比。
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export function SubjectTimerList({ today, onStart }: { today: ActionCenterTodayDto; onStart: (subjectId: string) => void }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card variant="master" padding="none" className="@container overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        fullWidth
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 !px-3.5 !py-2.5 text-left hover:!bg-white/[0.02]"
        aria-expanded={isOpen}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <TimerReset className="size-4 text-teal-400" aria-hidden="true" />
          临时专注计时 · 各科目直达
          <span className="font-normal text-xs text-zinc-400">（点击直接开始计时）</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <span>共 {today.subjectTimers.subjects.length} 科目</span>
          <ChevronDown className={`size-4 text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </Button>

      {isOpen ? (
        <div className="space-y-2 border-t border-white/5 p-3 pt-2">
          <div className="grid grid-cols-1 gap-2 @[28rem]:grid-cols-2 @[52rem]:grid-cols-3">
            {today.subjectTimers.subjects.map((subject) => {
              const maxRecent = Math.max(1, ...today.subjectTimers.subjects.map((s) => s.last7EffectiveMinutes));
              const progressPct = Math.min(100, Math.round((subject.last7EffectiveMinutes / maxRecent) * 100));
              return (
                <Card
                  key={subject.subjectId}
                  variant="subtle"
                  padding="none"
                  className="group flex flex-col justify-between p-2.5 transition-colors hover:border-teal-500/30 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <StatusDot status={subject.canStart ? "active" : "idle"} size="xs" />
                      <p className="truncate text-sm font-semibold text-white group-hover:text-teal-200">{subject.title}</p>
                    </div>
                    <Button
                      type="button"
                      disabled={!subject.canStart}
                      variant="secondary"
                      size="sm"
                      className="shrink-0 !h-6 !px-2 !py-0 !text-xs font-medium hover:border-teal-400/40 hover:text-teal-300"
                      onClick={() => onStart(subject.subjectId)}
                    >
                      开始
                    </Button>
                  </div>

                  <div className="mt-2 space-y-1 border-t border-white/5 pt-1.5">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span className="font-mono">今日 <strong className="text-teal-300 font-semibold">{subject.todayEffectiveMinutes}m</strong></span>
                      <span className="text-[11px] text-zinc-500">近 7 日 {subject.last7EffectiveMinutes}m</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-500/60 to-teal-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {today.subjectTimers.groups.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-2 text-xs text-zinc-400">
              <span className="font-medium text-zinc-300">分类汇总：</span>
              {today.subjectTimers.groups.map((group) => (
                <span key={group.groupId} className="rounded border border-white/5 bg-white/[0.02] px-2 py-0.5 text-xs text-zinc-300">
                  {group.title} · <strong className="text-white font-medium">{group.todayEffectiveMinutes}m</strong>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}


export function RecoveryDetails({
  recovery,
  pending,
  restarting,
  onRestart,
}: {
  recovery: NonNullable<ActionCenterTodayDto["recovery"]>;
  pending: boolean;
  restarting: boolean;
  onRestart: () => Promise<void>;
}) {
  const [open, setOpen] = useState(recovery.effectiveStatus === "EXPIRED");

  return (
    <Card variant="subtle" padding="md" className="space-y-3">
      <Button
        type="button"
        variant="ghost"
        fullWidth
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between !p-0 text-left text-sm font-medium text-zinc-200 hover:!bg-transparent"
      >
        <span>查看完整计划与恢复详情</span>
        <span className="text-xs text-teal-300">{open ? "收起" : "展开"}</span>
      </Button>
      {open ? (
        <div className="space-y-3 border-t border-white/5 pt-3">
          <p className="text-xs text-zinc-400">
            阶段 {recovery.currentStage} · 目标 {recovery.targetMinutes} 分钟 · {recovery.effectiveReason}
          </p>
          {recovery.effectiveStatus === "EXPIRED" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-400/5 p-3 text-xs text-amber-100" role="status">
              <p>恢复窗口已到期（旧记录 r{recovery.revision}），可重新开始新的三阶恢复。</p>
              <Button type="button" disabled={pending || restarting} variant="secondary" size="sm" onClick={() => void onRestart()}>
                {restarting || pending ? "重新开始中..." : "重新开始恢复"}
              </Button>
            </div>
          ) : null}
          <div>
            <Link href="/roadmap/allocation" className="text-xs text-teal-300 hover:underline">打开计划</Link>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function ShortcutTimerModal({ today, controller }: { today: ActionCenterTodayDto; controller: ActionCenterTodayController }) {
  const { state, actions } = controller;
  return (
    <Modal open={state.confirmOpen} title="确认科目快捷计时" onClose={() => actions.setConfirmOpen(false)}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-zinc-400">科目</span>
          <Select className="mt-1" value={state.subjectId} onChange={(event) => actions.chooseSubject(event.target.value)}>
            {today.subjectTimers.subjects.map((subject) => (
              <option key={subject.subjectId} value={subject.subjectId}>{subject.title}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="text-zinc-400">任务（可选）</span>
          <Select className="mt-1" value={state.shortcutTaskId} onChange={(event) => actions.chooseTask(event.target.value)}>
            <option value="">不关联任务</option>
            {state.shortcutTasks.map((task) => (
              <option key={task.id} value={task.id} disabled={Boolean(task.disabledReason)}>
                {task.title}{task.disabledReason ? `（${task.disabledReason}）` : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="text-zinc-400">主考纲节点（可选）</span>
          <Select className="mt-1" value={state.shortcutNodeId} onChange={(event) => actions.setShortcutNodeId(event.target.value)}>
            <option value="">不关联主节点</option>
            {state.shortcutNodes.map((node) => (
              <option key={node.id} value={node.id}>{`${"　".repeat(node.depth)}${node.title}`}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="text-zinc-400">目标时长（分钟，可选）</span>
          <Input type="number" min={5} max={720} className="mt-1" value={state.goalMinutes} onChange={(event) => actions.setGoalMinutes(event.target.value)} />
        </label>
        <p className="text-xs text-zinc-500">到点只提醒，不自动结束。不要求先创建任务。</p>
        <Button
          type="button"
          disabled={state.pending || state.startingShortcut}
          variant="primary"
          size="lg"
          className="w-full shadow-[0_0_20px_rgba(45,212,191,0.35)]"
          onClick={() => void actions.startShortcut()}
        >
          {state.startingShortcut ? "开始中..." : "确认开始"}
        </Button>
      </div>
    </Modal>
  );
}
