"use client";

import { Link2, Pencil, Play, RotateCcw, Trash2, X } from "lucide-react";
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
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { withReturnTo } from "@/lib/navigation/batch7";
import type { PlanMilestoneDto } from "@/lib/study/plan-milestone-service";
import type { TaskDependencyDto } from "@/lib/study/task-dependency-service";
import type { StudyTaskDetailDto, TaskDependencyCandidateDto } from "@/lib/study/task-detail-service";
import type { StagePlanDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";
import type { KnowledgePointDto } from "@/lib/study/knowledge-point-service";

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
    : props.returnTo ?? "/plan";
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
      const response = await fetch("/api/study-sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
        body: JSON.stringify({ idempotencyKey: getOrCreateIdempotencyKey(commandScope, "study-session-start", payload), ...payload }),
      });
      const body = (await response.json().catch(() => null)) as
        | { session?: { id: string }; error?: string; latest?: { id?: string } }
        | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        if (response.status === 409 && body?.latest?.id) {
          completeIdempotentCommand(commandScope);
          router.push(`/focus/${body.latest.id}?returnTo=${encodeURIComponent(focusReturnTo)}`);
          return;
        }
        setError(startErrorLabel(body?.error));
        return;
      }
      if (body?.session?.id) {
        completeIdempotentCommand(commandScope);
        router.push(`/focus/${body.session.id}?returnTo=${encodeURIComponent(focusReturnTo)}`);
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
      const response = await fetch(`/api/tasks/${task.id}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewText: "从任务详情恢复到今天" }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
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
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    payload: unknown,
    successMessage: string,
  ) {
    setPendingAction(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
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
          <Link href={props.closeHref} className="inline-flex h-9 items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
            <X className="h-4 w-4" aria-hidden="true" />
            关闭详情
          </Link>
        ) : (
          <BackToListLink fallbackHref={sourceHref} className="text-sm text-zinc-400 hover:text-zinc-200">
            {taskSourceLabel(sourceHref)}
          </BackToListLink>
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <DetailHeading level={props.embedded ? 2 : 1} className={`break-words font-semibold text-white ${props.embedded ? "text-2xl" : "text-3xl"}`}>{task.title}</DetailHeading>
            <p className="text-sm text-zinc-400">
              {task.subjectName} · {taskStatusLabel(task.status)} · 预计 {task.estimatedMinutes} 分钟 · 已投入 {task.actualMinutes} 分钟
            </p>
          </div>
          {editable ? (
            <div className="flex w-full shrink-0 gap-2 sm:w-auto">
              {task.status === "deferred" ? (
                <button
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:opacity-50 sm:flex-none"
                  disabled={pendingAction !== null}
                  onClick={() => void recoverTask()}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  恢复到今天
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:opacity-50 sm:flex-none"
                  disabled={pendingAction !== null}
                  onClick={() => void startTask()}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {task.status === "in_progress" ? "继续专注" : "开始专注"}
                </button>
              )}
              {!editing ? (
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  编辑
                </button>
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
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <RelationItem label="主考纲节点">
            {task.syllabusNodeId ? (
              props.detail.readOnly
                ? task.syllabusNodeTitle
                : <Link className="text-teal-300 hover:underline" href={withReturnTo(`/knowledge/syllabus/${task.syllabusNodeId}`, sourceHref)}>{task.syllabusNodeTitle}</Link>
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
                    : <Link className="inline-flex rounded-md border border-white/10 px-2 py-1 text-zinc-300 hover:text-teal-200" href={withReturnTo(`/knowledge/syllabus/${node.id}`, sourceHref)}>
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
          <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]" onSubmit={createDependency}>
            <label className="sr-only" htmlFor="task-dependency-candidate">新增前置任务</label>
            <select
              id="task-dependency-candidate"
              className="h-11 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-white"
              value={candidateId}
              onChange={(event) => setCandidateId(event.target.value)}
            >
              <option value="">选择前置任务</option>
              {availableCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.subjectName} · {candidate.title} · {taskStatusLabel(candidate.status)}</option>
              ))}
            </select>
            <select
              aria-label="依赖类型"
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-white"
              value={candidateType}
              onChange={(event) => setCandidateType(event.target.value as "SOFT" | "HARD")}
            >
              <option value="SOFT">软依赖</option>
              <option value="HARD">硬依赖</option>
            </select>
            <button
              type="submit"
              className="h-11 rounded-md border border-teal-300/30 px-3 text-sm text-teal-200 disabled:opacity-50"
              disabled={!candidateId || pendingAction !== null}
            >
              关联
            </button>
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

function RelationItem(props: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-zinc-500">{props.label}</dt><dd className="mt-1 break-words text-zinc-300">{props.children}</dd></div>;
}

function TaskLink({ task, returnTo }: { task: { id: string; title: string; status: string }; returnTo: string }) {
  return <Link className="text-teal-300 hover:underline" href={withReturnTo(`/plan/tasks/${task.id}`, returnTo)}>{task.title} · {taskStatusLabel(task.status)}</Link>;
}

function DependencyList(props: {
  label: string;
  dependencies: TaskDependencyDto[];
  taskId: string;
  returnTo: string;
  editable: boolean;
  pendingAction: string | null;
  onMutate: (
    action: string,
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    payload: unknown,
    successMessage: string,
  ) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-300">{props.label}</h3>
      {props.dependencies.length ? (
        <ul className="divide-y divide-white/10 border-y border-white/10">
          {props.dependencies.map((dependency) => {
            const incoming = dependency.successorId === props.taskId;
            const linkedId = incoming ? dependency.predecessorId : dependency.successorId;
            const linkedTitle = incoming ? dependency.predecessorTitle : dependency.successorTitle;
            const linkedStatus = incoming ? dependency.predecessorStatus : dependency.successorStatus;
            return (
              <li key={dependency.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <Link className="min-w-0 break-words text-teal-300 hover:underline" href={withReturnTo(`/plan/tasks/${linkedId}`, props.returnTo)}>
                  {linkedTitle ?? `任务 ${linkedId.slice(0, 8)}`} · {taskStatusLabel(linkedStatus ?? "unknown")}
                </Link>
                <div className="flex items-center gap-2">
                  {props.editable ? (
                    <select
                      aria-label={`修改与“${linkedTitle ?? linkedId}”的依赖类型`}
                      className="h-9 rounded-md border border-white/10 bg-[#0d1117] px-2 text-xs text-white"
                      value={dependency.type}
                      disabled={props.pendingAction !== null}
                      onChange={(event) => void props.onMutate(
                        `dependency-${dependency.id}`,
                        `/api/tasks/${props.taskId}/dependencies/${dependency.id}`,
                        "PATCH",
                        { type: event.target.value, expectedRevision: dependency.revision },
                        "依赖类型已更新",
                      )}
                    >
                      <option value="SOFT">软依赖</option>
                      <option value="HARD">硬依赖</option>
                    </select>
                  ) : <span className="text-xs text-zinc-500">{dependency.type === "HARD" ? "硬依赖" : "软依赖"}</span>}
                  {props.editable ? (
                    <button
                      type="button"
                      className="grid h-9 w-9 place-items-center rounded-md border border-white/10 text-zinc-400 hover:text-red-200"
                      aria-label={`解除与“${linkedTitle ?? linkedId}”的依赖`}
                      title="解除依赖"
                      disabled={props.pendingAction !== null}
                      onClick={() => void props.onMutate(
                        `dependency-${dependency.id}`,
                        `/api/tasks/${props.taskId}/dependencies/${dependency.id}`,
                        "DELETE",
                        { expectedRevision: dependency.revision },
                        "依赖已解除",
                      )}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-zinc-500">无</p>}
    </div>
  );
}

function TaskHistory({ detail }: { detail: StudyTaskDetailDto }) {
  const returnTo = `/plan/tasks/${detail.task.id}`;
  return (
    <section aria-labelledby="task-history-heading" className="space-y-4 border-t border-white/10 pt-5">
      <h2 id="task-history-heading" className="text-lg font-semibold text-white">行动历史</h2>
      <HistoryGroup label="专注记录" empty={detail.sessions.length === 0}>
        {detail.sessions.map((session) => (
          <li key={session.id} className="py-2 text-sm text-zinc-300">
            {detail.readOnly
              ? <span>{formatDateTime(session.startedAt)}</span>
              : <Link className="text-teal-300 hover:underline" href={`/focus/${session.id}?returnTo=${encodeURIComponent(returnTo)}`}>{formatDateTime(session.startedAt)}</Link>}
            {` · ${session.status} · ${session.effectiveMinutes} 分钟`}
            {session.minimalOutput ? <p className="mt-1 break-words text-zinc-500">{session.minimalOutput}</p> : null}
          </li>
        ))}
      </HistoryGroup>
      <HistoryGroup label="状态与欠账" empty={detail.debtEvents.length === 0}>
        {detail.debtEvents.map((event) => (
          <li key={event.id} className="py-2 text-sm text-zinc-300">
            {formatDateTime(event.createdAt)} · {debtActionLabel(event.action)}
            {event.fromStatus || event.toStatus ? ` · ${event.fromStatus ?? "-"} → ${event.toStatus ?? "-"}` : ""}
            {event.reason ? <p className="mt-1 break-words text-zinc-500">{event.reason}</p> : null}
          </li>
        ))}
      </HistoryGroup>
      <HistoryGroup label="变更审计" empty={detail.auditEvents.length === 0}>
        {detail.auditEvents.map((event) => <li key={event.id} className="py-2 text-sm text-zinc-400">{formatDateTime(event.createdAt)} · {auditActionLabel(event.action)}</li>)}
      </HistoryGroup>
    </section>
  );
}

function taskSourceLabel(sourceHref: string): string {
  if (sourceHref === "/today") return "返回今日";
  if (sourceHref.startsWith("/plan/inbox")) return "返回收件箱";
  if (sourceHref.startsWith("/plan/stages")) return "返回阶段";
  if (sourceHref.startsWith("/plan")) return "返回计划";
  if (sourceHref.startsWith("/review/")) return "返回复盘";
  if (sourceHref.startsWith("/knowledge/")) return "返回知识";
  return "返回来源";
}

function HistoryGroup(props: { label: string; empty: boolean; children: React.ReactNode }) {
  return <div><h3 className="text-sm font-medium text-zinc-300">{props.label}</h3>{props.empty ? <p className="mt-2 text-sm text-zinc-500">暂无记录</p> : <ul className="mt-1 divide-y divide-white/10">{props.children}</ul>}</div>;
}

function taskStatusLabel(status: string): string {
  return ({ todo: "待开始", in_progress: "进行中", done: "已完成", skipped: "已放弃", deferred: "已延期" } as Record<string, string>)[status.toLowerCase()] ?? status;
}

function priorityLabel(priority: string): string {
  return ({ low: "低", medium: "中", high: "高", critical: "最高" } as Record<string, string>)[priority] ?? priority;
}

function debtActionLabel(action: string): string {
  return ({ complete: "完成", defer: "延期", drop: "放弃", recover: "恢复", split: "拆分", convert_review: "转复习任务", reorder_suggested: "生成重排建议", reorder_applied: "应用重排" } as Record<string, string>)[action] ?? action;
}

function auditActionLabel(action: string): string {
  return ({ STUDY_TASK_CREATED: "创建任务", STUDY_TASK_UPDATED: "编辑任务", STUDY_TASK_COMPLETED: "完成任务", STUDY_TASK_DEFERRED: "延期任务", STUDY_TASK_DROPPED: "放弃任务", STUDY_TASK_RECOVERED: "恢复任务" } as Record<string, string>)[action] ?? action;
}

function startErrorLabel(error?: string): string {
  if (error === "HARD_DEPENDENCY_BLOCKED") return "硬依赖尚未完成，请先打开前置任务。";
  if (error === "TASK_STATE_CONFLICT") return "任务状态已变化，请刷新后重试。";
  return error ?? "无法开始任务";
}

function dependencyErrorLabel(error?: string): string {
  return ({ DEPENDENCY_SELF_LOOP: "任务不能依赖自身。", DEPENDENCY_DUPLICATE: "该依赖已存在。", DEPENDENCY_CYCLE: "该关联会形成依赖环，已拒绝。", DEPENDENCY_REVISION_CONFLICT: "依赖已在其他页面更新，请刷新后重试。" } as Record<string, string>)[error ?? ""] ?? error ?? "依赖操作失败";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
