"use client";

import { TimerReset } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/overlays";
import { Alert } from "@/components/ui/feedback";
import { buttonClassName } from "@/components/ui/button";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { ActionCenterTodayDto } from "@/lib/study/action-center-service";

export function ActionCenterToday({ initial }: { initial: ActionCenterTodayDto }) {
  const router = useRouter();
  const { withActivityBarrier } = useQuickReviewActivityGuard();
  const today = initial;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(today.subjectTimers.subjects[0]?.subjectId ?? "");
  const [goalMinutes, setGoalMinutes] = useState("25");
  const [shortcutTaskId, setShortcutTaskId] = useState("");
  const [shortcutNodeId, setShortcutNodeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restartingRecovery, setRestartingRecovery] = useState(false);
  const [startingShortcut, setStartingShortcut] = useState(false);
  const [creatingMinimumTask, setCreatingMinimumTask] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mobileQueue, setMobileQueue] = useState<"tasks" | "reviews" | "mistakes">(() =>
    hasRemainingAction(today.queues.formalTasks, today.primaryActionHref)
      ? "tasks"
      : hasRemainingAction(today.queues.noteResourceSyllabusReviews, today.primaryActionHref)
        ? "reviews"
        : hasRemainingAction(today.queues.mistakeReviews, today.primaryActionHref)
          ? "mistakes"
          : "tasks",
  );

  async function startShortcut() {
    if (startingShortcut) return;
    setError(null);
    if (!subjectId) {
      setError("请选择科目");
      return;
    }
    await withActivityBarrier(runStartShortcut);
  }

  async function runStartShortcut() {
    setStartingShortcut(true);
    try {
      const response = await fetch("/api/study-sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId,
          taskId: shortcutTaskId || undefined,
          syllabusNodeId: shortcutNodeId || null,
          goalMinutes: goalMinutes ? Number(goalMinutes) : null,
          startSource: "SUBJECT_SHORTCUT",
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { session?: { id: string }; error?: string; latest?: { id?: string } }
        | null;
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok) {
        if (response.status === 409 && body?.latest?.id) {
          router.push(`/focus/${body.latest.id}?returnTo=%2Ftoday`);
          return;
        }
        setError(body?.error ?? "无法开始计时，当前选择仍保留；请显式重试。");
        return;
      }
      if (body?.session?.id) {
        setConfirmOpen(false);
        router.push(`/focus/${body.session.id}?returnTo=%2Ftoday`);
        return;
      }
      setError("未返回 session，当前选择仍保留；请显式重试。");
    } catch {
      setError("网络不可用，当前计时选择仍保留；恢复网络后请显式重试。");
    } finally {
      setStartingShortcut(false);
    }
  }

  const shortcutTasks = today.shortcutOptions.tasks.filter((task) => task.subjectId === subjectId);
  const shortcutNodes = flattenShortcutNodes(today.shortcutOptions.syllabusNodes)
    .filter((node) => node.subjectId === subjectId);

  async function createMinimumTask() {
    if (creatingMinimumTask) return;
    setError(null);
    if (!subjectId) {
      setError("请先选择科目");
      return;
    }
    await withActivityBarrier(runCreateMinimumTask);
  }

  async function runCreateMinimumTask() {
    setCreatingMinimumTask(true);
    const payload = {
      subjectId,
      title: "今天最小任务",
      estimatedMinutes: 25,
      type: "study",
      priority: "high",
    };
    const commandScope = "action-center:create-minimum-task";
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "task-create", payload),
          ...payload,
        }),
      });
      const body = (await response.json().catch(() => null)) as { task?: { id: string }; error?: string } | null;
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok) {
        setError(body?.error ?? "无法创建最小任务；请显式重试。");
        return;
      }
      if (!body?.task?.id) {
        setError("任务已创建，但服务端未返回可启动的任务标识。");
        return;
      }
      const startResponse = await fetch("/api/study-sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: body.task.id, goalMinutes: 25, startSource: "TASK" }),
      });
      const startBody = await startResponse.json().catch(() => null) as {
        session?: { id?: string };
        latest?: { id?: string };
        error?: string;
      } | null;
      if (startResponse.status === 401) return redirectToLoginWithCurrentLocation();
      const sessionId = startBody?.session?.id ?? (startResponse.status === 409 ? startBody?.latest?.id : undefined);
      if (!startResponse.ok && !sessionId) {
        setError(startBody?.error ?? "最小任务已创建，但启动失败；再次点击会复用同一任务并显式重试。");
        return;
      }
      if (!sessionId) {
        setError("最小任务已创建，但服务端未返回可继续的活动。");
        return;
      }
      completeIdempotentCommand(commandScope);
      startTransition(() => router.refresh());
      router.push(`/focus/${sessionId}?returnTo=%2Ftoday`);
    } catch {
      setError("网络不可用，未创建最小任务；恢复网络后请显式重试。");
    } finally {
      setCreatingMinimumTask(false);
    }
  }

  async function restartExpiredRecovery() {
    if (!today.recovery?.restartAvailable) return;
    setError(null);
    setRestartingRecovery(true);
    try {
      const response = await fetch(`/api/recovery/${today.recovery.id}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: today.recovery.revision }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "无法重新开始恢复");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，未重新开始恢复。");
    } finally {
      setRestartingRecovery(false);
    }
  }

  if (today.setupRequired) {
    return (
      <PageFrame variant="content-focus">
        <PageHeader title="今日" eyebrow="行动中心" description="先设置考试目标，AreaForge 才能生成真实的学习行动。" />
        <Alert tone="warning">
          尚未设置考试工作区。不展示伪造统计。
        </Alert>
        <Link
          href="/settings/workspace?setup=1"
          className={buttonClassName({ variant: "primary", size: "lg", className: "w-fit" })}
        >
          设置考试目标
        </Link>
      </PageFrame>
    );
  }

  const queueTabs = [
    { key: "tasks" as const, label: "任务", items: today.queues.formalTasks, actionLabel: "查看任务" },
    { key: "reviews" as const, label: "复习", items: today.queues.noteResourceSyllabusReviews, actionLabel: "开始复习" },
    { key: "mistakes" as const, label: "错题", items: today.queues.mistakeReviews, actionLabel: "开始复习" },
  ].map((queue) => ({
    ...queue,
    items: queue.items.filter((item) => !isSameActionTarget(item.href, today.primaryActionHref)),
  }));
  const activeQueue = queueTabs.find((queue) => queue.key === mobileQueue) ?? queueTabs[0]!;

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader title="今日" eyebrow="行动中心" description={today.workspace?.name} />

      {today.statusBar ? (
        <Alert tone={today.statusBar === "recovery_minimum" ? "warning" : "info"}>
          {today.statusBar === "paused_activity"
            ? "活动已暂停，可继续当前行动。"
            : today.statusBar === "recovery_minimum"
              ? "恢复模式：先完成一个最小行动。"
              : "晚间提醒：最低行动或复盘尚未闭环。"}
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <div className="min-w-0 space-y-6">
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
              <Link
                href={withTodayReturnTo(today.primaryActionHref)}
                className={buttonClassName({ variant: "primary", size: "lg" })}
              >
                {today.primaryActionLabel}
              </Link>
              {today.queuesEmpty ? (
                <button
                  type="button"
                  disabled={creatingMinimumTask}
                  className={buttonClassName({ variant: "secondary", size: "lg" })}
                  onClick={() => void createMinimumTask()}
                >
                  {creatingMinimumTask ? "创建并启动中..." : "直接开始 25 分钟"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-medium text-white">后续队列</h2>
              <div className="flex rounded-md border border-white/10 p-1" role="tablist" aria-label="待办类型">
                {queueTabs.map((queue) => (
                  <button
                    key={queue.key}
                    type="button"
                    role="tab"
                    aria-selected={mobileQueue === queue.key}
                    className={`h-8 rounded px-3 text-xs ${mobileQueue === queue.key ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200"}`}
                    onClick={() => setMobileQueue(queue.key)}
                  >
                    {queue.label} {queue.items.length}
                  </button>
                ))}
              </div>
            </div>
            <QueueList items={activeQueue.items} actionLabel={activeQueue.actionLabel} />
          </div>
        </div>

        <div className="space-y-5 border-t border-white/10 pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
        <section aria-labelledby="today-summary-heading">
          <SectionHeader title="今日完成" />
          <dl className="mt-3 grid grid-cols-3 divide-x divide-white/10 border-y border-white/10 py-3">
            <TodayMetric label="有效学习" value={`${today.checkIn?.effectiveMinutes ?? 0} 分`} />
            <TodayMetric label="任务完成" value={`${Math.round((today.checkIn?.taskCompletionRate ?? 0) * 100)}%`} />
            <TodayMetric label="晚间复盘" value={today.checkIn?.reviewSubmitted ? "已完成" : "未完成"} />
          </dl>
        </section>
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
                  <div>
                    <p className="font-medium text-white">{subject.title}</p>
                    {subject.groupTitle ? <p className="text-xs text-zinc-500">{subject.groupTitle}</p> : null}
                    <p className="mt-2 text-xs text-zinc-400">
                      今日 {subject.todayEffectiveMinutes} 分 · 近 7 日 {subject.last7EffectiveMinutes} 分
                    </p>
                    {subject.contextSummary ? <p className="mt-1 text-xs text-zinc-500">{subject.contextSummary}</p> : null}
                  </div>
                  <button
                    type="button"
                    disabled={!subject.canStart}
                    className="rounded-md border border-teal-400/40 px-3 py-1.5 text-xs text-teal-200 disabled:opacity-40"
                    onClick={() => {
                      setSubjectId(subject.subjectId);
                      setConfirmOpen(true);
                    }}
                  >
                    开始
                  </button>
                </div>
              </div>
            ))}
          </div>
          {today.subjectTimers.groups.length > 0 ? (
            <div className="divide-y divide-white/10 border-t border-white/10">
              {today.subjectTimers.groups.map((group) => (
                <div key={group.groupId} className="py-2 text-xs text-zinc-500">
                  {group.title}合计 · 今日 {group.todayEffectiveMinutes} 分
                </div>
              ))}
            </div>
          ) : null}
        </details>
        </div>
      </div>

      {today.recovery ? (
        <details className="rounded-md border border-white/10 bg-[#101419] p-3 text-sm" open={today.recovery.effectiveStatus === "EXPIRED"}>
          <summary className="cursor-pointer text-zinc-200">查看完整计划与恢复详情</summary>
          <p className="mt-2 text-zinc-400">
            阶段 {today.recovery.currentStage} · 目标 {today.recovery.targetMinutes} 分钟 · {today.recovery.effectiveReason}
          </p>
          {today.recovery.effectiveStatus === "EXPIRED" ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-amber-100" role="status">
              <p>恢复窗口已到期（旧记录 r{today.recovery.revision}），可重新开始新的三阶恢复。</p>
              <button
                type="button"
                disabled={pending || restartingRecovery}
                className="h-10 rounded-md border border-amber-200/40 px-3 text-sm disabled:opacity-60"
                onClick={() => void restartExpiredRecovery()}
              >
                {restartingRecovery || pending ? "重新开始中..." : "重新开始恢复"}
              </button>
            </div>
          ) : null}
          <Link href="/today/plan" className="mt-2 inline-flex text-teal-300 hover:underline">
            打开计划
          </Link>
        </details>
      ) : null}

      {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}

      <Modal open={confirmOpen} title="确认科目快捷计时" onClose={() => setConfirmOpen(false)}>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-zinc-400">科目</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={subjectId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setShortcutTaskId("");
                setShortcutNodeId("");
              }}
            >
              {today.subjectTimers.subjects.map((subject) => (
                <option key={subject.subjectId} value={subject.subjectId}>
                  {subject.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-400">任务（可选）</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={shortcutTaskId}
              onChange={(event) => {
                const taskId = event.target.value;
                setShortcutTaskId(taskId);
                const task = shortcutTasks.find((option) => option.id === taskId);
                setShortcutNodeId(task?.syllabusNodeId ?? "");
              }}
            >
              <option value="">不关联任务</option>
              {shortcutTasks.map((task) => (
                <option key={task.id} value={task.id} disabled={Boolean(task.disabledReason)}>
                  {task.title}{task.disabledReason ? `（${task.disabledReason}）` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-400">主考纲节点（可选）</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={shortcutNodeId}
              onChange={(event) => setShortcutNodeId(event.target.value)}
            >
              <option value="">不关联主节点</option>
              {shortcutNodes.map((node) => (
                <option key={node.id} value={node.id}>{`${"　".repeat(node.depth)}${node.title}`}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-400">目标时长（分钟，可选）</span>
            <input
              type="number"
              min={5}
              max={720}
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={goalMinutes}
              onChange={(event) => setGoalMinutes(event.target.value)}
            />
          </label>
          <p className="text-xs text-zinc-500">到点只提醒，不自动结束。不要求先创建任务。</p>
          <button
            type="button"
            disabled={pending || startingShortcut}
            className="h-11 w-full rounded-md bg-teal-500/90 text-sm font-medium text-black disabled:opacity-60"
            onClick={() => void startShortcut()}
          >
            {startingShortcut ? "开始中..." : "确认开始"}
          </button>
        </div>
      </Modal>
    </PageFrame>
  );
}

function withTodayReturnTo(href: string): string {
  if (
    !href.startsWith("/quick-review/")
    && !href.startsWith("/focus/")
    && !href.startsWith("/today/tasks/")
  ) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent("/today")}`;
}

function isSameActionTarget(left: string, right: string): boolean {
  return left.split("?", 1)[0] === right.split("?", 1)[0];
}

function hasRemainingAction(
  items: Array<{ href: string }>,
  primaryActionHref: string,
): boolean {
  return items.some((item) => !isSameActionTarget(item.href, primaryActionHref));
}

function flattenShortcutNodes(
  nodes: ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"],
  depth = 0,
): Array<ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"][number] & { depth: number }> {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenShortcutNodes(node.children, depth + 1),
  ]);
}

function QueueList(props: {
  items: Array<{ id: string; title: string; reason: string; href: string; softDependencyHint: string | null }>;
  actionLabel: string;
}) {
  return (
    props.items.length === 0 ? (
      <div className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-500">当前推荐之外没有待办</div>
    ) : (
      <ul className="divide-y divide-white/10 border-y border-white/10">
        {props.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-white">{item.title}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{item.reason}</p>
              {item.softDependencyHint ? <p className="mt-1 text-xs text-amber-200">{item.softDependencyHint}</p> : null}
            </div>
            <Link href={withTodayReturnTo(item.href)} className={buttonClassName({ variant: "secondary", size: "sm" })}>
              {props.actionLabel}
            </Link>
          </li>
        ))}
      </ul>
    )
  );
}

function TodayMetric(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="text-xs text-zinc-500">{props.label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-zinc-200">{props.value}</dd>
    </div>
  );
}
