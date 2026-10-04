"use client";

import { isUnauthorized } from "@/lib/client/api-errors";
import { mutationFeedback } from "@/lib/client/mutation-feedback";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { TaskType } from "@areaforge/core";
import { Search } from "lucide-react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { createTask as createStudyTask } from "@/lib/api/tasks";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraftEnvelope,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { PlanMilestoneDto } from "@/lib/contracts";
import type { PlanRollingDto } from "@/lib/contracts";
import type { StagePlanDto, SyllabusOptionNodeDto, TaskPriorityDto } from "@/lib/contracts";
import type { KnowledgePointDto } from "@/lib/contracts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { useKeyedDraftHydration } from "@/lib/client/use-keyed-draft-hydration";
import { PlanRollingCreateDrawer } from "@/components/plan-rolling-create-drawer";
import { DayTaskList, formatPlanDay, formatShortDate } from "@/components/plan-rolling-day-list";
import {
  createDraftSnapshot,
  flattenSyllabusNodes,
  isTaskCreateDraft,
} from "@/components/plan-rolling-utils";
import { isShanghaiDateInputError, shanghaiDateInputToIso } from "@/lib/formatters";

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
  const [taskType, setTaskType] = useState<TaskType>("study");
  const [priority, setPriority] = useState<TaskPriorityDto>(props.createMinimum ? "high" : "medium");
  const [estimatedMinutes, setEstimatedMinutes] = useState(props.createMinimum ? 25 : 45);
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
  const {
    ready: draftReady,
    begin: beginDraftHydration,
    isCurrent: isDraftHydrationCurrent,
    complete: completeDraftHydration,
    cancel: cancelDraftHydration,
  } = useKeyedDraftHydration(draftKey);
  useRestoreListReturn(props.detailTaskId ?? "list");

  const flatSyllabusNodes = useMemo(() => flattenSyllabusNodes(props.syllabusNodes), [props.syllabusNodes]);
  const availableNodes = flatSyllabusNodes.filter((node) => node.subjectId === subjectId);
  const availableMilestones = props.milestones.filter((milestone) =>
    !milestone.archivedAt && (!milestone.subjectId || milestone.subjectId === subjectId),
  );
  const availableStagePlans = props.stagePlans.filter((stagePlan) => stagePlan.status === "draft" || stagePlan.status === "active");

  useEffect(() => {
    const token = beginDraftHydration();
    const timer = window.setTimeout(() => {
      const stored = loadPrivateBusinessDraftEnvelope(
        draftKey,
        LONG_PRIVATE_DRAFT_TTL_MS,
        isTaskCreateDraft,
      );
      if (!isDraftHydrationCurrent(token)) return;
      const fallbackSubjectId = props.sourceResource?.subjectId
        ?? props.query.subjectId
        ?? props.subjects[0]?.id
        ?? "";
      const draft = stored && props.subjects.some((subject) => subject.id === stored.value.subjectId)
        ? stored.value
        : createDraftSnapshot({
            subjectId: fallbackSubjectId,
            syllabusNodeId: props.sourceResource?.syllabusNodeId ?? props.query.syllabusNodeId ?? "",
            relatedSyllabusNodeIds: [],
            stagePlanIds: [],
            knowledgePointIds: [],
            planMilestoneId: "",
            title: props.createMinimum
              ? "今天最小任务"
              : props.sourceResource ? `学习：${props.sourceResource.title}` : "",
            taskType: "study",
            priority: props.createMinimum ? "high" : "medium",
            estimatedMinutes: props.createMinimum ? 25 : 45,
          });
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
      completeDraftHydration(token);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cancelDraftHydration(token);
    };
  }, [beginDraftHydration, cancelDraftHydration, completeDraftHydration, draftKey, isDraftHydrationCurrent, props.createMinimum, props.query.subjectId, props.query.syllabusNodeId, props.sourceResource, props.subjects]);

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

  function changeCreateSubject(nextSubjectId: string) {
    setSubjectId(nextSubjectId);
    setSyllabusNodeId("");
    setRelatedSyllabusNodeIds([]);
    setKnowledgePointIds([]);
    setStagePlanIds([]);
    setPlanMilestoneId("");
  }

  function changePrimarySyllabusNode(nodeId: string) {
    setSyllabusNodeId(nodeId);
    setRelatedSyllabusNodeIds((current) => current.filter((id) => id !== nodeId));
  }

  function toggleRelatedSyllabusNode(nodeId: string) {
    setRelatedSyllabusNodeIds((current) => current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : current.length < 20 ? [...current, nodeId] : current);
  }

  function toggleKnowledgePoint(pointId: string) {
    setKnowledgePointIds((current) => current.includes(pointId)
      ? current.filter((id) => id !== pointId)
      : current.length < 50 ? [...current, pointId] : current);
  }

  async function createTask() {
    if (creatingTask) return;
    setError(null);
    if (!subjectId || !title.trim()) {
      setError("科目和标题必填");
      return;
    }
    setCreatingTask(true);
    const commandScope = `plan:create:${selectedDate ?? "undated"}:${props.sourceResource?.id ?? "direct"}`;
    try {
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
        plannedDate: selectedDate ? shanghaiDateInputToIso(selectedDate) : undefined,
      };
      const result = await createStudyTask({
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "task-create", payload),
        ...payload,
      });
      const body = result.body;
      if (isUnauthorized(result)) return redirectToLoginWithCurrentLocation();
      if (!result.ok) {
        setError(mutationFeedback(result, "创建失败，当前输入仍保留；请显式重试。").message);
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
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "计划日期无效，请重新选择；任务输入仍保留。"
        : "网络不可用，任务输入仍保留；恢复网络后请显式重试。");
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

      <Card variant="subtle" className="p-3.5">
        <form
          className="af-plan-filter-grid grid min-w-0 gap-2.5"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            pushQuery({ q: searchQuery.trim() || undefined });
          }}
        >
          <label className="relative min-w-0">
            <span className="sr-only">搜索任务</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" aria-hidden="true" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索七日任务"
              className="h-10 w-full pl-9 pr-3 text-sm"
            />
          </label>
          <label>
            <span className="sr-only">科目筛选</span>
            <Select className="h-10 w-full px-3 text-sm text-zinc-200" value={props.query.subjectId ?? ""} onChange={(event) => pushQuery({ subjectId: event.target.value || undefined })}>
              <option value="">全部科目</option>
              {props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
          </label>
          <label>
            <span className="sr-only">状态筛选</span>
            <Select className="h-10 w-full px-3 text-sm text-zinc-200" value={props.query.status ?? ""} onChange={(event) => pushQuery({ status: event.target.value || undefined })}>
              <option value="">全部状态</option>
              <option value="todo">待开始</option>
              <option value="in_progress">进行中</option>
              <option value="deferred">已延期</option>
              <option value="done">已完成</option>
            </Select>
          </label>
          <Button type="submit" variant="secondary">搜索</Button>
        </form>
      </Card>

      <div className={props.detailPanel ? "af-plan-layout-grid grid min-h-0 min-w-0 gap-5" : "space-y-5"}>
        <div className="min-w-0 space-y-5">
          <div className={`gap-2 overflow-x-auto pb-2 ${props.detailPanel ? "flex" : "af-plan-date-strip-wide-hidden flex"}`} tabIndex={0} aria-label="日期条" data-horizontal-scroll="date-strip">
            {props.initial.days.map((day) => (
              <Button
                variant="ghost"
                size="sm"
                key={day.date}
                type="button"
                className={`!h-auto shrink-0 rounded-xl border px-3.5 py-2 text-xs transition-all ${
                  selectedDate === day.date
                    ? "border-teal-500/30 bg-teal-400/10 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.15)] font-medium"
                    : "border-white/5 bg-white/[0.02] text-zinc-400 hover:border-white/10 hover:text-white"
                }`}
                onClick={() => pushQuery({ date: day.date })}
              >
                {formatPlanDay(day.date)} · {day.tasks.length}
              </Button>
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
              <div className="af-plan-seven-day gap-3 overflow-x-auto pb-2 flex" tabIndex={0} aria-label="七天列" data-horizontal-scroll="seven-day-plan">
                {props.initial.days.map((day) => (
                  <Card key={day.date} variant="subtle" className="af-plan-day-column flex-1 min-w-[190px] p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/5">
                        <h2 className="text-xs font-semibold text-zinc-200">{formatPlanDay(day.date)}</h2>
                        <span className="text-[11px] font-medium text-zinc-500 rounded px-1.5 py-0.5 bg-white/5">{day.tasks.length}</span>
                      </div>
                      {day.tasks.length ? (
                        <ul className="mt-3 space-y-2">
                          {day.tasks.map((task) => (
                            <li key={task.id} className="rounded-xl border border-white/10 bg-[#0e1619]/90 p-2.5 shadow-sm transition-colors hover:border-teal-400/40">
                              <ListDetailLink
                                href={withReturnTo(`/roadmap/allocation/tasks/${task.id}`, currentPlanHref)}
                                desktopHref={desktopTaskHref(task.id)}
                                focusId={`plan-task-desktop-${day.date}-${task.id}`}
                                className="block break-words text-xs font-medium text-white hover:text-teal-300"
                              >
                                {task.title}
                              </ListDetailLink>
                              <p className="mt-1 text-[11px] text-zinc-400">{task.subjectName} · {task.estimatedMinutes} 分</p>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-6 text-center text-xs text-zinc-600">暂无任务</p>}
                    </div>
                  </Card>
                ))}
              </div>
              <div className="af-plan-day-list">
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
            <Card variant="accent" className="border-amber-400/25 shadow-[0_0_16px_rgba(251,191,36,0.1)] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-amber-100">待处理欠账</h2>
                <span className="text-xs font-medium text-amber-200/80 rounded px-2 py-0.5 bg-amber-400/10">{props.initial.debt.length}</span>
              </div>
              <ul className="divide-y divide-amber-200/10">
                {props.initial.debt.map((task) => (
                  <li key={task.id} className="py-2.5 first:pt-0 last:pb-0">
                    <ListDetailLink
                      href={withReturnTo(`/roadmap/allocation/tasks/${task.id}`, currentPlanHref)}
                      desktopHref={desktopTaskHref(task.id)}
                      focusId={`plan-debt-${task.id}`}
                      className="block text-sm font-medium text-white hover:text-teal-300"
                    >
                      {task.title}
                    </ListDetailLink>
                    <p className="mt-1 text-xs text-amber-100/60">{task.subjectName} · 原计划 {formatShortDate(task.plannedDate)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        {props.detailPanel ? (
          <aside className="af-plan-detail-host min-w-0" aria-label="任务详情">
            {props.detailPanel}
          </aside>
        ) : null}
      </div>

      <PlanRollingCreateDrawer
        open={createOpen}
        selectedDate={selectedDate}
        title={title}
        subjectId={subjectId}
        subjects={props.subjects}
        planMilestoneId={planMilestoneId}
        availableMilestones={availableMilestones}
        syllabusNodeId={syllabusNodeId}
        availableNodes={availableNodes}
        estimatedMinutes={estimatedMinutes}
        taskType={taskType}
        priority={priority}
        relatedSyllabusNodeIds={relatedSyllabusNodeIds}
        knowledgePointIds={knowledgePointIds}
        knowledgePoints={props.knowledgePoints}
        stagePlanIds={stagePlanIds}
        availableStagePlans={availableStagePlans}
        error={error}
        pending={pending}
        creatingTask={creatingTask}
        sourceResourceArchived={Boolean(props.sourceResource?.archived)}
        onClose={() => setCreateOpen(false)}
        onTitleChange={setTitle}
        onSubjectChange={changeCreateSubject}
        onPlanMilestoneChange={setPlanMilestoneId}
        onSyllabusNodeChange={changePrimarySyllabusNode}
        onEstimatedMinutesChange={setEstimatedMinutes}
        onTaskTypeChange={setTaskType}
        onPriorityChange={setPriority}
        onRelatedSyllabusNodeToggle={toggleRelatedSyllabusNode}
        onKnowledgePointToggle={toggleKnowledgePoint}
        onStagePlanToggle={toggleStagePlan}
        onCreate={() => void createTask()}
      />
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
