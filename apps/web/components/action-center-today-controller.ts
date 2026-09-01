"use client";

import {
  flattenShortcutNodes,
  hasRemainingAction,
  isSameActionTarget,
} from "@/components/action-center-today-support";
import { createTask } from "@/lib/api/tasks";
import { restartRecoveryState } from "@/lib/api/recovery";
import { startStudySession } from "@/lib/api/session";
import { classifyApiFailure } from "@/lib/client/api-errors";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import {
  completeIdempotentCommand,
  getOrCreateIdempotencyKey,
} from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { ActionCenterTodayDto } from "@/lib/contracts";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

export type TodayQueueKey = "tasks" | "reviews" | "mistakes";

type ActivityBarrier = (operation: () => Promise<void>) => Promise<boolean>;

export function useActionCenterTodayController(
  today: ActionCenterTodayDto,
  withActivityBarrier: ActivityBarrier,
) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(today.subjectTimers.subjects[0]?.subjectId ?? "");
  const [goalMinutes, setGoalMinutes] = useState("");
  const [shortcutTaskId, setShortcutTaskId] = useState("");
  const [shortcutNodeId, setShortcutNodeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restartingRecovery, setRestartingRecovery] = useState(false);
  const [startingShortcut, setStartingShortcut] = useState(false);
  const [creatingMinimumTask, setCreatingMinimumTask] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mobileQueue, setMobileQueue] = useState<TodayQueueKey>(() => getInitialQueue(today));

  const shortcutTasks = useMemo(
    () => today.shortcutOptions.tasks.filter((task) => task.subjectId === subjectId),
    [subjectId, today.shortcutOptions.tasks],
  );
  const shortcutNodes = useMemo(
    () => flattenShortcutNodes(today.shortcutOptions.syllabusNodes)
      .filter((node) => node.subjectId === subjectId),
    [subjectId, today.shortcutOptions.syllabusNodes],
  );
  const queueTabs = useMemo(() => getQueueTabs(today), [today]);
  const activeQueue = queueTabs.find((queue) => queue.key === mobileQueue) ?? queueTabs[0]!;

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
    const payload = {
      subjectId,
      taskId: shortcutTaskId || undefined,
      syllabusNodeId: shortcutNodeId || null,
      goalMinutes: goalMinutes ? Number(goalMinutes) : null,
      startSource: "SUBJECT_SHORTCUT" as const,
    };
    const commandScope = "action-center:focus-start";
    try {
      const result = await startStudySession({
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "study-session-start", payload),
        ...payload,
      }, getClientDeviceHeaders());
      const body = result.body;
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
        if (failure.kind === "conflict" && body?.latest?.id) {
          completeIdempotentCommand(commandScope);
          router.push("/focus?returnTo=%2Ftoday");
          return;
        }
        setError(failure.code ?? "无法开始计时，当前选择仍保留；请显式重试。");
        return;
      }
      if (!body?.session?.id) {
        setError("未返回 session，当前选择仍保留；请显式重试。");
        return;
      }
      completeIdempotentCommand(commandScope);
      setConfirmOpen(false);
      router.push("/focus?returnTo=%2Ftoday");
    } catch {
      setError("网络不可用，当前计时选择仍保留；恢复网络后请显式重试。");
    } finally {
      setStartingShortcut(false);
    }
  }

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
      priority: "high" as const,
    };
    const commandScope = "action-center:create-minimum-task";
    try {
      const result = await createTask({
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "task-create", payload),
        ...payload,
      }, { headers: getClientDeviceHeaders() });
      const body = result.body;
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
        setError(failure.code ?? "无法创建最小任务；请显式重试。");
        return;
      }
      if (!body?.task?.id) {
        setError("任务已创建，但服务端未返回可启动的任务标识。");
        return;
      }
      const startPayload = { taskId: body.task.id, goalMinutes: null, startSource: "TASK" as const };
      const startResult = await startStudySession({
        idempotencyKey: getOrCreateIdempotencyKey(`${commandScope}:start`, "study-session-start", startPayload),
        ...startPayload,
      }, getClientDeviceHeaders());
      const startBody = startResult.body;
      let sessionId = startBody?.session?.id;
      const startFailure = startResult.ok ? null : classifyApiFailure(startResult);
      if (startFailure?.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
      if (startFailure?.kind === "conflict") sessionId = startBody?.latest?.id;
      if (!startResult.ok && !sessionId) {
        setError(startFailure?.code ?? "最小任务已创建，但启动失败；再次点击会复用同一任务并显式重试。");
        return;
      }
      if (!sessionId) {
        setError("最小任务已创建，但服务端未返回可继续的活动。");
        return;
      }
      completeIdempotentCommand(commandScope);
      startTransition(() => router.refresh());
      router.push("/focus?returnTo=%2Ftoday");
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
      const result = await restartRecoveryState(today.recovery.id, today.recovery.revision);
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        setError(failure.code ?? "无法重新开始恢复");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，未重新开始恢复。");
    } finally {
      setRestartingRecovery(false);
    }
  }

  function chooseSubject(nextSubjectId: string) {
    setSubjectId(nextSubjectId);
    setShortcutTaskId("");
    setShortcutNodeId("");
  }

  function chooseTask(taskId: string) {
    setShortcutTaskId(taskId);
    const task = shortcutTasks.find((option) => option.id === taskId);
    setShortcutNodeId(task?.syllabusNodeId ?? "");
  }

  return {
    state: {
      confirmOpen,
      subjectId,
      goalMinutes,
      shortcutTaskId,
      shortcutNodeId,
      error,
      restartingRecovery,
      startingShortcut,
      creatingMinimumTask,
      pending,
      mobileQueue,
      shortcutTasks,
      shortcutNodes,
      queueTabs,
      activeQueue,
    },
    actions: {
      setConfirmOpen,
      setGoalMinutes,
      setShortcutNodeId,
      setMobileQueue,
      chooseSubject,
      chooseTask,
      startShortcut,
      createMinimumTask,
      restartExpiredRecovery,
    },
  };
}

export type ActionCenterTodayController = ReturnType<typeof useActionCenterTodayController>;

function getInitialQueue(today: ActionCenterTodayDto): TodayQueueKey {
  if (hasRemainingAction(today.queues.formalTasks, today.primaryActionHref)) return "tasks";
  if (hasRemainingAction(today.queues.noteResourceSyllabusReviews, today.primaryActionHref)) return "reviews";
  if (hasRemainingAction(today.queues.mistakeReviews, today.primaryActionHref)) return "mistakes";
  return "tasks";
}

function getQueueTabs(today: ActionCenterTodayDto) {
  return [
    { key: "tasks" as const, label: "任务", items: today.queues.formalTasks, actionLabel: "查看任务" },
    { key: "reviews" as const, label: "复习", items: today.queues.noteResourceSyllabusReviews, actionLabel: "开始复习" },
    { key: "mistakes" as const, label: "错题", items: today.queues.mistakeReviews, actionLabel: "开始复习" },
  ].map((queue) => ({
    ...queue,
    items: queue.items.filter((item) => !isSameActionTarget(item.href, today.primaryActionHref)),
  }));
}
