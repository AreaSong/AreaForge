"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import { Link2, Pencil, Play, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DetailHeading } from "@/components/detail-heading";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import { BackToListLink } from "@/components/list-return-context";
import { TaskDetailEditor } from "@/components/task-detail-editor";
import { ReviewBridgeTaskActions } from "@/components/review-bridge-task-actions";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import {
  createTaskDependency,
  deleteTaskDependency,
  recoverTask as recoverTaskApi,
  updateTaskDependency,
} from "@/lib/api/tasks";
import { startStudySession as startStudySessionApi } from "@/lib/api/session";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { formatDateMedium as formatDate, formatTaskStatus } from "@/lib/formatters";
import type { PlanMilestoneDto } from "@/lib/contracts";
import type { TaskDependencyDto } from "@/lib/contracts";
import type { StudyTaskDetailDto, TaskDependencyCandidateDto } from "@/lib/contracts";
import type { StagePlanDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/contracts";
import type { KnowledgePointDto } from "@/lib/contracts";
import {
  dependencyErrorLabel,
  DependencyList,
  priorityLabel,
  RelationItem,
  startErrorLabel,
  taskSourceLabel,
  TaskHistory,
  TaskLink,
} from "@/components/task-detail-client-sections";

export function TaskDetailClient(props: {
  detail: StudyTaskDetailDto;
  dependencies: TaskDependencyDto[];
  subjects: SubjectDto[];
  syllabusNodes: SyllabusOptionNodeDto[];
  milestones: PlanMilestoneDto[];
  stagePlans: StagePlanDto[];
  knowledgePoints: KnowledgePointDto[];
  dependencyCandidates: TaskDependencyCandidateDto[];
  embedded?: boolean;
  closeHref?: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const { withActivityBarrier } = useQuickReviewActivityGuard();
  const task = props.detail.task;
  const sourceHref = props.embedded && props.closeHref
    ? props.closeHref
    : props.returnTo ?? "/roadmap/allocation";
  const focusReturnTo = sourceHref;
  const terminal = task.status === "done" || task.status === "skipped";
  const editable = !props.detail.readOnly && !terminal && !props.detail.subjectArchived;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [candidateType, setCandidateType] = useState<"SOFT" | "HARD">("SOFT");
  const incomingDependencies = useMemo(
    () => props.dependencies.filter((dependency) => dependency.successorId === task.id),
    [props.dependencies, task.id],
  );
  const outgoingDependencies = useMemo(
    () => props.dependencies.filter((dependency) => dependency.predecessorId === task.id),
    [props.dependencies, task.id],
  );
  const incomingIds = new Set(incomingDependencies.map((dependency) => dependency.predecessorId));
  const availableCandidates = props.dependencyCandidates.filter((candidate) => !incomingIds.has(candidate.id));

  async function startTask() {
    await withActivityBarrier(runStartTask);
  }

  async function runStartTask() {
    setPendingAction("start");
    setError(null);
    setNotice(null);
    const payload = { taskId: task.id, subjectId: task.subjectId, startSource: "TASK" as const };
    const commandScope = `task-start:${task.id}`;
    try {
      const result = await startStudySessionApi({
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "study-session-start", payload),
        ...payload,
      }, getClientDeviceHeaders());
      const body = result.body;
      if (isUnauthorized(result)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        if (isConflict(result) && body?.latest?.id) {
          completeIdempotentCommand(commandScope);
          router.push(`/focus?returnTo=${encodeURIComponent(focusReturnTo)}`);
          return;
        }
        setError(startErrorLabel(body?.error));
        return;
      }
      if (body?.session?.id) {
        completeIdempotentCommand(commandScope);
        router.push(`/focus?returnTo=${encodeURIComponent(focusReturnTo)}`);
      }
    } catch {
      setError("网络不可用，未确认是否已开始；请刷新活动状态后再操作。");
    } finally {
      setPendingAction(null);
    }
  }

  async function recoverTask() {
    setPendingAction("recover");
    setError(null);
    setNotice(null);
    try {
      const result = await recoverTaskApi(task.id, { reviewText: "从任务详情恢复到今天" });
      const body = result.body;
      if (isUnauthorized(result)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        setError(body?.error ?? "恢复任务失败，请刷新后重试。");
        return;
      }
      setNotice("任务已恢复到今天，可以开始专注。");
      router.refresh();
    } catch {
      setError("网络不可用，任务状态未确认；请刷新后再操作。");
    } finally {
      setPendingAction(null);
    }
  }

  async function createDependency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidateId) return;
    await mutateDependency(
      "dependency-create",
      `/api/tasks/${task.id}/dependencies`,
      "POST",
      { predecessorId: candidateId, type: candidateType },
      "前置任务已关联",
    );
    setCandidateId("");
  }

  async function mutateDependency(
    action: string,
    pathOrBody: string | unknown,
    method: "POST" | "PATCH" | "DELETE",
    payload: unknown,
    successMessage: string,
  ) {
    setPendingAction(action);
    setError(null);
    setNotice(null);
    try {
      const result = typeof pathOrBody === "string"
        ? method === "POST"
          ? await createTaskDependency(task.id, payload)
          : method === "PATCH"
            ? await updateTaskDependency(task.id, pathOrBody.split("/").pop()!, payload)
            : await deleteTaskDependency(task.id, pathOrBody.split("/").pop()!, payload)
        : await createTaskDependency(task.id, pathOrBody);
      const body = result.body;
      if (isUnauthorized(result)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        setError(dependencyErrorLabel(body?.error));
        return;
      }
      setNotice(successMessage);
      router.refresh();
    } catch {
      setError("网络不可用，依赖变更未确认；请刷新后再操作。");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="space-y-6 pb-4">
      <div className="space-y-3">
        {props.embedded && props.closeHref ? (
          <BackToListLink fallbackHref={props.closeHref} className="inline-flex h-9 items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" aria-hidden="true" />
            关闭详情
          </BackToListLink>
        ) : (
          <BackToListLink fallbackHref={sourceHref} className="text-sm text-zinc-400 hover:text-zinc-200">
            {taskSourceLabel(sourceHref)}
          </BackToListLink>
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <DetailHeading level={props.embedded ? 2 : 1} className={`break-words font-semibold text-white ${props.embedded ? "text-2xl" : "text-3xl"}`}>{task.title}</DetailHeading>
            <p className="text-sm text-zinc-400">
              {task.subjectName} · {formatTaskStatus(task.status)} · 预计 {task.estimatedMinutes} 分钟 · 已投入 {task.actualMinutes} 分钟
            </p>
          </div>
          {editable ? (
            <div className="flex w-full shrink-0 gap-2 sm:w-auto">
              {task.status === "deferred" ? (
                <Button
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:opacity-50 sm:flex-none"
                  disabled={pendingAction !== null}
                  onClick={() => void recoverTask()}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  恢复到今天
                </Button>
              ) : (
                <Button
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:opacity-50 sm:flex-none"
                  disabled={pendingAction !== null}
                  onClick={() => void startTask()}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {task.status === "in_progress" ? "继续专注" : "开始专注"}
                </Button>
              )}
              {!editing ? (
                <Button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  编辑
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {props.detail.readOnly || terminal || props.detail.subjectArchived ? (
          <p role="status" className="border-l-2 border-zinc-500 pl-3 text-sm text-zinc-400">
            {props.detail.readOnly
              ? `“${props.detail.workspaceName}”已归档，本页只读保留历史；不会进入当前推荐或写事务。`
              : props.detail.subjectArchived
                ? "所属科目已归档，本页只读保留历史。"
                : "任务已进入终态，本页只读保留关联与行动历史。"}
          </p>
        ) : null}
      </div>

      {editing ? (
        <TaskDetailEditor
          snapshot={props.detail.updateSnapshot}
          subjects={props.subjects}
          syllabusNodes={props.syllabusNodes}
          milestones={props.milestones}
          stagePlans={props.stagePlans}
          knowledgePoints={props.knowledgePoints}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice("任务已保存");
            router.refresh();
          }}
        />
      ) : null}

      {editable && props.detail.reviewSchedule ? (
        <ReviewBridgeTaskActions
          taskId={task.id}
          estimatedMinutes={task.estimatedMinutes}
          reviewSchedule={props.detail.reviewSchedule}
        />
      ) : null}

      <section aria-labelledby="task-relations-heading" className="space-y-3 border-t border-white/10 pt-5">
        <h2 id="task-relations-heading" className="text-lg font-semibold text-white">关联</h2>
        <dl className="af-content-grid-two grid gap-3 text-sm">
          <RelationItem label="主考纲节点">
            {task.syllabusNodeId ? (
              props.detail.readOnly
                ? task.syllabusNodeTitle
                : <Link className="text-teal-300 hover:underline" href={withReturnTo(`/knowledge/syllabi/${task.syllabusNodeId}`, sourceHref)}>{task.syllabusNodeTitle}</Link>
            ) : "未关联"}
          </RelationItem>
          <RelationItem label="里程碑">{props.detail.planMilestone?.title ?? "未关联"}</RelationItem>
          <RelationItem label="所属阶段">
            {task.stagePlanNames.length > 0 ? task.stagePlanNames.join("、") : "未关联"}
          </RelationItem>
          <RelationItem label="计划日期">{formatDate(task.plannedDate)}</RelationItem>
          <RelationItem label="优先级">{priorityLabel(task.priority)}</RelationItem>
          <RelationItem label="父任务">
            {props.detail.parentTask ? <TaskLink task={props.detail.parentTask} returnTo={sourceHref} /> : "无"}
          </RelationItem>
          <RelationItem label="复习桥接">
            {props.detail.reviewSchedule ? (
              props.detail.readOnly
                ? `${props.detail.reviewSchedule.status} · ${props.detail.reviewSchedule.dueDate ? formatDate(props.detail.reviewSchedule.dueDate) : "未排期"}`
                : <Link className="text-teal-300 hover:underline" href={withReturnTo(`/knowledge/reviews/${props.detail.reviewSchedule.id}`, sourceHref)}>
                    {props.detail.reviewSchedule.status} · {props.detail.reviewSchedule.dueDate ? formatDate(props.detail.reviewSchedule.dueDate) : "未排期"}
                  </Link>
            ) : "无"}
          </RelationItem>
        </dl>
        <div className="space-y-2 text-sm">
          <p className="text-zinc-500">相关考纲节点</p>
          {props.detail.relatedSyllabusNodes.length ? (
            <ul className="flex flex-wrap gap-2">
              {props.detail.relatedSyllabusNodes.map((node) => (
                <li key={node.id}>
                  {props.detail.readOnly
                    ? <span className="inline-flex rounded-md border border-white/10 px-2 py-1 text-zinc-300">{node.title}{node.archivedAt ? "（已归档）" : ""}</span>
                    : <Link className="inline-flex rounded-md border border-white/10 px-2 py-1 text-zinc-300 hover:text-teal-200" href={withReturnTo(`/knowledge/syllabi/${node.id}`, sourceHref)}>
                        {node.title}{node.archivedAt ? "（已归档）" : ""}
                      </Link>}
                </li>
              ))}
            </ul>
          ) : <p className="text-zinc-400">未关联</p>}
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-zinc-500">关联知识点</p>
          {props.detail.knowledgePoints.length ? (
            <ul className="flex flex-wrap gap-2">
              {props.detail.knowledgePoints.map((point) => (
                <li key={point.id}>
                  <Link className="inline-flex rounded-md border border-white/10 px-2 py-1 text-zinc-300 hover:text-teal-200" href={withReturnTo(`/knowledge/points/${point.id}`, sourceHref)}>
                    {point.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-zinc-400">未关联</p>}
        </div>
        {props.detail.childTasks.length ? (
          <div className="space-y-2 text-sm">
            <p className="text-zinc-500">拆分子任务</p>
            <ul className="space-y-1">{props.detail.childTasks.map((child) => <li key={child.id}><TaskLink task={child} returnTo={sourceHref} /></li>)}</ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="task-dependencies-heading" className="space-y-4 border-t border-white/10 pt-5">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 id="task-dependencies-heading" className="text-lg font-semibold text-white">任务依赖</h2>
        </div>
        <DependencyList
          label="前置任务"
          dependencies={incomingDependencies}
          taskId={task.id}
          returnTo={sourceHref}
          editable={editable}
          pendingAction={pendingAction}
          onMutate={mutateDependency}
        />
        <DependencyList
          label="后继任务"
          dependencies={outgoingDependencies}
          taskId={task.id}
          returnTo={sourceHref}
          editable={editable}
          pendingAction={pendingAction}
          onMutate={mutateDependency}
        />
        {editable ? (
          <form className="af-form-action-grid grid gap-2" onSubmit={createDependency}>
            <label className="sr-only" htmlFor="task-dependency-candidate">新增前置任务</label>
            <Select
              id="task-dependency-candidate"
              className="h-11 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-white"
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
            >
              <option value="">选择前置任务</option>
              {availableCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.subjectName} · {candidate.title} · {formatTaskStatus(candidate.status)}</option>
              ))}
            </Select>
            <Select
              aria-label="依赖类型"
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-white"
              value={candidateType}
              onChange={(event) => setCandidateType(event.target.value as "SOFT" | "HARD")}
            >
              <option value="SOFT">软依赖</option>
              <option value="HARD">硬依赖</option>
            </Select>
            <Button
              type="submit"
              className="h-11 rounded-md border border-teal-300/30 px-3 text-sm text-teal-200 disabled:opacity-50"
              disabled={!candidateId || pendingAction !== null}
            >
              关联
            </Button>
          </form>
        ) : null}
      </section>

      <TaskHistory detail={props.detail} />

      {task.reviewText ? (
        <section className="space-y-2 border-t border-white/10 pt-5">
          <h2 className="text-lg font-semibold text-white">任务复盘</h2>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">{task.reviewText}</p>
        </section>
      ) : null}

      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-teal-200">{notice}</p> : null}

    </section>
  );
}
