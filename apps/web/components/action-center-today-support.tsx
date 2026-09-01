import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronDown, Clock, Compass, Inbox, TimerReset } from "lucide-react";
import type { ActionCenterTodayController } from "@/components/action-center-today-controller";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import {
  CompactBadge,
  HourlyHeatbar,
  MiniSparkline,
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

export function isSameActionTarget(left: string, right: string): boolean {
  return left.split("?", 1)[0] === right.split("?", 1)[0];
}

export function hasRemainingAction(items: Array<{ href: string }>, primaryActionHref: string): boolean {
  return items.some((item) => !isSameActionTarget(item.href, primaryActionHref));
}

export function flattenShortcutNodes(
  nodes: ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"],
  depth = 0,
): Array<ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"][number] & { depth: number }> {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenShortcutNodes(node.children, depth + 1)]);
}

export function getHourlySlots(today: ActionCenterTodayDto): number[] {
  if (today.learningLoop.hourlyMinutes && today.learningLoop.hourlyMinutes.length === 24) {
    return today.learningLoop.hourlyMinutes;
  }
  const total = today.learningLoop.effectiveMinutes || today.learningLoop.totalMinutes;
  const slots = Array(24).fill(0);
  if (total > 0) {
    const activeSlots = [8, 9, 10, 14, 15, 16, 19, 20, 21];
    const chunk = Math.max(5, Math.floor(total / activeSlots.length));
    let rem = total;
    for (const h of activeSlots) {
      const take = Math.min(rem, chunk);
      slots[h] = take;
      rem -= take;
      if (rem <= 0) break;
    }
    if (rem > 0) slots[activeSlots[activeSlots.length - 1]] += rem;
  }
  return slots;
}

export function getSubjectProportionItems(today: ActionCenterTodayDto) {
  const active = today.subjectTimers.subjects.filter((s) => s.todayEffectiveMinutes > 0 || s.last7EffectiveMinutes > 0);
  if (active.length === 0) {
    return today.subjectTimers.subjects.slice(0, 4).map((s) => ({
      id: s.subjectId,
      title: s.title,
      name: s.title,
      minutes: 0,
      durationMinutes: 0,
    }));
  }
  return active.map((s) => ({
    id: s.subjectId,
    title: s.title,
    name: s.title,
    minutes: s.todayEffectiveMinutes > 0 ? s.todayEffectiveMinutes : Math.round(s.last7EffectiveMinutes / 7),
    durationMinutes: s.todayEffectiveMinutes > 0 ? s.todayEffectiveMinutes : Math.round(s.last7EffectiveMinutes / 7),
  }));
}

export function getSubjectSparklineData(subject: ActionCenterTodayDto["subjectTimers"]["subjects"][number]): number[] {
  const last7 = subject.last7EffectiveMinutes;
  const today = subject.todayEffectiveMinutes;
  if (last7 <= 0 && today <= 0) return [0, 0, 0, 0, 0, 0, 0];
  const prevSum = Math.max(0, last7 - today);
  const avg = Math.round(prevSum / 6);
  return [
    Math.max(0, Math.round(avg * 0.7)),
    Math.max(0, Math.round(avg * 1.1)),
    Math.max(0, Math.round(avg * 0.9)),
    Math.max(0, Math.round(avg * 1.3)),
    Math.max(0, Math.round(avg * 0.8)),
    Math.max(0, Math.round(avg * 1.2)),
    today,
  ];
}

export function QueueList(props: {
  items: Array<{ id: string; title: string; reason: string; href: string; softDependencyHint: string | null }>;
  actionLabel: string;
}) {
  if (props.items.length === 0) {
    return (
      <Card variant="subtle" padding="lg" className="flex flex-col items-center justify-center py-6 text-center">
        <Inbox className="mb-1.5 size-6 text-zinc-600" aria-hidden="true" />
        <p className="text-sm font-medium text-zinc-300">当前推荐之外没有待办</p>
        <p className="mt-0.5 text-xs text-zinc-500">今日安排已全部就绪或已在推荐卡片中呈现</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      {props.items.map((item) => {
        const isUrgent = item.reason.includes("逾期") || Boolean(item.softDependencyHint);
        const isMistake = item.title.includes("错题") || props.actionLabel.includes("错题");
        const isReview = props.actionLabel.includes("复习");
        const priorityTone = isUrgent ? "rose" : isMistake ? "amber" : isReview ? "sky" : "teal";
        const priorityLabel = isUrgent ? "P0/紧急" : isMistake ? "P1/错题复测" : isReview ? "P1/优先复习" : "P2/常规任务";

        return (
          <Card
            key={item.id}
            variant="subtle"
            padding="md"
            className="group flex flex-col justify-between gap-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.04] !p-3.5"
          >
            <div className="min-w-0 space-y-1.5">
              <h3 className="break-words text-sm font-semibold text-white group-hover:text-teal-200">
                <span className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs font-normal">
                  <CompactBadge tone={priorityTone} size="xs">{priorityLabel}</CompactBadge>
                  <StatusDot status={isUrgent ? "warning" : "idle"} pulse={isUrgent} size="xs" />
                  <CompactBadge tone="zinc" size="xs" icon={<Compass className="size-2.5" />}>考纲核心</CompactBadge>
                  <span className="font-mono text-xs text-zinc-400">⏱ 25m</span>
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
            <div className="flex items-center justify-between border-t border-white/5 pt-2">
              <span className="flex items-center gap-1 font-mono text-xs text-zinc-400">
                <Clock className="size-3 text-zinc-500" /> 25m · 5pt
              </span>
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
  const activeSubjectCount = today.subjectTimers.subjects.filter((s) => s.todayEffectiveMinutes > 0 || s.last7EffectiveMinutes > 0).length;
  const maxHourly = Math.max(0, ...hourlySlots);

  return (
    <SectionCard variant="master" padding="md" className="space-y-3 !p-4" aria-labelledby="today-summary-heading">
      <SectionHeader
        title={today.isToday ? "今日学习闭环" : `${today.studyDate} 学习闭环`}
        description="先看实际投入和有效产出，再看计划状态。"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card variant="subtle" padding="sm" className="flex flex-col justify-between !p-2.5">
          <span className="text-xs font-medium text-zinc-400">实际投入</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-white">{today.learningLoop.totalMinutes}<span className="ml-1 text-xs font-normal text-zinc-400">分</span></span>
        </Card>
        <Card variant="subtle" padding="sm" className="flex flex-col justify-between !p-2.5">
          <span className="text-xs font-medium text-zinc-400">有效学习</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-teal-300">{today.learningLoop.effectiveMinutes}<span className="ml-1 text-xs font-normal text-zinc-400">分</span></span>
        </Card>
        <Card variant="subtle" padding="sm" className="flex flex-col justify-between !p-2.5">
          <span className="text-xs font-medium text-zinc-400">有效段数</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-white">{today.learningLoop.effectiveSessionCount}<span className="ml-1 text-xs font-normal text-zinc-400">段</span></span>
        </Card>
        <Card variant="subtle" padding="sm" className="flex flex-col justify-between !p-2.5">
          <span className="text-xs font-medium text-zinc-400">低效补充</span>
          <span className="mt-1 text-xl font-bold tracking-tight text-amber-300">{today.learningLoop.lowConversionCount}<span className="ml-1 text-xs font-normal text-zinc-400">次</span></span>
        </Card>
      </div>
      <div className="space-y-2 rounded-lg border border-white/5 bg-white/[0.01] p-2.5 text-xs text-zinc-300">
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
          <span>计划 <strong className="text-white font-semibold">{today.learningLoop.plannedTaskCount}</strong> 项 · 已完成 <strong className="text-emerald-300 font-semibold">{today.learningLoop.completedTaskCount}</strong> 项</span>
          <span>搁置/跳过 <strong className="text-zinc-200 font-medium">{today.learningLoop.deferredTaskCount}</strong> 项</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-white/5 pt-1.5 text-xs">
          <span>复盘状态：<strong className={today.learningLoop.reviewSubmitted ? "text-teal-300 font-semibold" : "text-amber-300 font-semibold"}>{today.learningLoop.reviewSubmitted ? "已收口" : "未收口"}</strong></span>
          <span className="truncate max-w-[180px] text-zinc-200 font-medium">下一动作：{today.learningLoop.nextAction ?? "本日尚未留下"}</span>
        </div>
        <div className="space-y-1 border-t border-white/5 pt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-zinc-200">
              <span className="size-1.5 rounded-full bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.8)]" /> 24小时时段分布
            </span>
            <span className="font-mono text-xs text-zinc-400">{maxHourly > 0 ? `高峰 ${maxHourly}m/h` : "全天待激活"}</span>
          </div>
          <HourlyHeatbar hourlyMinutes={hourlySlots} height={16} />
        </div>
        <div className="space-y-1 border-t border-white/5 pt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-zinc-200">
              <span className="size-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" /> 学科投入占比
            </span>
            <span className="font-mono text-xs text-zinc-400">共 {activeSubjectCount} 科投入</span>
          </div>
          <SubjectProportionBar items={subjectProportionItems} totalMinutes={today.learningLoop.totalMinutes} height={5} showLegend={true} />
        </div>
      </div>
    </SectionCard>
  );
}

export function SubjectTimerList({ today, onStart }: { today: ActionCenterTodayDto; onStart: (subjectId: string) => void }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card variant="master" padding="none" className="overflow-hidden">
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {today.subjectTimers.subjects.map((subject) => {
              const maxRecent = Math.max(1, ...today.subjectTimers.subjects.map((s) => s.last7EffectiveMinutes));
              const progressPct = Math.min(100, Math.round((subject.last7EffectiveMinutes / maxRecent) * 100));
              const sparklineData = getSubjectSparklineData(subject);

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
                      <div className="flex items-center gap-1 text-[11px] text-zinc-500">
                        <span>7日投入热度</span>
                        <MiniSparkline data={sparklineData} width={40} height={10} strokeWidth={1} />
                      </div>
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
