import type { ActionCenterTodayController } from "@/components/action-center-today-controller";
import {
  QueueList,
  TodayMetric,
  withTodayReturnTo,
} from "@/components/action-center-today-support";
import { Button, buttonClassName } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Alert } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlays";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import type { ActionCenterTodayDto } from "@/lib/contracts";
import { CalendarDays, TimerReset } from "lucide-react";
import Link from "next/link";

export function ActionCenterTodayView({
  today,
  controller,
}: {
  today: ActionCenterTodayDto;
  controller: ActionCenterTodayController;
}) {
  if (today.setupRequired) return <TodaySetupRequired />;

  const { state, actions } = controller;
  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        title={today.isToday ? "今日" : today.studyDate}
        eyebrow="行动中心"
        description={today.workspace?.name}
        action={<TodayDatePicker studyDate={today.studyDate} />}
      />

      {today.statusBar ? <TodayStatusBar status={today.statusBar} /> : null}

      <div className="af-content-grid-primary grid items-start gap-6">
        <div className="min-w-0 space-y-6">
          <TodayRecommendation
            today={today}
            creatingMinimumTask={state.creatingMinimumTask}
            onCreateMinimumTask={actions.createMinimumTask}
          />
          <TodayQueue
            queueTabs={state.queueTabs}
            activeQueue={state.activeQueue}
            mobileQueue={state.mobileQueue}
            onQueueChange={actions.setMobileQueue}
          />
        </div>

        <div className="space-y-5 border-t border-white/10 pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <TodayLearningSummary today={today} />
          <SubjectTimerList
            today={today}
            onStart={(subjectId) => {
              actions.chooseSubject(subjectId);
              actions.setConfirmOpen(true);
            }}
          />
        </div>
      </div>

      {today.recovery ? (
        <RecoveryDetails
          recovery={today.recovery}
          pending={state.pending}
          restarting={state.restartingRecovery}
          onRestart={actions.restartExpiredRecovery}
        />
      ) : null}

      {state.error ? <p className="text-sm text-red-300" role="alert">{state.error}</p> : null}
      <ShortcutTimerModal today={today} controller={controller} />
    </PageFrame>
  );
}

function TodaySetupRequired() {
  return (
    <PageFrame variant="content-focus">
      <PageHeader title="今日" eyebrow="行动中心" description="先设置考试目标，AreaForge 才能生成真实的学习行动。" />
      <Alert tone="warning">尚未设置考试工作区。不展示伪造统计。</Alert>
      <Link href="/settings/exams?setup=1" className={buttonClassName({ variant: "primary", size: "lg", className: "w-fit" })}>
        设置考试目标
      </Link>
    </PageFrame>
  );
}

function TodayDatePicker({ studyDate }: { studyDate: string }) {
  return (
    <form action="/today" method="get" className="flex flex-wrap items-center gap-2" aria-label="选择学习日期">
      <label htmlFor="today-date" className="sr-only">学习日期</label>
      <span className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 text-xs text-zinc-400">
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        <Input id="today-date" name="date" type="date" defaultValue={studyDate} className="bg-transparent text-sm text-zinc-100 outline-none" />
      </span>
      <Button type="submit" variant="secondary" size="sm">查看日期</Button>
    </form>
  );
}

function TodayStatusBar({ status }: { status: NonNullable<ActionCenterTodayDto["statusBar"]> }) {
  return (
    <Alert tone={status === "recovery_minimum" ? "warning" : "info"}>
      {status === "paused_activity"
        ? "活动已暂停，可继续当前行动。"
        : status === "recovery_minimum"
          ? "恢复模式：先完成一个最小行动。"
          : "晚间提醒：最低行动或复盘尚未闭环。"}
    </Alert>
  );
}

function TodayRecommendation({
  today,
  creatingMinimumTask,
  onCreateMinimumTask,
}: {
  today: ActionCenterTodayDto;
  creatingMinimumTask: boolean;
  onCreateMinimumTask: () => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[var(--af-surface)] p-5 sm:p-6">
      <p className="text-xs font-medium text-teal-300">当前推荐</p>
      {today.recommendation ? (
        <>
          <h2 className="mt-2 text-xl font-medium text-white">{today.recommendation.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{today.recommendation.reason}</p>
          {today.recommendation.softDependencyHint ? (
            <p className="mt-2 text-sm text-amber-200">{today.recommendation.softDependencyHint}</p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">暂无推荐。可以创建今天最小任务。</p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={withTodayReturnTo(today.primaryActionHref)} className={buttonClassName({ variant: "primary", size: "lg" })}>
          {today.primaryActionLabel}
        </Link>
        {today.queuesEmpty ? (
          <Button type="button" disabled={creatingMinimumTask} variant="secondary" size="lg" onClick={() => void onCreateMinimumTask()}>
            {creatingMinimumTask ? "创建并启动中..." : "直接开始 25 分钟"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type QueueTabs = ActionCenterTodayController["state"]["queueTabs"];

function TodayQueue({
  queueTabs,
  activeQueue,
  mobileQueue,
  onQueueChange,
}: {
  queueTabs: QueueTabs;
  activeQueue: QueueTabs[number];
  mobileQueue: ActionCenterTodayController["state"]["mobileQueue"];
  onQueueChange: ActionCenterTodayController["actions"]["setMobileQueue"];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">后续队列</h2>
        <SegmentedControl
          value={mobileQueue}
          label="待办类型"
          options={queueTabs.map((queue) => ({ value: queue.key, label: `${queue.label} ${queue.items.length}` }))}
          onChange={onQueueChange}
          className="[&_[role=tab]]:h-8 [&_[role=tab]]:text-xs"
        />
      </div>
      <QueueList items={activeQueue.items} actionLabel={activeQueue.actionLabel} />
    </div>
  );
}

function TodayLearningSummary({ today }: { today: ActionCenterTodayDto }) {
  return (
    <section aria-labelledby="today-summary-heading">
      <SectionHeader title={today.isToday ? "今日学习闭环" : `${today.studyDate} 学习闭环`} description="先看实际投入和有效产出，再看计划状态。" />
      <dl className="af-metric-grid-four mt-3 grid divide-x divide-y divide-white/10 border-y border-white/10 py-3">
        <TodayMetric label="实际投入" value={`${today.learningLoop.totalMinutes} 分`} />
        <TodayMetric label="有效学习" value={`${today.learningLoop.effectiveMinutes} 分`} />
        <TodayMetric label="有效段数" value={`${today.learningLoop.effectiveSessionCount} 段`} />
        <TodayMetric label="低效补充" value={`${today.learningLoop.lowConversionCount} 次`} />
      </dl>
      <div className="af-content-grid-three mt-3 grid gap-2 text-xs text-zinc-400">
        <p>计划 {today.learningLoop.plannedTaskCount} 项 · 已完成 {today.learningLoop.completedTaskCount} 项</p>
        <p>搁置/跳过 {today.learningLoop.deferredTaskCount} 项 · 复盘 {today.learningLoop.reviewSubmitted ? "已收口" : "未收口"}</p>
        <p className="text-left">下一动作：{today.learningLoop.nextAction ?? "本日尚未留下下一动作"}</p>
      </div>
    </section>
  );
}

function SubjectTimerList({
  today,
  onStart,
}: {
  today: ActionCenterTodayDto;
  onStart: (subjectId: string) => void;
}) {
  return (
    <details className="border-y border-white/10 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-zinc-200">
        <span className="inline-flex items-center gap-2">
          <TimerReset className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          临时专注
        </span>
        <span className="text-xs text-zinc-500">不建任务时使用</span>
      </summary>
      <div className="mt-3 divide-y divide-white/10 border-t border-white/10">
        {today.subjectTimers.subjects.map((subject) => (
          <div key={subject.subjectId} className="py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-medium text-white">{subject.title}</p>
                {subject.groupTitle ? <p className="text-xs text-zinc-500">{subject.groupTitle}</p> : null}
                <p className="mt-2 text-xs text-zinc-400">
                  {today.studyDate} {subject.todayEffectiveMinutes} 分 · 近 7 日 {subject.last7EffectiveMinutes} 分
                </p>
                {subject.contextSummary ? <p className="mt-1 break-words text-xs text-zinc-500">{subject.contextSummary}</p> : null}
              </div>
              <Button type="button" disabled={!subject.canStart} variant="secondary" size="sm" onClick={() => onStart(subject.subjectId)}>
                开始
              </Button>
            </div>
          </div>
        ))}
      </div>
      {today.subjectTimers.groups.length > 0 ? (
        <div className="divide-y divide-white/10 border-t border-white/10">
          {today.subjectTimers.groups.map((group) => (
            <div key={group.groupId} className="py-2 text-xs text-zinc-500">
              {group.title}合计 · {today.studyDate} {group.todayEffectiveMinutes} 分
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function RecoveryDetails({
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
  return (
    <details className="rounded-md border border-white/10 bg-[#101419] p-3 text-sm" open={recovery.effectiveStatus === "EXPIRED"}>
      <summary className="cursor-pointer text-zinc-200">查看完整计划与恢复详情</summary>
      <p className="mt-2 text-zinc-400">
        阶段 {recovery.currentStage} · 目标 {recovery.targetMinutes} 分钟 · {recovery.effectiveReason}
      </p>
      {recovery.effectiveStatus === "EXPIRED" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-amber-100" role="status">
          <p>恢复窗口已到期（旧记录 r{recovery.revision}），可重新开始新的三阶恢复。</p>
          <Button type="button" disabled={pending || restarting} variant="secondary" onClick={() => void onRestart()}>
            {restarting || pending ? "重新开始中..." : "重新开始恢复"}
          </Button>
        </div>
      ) : null}
      <Link href="/roadmap/allocation" className="mt-2 inline-flex text-teal-300 hover:underline">打开计划</Link>
    </details>
  );
}

function ShortcutTimerModal({
  today,
  controller,
}: {
  today: ActionCenterTodayDto;
  controller: ActionCenterTodayController;
}) {
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
        <Button type="button" disabled={state.pending || state.startingShortcut} variant="primary" size="lg" className="w-full" onClick={() => void actions.startShortcut()}>
          {state.startingShortcut ? "开始中..." : "确认开始"}
        </Button>
      </div>
    </Modal>
  );
}
