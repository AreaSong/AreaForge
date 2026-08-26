import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  Inbox,
  TimerReset,
} from "lucide-react";
import type { ActionCenterTodayController } from "@/components/action-center-today-controller";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import { Modal } from "@/components/ui/overlays";
import { SectionHeader } from "@/components/ui/page";
import type { ActionCenterTodayDto } from "@/lib/contracts";

export function withTodayReturnTo(href: string): string {
  if (
    !href.startsWith("/knowledge/reviews/")
    && !href.startsWith("/focus")
    && !href.startsWith("/roadmap/allocation/tasks/")
  ) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent("/today")}`;
}

export function isSameActionTarget(left: string, right: string): boolean {
  return left.split("?", 1)[0] === right.split("?", 1)[0];
}

export function hasRemainingAction(
  items: Array<{ href: string }>,
  primaryActionHref: string,
): boolean {
  return items.some((item) => !isSameActionTarget(item.href, primaryActionHref));
}

export function flattenShortcutNodes(
  nodes: ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"],
  depth = 0,
): Array<ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"][number] & { depth: number }> {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenShortcutNodes(node.children, depth + 1),
  ]);
}

export function QueueList(props: {
  items: Array<{ id: string; title: string; reason: string; href: string; softDependencyHint: string | null }>;
  actionLabel: string;
}) {
  if (props.items.length === 0) {
    return (
      <Card variant="subtle" padding="lg" className="flex flex-col items-center justify-center py-8 text-center">
        <Inbox className="mb-2 size-8 text-zinc-600" aria-hidden="true" />
        <p className="text-sm font-medium text-zinc-300">当前推荐之外没有待办</p>
        <p className="mt-1 text-xs text-zinc-500">今日安排已全部就绪或已在推荐卡片中呈现</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      {props.items.map((item) => (
        <Card
          key={item.id}
          variant="subtle"
          padding="md"
          className="group flex flex-col justify-between gap-3 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
        >
          <div className="min-w-0 space-y-1.5">
            <h3 className="break-words text-sm font-semibold text-white group-hover:text-teal-200">
              {item.title}
            </h3>
            <p className="text-xs leading-relaxed text-zinc-400">
              {item.reason}
            </p>
            {item.softDependencyHint ? (
              <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-[11px] text-amber-200">
                <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.softDependencyHint}</span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-end pt-1">
            <Link
              href={withTodayReturnTo(item.href)}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {props.actionLabel}
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function TodayMetric(props: { label: string; value: string }) {
  return <Metric {...props} layout="compact" valueSize="sm" className="first:pl-0 last:pr-0" />;
}

export function TodayLearningSummary({ today }: { today: ActionCenterTodayDto }) {
  return (
    <SectionCard
      variant="master"
      padding="md"
      className="space-y-4"
      aria-labelledby="today-summary-heading"
    >
      <SectionHeader
        title={today.isToday ? "今日学习闭环" : `${today.studyDate} 学习闭环`}
        description="先看实际投入和有效产出，再看计划状态。"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card
          variant="subtle"
          padding="sm"
          className="flex flex-col justify-between"
        >
          <span className="text-xs font-medium text-zinc-400">实际投入</span>
          <span className="mt-2 text-xl font-bold tracking-tight text-white">
            {today.learningLoop.totalMinutes}
            <span className="ml-1 text-xs font-normal text-zinc-400">分</span>
          </span>
        </Card>
        <Card
          variant="subtle"
          padding="sm"
          className="flex flex-col justify-between"
        >
          <span className="text-xs font-medium text-zinc-400">有效学习</span>
          <span className="mt-2 text-xl font-bold tracking-tight text-teal-300">
            {today.learningLoop.effectiveMinutes}
            <span className="ml-1 text-xs font-normal text-zinc-400">分</span>
          </span>
        </Card>
        <Card
          variant="subtle"
          padding="sm"
          className="flex flex-col justify-between"
        >
          <span className="text-xs font-medium text-zinc-400">有效段数</span>
          <span className="mt-2 text-xl font-bold tracking-tight text-white">
            {today.learningLoop.effectiveSessionCount}
            <span className="ml-1 text-xs font-normal text-zinc-400">段</span>
          </span>
        </Card>
        <Card
          variant="subtle"
          padding="sm"
          className="flex flex-col justify-between"
        >
          <span className="text-xs font-medium text-zinc-400">低效补充</span>
          <span className="mt-2 text-xl font-bold tracking-tight text-amber-300">
            {today.learningLoop.lowConversionCount}
            <span className="ml-1 text-xs font-normal text-zinc-400">次</span>
          </span>
        </Card>
      </div>
      <div className="space-y-1.5 rounded-xl border border-white/5 bg-white/[0.01] p-3 text-xs text-zinc-400">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            计划{" "}
            <strong className="text-zinc-200">
              {today.learningLoop.plannedTaskCount}
            </strong>{" "}
            项 · 已完成{" "}
            <strong className="text-emerald-300">
              {today.learningLoop.completedTaskCount}
            </strong>{" "}
            项
          </span>
          <span>
            搁置/跳过{" "}
            <strong className="text-zinc-300">
              {today.learningLoop.deferredTaskCount}
            </strong>{" "}
            项
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-1.5">
          <span>
            复盘状态：
            <strong
              className={
                today.learningLoop.reviewSubmitted
                  ? "text-teal-300"
                  : "text-amber-300"
              }
            >
              {today.learningLoop.reviewSubmitted ? "已收口" : "未收口"}
            </strong>
          </span>
          <span className="truncate max-w-[200px] text-zinc-300">
            下一动作：
            {today.learningLoop.nextAction ?? "本日尚未留下下一动作"}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}

export function SubjectTimerList({
  today,
  onStart,
}: {
  today: ActionCenterTodayDto;
  onStart: (subjectId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card variant="master" padding="none" className="overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        fullWidth
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 !p-4 text-left hover:!bg-white/[0.02]"
        aria-expanded={isOpen}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <TimerReset className="size-4 text-teal-400" aria-hidden="true" />
          临时专注计时
        </span>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          <span>不建任务时使用</span>
          <ChevronDown
            className={`size-4 text-zinc-400 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </span>
      </Button>

      {isOpen ? (
        <div className="space-y-3 border-t border-white/5 p-4 pt-2">
          <div className="grid grid-cols-1 gap-2.5">
            {today.subjectTimers.subjects.map((subject) => {
              const maxRecent = Math.max(
                1,
                ...today.subjectTimers.subjects.map(
                  (s) => s.last7EffectiveMinutes,
                ),
              );
              const progressPct = Math.min(
                100,
                Math.round((subject.last7EffectiveMinutes / maxRecent) * 100),
              );

              return (
                <Card
                  key={subject.subjectId}
                  variant="subtle"
                  padding="sm"
                  className="flex flex-col justify-between gap-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">
                          {subject.title}
                        </p>
                        {subject.groupTitle ? (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {subject.groupTitle}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {today.studyDate} {subject.todayEffectiveMinutes} 分 · 近
                        7 日 {subject.last7EffectiveMinutes} 分
                      </p>
                      {subject.contextSummary ? (
                        <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
                          {subject.contextSummary}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      disabled={!subject.canStart}
                      variant="secondary"
                      size="sm"
                      onClick={() => onStart(subject.subjectId)}
                    >
                      开始
                    </Button>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span>7日投入热度</span>
                      <span>{subject.last7EffectiveMinutes} 分</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-500/60 to-teal-300 transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {today.subjectTimers.groups.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-t border-white/5 pt-2.5">
              {today.subjectTimers.groups.map((group) => (
                <span
                  key={group.groupId}
                  className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1 text-xs text-zinc-400"
                >
                  {group.title}合计 · {group.todayEffectiveMinutes} 分
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
            阶段 {recovery.currentStage} · 目标 {recovery.targetMinutes} 分钟 ·{" "}
            {recovery.effectiveReason}
          </p>
          {recovery.effectiveStatus === "EXPIRED" ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-400/5 p-3 text-xs text-amber-100"
              role="status"
            >
              <p>
                恢复窗口已到期（旧记录 r{recovery.revision}
                ），可重新开始新的三阶恢复。
              </p>
              <Button
                type="button"
                disabled={pending || restarting}
                variant="secondary"
                size="sm"
                onClick={() => void onRestart()}
              >
                {restarting || pending ? "重新开始中..." : "重新开始恢复"}
              </Button>
            </div>
          ) : null}
          <div>
            <Link
              href="/roadmap/allocation"
              className="text-xs text-teal-300 hover:underline"
            >
              打开计划
            </Link>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function ShortcutTimerModal({
  today,
  controller,
}: {
  today: ActionCenterTodayDto;
  controller: ActionCenterTodayController;
}) {
  const { state, actions } = controller;
  return (
    <Modal
      open={state.confirmOpen}
      title="确认科目快捷计时"
      onClose={() => actions.setConfirmOpen(false)}
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-zinc-400">科目</span>
          <Select
            className="mt-1"
            value={state.subjectId}
            onChange={(event) => actions.chooseSubject(event.target.value)}
          >
            {today.subjectTimers.subjects.map((subject) => (
              <option key={subject.subjectId} value={subject.subjectId}>
                {subject.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="text-zinc-400">任务（可选）</span>
          <Select
            className="mt-1"
            value={state.shortcutTaskId}
            onChange={(event) => actions.chooseTask(event.target.value)}
          >
            <option value="">不关联任务</option>
            {state.shortcutTasks.map((task) => (
              <option
                key={task.id}
                value={task.id}
                disabled={Boolean(task.disabledReason)}
              >
                {task.title}
                {task.disabledReason ? `（${task.disabledReason}）` : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="text-zinc-400">主考纲节点（可选）</span>
          <Select
            className="mt-1"
            value={state.shortcutNodeId}
            onChange={(event) => actions.setShortcutNodeId(event.target.value)}
          >
            <option value="">不关联主节点</option>
            {state.shortcutNodes.map((node) => (
              <option key={node.id} value={node.id}>{`${"　".repeat(
                node.depth,
              )}${node.title}`}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="text-zinc-400">目标时长（分钟，可选）</span>
          <Input
            type="number"
            min={5}
            max={720}
            className="mt-1"
            value={state.goalMinutes}
            onChange={(event) => actions.setGoalMinutes(event.target.value)}
          />
        </label>
        <p className="text-xs text-zinc-500">
          到点只提醒，不自动结束。不要求先创建任务。
        </p>
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
