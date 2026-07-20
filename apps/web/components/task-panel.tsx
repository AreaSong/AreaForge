"use client";

import { Check, FastForward, Plus, RotateCcw, Scissors, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { StudyTaskDto, SubjectDto, SyllabusNodeDto, TaskDebtReorderDto } from "@/lib/study/types";

interface TaskPanelProps {
  subjects: SubjectDto[];
  tasks: StudyTaskDto[];
  syllabusNodes: SyllabusNodeDto[];
  debtReorder: TaskDebtReorderDto;
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function TaskPanel({ subjects, tasks, syllabusNodes, debtReorder }: TaskPanelProps) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [syllabusNodeId, setSyllabusNodeId] = useState("");
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState("study");
  const [estimatedMinutes, setEstimatedMinutes] = useState(45);
  const [priority, setPriority] = useState("medium");
  const [error, setError] = useState<string | null>(null);
  const [debtNotice, setDebtNotice] = useState<string | null>(null);
  const [selectedDebtTaskIds, setSelectedDebtTaskIds] = useState<string[]>([]);
  const [isDebtActionPending, setDebtActionPending] = useState(false);
  const [pendingTaskActions, setPendingTaskActions] = useState<Record<string, boolean>>({});
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
    setError(null);
    setDebtNotice(null);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        syllabusNodeId: syllabusNodeId || null,
        title,
        type: taskType,
        priority,
        estimatedMinutes,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "创建任务失败");
      return;
    }

    setTitle("");
    setSyllabusNodeId("");
    startTransition(() => router.refresh());
  }

  async function act(path: string, body?: unknown, taskId?: string) {
    setError(null);
    setDebtNotice(null);
    if (taskId) setPendingTaskActions((current) => ({ ...current, [taskId]: true }));
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "操作失败，任务状态可能已变化，请刷新后重试。");
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      setError("网络暂时不可用，任务状态未确认，请刷新后重试。");
    } finally {
      if (taskId) setPendingTaskActions((current) => ({ ...current, [taskId]: false }));
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
    const path = kind === "apply"
      ? "/api/tasks/debt-reorder/applications"
      : "/api/tasks/debt-reorder/decisions";
    const body = kind === "apply"
      ? { selectedTaskIds }
      : { action: kind, selectedTaskIds };
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        decision?: { summary?: string };
        application?: { summary?: string };
      } | null;

      if (!response.ok) {
        setError(data?.error ?? "债务重排操作失败");
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
        <div className="grid gap-3 sm:grid-cols-[1fr_1.7fr]">
          <select
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
          </select>
          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="新增今天要完成的任务"
            required
          />
        </div>
        <select
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
        </select>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
          >
            <option value="study">学习</option>
            <option value="review">复习</option>
            <option value="practice">刷题</option>
            <option value="mistake">错题</option>
            <option value="simulation_exam">模拟</option>
          </select>
          <select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="critical">最高</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            type="number"
            min={5}
            max={720}
            value={estimatedMinutes}
            onChange={(event) => setEstimatedMinutes(Number(event.target.value))}
          />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || !subjectId}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            新建
          </button>
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
                <input
                  className="mt-1 h-4 w-4 accent-amber-300"
                  type="checkbox"
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
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={isDebtActionPending || selectedVisibleDebtTaskIds.length === 0}
                onClick={() => actOnDebtReorder("confirm")}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                确认所选
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300/25 px-3 text-sm text-red-100 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={isDebtActionPending || selectedVisibleDebtTaskIds.length === 0}
                onClick={() => actOnDebtReorder("reject")}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                驳回所选
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-sm text-amber-100 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={isDebtActionPending || selectedVisibleDebtTaskIds.length === 0}
                onClick={() => actOnDebtReorder("apply")}
              >
                <FastForward className="h-4 w-4" aria-hidden="true" />
                应用所选
              </button>
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
                  {labelTaskType(task.type)} / {labelStatus(task.status)} / {task.estimatedMinutes} 分钟
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
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => act(`/api/tasks/${task.id}/complete`, { reviewText: "从今日任务面板完成" }, task.id)}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                完成
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-sm text-amber-100 hover:bg-amber-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => act(`/api/tasks/${task.id}/defer`, { reviewText: "延期到下一学习日" }, task.id)}
              >
                <FastForward className="h-4 w-4" aria-hidden="true" />
                延期
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-sky-300/25 px-3 text-sm text-sky-100 hover:bg-sky-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => act(`/api/tasks/${task.id}/recover`, { reviewText: "从任务面板补做" }, task.id)}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                补做
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-300/25 px-3 text-sm text-violet-100 hover:bg-violet-400/10"
                type="button"
                onClick={() =>
                  act(`/api/tasks/${task.id}/split`, {
                    title: `${task.title} / 最小推进`,
                    estimatedMinutes: Math.min(45, Math.max(15, Math.ceil(task.estimatedMinutes / 2))),
                    reviewText: "从任务面板拆小",
                  }, task.id)
                }
                disabled={pendingTaskActions[task.id]}
              >
                <Scissors className="h-4 w-4" aria-hidden="true" />
                拆小
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-300/25 px-3 text-sm text-blue-100 hover:bg-blue-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => act(`/api/tasks/${task.id}/convert-review`, { reviewText: "从任务面板改成复习任务" }, task.id)}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                改复习
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300/25 px-3 text-sm text-red-100 hover:bg-red-400/10"
                type="button"
                disabled={pendingTaskActions[task.id]}
                onClick={() => {
                  if (window.confirm("确认放弃这个任务？该操作会记录为任务状态变化。")) act(`/api/tasks/${task.id}/drop`, undefined, task.id);
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                放弃
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function labelStatus(status: StudyTaskDto["status"]): string {
  switch (status) {
    case "todo":
      return "待开始";
    case "in_progress":
      return "进行中";
    case "done":
      return "已完成";
    case "skipped":
      return "已放弃";
    case "deferred":
      return "已延期";
  }
}

function labelDebtAction(action: TaskDebtReorderDto["suggestions"][number]["action"]): string {
  switch (action) {
    case "keep":
      return "保留";
    case "recover":
      return "补做";
    case "defer":
      return "延期";
    case "split":
      return "拆小";
    case "drop":
      return "放弃";
    case "convert_review":
      return "改复习";
  }
}

function flattenNodes(nodes: SyllabusNodeDto[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      subjectId: node.subjectId,
      title: node.title,
      depth,
    },
    ...flattenNodes(node.children, depth + 1),
  ]);
}

function labelPriority(priority: StudyTaskDto["priority"]): string {
  switch (priority) {
    case "critical":
      return "最高";
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
  }
}

function labelTaskType(type: string): string {
  switch (type) {
    case "study":
      return "学习";
    case "review":
      return "复习";
    case "practice":
      return "刷题";
    case "mistake":
      return "错题";
    case "simulation_exam":
      return "模拟";
    default:
      return type;
  }
}
