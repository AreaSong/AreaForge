"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/overlays";
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
  const [mobileQueue, setMobileQueue] = useState<"tasks" | "reviews" | "mistakes">("tasks");

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
          router.push(`/focus/${body.latest.id}`);
          return;
        }
        setError(body?.error ?? "无法开始计时，当前选择仍保留；请显式重试。");
        return;
      }
      if (body?.session?.id) {
        setConfirmOpen(false);
        router.push(`/focus/${body.session.id}`);
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
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold text-white">今日行动中心</h1>
        <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          尚未设置考试工作区。不展示伪造统计。
        </div>
        <Link
          href="/settings/workspace?setup=1"
          className="inline-flex h-11 items-center rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black hover:bg-teal-400"
        >
          设置考试目标
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-teal-300">{today.workspace?.name}</p>
        <h1 className="mt-1 text-3xl font-semibold text-white">今日行动中心</h1>
      </div>

      {today.statusBar ? (
        <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">
          {today.statusBar === "paused_activity"
            ? "活动已暂停，可继续当前行动。"
            : today.statusBar === "recovery_minimum"
              ? "恢复模式：先完成一个最小行动。"
              : "晚间提醒：最低行动或复盘尚未闭环。"}
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-[#101419] p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500">当前推荐</p>
        {today.recommendation ? (
          <>
            <h2 className="mt-2 text-xl font-medium text-white">{today.recommendation.title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{today.recommendation.reason}</p>
            {today.recommendation.softDependencyHint ? (
              <p className="mt-1 text-sm text-amber-200">{today.recommendation.softDependencyHint}</p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">暂无推荐。可以创建今天最小任务。</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={withTodayReviewReturnTo(today.primaryActionHref)}
            className="inline-flex h-11 items-center rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black hover:bg-teal-400"
          >
            {today.primaryActionLabel}
          </Link>
          {today.queuesEmpty ? (
            <button
              type="button"
              disabled={creatingMinimumTask}
              className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-200 hover:bg-white/5"
              onClick={() => void createMinimumTask()}
            >
              {creatingMinimumTask ? "创建中..." : "创建今天最小任务"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium text-white">科目快捷计时</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {today.subjectTimers.subjects.map((subject) => (
            <div key={subject.subjectId} className="rounded-md border border-white/10 bg-[#101419] p-3">
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
          <div className="grid gap-2 sm:grid-cols-2">
            {today.subjectTimers.groups.map((group) => (
              <div key={group.groupId} className="rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-zinc-500">
                {group.title}（分组聚合，不可直接开始）· 今日 {group.todayEffectiveMinutes} 分
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-white">三队列</h2>
          <div className="flex gap-1 md:hidden">
            {(
              [
                ["tasks", "任务"],
                ["reviews", "复习"],
                ["mistakes", "错题"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rounded-md px-2 py-1 text-xs ${mobileQueue === key ? "bg-white/10 text-white" : "text-zinc-500"}`}
                onClick={() => setMobileQueue(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <QueueCard
            title="正式任务"
            hidden={false}
            mobileHidden={mobileQueue !== "tasks"}
            items={today.queues.formalTasks}
          />
          <QueueCard
            title="笔记/资料/考纲"
            hidden={false}
            mobileHidden={mobileQueue !== "reviews"}
            items={today.queues.noteResourceSyllabusReviews}
          />
          <QueueCard
            title="错题复习"
            hidden={false}
            mobileHidden={mobileQueue !== "mistakes"}
            items={today.queues.mistakeReviews}
          />
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
    </section>
  );
}

function withTodayReviewReturnTo(href: string): string {
  if (!href.startsWith("/quick-review/")) return href;
  return `${href}?returnTo=${encodeURIComponent("/today")}`;
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

function QueueCard(props: {
  title: string;
  items: Array<{ id: string; title: string; reason: string; href: string; softDependencyHint: string | null }>;
  hidden: boolean;
  mobileHidden: boolean;
}) {
  return (
    <div className={`rounded-md border border-white/10 bg-[#101419] p-3 ${props.mobileHidden ? "hidden md:block" : ""} ${props.hidden ? "hidden" : ""}`}>
      <h3 className="text-sm font-medium text-zinc-200">{props.title}</h3>
      {props.items.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">空</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {props.items.map((item) => (
            <li key={item.id} className="rounded border border-white/5 p-2">
              <p className="text-sm text-white">{item.title}</p>
              <p className="text-xs text-zinc-500">{item.reason}</p>
              {item.softDependencyHint ? <p className="text-xs text-amber-200">{item.softDependencyHint}</p> : null}
              <Link href={withTodayReviewReturnTo(item.href)} className="mt-1 inline-flex text-xs text-teal-300 hover:underline">
                开始
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
