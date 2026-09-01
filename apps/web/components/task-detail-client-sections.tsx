import { Trash2 } from "lucide-react";
import Link from "next/link";
import { IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import type { StudyTaskDetailDto, TaskDependencyDto, TaskStatusDto } from "@/lib/contracts";
import { formatDateTimeShort as formatDateTime, formatTaskStatus } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";

export function RelationItem(props: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-zinc-500">{props.label}</dt><dd className="mt-1 break-words text-zinc-300">{props.children}</dd></div>;
}

export function TaskLink({ task, returnTo }: {
  task: { id: string; title: string; status: TaskStatusDto };
  returnTo: string;
}) {
  return <Link className="text-teal-300 hover:underline" href={withReturnTo(`/roadmap/allocation/tasks/${task.id}`, returnTo)}>{task.title} · {formatTaskStatus(task.status)}</Link>;
}

export function DependencyList(props: {
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
                <Link className="min-w-0 break-words text-teal-300 hover:underline" href={withReturnTo(`/roadmap/allocation/tasks/${linkedId}`, props.returnTo)}>
                  {linkedTitle ?? `任务 ${linkedId.slice(0, 8)}`} · {linkedStatus ? formatTaskStatus(linkedStatus) : "状态未记录"}
                </Link>
                <div className="flex items-center gap-2">
                  {props.editable ? (
                    <Select
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
                    </Select>
                  ) : <span className="text-xs text-zinc-500">{dependency.type === "HARD" ? "硬依赖" : "软依赖"}</span>}
                  {props.editable ? (
                    <IconButton
                      label={`解除与“${linkedTitle ?? linkedId}”的依赖`}
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
                    </IconButton>
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

export function TaskHistory({ detail }: { detail: StudyTaskDetailDto }) {
  const returnTo = `/roadmap/allocation/tasks/${detail.task.id}`;
  return (
    <section aria-labelledby="task-history-heading" className="space-y-4 border-t border-white/10 pt-5">
      <h2 id="task-history-heading" className="text-lg font-semibold text-white">行动历史</h2>
      <HistoryGroup label="专注记录" empty={detail.sessions.length === 0}>
        {detail.sessions.map((session) => (
          <li key={session.id} className="py-2 text-sm text-zinc-300">
            {detail.readOnly
              ? <span>{formatDateTime(session.startedAt)}</span>
              : <Link className="text-teal-300 hover:underline" href={`/focus?returnTo=${encodeURIComponent(returnTo)}`}>{formatDateTime(session.startedAt)}</Link>}
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

export function taskSourceLabel(sourceHref: string): string {
  if (sourceHref === "/today") return "返回今日";
  if (sourceHref.startsWith("/roadmap/allocation/drafts")) return "返回收件箱";
  if (sourceHref.startsWith("/roadmap/stages")) return "返回阶段";
  if (sourceHref.startsWith("/roadmap/allocation")) return "返回计划";
  if (sourceHref.startsWith("/roadmap/reviews/daily/")) return "返回复盘";
  if (sourceHref.startsWith("/knowledge/")) return "返回知识";
  return "返回来源";
}

function HistoryGroup(props: { label: string; empty: boolean; children: React.ReactNode }) {
  return <div><h3 className="text-sm font-medium text-zinc-300">{props.label}</h3>{props.empty ? <p className="mt-2 text-sm text-zinc-500">暂无记录</p> : <ul className="mt-1 divide-y divide-white/10">{props.children}</ul>}</div>;
}

export function priorityLabel(priority: string): string {
  return ({ low: "低", medium: "中", high: "高", critical: "最高" } as Record<string, string>)[priority] ?? priority;
}

function debtActionLabel(action: string): string {
  return ({ complete: "完成", defer: "延期", drop: "放弃", recover: "恢复", split: "拆分", convert_review: "转复习任务", reorder_suggested: "生成重排建议", reorder_applied: "应用重排" } as Record<string, string>)[action] ?? action;
}

function auditActionLabel(action: string): string {
  return ({ STUDY_TASK_CREATED: "创建任务", STUDY_TASK_UPDATED: "编辑任务", STUDY_TASK_COMPLETED: "完成任务", STUDY_TASK_DEFERRED: "延期任务", STUDY_TASK_DROPPED: "放弃任务", STUDY_TASK_RECOVERED: "恢复任务" } as Record<string, string>)[action] ?? action;
}

export function startErrorLabel(error?: string): string {
  if (error === "HARD_DEPENDENCY_BLOCKED") return "硬依赖尚未完成，请先打开前置任务。";
  if (error === "TASK_STATE_CONFLICT") return "任务状态已变化，请刷新后重试。";
  return error ?? "无法开始任务";
}

export function dependencyErrorLabel(error?: string): string {
  return ({ DEPENDENCY_SELF_LOOP: "任务不能依赖自身。", DEPENDENCY_DUPLICATE: "该依赖已存在。", DEPENDENCY_CYCLE: "该关联会形成依赖环，已拒绝。", DEPENDENCY_REVISION_CONFLICT: "依赖已在其他页面更新，请刷新后重试。" } as Record<string, string>)[error ?? ""] ?? error ?? "依赖操作失败";
}
