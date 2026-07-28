"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { PlanMilestoneDto } from "@/lib/study/plan-milestone-service";
import type { PlanRollingDto } from "@/lib/study/plan-rolling-service";
import type { SyllabusOptionNodeDto, TaskPriorityDto } from "@/lib/study/types";

interface TaskCreateDraft {
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  planMilestoneId: string;
  title: string;
  type: string;
  priority: TaskPriorityDto;
  estimatedMinutes: number;
}

export function PlanRollingClient(props: {
  initial: PlanRollingDto;
  subjects: Array<{ id: string; name: string }>;
  syllabusNodes: SyllabusOptionNodeDto[];
  milestones: PlanMilestoneDto[];
  createMinimum: boolean;
  sourceResource: {
    id: string;
    title: string;
    subjectId: string | null;
    syllabusNodeId: string | null;
    archived: boolean;
  } | null;
  query: { date?: string; subjectId?: string; status?: string; q?: string; resourceId?: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(props.createMinimum ? "今天最小任务" : props.sourceResource ? `学习：${props.sourceResource.title}` : "");
  const [subjectId, setSubjectId] = useState(props.sourceResource?.subjectId ?? props.subjects[0]?.id ?? "");
  const [syllabusNodeId, setSyllabusNodeId] = useState(props.sourceResource?.syllabusNodeId ?? "");
  const [relatedSyllabusNodeIds, setRelatedSyllabusNodeIds] = useState<string[]>([]);
  const [planMilestoneId, setPlanMilestoneId] = useState("");
  const [taskType, setTaskType] = useState("study");
  const [priority, setPriority] = useState<TaskPriorityDto>(props.createMinimum ? "high" : "medium");
  const [estimatedMinutes, setEstimatedMinutes] = useState(props.createMinimum ? 25 : 45);
  const [draftReady, setDraftReady] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const selectedDate = props.query.date ?? props.initial.days[0]?.date;
  const draftKey = `areaforge.task.draft.create.${selectedDate ?? "undated"}.${props.sourceResource?.id ?? (props.createMinimum ? "minimum" : "direct")}`;
  useRestoreListReturn();

  const flatSyllabusNodes = useMemo(() => flattenSyllabusNodes(props.syllabusNodes), [props.syllabusNodes]);
  const availableNodes = flatSyllabusNodes.filter((node) => node.subjectId === subjectId);
  const availableMilestones = props.milestones.filter((milestone) =>
    !milestone.archivedAt && (!milestone.subjectId || milestone.subjectId === subjectId),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isTaskCreateDraft);
      if (draft && props.subjects.some((subject) => subject.id === draft.subjectId)) {
        setSubjectId(draft.subjectId);
        setSyllabusNodeId(draft.syllabusNodeId);
        setRelatedSyllabusNodeIds(draft.relatedSyllabusNodeIds);
        setPlanMilestoneId(draft.planMilestoneId);
        setTitle(draft.title);
        setTaskType(draft.type);
        setPriority(draft.priority);
        setEstimatedMinutes(draft.estimatedMinutes);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, props.subjects]);

  useEffect(() => {
    if (!draftReady) return;
    const draft = createDraftSnapshot({ subjectId, syllabusNodeId, relatedSyllabusNodeIds, planMilestoneId, title, taskType, priority, estimatedMinutes });
    if (!title.trim() && !syllabusNodeId && relatedSyllabusNodeIds.length === 0 && !planMilestoneId) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft(draftKey, draft);
  }, [draftKey, draftReady, estimatedMinutes, planMilestoneId, priority, relatedSyllabusNodeIds, subjectId, syllabusNodeId, taskType, title]);

  const selectedDayTasks = useMemo(() => {
    return props.initial.days.find((day) => day.date === selectedDate)?.tasks ?? props.initial.tasks;
  }, [props.initial.days, props.initial.tasks, selectedDate]);

  function pushQuery(next: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { ...props.query, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    startTransition(() => router.push(`/today/plan?${params.toString()}`));
  }

  async function createTask() {
    if (creatingTask) return;
    setError(null);
    if (!subjectId || !title.trim()) {
      setError("科目和标题必填");
      return;
    }
    setCreatingTask(true);
    const payload = {
      subjectId,
      syllabusNodeId: syllabusNodeId || null,
      relatedSyllabusNodeIds,
      planMilestoneId: planMilestoneId || null,
      sourceResourceId: props.sourceResource?.id,
      title: title.trim(),
      estimatedMinutes,
      type: taskType,
      priority,
      plannedDate: selectedDate ? new Date(`${selectedDate}T08:00:00+08:00`).toISOString() : undefined,
    };
    const commandScope = `plan:create:${selectedDate ?? "undated"}:${props.sourceResource?.id ?? "direct"}`;
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
        setError(body?.error ?? "创建失败，当前输入仍保留；请显式重试。");
        return;
      }
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(draftKey);
      setTitle("");
      setSyllabusNodeId("");
      setRelatedSyllabusNodeIds([]);
      setPlanMilestoneId("");
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，任务输入仍保留；恢复网络后请显式重试。");
    } finally {
      setCreatingTask(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">计划</h1>
          <p className="mt-1 text-sm text-zinc-400">正式任务、欠账与带日期 Inbox 数量入口</p>
        </div>
        <Link href={props.initial.inboxEntryPath} className="text-sm text-teal-300 hover:underline">
          带日期收件箱 {props.initial.datedInboxCount}
        </Link>
      </div>
      {props.sourceResource ? (
        <p className={`rounded-md border px-3 py-2 text-sm ${props.sourceResource.archived ? "border-red-400/30 text-red-200" : "border-teal-400/20 text-teal-100"}`}>
          来源资料：{props.sourceResource.title}{props.sourceResource.archived ? "（已归档，不能创建关联任务）" : ""}
        </p>
      ) : null}

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="日期条">
        {props.initial.days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={`shrink-0 rounded-md border px-3 py-2 text-xs ${selectedDate === day.date ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-400"}`}
            onClick={() => pushQuery({ date: day.date })}
          >
            {day.date.slice(5)} · {day.tasks.length}
          </button>
        ))}
      </div>

      <div className="hidden gap-3 overflow-x-auto lg:flex" aria-label="七天列">
        {props.initial.days.map((day) => (
          <div key={day.date} className="min-w-[12rem] flex-1 rounded-md border border-white/10 bg-[#101419] p-3">
            <p className="text-xs text-zinc-500">{day.date}</p>
            <ul className="mt-2 space-y-2">
              {day.tasks.map((task) => (
                <li key={task.id}>
                  <ListDetailLink href={`/today/tasks/${task.id}`} focusId={`plan-task-desktop-${day.date}-${task.id}`} className="text-sm text-white hover:text-teal-300">
                    {task.title}
                  </ListDetailLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-white/10 bg-[#101419] p-4 lg:hidden">
        <h2 className="text-sm font-medium text-zinc-200">当日任务</h2>
        <ul className="mt-2 space-y-2">
          {selectedDayTasks.map((task) => (
            <li key={task.id}>
              <ListDetailLink href={`/today/tasks/${task.id}`} focusId={`plan-task-mobile-${selectedDate ?? "undated"}-${task.id}`} className="text-sm text-white hover:text-teal-300">
                {task.title}
              </ListDetailLink>
              <p className="text-xs text-zinc-500">{task.subjectName}</p>
            </li>
          ))}
        </ul>
      </div>

      {props.initial.debt.length > 0 ? (
        <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-4">
          <h2 className="text-sm font-medium text-amber-100">欠账</h2>
          <ul className="mt-2 space-y-2">
            {props.initial.debt.map((task) => (
              <li key={task.id}>
                <ListDetailLink href={`/today/tasks/${task.id}`} focusId={`plan-debt-${task.id}`} className="text-sm text-white hover:text-teal-300">
                  {task.title}
                </ListDetailLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-white/10 bg-[#101419] p-4">
        <h2 className="text-sm font-medium text-white">新建任务</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-zinc-400">标题</span>
            <input
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">科目</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={subjectId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setSyllabusNodeId("");
                setRelatedSyllabusNodeIds([]);
                setPlanMilestoneId("");
              }}
            >
              {props.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">里程碑</span>
            <select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={planMilestoneId} onChange={(event) => setPlanMilestoneId(event.target.value)}>
              <option value="">不关联里程碑</option>
              {availableMilestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">主考纲节点</span>
            <select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={syllabusNodeId} onChange={(event) => {
              setSyllabusNodeId(event.target.value);
              setRelatedSyllabusNodeIds((current) => current.filter((id) => id !== event.target.value));
            }}>
              <option value="">不关联主节点</option>
              {availableNodes.map((node) => <option key={node.id} value={node.id}>{`${"  ".repeat(node.depth)}${node.title}`}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">预计分钟</span>
            <input
              type="number"
              min={5}
              max={720}
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(Number(event.target.value) || 25)}
            />
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">任务类型</span>
            <select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={taskType} onChange={(event) => setTaskType(event.target.value)}>
              <option value="study">学习</option><option value="review">复习</option><option value="practice">刷题</option><option value="mistake">错题</option><option value="simulation_exam">模拟</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">优先级</span>
            <select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriorityDto)}>
              <option value="critical">最高</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option>
            </select>
          </label>
        </div>
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm text-zinc-400">相关考纲节点（最多 20 个）</legend>
          <div className="grid max-h-44 gap-2 overflow-y-auto border-l border-white/10 pl-3 sm:grid-cols-2">
            {availableNodes.filter((node) => node.id !== syllabusNodeId).map((node) => (
              <label key={node.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-300">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-400" checked={relatedSyllabusNodeIds.includes(node.id)} onChange={() => setRelatedSyllabusNodeIds((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : current.length < 20 ? [...current, node.id] : current)} />
                <span className="min-w-0 break-words">{`${"  ".repeat(node.depth)}${node.title}`}</span>
              </label>
            ))}
            {availableNodes.length === 0 ? <p className="text-sm text-zinc-500">该科目暂无可关联节点</p> : null}
          </div>
        </fieldset>
        {error ? <p className="mt-2 text-sm text-red-300" role="alert">{error}</p> : null}
        <button
          type="button"
          disabled={pending || creatingTask || props.sourceResource?.archived}
          className="mt-3 h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-60"
          onClick={() => void createTask()}
        >
          {creatingTask ? "创建中..." : "新建任务"}
        </button>
      </div>
    </section>
  );
}

function flattenSyllabusNodes(nodes: SyllabusOptionNodeDto[], depth = 0): Array<SyllabusOptionNodeDto & { depth: number }> {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenSyllabusNodes(node.children, depth + 1)]);
}

function createDraftSnapshot(input: {
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  planMilestoneId: string;
  title: string;
  taskType: string;
  priority: TaskPriorityDto;
  estimatedMinutes: number;
}): TaskCreateDraft {
  return {
    subjectId: input.subjectId,
    syllabusNodeId: input.syllabusNodeId,
    relatedSyllabusNodeIds: input.relatedSyllabusNodeIds,
    planMilestoneId: input.planMilestoneId,
    title: input.title,
    type: input.taskType,
    priority: input.priority,
    estimatedMinutes: input.estimatedMinutes,
  };
}

function isTaskCreateDraft(value: unknown): value is TaskCreateDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<TaskCreateDraft>;
  return typeof draft.subjectId === "string"
    && typeof draft.syllabusNodeId === "string"
    && Array.isArray(draft.relatedSyllabusNodeIds)
    && draft.relatedSyllabusNodeIds.every((id) => typeof id === "string")
    && typeof draft.planMilestoneId === "string"
    && typeof draft.title === "string"
    && typeof draft.type === "string"
    && ["low", "medium", "high", "critical"].includes(draft.priority ?? "")
    && typeof draft.estimatedMinutes === "number";
}
