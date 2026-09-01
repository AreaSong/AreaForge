"use client";

import { Button } from "@/components/ui/button";
import { Checkbox, Select, Input } from "@/components/ui/field";
import { isUnauthorized } from "@/lib/client/api-errors";
import { mutationFeedback } from "@/lib/client/mutation-feedback";

import { Check, FastForward, Plus, RotateCcw, Scissors, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { createTask, executeTaskCommand, reorderTaskDebt, type TaskCommand } from "@/lib/api/tasks";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { StudyTaskDto, SubjectDto, SyllabusOptionNodeDto, TaskDebtReorderDto, TaskPriorityDto } from "@/lib/contracts";
import {
  flattenNodes,
  labelDebtAction,
  labelPriority,
  labelTaskType,
} from "@/components/task-panel-utils";
import { formatTaskStatus } from "@/lib/formatters";

interface TaskPanelProps {
  subjects: SubjectDto[];
  tasks: StudyTaskDto[];
  syllabusNodes: SyllabusOptionNodeDto[];
  debtReorder: TaskDebtReorderDto;
}

type TaskPanelCommand = Extract<
  TaskCommand,
  { type: "complete" | "defer" | "recover" | "split" | "convert-review" | "drop" }
>;

export function TaskPanel({ subjects, tasks, syllabusNodes, debtReorder }: TaskPanelProps) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [syllabusNodeId, setSyllabusNodeId] = useState("");
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState("study");
  const [estimatedMinutes, setEstimatedMinutes] = useState(45);
  const [priority, setPriority] = useState<TaskPriorityDto>("medium");
  const [error, setError] = useState<string | null>(null);
  const [debtNotice, setDebtNotice] = useState<string | null>(null);
  const [selectedDebtTaskIds, setSelectedDebtTaskIds] = useState<string[]>([]);
  const [isDebtActionPending, setDebtActionPending] = useState(false);
  const [isCreating, setCreating] = useState(false);
  const [pendingTaskActions, setPendingTaskActions] = useState<Record<string, boolean>>({});
  const [taskToDrop, setTaskToDrop] = useState<StudyTaskDto | null>(null);
  const [isPending, startTransition] = useTransition();
  const flatNodes = useMemo(() => flattenNodes(syllabusNodes), [syllabusNodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const visibleDebtSuggestions = useMemo(() => debtReorder.suggestions.slice(0, 4), [debtReorder.suggestions]);
  const visibleDebtTaskIds = useMemo(
    () => new Set(visibleDebtSuggestions.map((suggestion) => suggestion.taskId)),
    [visibleDebtSuggestions],
  );
  const selectedVisibleDebtTaskIds = selectedDebtTaskIds.filter((taskId) => visibleDebtTaskIds.has(taskId));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    setError(null);
    setDebtNotice(null);
    const payload = {
      subjectId,
      syllabusNodeId: syllabusNodeId || null,
      title,
      type: taskType,
      priority,
      estimatedMinutes,
    };
    const commandScope = "task-panel:create";
    setCreating(true);
    try {
      const result = await createTask({
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "task-create", payload),
        ...payload,
      });

      if (isUnauthorized(result)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        const feedback = mutationFeedback(result, "创建任务失败，当前输入仍保留");
        if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
        setError(feedback.message);
        return;
      }

      completeIdempotentCommand(commandScope);
      setTitle("");
      setSyllabusNodeId("");
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，任务输入与命令身份仍保留；恢复网络后请显式重试。");
    } finally {
      setCreating(false);
    }
  }

  async function act(command: TaskPanelCommand) {
    setError(null);
    setDebtNotice(null);
    setPendingTaskActions((current) => ({ ...current, [command.taskId]: true }));
    try {
      const result = await executeTaskCommand(command);
      if (!result.ok) {
        const feedback = mutationFeedback(result, "操作失败，任务状态可能已变化，请刷新后重试。");
        if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
        setError(feedback.message);
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      setError("网络暂时不可用，任务状态未确认，请刷新后重试。");
    } finally {
      setPendingTaskActions((current) => ({ ...current, [command.taskId]: false }));
    }
  }

  function toggleDebtSuggestion(taskId: string) {
    setSelectedDebtTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((item) => item !== taskId)
        : [...current, taskId],
    );
  }

  async function actOnDebtReorder(kind: "confirm" | "reject" | "apply") {
    const selectedTaskIds = selectedVisibleDebtTaskIds;
    if (selectedTaskIds.length === 0) return;

    setError(null);
    setDebtNotice(null);
    setDebtActionPending(true);
    try {
      const result = await reorderTaskDebt({ type: kind, selectedTaskIds });
      const data = result.body;
      if (!result.ok) {
        const feedback = mutationFeedback(result, "债务重排操作失败");
        if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
        setError(feedback.message);
        return;
      }

      setSelectedDebtTaskIds([]);
      setDebtNotice(data?.decision?.summary ?? data?.application?.summary ?? "债务重排操作已记录");
      startTransition(() => router.refresh());
    } catch {
      setError("债务重排操作失败");
    } finally {
      setDebtActionPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
      <div className="flex items-center gap-2">
        <Plus className="h-5 w-5 text-teal-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-white">今日任务</h2>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        状态主题只改变任务优先提示，完整任务列表仍保留在这里，不自动修改任务或阶段计划。
      </p>

      <form className="mt-4 grid gap-3 border-b border-white/10 pb-4" onSubmit={submit}>
        <div className="af-content-grid-two grid gap-3">
          <Select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={subjectId}
            onChange={(event) => {
              setSubjectId(event.target.value);
              setSyllabusNodeId("");
            }}
            required
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
          <Input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="新增今天要完成的任务"
            required
          />
        </div>
        <Select
          className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
          value={syllabusNodeId}
          onChange={(event) => setSyllabusNodeId(event.target.value)}
        >
          <option value="">不关联考纲节点</option>
          {nodeOptions.map((node) => (
            <option key={node.id} value={node.id}>
              {"  ".repeat(node.depth)}
              {node.title}
            </option>
          ))}
        </Select>
        <div className="af-content-grid-four grid gap-3">
          <Select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
          >
            <option value="study">学习</option>
            <option value="review">复习</option>
            <option value="practice">刷题</option>
            <option value="mistake">错题</option>
            <option value="simulation_exam">模拟</option>
          </Select>
          <Select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriorityDto)}
          >
            <option value="critical">最高</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </Select>
          <Input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            type="number"
            min={5}
            max={720}
            value={estimatedMinutes}
            onChange={(event) => setEstimatedMinutes(Number(event.target.value))}
          />
          <Button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || isCreating || !subjectId}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            新建
          </Button>
        </div>
      </form>

      {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}
      {debtNotice ? <p className="mt-3 text-sm text-teal-200">{debtNotice}</p> : null}

      {debtReorder.suggestions.length > 0 ? (
        <div className="mt-4 border-b border-white/10 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-amber-100">债务重排建议</p>
                <span className="rounded-md border border-amber-300/20 px-2 py-1 text-xs text-amber-100">
                  {debtReorder.canAutoApply ? "可自动应用" : "只读建议"}
                </span>
                <span className="rounded-md border border-amber-300/20 px-2 py-1 text-xs text-amber-100">
                  {debtReorder.requiresUserConfirmation ? "需确认" : "无需确认"}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{debtReorder.summary}</p>
            </div>
            <span className="rounded-md border border-amber-300/20 px-2 py-1 text-xs text-amber-100">
              {debtReorder.availableMinutes} 分钟
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            {visibleDebtSuggestions.map((suggestion) => (
              <label
                key={suggestion.taskId}
                className="grid cursor-pointer grid-cols-[auto_1fr] gap-3 border-l border-amber-300/30 pl-3 text-sm"
              >
                <Checkbox
                  className="mt-1 accent-amber-300"
                  checked={selectedDebtTaskIds.includes(suggestion.taskId)}
                  onChange={() => toggleDebtSuggestion(suggestion.taskId)}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-amber-100">{labelDebtAction(suggestion.action)}</span>
                    <span className="text-zinc-100">{suggestion.taskTitle}</span>
                    <span className="text-xs text-zinc-500">{suggestion.subjectName}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">{suggestion.reason}</p>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500">
              只处理所选项：已选 {selectedVisibleDebtTaskIds.length} / {visibleDebtSuggestions.length}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={isDebtActionPending || selectedVisibleDebtTaskIds.length === 0}
                onClick={() => actOnDebtReorder("confirm")}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                确认所选
              </Button>
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300/25 px-3 text-sm text-red-100 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={isDebtActionPending || selectedVisibleDebtTaskIds.length === 0}
                onClick={() => actOnDebtReorder("reject")}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                驳回所选
              </Button>
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-sm text-amber-100 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={isDebtActionPending || selectedVisibleDebtTaskIds.length === 0}
                onClick={() => actOnDebtReorder("apply")}
              >
                <FastForward className="h-4 w-4" aria-hidden="true" />
                应用所选
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        {tasks.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
            今天还没有任务，先建一个最小任务再开始计时。
          </p>
        ) : null}
        {tasks.map((task) => (
          <article key={task.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-400">{task.subjectName}</p>
                <h3 className="mt-1 font-medium text-white">{task.title}</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  {labelTaskType(task.type)} / {formatTaskStatus(task.status)} / {task.estimatedMinutes} 分钟
                </p>
                {task.syllabusNodeTitle ? (
                  <p className="mt-1 text-xs text-teal-200">考纲：{task.syllabusNodeTitle}</p>
                ) : null}
              </div>
              <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
                {labelPriority(task.priority)}
              </span>
            </div>
            <div className="mt-4 h-2 rounded-md bg-white/10">
              <div
                className="h-2 rounded-md bg-teal-400"
                style={{ width: `${Math.min(100, Math.round((task.actualMinutes / Math.max(1, task.estimatedMinutes)) * 100))}%` }}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => void act({ type: "complete", taskId: task.id, input: { reviewText: "从今日任务面板完成" } })}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                完成
              </Button>
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-sm text-amber-100 hover:bg-amber-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => void act({ type: "defer", taskId: task.id, input: { reviewText: "延期到下一学习日" } })}
              >
                <FastForward className="h-4 w-4" aria-hidden="true" />
                延期
              </Button>
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-sky-300/25 px-3 text-sm text-sky-100 hover:bg-sky-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => void act({ type: "recover", taskId: task.id, input: { reviewText: "从任务面板补做" } })}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                补做
              </Button>
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-300/25 px-3 text-sm text-violet-100 hover:bg-violet-400/10"
                type="button"
                onClick={() =>
                  void act({
                    type: "split",
                    taskId: task.id,
                    input: {
                      title: `${task.title} / 最小推进`,
                      estimatedMinutes: Math.min(45, Math.max(15, Math.ceil(task.estimatedMinutes / 2))),
                      reviewText: "从任务面板拆小",
                    },
                  })
                }
                disabled={pendingTaskActions[task.id]}
              >
                <Scissors className="h-4 w-4" aria-hidden="true" />
                拆小
              </Button>
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-300/25 px-3 text-sm text-blue-100 hover:bg-blue-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => void act({ type: "convert-review", taskId: task.id, input: { reviewText: "从任务面板改成复习任务" } })}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                改复习
              </Button>
              <Button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300/25 px-3 text-sm text-red-100 hover:bg-red-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => setTaskToDrop(task)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                放弃
              </Button>
            </div>
          </article>
        ))}
      </div>
      <ConfirmationDialog
        open={taskToDrop !== null}
        title="放弃这个任务？"
        description={<>任务“{taskToDrop?.title}”会进入已放弃状态并记录任务债务事件。之后仍可通过补做恢复。</>}
        confirmLabel="确认放弃任务"
        pending={Boolean(taskToDrop && pendingTaskActions[taskToDrop.id])}
        pendingLabel="正在放弃"
        onClose={() => setTaskToDrop(null)}
        onConfirm={() => {
          if (!taskToDrop) return;
          const task = taskToDrop;
          setTaskToDrop(null);
          void act({ type: "drop", taskId: task.id });
        }}
      />
    </div>
  );
}
