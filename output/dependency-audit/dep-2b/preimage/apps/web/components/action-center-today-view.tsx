import Link from "next/link";
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  RefreshCw,
  ThumbsUp,
} from "lucide-react";
import type { ActionCenterTodayController } from "@/components/action-center-today-controller";
import {
  QueueList,
  RecoveryDetails,
  ShortcutTimerModal,
  SubjectTimerList,
  TodayLoopProgress,
  TodayContinuation,
  TodayLearningSummary,
  dailyClosureLabel,
  shiftDate,
  withTodayReturnTo,
} from "@/components/action-center-today-support";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { CompactBadge } from "@/components/ui/micro-charts";
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
        action={<TodayDatePicker studyDate={today.studyDate} isToday={today.isToday} />}
      />

      <TodayLoopProgress today={today} />

      <div className="@container grid grid-cols-1 gap-3.5 @[56rem]:grid-cols-[1fr_360px] @[80rem]:grid-cols-[1fr_380px] items-start">
        <div className="min-w-0 space-y-3">
          <TodayRecommendation
            today={today}
            creatingMinimumTask={state.creatingMinimumTask}
            onCreateMinimumTask={actions.createMinimumTask}
            feedbackPending={state.recommendationFeedbackPending}
            feedbackNotice={state.recommendationFeedbackNotice}
            onFeedback={actions.submitRecommendationFeedback}
          />
          <TodayContinuation today={today} />
          <SubjectTimerList
            today={today}
            onStart={(subjectId) => {
              actions.chooseSubject(subjectId);
              actions.setConfirmOpen(true);
            }}
          />
          <TodayQueue
            queueTabs={state.queueTabs}
            activeQueue={state.activeQueue}
            mobileQueue={state.mobileQueue}
            onQueueChange={actions.setMobileQueue}
          />
        </div>

        <div className="min-w-0 space-y-3">
          <TodayLearningSummary today={today} />
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
              className="!h-7"
              disabled={state.creatingMinimumTask}
              onClick={() => void actions.createMinimumTask()}
            >
              {state.creatingMinimumTask ? "创建中..." : "创建最小任务"}
            </Button>
            <Link
              href="/roadmap/reviews/daily"
              className={buttonClassName({
                variant: today.learningLoop.reviewSubmitted ? "ghost" : "secondary",
                size: "sm",
                className: "!h-7",
              })}
            >
              <ClipboardCheck className="size-3.5" aria-hidden="true" />
              {dailyClosureLabel(today)}
            </Link>
            <Link
              href={withTodayReturnTo(today.primaryActionHref)}
              className={buttonClassName({
                variant: "primary",
                size: "sm",
                className: "shadow-[0_0_16px_rgba(45,212,191,0.35)] !h-7",
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

function TodayDatePicker({ studyDate, isToday }: { studyDate: string; isToday: boolean }) {
  const prevDate = shiftDate(studyDate, -1);
  const nextDate = shiftDate(studyDate, 1);

  return (
    <div className="flex items-center gap-1" aria-label="选择学习日期">
      <Link
        href={`/today?date=${prevDate}`}
        title="前一天"
        className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:border-teal-500/40 hover:bg-white/10 hover:text-white transition-colors"
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
        <span className="sr-only">前一天</span>
      </Link>

      <form
        action="/today"
        method="get"
        className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-200 hover:border-teal-500/30 transition-colors"
      >
        <label htmlFor="today-date" className="sr-only">
          学习日期
        </label>
        <CalendarDays className="size-3.5 text-teal-400" aria-hidden="true" />
        <Input
          id="today-date"
          name="date"
          type="date"
          defaultValue={studyDate}
          className="h-6 w-auto border-none bg-transparent p-0 font-mono text-sm text-zinc-100 focus:ring-0 focus:outline-none cursor-pointer"
        />
        {isToday ? (
          <span className="rounded bg-teal-400/20 px-1.5 py-0.5 text-xs font-medium text-teal-300">
            今日
          </span>
        ) : null}
      </form>

      <Link
        href={`/today?date=${nextDate}`}
        title="后一天"
        className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:border-teal-500/40 hover:bg-white/10 hover:text-white transition-colors"
      >
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <span className="sr-only">后一天</span>
      </Link>

      {!isToday ? (
        <Link
          href="/today"
          className="ml-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-xs font-medium text-teal-300 hover:bg-teal-500/20 transition-colors"
        >
          回到今日
        </Link>
      ) : null}
    </div>
  );
}

function TodayRecommendation({
  today,
  creatingMinimumTask,
  onCreateMinimumTask,
  feedbackPending,
  feedbackNotice,
  onFeedback,
}: {
  today: ActionCenterTodayDto;
  creatingMinimumTask: boolean;
  onCreateMinimumTask: () => Promise<void>;
  feedbackPending: boolean;
  feedbackNotice: string | null;
  onFeedback: (feedback: "HELPFUL" | "NOT_NOW") => Promise<void>;
}) {
  return (
    <Card variant="accent" padding="md" className="relative overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-teal-300">推荐行动</span>
          <CompactBadge variant="glow" size="xs">今日首要</CompactBadge>
        </div>
        {today.workspace?.name ? <span className="truncate text-xs text-zinc-400">{today.workspace.name}</span> : null}
      </div>

      <div className="mt-2.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          {today.recommendation ? (
            <>
              <h2 className="truncate text-lg sm:text-xl font-bold tracking-tight text-white">
                {today.recommendation.title}
              </h2>
              <p className="truncate text-sm leading-relaxed text-zinc-200">
                {today.recommendation.reason}
              </p>
              {today.isToday ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span>这项推荐是否适合现在？</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="!h-7 !px-2"
                    disabled={feedbackPending}
                    title="保留这项推荐"
                    aria-label="这项推荐适合现在"
                    onClick={() => void onFeedback("HELPFUL")}
                  >
                    <ThumbsUp className="size-3.5" aria-hidden="true" />
                    适合
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="!h-7 !px-2"
                    disabled={feedbackPending}
                    title="暂时跳过并查看下一项"
                    aria-label="暂时跳过这项推荐"
                    onClick={() => void onFeedback("NOT_NOW")}
                  >
                    <RefreshCw className={`size-3.5 ${feedbackPending ? "animate-spin" : ""}`} aria-hidden="true" />
                    换一项
                  </Button>
                  {feedbackNotice ? <span className="text-teal-300" role="status">{feedbackNotice}</span> : null}
                </div>
              ) : null}
              {today.recommendation.softDependencyHint ? (
                <div className="mt-1 flex items-center gap-1.5 rounded border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-xs text-amber-200">
                  <AlertCircle className="size-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                  <span className="truncate">{today.recommendation.softDependencyHint}</span>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-zinc-400">暂无推荐行动。可以立即创建今天的最小任务开启专注。</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={withTodayReturnTo(today.primaryActionHref)}
            className={buttonClassName({
              variant: "primary",
              size: "sm",
              className:
                "shadow-[0_0_20px_rgba(45,212,191,0.35)] active:scale-[0.98] !h-9 !px-4 text-sm font-semibold",
            })}
          >
            {today.primaryActionLabel}
          </Link>
          {today.queuesEmpty ? (
            <Button
              type="button"
              disabled={creatingMinimumTask}
              variant="secondary"
              size="sm"
              className="!h-9 !px-3 text-xs"
              onClick={() => void onCreateMinimumTask()}
            >
              {creatingMinimumTask ? "创建中..." : "直接开始 25m"}
            </Button>
          ) : null}
        </div>
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
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">后续队列</h2>
        <SegmentedControl
          value={mobileQueue}
          label="待办类型"
          options={queueTabs.map((queue) => ({
            value: queue.key,
            label: `${queue.label} ${queue.items.length}`,
          }))}
          onChange={onQueueChange}
          className="[&_[role=tab]]:h-7.5 [&_[role=tab]]:px-3 [&_[role=tab]]:text-xs"
        />
      </div>
      <QueueList
        items={activeQueue.items}
        actionLabel={activeQueue.actionLabel}
      />
    </div>
  );
}
