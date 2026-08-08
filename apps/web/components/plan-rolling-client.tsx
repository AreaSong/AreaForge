"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { buttonClassName } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlays";
import { PageFrame, PageHeader } from "@/components/ui/page";
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
import type { StagePlanDto, SyllabusOptionNodeDto, TaskPriorityDto } from "@/lib/study/types";
import type { KnowledgePointDto } from "@/lib/study/knowledge-point-service";
import { withReturnTo } from "@/lib/navigation/batch7";

interface TaskCreateDraft {
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  stagePlanIds: string[];
  knowledgePointIds: string[];
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
  stagePlans: StagePlanDto[];
  knowledgePoints: KnowledgePointDto[];
  createMinimum: boolean;
  sourceResource: {
    id: string;
    title: string;
    subjectId: string | null;
    syllabusNodeId: string | null;
    archived: boolean;
  } | null;
  query: { date?: string; subjectId?: string; status?: string; q?: string; resourceId?: string; syllabusNodeId?: string };
  detailTaskId?: string;
  closeDetailHref: string;
  detailPanel?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(props.createMinimum ? "今天最小任务" : props.sourceResource ? `学习：${props.sourceResource.title}` : "");
  const [subjectId, setSubjectId] = useState(props.sourceResource?.subjectId ?? props.query.subjectId ?? props.subjects[0]?.id ?? "");
  const [syllabusNodeId, setSyllabusNodeId] = useState(props.sourceResource?.syllabusNodeId ?? props.query.syllabusNodeId ?? "");
  const [relatedSyllabusNodeIds, setRelatedSyllabusNodeIds] = useState<string[]>([]);
  const [stagePlanIds, setStagePlanIds] = useState<string[]>([]);
  const [knowledgePointIds, setKnowledgePointIds] = useState<string[]>([]);
  const [planMilestoneId, setPlanMilestoneId] = useState("");
  const [taskType, setTaskType] = useState("study");
  const [priority, setPriority] = useState<TaskPriorityDto>(props.createMinimum ? "high" : "medium");
  const [estimatedMinutes, setEstimatedMinutes] = useState(props.createMinimum ? 25 : 45);
  const [draftReady, setDraftReady] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [createOpen, setCreateOpen] = useState(props.createMinimum || Boolean(props.sourceResource));
  const [searchQuery, setSearchQuery] = useState(props.query.q ?? "");
  const selectedDate = props.query.date ?? props.initial.days[0]?.date;
  const currentPlanHref = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(props.query)) {
      if (value) params.set(key, value);
    }
    return `/roadmap/allocation${params.size ? `?${params.toString()}` : ""}`;
  }, [props.query]);
  const draftKey = `areaforge.task.draft.create.${selectedDate ?? "undated"}.${props.sourceResource?.id ?? props.query.syllabusNodeId ?? (props.createMinimum ? "minimum" : "direct")}`;
  useRestoreListReturn();

  const flatSyllabusNodes = useMemo(() => flattenSyllabusNodes(props.syllabusNodes), [props.syllabusNodes]);
  const availableNodes = flatSyllabusNodes.filter((node) => node.subjectId === subjectId);
  const availableMilestones = props.milestones.filter((milestone) =>
    !milestone.archivedAt && (!milestone.subjectId || milestone.subjectId === subjectId),
  );
  const availableStagePlans = props.stagePlans.filter((stagePlan) => stagePlan.status === "draft" || stagePlan.status === "active");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isTaskCreateDraft);
      if (draft && props.subjects.some((subject) => subject.id === draft.subjectId)) {
        setSubjectId(draft.subjectId);
        setSyllabusNodeId(draft.syllabusNodeId);
        setRelatedSyllabusNodeIds(draft.relatedSyllabusNodeIds);
        setStagePlanIds(draft.stagePlanIds);
        setKnowledgePointIds(draft.knowledgePointIds);
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
    const draft = createDraftSnapshot({ subjectId, syllabusNodeId, relatedSyllabusNodeIds, stagePlanIds, knowledgePointIds, planMilestoneId, title, taskType, priority, estimatedMinutes });
    if (!title.trim() && !syllabusNodeId && relatedSyllabusNodeIds.length === 0 && stagePlanIds.length === 0 && !planMilestoneId) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft(draftKey, draft);
  }, [draftKey, draftReady, estimatedMinutes, knowledgePointIds, planMilestoneId, priority, relatedSyllabusNodeIds, subjectId, syllabusNodeId, stagePlanIds, taskType, title]);

  const selectedDayTasks = useMemo(() => {
    return props.initial.days.find((day) => day.date === selectedDate)?.tasks ?? props.initial.tasks;
  }, [props.initial.days, props.initial.tasks, selectedDate]);

  function pushQuery(next: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { ...props.query, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    startTransition(() => router.push(`/roadmap/allocation?${params.toString()}`));
  }

  function toggleStagePlan(stagePlanId: string) {
    setStagePlanIds((current) => current.includes(stagePlanId)
      ? current.filter((id) => id !== stagePlanId)
      : current.length < 20 ? [...current, stagePlanId] : current);
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
      stagePlanIds,
      knowledgePointIds,
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
      if (!body?.task?.id) {
        setError("服务端未返回已创建任务，当前输入与重试标识仍保留。");
        return;
      }
      const createdTaskId = body.task.id;
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(draftKey);
      setTitle("");
      setSyllabusNodeId("");
      setRelatedSyllabusNodeIds([]);
      setStagePlanIds([]);
      setKnowledgePointIds([]);
      setPlanMilestoneId("");
      setCreateOpen(false);
      startTransition(() => router.push(withReturnTo(`/roadmap/allocation/tasks/${createdTaskId}`, currentPlanHref)));
    } catch {
      setError("网络不可用，任务输入仍保留；恢复网络后请显式重试。");
    } finally {
      setCreatingTask(false);
    }
  }

  return (
    <PageFrame variant="dashboard-wide" className="space-y-5">
      <PageHeader
        title="投入安排"
        eyebrow="长期计划"
        description="把长期目标落到当前执行窗口，处理欠账与待确认计划"
      />
      {props.sourceResource ? (
        <p className={`rounded-md border px-3 py-2 text-sm ${props.sourceResource.archived ? "border-red-400/30 text-red-200" : "border-teal-400/20 text-teal-100"}`}>
          来源资料：{props.sourceResource.title}{props.sourceResource.archived ? "（已归档，不能创建关联任务）" : ""}
        </p>
      ) : null}

      <form
        className="grid gap-2 border-y border-white/10 py-3 sm:grid-cols-[minmax(14rem,1fr)_minmax(9rem,0.35fr)_minmax(8rem,0.3fr)_auto]"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          pushQuery({ q: searchQuery.trim() || undefined });
        }}
      >
        <label className="relative min-w-0">
          <span className="sr-only">搜索任务</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索七日任务"
            className="h-10 w-full rounded-md border border-white/10 bg-[#101419] pl-9 pr-3 text-sm text-white"
          />
        </label>
        <label>
          <span className="sr-only">科目筛选</span>
          <select className="h-10 w-full rounded-md border border-white/10 bg-[#101419] px-3 text-sm text-zinc-200" value={props.query.subjectId ?? ""} onChange={(event) => pushQuery({ subjectId: event.target.value || undefined })}>
            <option value="">全部科目</option>
            {props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">状态筛选</span>
          <select className="h-10 w-full rounded-md border border-white/10 bg-[#101419] px-3 text-sm text-zinc-200" value={props.query.status ?? ""} onChange={(event) => pushQuery({ status: event.target.value || undefined })}>
            <option value="">全部状态</option>
            <option value="todo">待开始</option>
            <option value="in_progress">进行中</option>
            <option value="deferred">已延期</option>
            <option value="done">已完成</option>
          </select>
        </label>
        <button type="submit" className={buttonClassName({ variant: "secondary" })}>搜索</button>
      </form>

      <div className={props.detailPanel ? "grid min-h-0 gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]" : "space-y-5"}>
        <div className="min-w-0 space-y-5">
          <div className={`gap-2 overflow-x-auto pb-1 ${props.detailPanel ? "flex" : "flex lg:hidden"}`} aria-label="日期条">
            {props.initial.days.map((day) => (
              <button
                key={day.date}
                type="button"
                className={`shrink-0 rounded-md border px-3 py-2 text-xs ${selectedDate === day.date ? "border-teal-400/50 bg-teal-400/5 text-teal-200" : "border-white/10 text-zinc-400"}`}
                onClick={() => pushQuery({ date: day.date })}
              >
                {formatPlanDay(day.date)} · {day.tasks.length}
              </button>
            ))}
          </div>

          {props.detailPanel ? (
            <DayTaskList
              date={selectedDate}
              tasks={selectedDayTasks}
              detailTaskId={props.detailTaskId}
              desktopHref={desktopTaskHref}
              mobileHref={(taskId) => withReturnTo(`/roadmap/allocation/tasks/${taskId}`, currentPlanHref)}
            />
          ) : (
            <>
              <div className="hidden gap-3 overflow-x-auto lg:flex xl:grid xl:grid-cols-7 xl:overflow-visible" aria-label="七天列">
                {props.initial.days.map((day) => (
                  <section key={day.date} className="min-w-[10rem] flex-1 rounded-md border border-white/10 bg-[#101419] p-3 xl:min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-medium text-zinc-200">{formatPlanDay(day.date)}</h2>
                      <span className="text-xs text-zinc-600">{day.tasks.length}</span>
                    </div>
                    {day.tasks.length ? (
                      <ul className="mt-3 space-y-2">
                        {day.tasks.map((task) => (
                          <li key={task.id} className="rounded-md border border-white/5 bg-black/10 p-2">
                            <ListDetailLink
                              href={withReturnTo(`/roadmap/allocation/tasks/${task.id}`, currentPlanHref)}
                              desktopHref={desktopTaskHref(task.id)}
                              focusId={`plan-task-desktop-${day.date}-${task.id}`}
                              className="block break-words text-sm text-white hover:text-teal-300"
                            >
                              {task.title}
                            </ListDetailLink>
                            <p className="mt-1 text-xs text-zinc-500">{task.subjectName} · {task.estimatedMinutes} 分</p>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-5 text-xs text-zinc-600">暂无任务</p>}
                  </section>
                ))}
              </div>
              <div className="lg:hidden">
                <DayTaskList
                  date={selectedDate}
                  tasks={selectedDayTasks}
                  detailTaskId={props.detailTaskId}
                  desktopHref={desktopTaskHref}
                  mobileHref={(taskId) => withReturnTo(`/roadmap/allocation/tasks/${taskId}`, currentPlanHref)}
                  onCreate={() => setCreateOpen(true)}
                />
              </div>
            </>
          )}

          {props.initial.debt.length > 0 ? (
            <section className="rounded-md border border-amber-400/20 bg-amber-500/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-amber-100">待处理欠账</h2>
                <span className="text-xs text-amber-200/60">{props.initial.debt.length}</span>
              </div>
              <ul className="mt-3 divide-y divide-amber-200/10">
                {props.initial.debt.map((task) => (
                  <li key={task.id} className="py-2 first:pt-0 last:pb-0">
                    <ListDetailLink
                      href={withReturnTo(`/roadmap/allocation/tasks/${task.id}`, currentPlanHref)}
                      desktopHref={desktopTaskHref(task.id)}
                      focusId={`plan-debt-${task.id}`}
                      className="block text-sm text-white hover:text-teal-300"
                    >
                      {task.title}
                    </ListDetailLink>
                    <p className="mt-1 text-xs text-amber-100/50">{task.subjectName} · 原计划 {formatShortDate(task.plannedDate)}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {props.detailPanel ? (
          <aside className="hidden max-h-[calc(100dvh-12rem)] min-h-[32rem] overflow-y-auto border-l border-white/10 pl-5 lg:block" aria-label="任务详情">
            {props.detailPanel}
          </aside>
        ) : null}
      </div>

      <Drawer open={createOpen} title={`新建任务 · ${selectedDate ?? "未排期"}`} onClose={() => setCreateOpen(false)}>
        <div className="grid gap-3 sm:grid-cols-2">
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
                setKnowledgePointIds([]);
                setStagePlanIds([]);
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
              <option value="">不关联考纲节点</option>
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
          <legend className="text-sm text-zinc-400">其他相关考纲节点（最多 20 个）</legend>
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
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm text-zinc-400">关联知识点（可多选，最多 50 个）</legend>
          <div className="grid max-h-44 gap-2 overflow-y-auto border-l border-white/10 pl-3 sm:grid-cols-2">
            {props.knowledgePoints.filter((point) => point.subject.id === subjectId || point.relatedSubjects.some((subject) => subject.id === subjectId)).map((point) => (
              <label key={point.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-300">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-400" checked={knowledgePointIds.includes(point.id)} onChange={() => setKnowledgePointIds((current) => current.includes(point.id) ? current.filter((id) => id !== point.id) : current.length < 50 ? [...current, point.id] : current)} />
                <span className="min-w-0 break-words">{point.title}</span>
              </label>
            ))}
            {props.knowledgePoints.length === 0 ? <p className="text-sm text-zinc-500">当前还没有知识点</p> : null}
          </div>
        </fieldset>
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm text-zinc-400">所属阶段（可多选，最多 20 个）</legend>
          <div className="grid max-h-44 gap-2 overflow-y-auto border-l border-white/10 pl-3 sm:grid-cols-2">
            {availableStagePlans.map((stagePlan) => (
              <label key={stagePlan.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-teal-400"
                  checked={stagePlanIds.includes(stagePlan.id)}
                  onChange={() => toggleStagePlan(stagePlan.id)}
                />
                <span className="min-w-0 break-words">{stagePlan.name}</span>
              </label>
            ))}
            {availableStagePlans.length === 0 ? <p className="text-sm text-zinc-500">当前没有可关联的阶段</p> : null}
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
      </Drawer>
    </PageFrame>
  );

  function desktopTaskHref(taskId: string): string {
    const params = new URLSearchParams();
    const merged = { ...props.query, date: selectedDate, taskId };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    return `/roadmap/allocation?${params.toString()}`;
  }
}

function DayTaskList(props: {
  date?: string;
  tasks: PlanRollingDto["tasks"];
  detailTaskId?: string;
  desktopHref: (taskId: string) => string;
  mobileHref: (taskId: string) => string;
  onCreate?: () => void;
}) {
  return (
    <section className="border-y border-white/10 py-4" aria-labelledby="selected-day-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="selected-day-heading" className="text-sm font-medium text-zinc-200">{props.date ? formatPlanDay(props.date) : "当日"}任务</h2>
          <p className="mt-1 text-xs text-zinc-500">{props.tasks.length} 项正式任务</p>
        </div>
        {props.tasks.length === 0 && props.onCreate ? (
          <button type="button" className={buttonClassName({ variant: "ghost", size: "sm" })} onClick={props.onCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            安排任务
          </button>
        ) : null}
      </div>
      {props.tasks.length ? (
        <ul className="mt-3 divide-y divide-white/10">
          {props.tasks.map((task) => (
            <li key={task.id} className={`py-3 first:pt-0 last:pb-0 ${props.detailTaskId === task.id ? "border-l-2 border-teal-400 pl-3" : ""}`}>
              <ListDetailLink
                href={props.mobileHref(task.id)}
                desktopHref={props.desktopHref(task.id)}
                focusId={`plan-task-${props.date ?? "undated"}-${task.id}`}
                className="block break-words text-sm font-medium text-white hover:text-teal-300"
              >
                {task.title}
              </ListDetailLink>
              <p className="mt-1 text-xs text-zinc-500">{task.subjectName} · {task.estimatedMinutes} 分 · {taskStatusLabel(task.status)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-dashed border-white/10 px-3 py-4">
          <p className="text-sm text-zinc-500">这一天还没有任务</p>
          {props.onCreate ? <button type="button" className="text-sm text-teal-300" onClick={props.onCreate}>安排任务</button> : null}
        </div>
      )}
    </section>
  );
}

function formatPlanDay(value: string): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" }).format(date);
  return `${value.slice(5)} ${weekday}`;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(date);
}

function taskStatusLabel(status: string): string {
  if (status === "in_progress") return "进行中";
  if (status === "done") return "已完成";
  if (status === "deferred") return "已延期";
  if (status === "skipped") return "已跳过";
  return "待开始";
}

function flattenSyllabusNodes(nodes: SyllabusOptionNodeDto[], depth = 0): Array<SyllabusOptionNodeDto & { depth: number }> {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenSyllabusNodes(node.children, depth + 1)]);
}

function createDraftSnapshot(input: {
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  stagePlanIds: string[];
  knowledgePointIds: string[];
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
    stagePlanIds: input.stagePlanIds,
    knowledgePointIds: input.knowledgePointIds,
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
    && Array.isArray(draft.stagePlanIds)
    && draft.stagePlanIds.every((id) => typeof id === "string")
    && Array.isArray(draft.knowledgePointIds)
    && draft.knowledgePointIds.every((id) => typeof id === "string")
    && typeof draft.planMilestoneId === "string"
    && typeof draft.title === "string"
    && typeof draft.type === "string"
    && ["low", "medium", "high", "critical"].includes(draft.priority ?? "")
    && typeof draft.estimatedMinutes === "number";
}
