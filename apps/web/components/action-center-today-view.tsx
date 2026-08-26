import Link from "next/link";
import {
  AlertCircle,
  CalendarDays,
  Sparkles,
} from "lucide-react";
import type { ActionCenterTodayController } from "@/components/action-center-today-controller";
import {
  QueueList,
  RecoveryDetails,
  ShortcutTimerModal,
  SubjectTimerList,
  TodayLearningSummary,
  withTodayReturnTo,
} from "@/components/action-center-today-support";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { PinnedActionBar } from "@/components/ui/pinned-action-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ActionCenterTodayDto } from "@/lib/contracts";

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px] items-start">
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

        <div className="min-w-0 space-y-6">
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

      {state.error ? (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      ) : null}

      <PinnedActionBar
        mode="sticky"
        className="mt-6"
        left={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
            <span className="flex items-center gap-1.5 font-medium text-white">
              <span className="size-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
              今日投入 {today.learningLoop.totalMinutes} 分
            </span>
            <span className="text-zinc-500">·</span>
            <span>有效学习 {today.learningLoop.effectiveMinutes} 分</span>
            <span className="text-zinc-500">·</span>
            <span>
              计划 {today.learningLoop.completedTaskCount}/
              {today.learningLoop.plannedTaskCount} 项
            </span>
            {today.learningLoop.nextAction ? (
              <>
                <span className="text-zinc-500">·</span>
                <span className="truncate max-w-[200px] sm:max-w-[280px] text-zinc-400">
                  下一步: {today.learningLoop.nextAction}
                </span>
              </>
            ) : null}
          </div>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={state.creatingMinimumTask}
              onClick={() => void actions.createMinimumTask()}
            >
              {state.creatingMinimumTask ? "创建中..." : "创建最小任务"}
            </Button>
            <Link
              href={`/roadmap/reviews?date=${today.studyDate}`}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              快速复盘
            </Link>
            <Link
              href={withTodayReturnTo(today.primaryActionHref)}
              className={buttonClassName({
                variant: "primary",
                size: "sm",
                className: "shadow-[0_0_16px_rgba(45,212,191,0.35)]",
              })}
            >
              {today.primaryActionLabel || "开始今日推荐"}
            </Link>
          </div>
        }
      />

      <ShortcutTimerModal today={today} controller={controller} />
    </PageFrame>
  );
}

function TodaySetupRequired() {
  return (
    <PageFrame variant="content-focus">
      <PageHeader
        title="今日"
        eyebrow="行动中心"
        description="先设置考试目标，AreaForge 才能生成真实的学习行动。"
      />
      <Alert tone="warning">尚未设置考试工作区。不展示伪造统计。</Alert>
      <Link
        href="/settings/exams?setup=1"
        className={buttonClassName({
          variant: "primary",
          size: "lg",
          className: "w-fit shadow-[0_0_16px_rgba(45,212,191,0.35)]",
        })}
      >
        设置考试目标
      </Link>
    </PageFrame>
  );
}

function TodayDatePicker({ studyDate }: { studyDate: string }) {
  return (
    <form
      action="/today"
      method="get"
      className="flex items-center gap-2"
      aria-label="选择学习日期"
    >
      <label htmlFor="today-date" className="sr-only">
        学习日期
      </label>
      <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300">
        <CalendarDays className="size-4 text-zinc-400" aria-hidden="true" />
        <Input
          id="today-date"
          name="date"
          type="date"
          defaultValue={studyDate}
          className="h-7 w-auto border-none bg-transparent p-0 text-xs text-zinc-100 focus:ring-0 focus:outline-none"
        />
      </div>
      <Button type="submit" variant="secondary" size="sm">
        查看日期
      </Button>
    </form>
  );
}

function TodayStatusBar({
  status,
}: {
  status: NonNullable<ActionCenterTodayDto["statusBar"]>;
}) {
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
    <Card variant="accent" padding="lg" className="relative overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-400/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-teal-300">
          <Sparkles className="size-3.5 text-teal-300" aria-hidden="true" />
          <span>当前推荐行动</span>
        </div>
        {today.workspace?.name ? (
          <span className="text-xs font-medium text-zinc-400">
            {today.workspace.name}
          </span>
        ) : null}
      </div>

      {today.recommendation ? (
        <div className="mt-3 space-y-2">
          <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            {today.recommendation.title}
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-300">
            {today.recommendation.reason}
          </p>
          {today.recommendation.softDependencyHint ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
              <AlertCircle
                className="size-4 shrink-0 text-amber-400"
                aria-hidden="true"
              />
              <span>{today.recommendation.softDependencyHint}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 text-sm text-zinc-400">
          暂无推荐行动。可以立即创建今天的最小任务开启专注。
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={withTodayReturnTo(today.primaryActionHref)}
          className={buttonClassName({
            variant: "primary",
            size: "lg",
            className:
              "shadow-[0_0_20px_rgba(45,212,191,0.35)] active:scale-[0.98]",
          })}
        >
          {today.primaryActionLabel}
        </Link>
        {today.queuesEmpty ? (
          <Button
            type="button"
            disabled={creatingMinimumTask}
            variant="secondary"
            size="lg"
            onClick={() => void onCreateMinimumTask()}
          >
            {creatingMinimumTask ? "创建并启动中..." : "直接开始 25 分钟"}
          </Button>
        ) : null}
      </div>
    </Card>
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
        <h2 className="text-lg font-semibold text-white">后续队列</h2>
        <SegmentedControl
          value={mobileQueue}
          label="待办类型"
          options={queueTabs.map((queue) => ({
            value: queue.key,
            label: `${queue.label} ${queue.items.length}`,
          }))}
          onChange={onQueueChange}
          className="[&_[role=tab]]:h-8 [&_[role=tab]]:text-xs"
        />
      </div>
      <QueueList
        items={activeQueue.items}
        actionLabel={activeQueue.actionLabel}
      />
    </div>
  );
}
