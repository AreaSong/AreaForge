"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConflictResolutionModal, type ConflictComparison } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { PlanInboxOriginSummary, planInboxOriginLabel } from "@/components/plan-inbox-origin";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { withReturnTo } from "@/lib/navigation/batch7";
import type { PlanInboxFormOptions, PlanInboxItemDto } from "@/lib/study/plan-inbox-service";

type DependencyType = "SOFT" | "HARD";

interface PlanInboxFormDraft {
  title: string;
  subjectId: string;
  plannedDate: string;
  estimatedMinutes: string;
  priority: string;
  type: string;
  planMilestoneId: string;
  primaryNodeId: string;
  relatedNodeIds: string[];
  predecessors: Array<{ taskId: string; dependencyType: DependencyType }>;
}

interface PlanInboxConflict {
  latest: PlanInboxItemDto;
  conflictFields: string[];
  firstSubmissionSnapshot: PlanInboxFormDraft | null;
}

interface PendingPlanInboxConvert {
  idempotencyKey: string;
  expectedRevision: number;
  submittedSnapshot: PlanInboxFormDraft;
  resultState: "unknown";
}

interface PlanInboxStoredDraft {
  version: 2;
  fields: PlanInboxFormDraft;
  baseRevision: number;
  dirty: boolean;
  firstSubmissionSnapshot: PlanInboxFormDraft | null;
  pendingConvert: PendingPlanInboxConvert | null;
}

function dateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function PlanInboxItemClient({ userId, item: initialItem, options, returnTo: initialReturnTo }: { userId: string; item: PlanInboxItemDto; options: PlanInboxFormOptions; returnTo?: string }) {
  const router = useRouter();
  const returnTo = initialReturnTo ?? "/roadmap/allocation/drafts";
  const formDraftKey = `areaforge.plan-inbox.draft.${userId}.${initialItem.id}`;
  const savedBaseline = useRef(toPlanInboxFormDraft(initialItem));
  const [item, setItem] = useState(initialItem);
  const [title, setTitle] = useState(initialItem.title);
  const [subjectId, setSubjectId] = useState(initialItem.subjectId ?? "");
  const [plannedDate, setPlannedDate] = useState(dateInput(initialItem.plannedDate));
  const [estimatedMinutes, setEstimatedMinutes] = useState(initialItem.estimatedMinutes?.toString() ?? "");
  const [priority, setPriority] = useState(initialItem.priority?.toUpperCase() ?? "MEDIUM");
  const [type, setType] = useState(initialItem.type ?? "focus");
  const [planMilestoneId, setPlanMilestoneId] = useState(initialItem.planMilestoneId ?? "");
  const [createdMilestone, setCreatedMilestone] = useState<{ id: string; subjectId: string | null; title: string } | null>(null);
  const [primaryNodeId, setPrimaryNodeId] = useState(initialItem.primaryNodeId ?? "");
  const [relatedNodeIds, setRelatedNodeIds] = useState(initialItem.relatedNodeIds);
  const [predecessors, setPredecessors] = useState<Array<{ taskId: string; dependencyType: DependencyType }>>(
    initialItem.dependencyRefs.filter((ref) => ref.targetType === "TASK" && ref.taskId).map((ref) => ({ taskId: ref.taskId as string, dependencyType: ref.dependencyType })),
  );
  const [baseRevision, setBaseRevision] = useState(initialItem.revision);
  const [firstSubmissionSnapshot, setFirstSubmissionSnapshot] = useState<PlanInboxFormDraft | null>(null);
  const [pendingConvert, setPendingConvert] = useState<PendingPlanInboxConvert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PlanInboxConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isPlanInboxStoredDraftValue);
      if (loaded) {
        const draft = "version" in loaded
          ? loaded
          : legacyPlanInboxStoredDraft(loaded, initialItem.revision);
        setBaseRevision(draft.baseRevision);
        setFirstSubmissionSnapshot(draft.firstSubmissionSnapshot);
        setPendingConvert(draft.pendingConvert);
        if (initialItem.status === "OPEN" && !initialItem.supersededByItemId) {
          applyFormDraft(draft.fields);
          if ((draft.dirty || draft.firstSubmissionSnapshot) && draft.baseRevision !== initialItem.revision) {
            setConflict({
              latest: initialItem,
              conflictFields: ["revision"],
              firstSubmissionSnapshot: draft.firstSubmissionSnapshot,
            });
            setConflictOpen(true);
            setError("服务端 revision 已变化，本地草稿仍保留；请先人工处理冲突。");
          }
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey, initialItem]);

  const currentDraft = useMemo<PlanInboxFormDraft>(() => ({
    title,
    subjectId,
    plannedDate,
    estimatedMinutes,
    priority,
    type,
    planMilestoneId,
    primaryNodeId,
    relatedNodeIds,
    predecessors,
  }), [estimatedMinutes, planMilestoneId, plannedDate, predecessors, primaryNodeId, priority, relatedNodeIds, subjectId, title, type]);
  const dirty = !planInboxDraftsEqual(currentDraft, savedBaseline.current);

  useEffect(() => {
    if (!draftReady) return;
    if (!dirty && !firstSubmissionSnapshot && !pendingConvert) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<PlanInboxStoredDraft>(formDraftKey, {
      version: 2,
      fields: currentDraft,
      baseRevision,
      dirty,
      firstSubmissionSnapshot,
      pendingConvert,
    });
  }, [baseRevision, currentDraft, dirty, draftReady, firstSubmissionSnapshot, formDraftKey, pendingConvert]);

  const nodes = useMemo(() => options.nodes.filter((node) => node.subjectId === subjectId), [options.nodes, subjectId]);
  const milestones = useMemo(() => [...options.milestones, ...(createdMilestone ? [createdMilestone] : [])].filter((milestone) => !milestone.subjectId || milestone.subjectId === subjectId), [options.milestones, createdMilestone, subjectId]);
  const tasks = options.tasks;
  const localMissing = [
    !title.trim() ? "标题" : null,
    !subjectId ? "科目" : null,
    !plannedDate ? "日期" : null,
    !Number(estimatedMinutes) || Number(estimatedMinutes) < 1 ? "预计时长" : null,
    item.requiredMilestoneKey && !planMilestoneId ? "里程碑" : null,
  ].filter((value): value is string => Boolean(value));
  const readOnly = item.status === "CONVERTED" || Boolean(item.supersededByItemId) || Boolean(pendingConvert);

  function toggleRelated(nodeId: string) {
    setRelatedNodeIds((current) => current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]);
  }

  function togglePredecessor(taskId: string) {
    setPredecessors((current) => current.some((entry) => entry.taskId === taskId) ? current.filter((entry) => entry.taskId !== taskId) : [...current, { taskId, dependencyType: "SOFT" }]);
  }

  async function save(): Promise<void> {
    if (busy || pendingConvert) return;
    if (conflict) return setConflictOpen(true);
    const snapshot = currentFormDraft();
    const firstSnapshot = firstSubmissionSnapshot ?? snapshot;
    setBusy(true);
    setError(null);
    try {
      await submitSave(snapshot, firstSnapshot, false);
    } finally {
      setBusy(false);
    }
  }

  async function submitSave(
    snapshot: PlanInboxFormDraft,
    firstSnapshot: PlanInboxFormDraft,
    keepSubmissionSnapshot: boolean,
  ): Promise<PlanInboxItemDto | null> {
    setFirstSubmissionSnapshot(firstSnapshot);
    persistStoredDraft(snapshot, baseRevision, true, firstSnapshot, pendingConvert);
    try {
      const response = await fetch(`/api/plan-inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: baseRevision,
          title: snapshot.title,
          subjectId: snapshot.subjectId || null,
          plannedDate: snapshot.plannedDate ? new Date(`${snapshot.plannedDate}T00:00:00+08:00`).toISOString() : null,
          estimatedMinutes: snapshot.estimatedMinutes ? Number(snapshot.estimatedMinutes) : null,
          priority: snapshot.priority,
          type: snapshot.type,
          planMilestoneId: snapshot.planMilestoneId || null,
          primaryNodeId: snapshot.primaryNodeId || null,
          relatedNodeIds: snapshot.relatedNodeIds,
          predecessorTasks: snapshot.predecessors,
        }),
      });
      const body = await readPlanInboxBody(response);
      if (response.status === 401) {
        setError("登录已过期，Inbox 草稿和首次提交基线已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return null;
      }
      if (response.status === 404) {
        setError("这条 Inbox 草稿已不可用，本地输入仍保留；正在返回投入草稿。");
        router.replace(returnTo);
        return null;
      }
      if (!response.ok || !body?.item || !isPlanInboxItemDto(body.item)) {
        setError(`${body?.error ?? "保存失败，Inbox 草稿已保留"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
        if (response.status === 409 && isPlanInboxItemDto(body?.latest)) {
          setConflict({
            latest: body.latest,
            conflictFields: body.conflictFields ?? ["revision"],
            firstSubmissionSnapshot: firstSnapshot,
          });
          setConflictOpen(true);
        }
        return null;
      }

      const serverDraft = toPlanInboxFormDraft(body.item);
      setItem(body.item);
      setBaseRevision(body.item.revision);
      savedBaseline.current = serverDraft;
      applyFormDraft(serverDraft);
      if (!keepSubmissionSnapshot) {
        setFirstSubmissionSnapshot(null);
        removePrivateBusinessDraft(formDraftKey);
      }
      return body.item;
    } catch {
      setError("网络不可用，Inbox 草稿和首次提交基线已保留；恢复网络后请显式重试。");
      return null;
    }
  }

  async function convert(): Promise<void> {
    if (busy) return;
    if (pendingConvert) return setError("上次转换结果仍未知，请先使用“确认上次转换结果”。");
    if (conflict) return setConflictOpen(true);

    const snapshot = currentFormDraft();
    const firstSnapshot = firstSubmissionSnapshot ?? snapshot;
    setBusy(true);
    setError(null);
    try {
      const saved = dirty
        ? await submitSave(snapshot, firstSnapshot, true)
        : item;
      if (!saved) return;
      const command: PendingPlanInboxConvert = {
        idempotencyKey: createPlanInboxConvertKey(saved.id),
        expectedRevision: saved.revision,
        submittedSnapshot: snapshot,
        resultState: "unknown",
      };
      const serverDraft = toPlanInboxFormDraft(saved);
      setPendingConvert(command);
      setFirstSubmissionSnapshot(firstSnapshot);
      persistStoredDraft(serverDraft, saved.revision, false, firstSnapshot, command);
      await submitConvert(command);
    } finally {
      setBusy(false);
    }
  }

  async function retryUnknownConvert(): Promise<void> {
    if (busy || !pendingConvert) return;
    setBusy(true);
    setError(null);
    try {
      await submitConvert(pendingConvert);
    } finally {
      setBusy(false);
    }
  }

  async function submitConvert(command: PendingPlanInboxConvert): Promise<void> {
    try {
      const response = await fetch(`/api/plan-inbox/${item.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: command.expectedRevision,
          idempotencyKey: command.idempotencyKey,
        }),
      });
      const body = await readPlanInboxBody(response);
      if (response.status === 401) {
        setError("登录已过期，转换命令身份已保留。重新登录后请显式确认结果。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        clearPendingConvert(command);
        setError("这条 Inbox 草稿已不可用；正在返回投入草稿。");
        router.replace(returnTo);
        return;
      }
      if (!response.ok || !body?.item || !isPlanInboxItemDto(body.item)) {
        setError(`${body?.error ?? "转换失败，命令不会自动重放"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
        if (response.status === 409 && isPlanInboxItemDto(body?.latest)) {
          clearPendingConvert(command);
          setConflict({
            latest: body.latest,
            conflictFields: body.conflictFields ?? ["revision"],
            firstSubmissionSnapshot: firstSubmissionSnapshot ?? command.submittedSnapshot,
          });
          setConflictOpen(true);
        } else if (response.status !== 401) {
          clearPendingConvert(command);
        }
        return;
      }

      setItem(body.item);
      setBaseRevision(body.item.revision);
      savedBaseline.current = toPlanInboxFormDraft(body.item);
      setPendingConvert(null);
      setFirstSubmissionSnapshot(null);
      removePrivateBusinessDraft(formDraftKey);
      router.replace(body.item.convertedTaskId
        ? withReturnTo(`/roadmap/allocation/tasks/${body.item.convertedTaskId}`, returnTo)
        : withInboxStatus(returnTo, "CONVERTED"));
    } catch {
      setError("转换请求的结果未知。命令身份已持久保留；恢复网络后请显式确认结果，系统不会自动重放。");
    }
  }

  async function transition(action: "dismiss" | "reopen"): Promise<void> {
    if (busy || pendingConvert) return;
    if (conflict) return setConflictOpen(true);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/plan-inbox/${item.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: item.revision }),
      });
      const body = await readPlanInboxBody(response);
      if (response.status === 401) {
        setError("登录已过期，Inbox 草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        router.replace(returnTo);
        return;
      }
      if (!response.ok || !body?.item || !isPlanInboxItemDto(body.item)) {
        setError(body?.error ?? "操作失败，当前状态没有改变；请显式重试。");
        if (response.status === 409 && isPlanInboxItemDto(body?.latest)) {
          setConflict({
            latest: body.latest,
            conflictFields: body.conflictFields ?? ["revision"],
            firstSubmissionSnapshot,
          });
          setConflictOpen(true);
        }
        return;
      }
      setItem(body.item);
      setBaseRevision(body.item.revision);
    } catch {
      setError("网络不可用，当前状态没有改变；恢复网络后请显式重试。");
    } finally {
      setBusy(false);
    }
  }

  function currentFormDraft(): PlanInboxFormDraft {
    return currentDraft;
  }

  function applyFormDraft(draft: PlanInboxFormDraft): void {
    setTitle(draft.title);
    setSubjectId(draft.subjectId);
    setPlannedDate(draft.plannedDate);
    setEstimatedMinutes(draft.estimatedMinutes);
    setPriority(draft.priority);
    setType(draft.type);
    setPlanMilestoneId(draft.planMilestoneId);
    setPrimaryNodeId(draft.primaryNodeId);
    setRelatedNodeIds(draft.relatedNodeIds);
    setPredecessors(draft.predecessors);
  }

  function persistStoredDraft(
    fields: PlanInboxFormDraft,
    revision: number,
    isDirty: boolean,
    firstSnapshot: PlanInboxFormDraft | null,
    command: PendingPlanInboxConvert | null,
    key = formDraftKey,
  ): void {
    savePrivateBusinessDraft<PlanInboxStoredDraft>(key, {
      version: 2,
      fields,
      baseRevision: revision,
      dirty: isDirty,
      firstSubmissionSnapshot: firstSnapshot,
      pendingConvert: command,
    });
  }

  function clearPendingConvert(command: PendingPlanInboxConvert): void {
    setPendingConvert(null);
    persistStoredDraft(
      command.submittedSnapshot,
      command.expectedRevision,
      !planInboxDraftsEqual(command.submittedSnapshot, savedBaseline.current),
      firstSubmissionSnapshot ?? command.submittedSnapshot,
      null,
    );
  }

  function applyServerVersion(latest: PlanInboxItemDto): void {
    const draft = toPlanInboxFormDraft(latest);
    setItem(latest);
    setBaseRevision(latest.revision);
    savedBaseline.current = draft;
    applyFormDraft(draft);
    setFirstSubmissionSnapshot(null);
    setPendingConvert(null);
    removePrivateBusinessDraft(formDraftKey);
    setConflict(null);
    setConflictOpen(false);
    setError(`已明确采用服务端 r${latest.revision}，没有自动提交任何写入。`);
    if (latest.id !== initialItem.id) router.replace(withReturnTo(`/roadmap/allocation/drafts/${latest.id}`, returnTo));
  }

  function adoptLatestRevisionForManualMerge(latest: PlanInboxItemDto): void {
    const localDraft = currentFormDraft();
    const latestDraft = toPlanInboxFormDraft(latest);
    if (latest.id !== initialItem.id) {
      const successorKey = `areaforge.plan-inbox.draft.${userId}.${latest.id}`;
      persistStoredDraft(localDraft, latest.revision, true, null, null, successorKey);
      setDraftReady(false);
      removePrivateBusinessDraft(formDraftKey);
      router.replace(withReturnTo(`/roadmap/allocation/drafts/${latest.id}`, returnTo));
    }
    setItem(latest);
    setBaseRevision(latest.revision);
    savedBaseline.current = latestDraft;
    setFirstSubmissionSnapshot(null);
    setPendingConvert(null);
    setConflict(null);
    setConflictOpen(false);
    setError("本地输入已保留并改为基于服务端最新 revision；请检查后显式再次提交。");
  }

  async function createRequiredMilestone() {
    if (busy || pendingConvert) return;
    const stableKey = item.requiredMilestoneKey;
    const stagePlan = options.stagePlans[0];
    if (!stableKey || !stagePlan) {
      setError("请先创建当前阶段计划，再创建里程碑。");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/plan-milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagePlanId: stagePlan.id, stableKey, title: stableKey, subjectId: subjectId || null }),
      });
      const body = await response.json().catch(() => null) as { milestone?: { id: string; subjectId: string | null; title: string }; error?: string } | null;
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok || !body?.milestone) {
        setError(body?.error ?? "创建里程碑失败，Inbox 草稿仍保留");
        return;
      }
      setCreatedMilestone(body.milestone);
      setPlanMilestoneId(body.milestone.id);
    } catch {
      setError("网络不可用，Inbox 草稿仍保留；恢复网络后请显式重试创建里程碑。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <Link href={returnTo} className="text-sm text-zinc-400 hover:text-zinc-200">返回收件箱</Link>
      <header>
        <p className="text-sm text-teal-300">{planInboxOriginLabel(item.originType)}</p>
        <DetailHeading className="mt-1 text-3xl font-semibold text-white">
          {item.originType === "DAILY_REVIEW_MINIMUM" ? "补全明日任务" : "计划草稿"}
        </DetailHeading>
        <p className="mt-2 text-sm text-zinc-500">
          {planInboxStatusLabel(item.status)} · 版本 {item.revision}{dirty ? " · 有未保存修改" : ""}
        </p>
      </header>
      {item.supersededByItemId ? <p className="rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-sm text-amber-200">已被新版本取代。<Link href={withReturnTo(`/roadmap/allocation/drafts/${item.supersededByItemId}`, detailHref(item.id, returnTo))} className="ml-2 text-teal-300 hover:underline">查看最新</Link></p> : null}
      {pendingConvert ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-sm text-amber-100">
          <span>上次转换结果未知；草稿、revision 与命令身份均已保留，不会自动重放。</span>
          <button type="button" disabled={busy} className="h-10 rounded-md border border-amber-200/30 px-3 disabled:opacity-50" onClick={() => void retryUnknownConvert()}>{busy ? "确认中..." : "确认上次转换结果"}</button>
        </div>
      ) : null}

      <PlanInboxOriginSummary item={item} returnTo={detailHref(item.id, returnTo)} />
      <details className="border-y border-white/10 py-3"><summary className="cursor-pointer text-sm text-zinc-400">高级来源信息</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-zinc-500">{JSON.stringify(item.originSnapshot, null, 2)}</pre></details>

      <div className="space-y-4 rounded-md border border-white/10 bg-[#101419] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">标题<input disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="block text-sm">科目<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setPrimaryNodeId(""); setRelatedNodeIds([]); }}><option value="">请选择</option>{options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
          <div className="text-sm">
            <label className="block">计划日期<input disabled={readOnly} type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
            {!readOnly ? (
              <div className="mt-2 flex gap-2" aria-label="快捷安排日期">
                <button type="button" className="text-xs text-teal-300 hover:text-teal-200" onClick={() => setPlannedDate(shanghaiDateOffset(0))}>今天</button>
                <button type="button" className="text-xs text-teal-300 hover:text-teal-200" onClick={() => setPlannedDate(shanghaiDateOffset(1))}>明天</button>
              </div>
            ) : null}
          </div>
          <label className="block text-sm">预计时长（分钟）<input disabled={readOnly} type="number" min="1" max="1440" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} /></label>
          <label className="block text-sm">优先级<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option><option value="CRITICAL">关键</option></select></label>
          <label className="block text-sm">类型<input disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={type} onChange={(event) => setType(event.target.value)} /></label>
          <label className="block text-sm">里程碑<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={planMilestoneId} onChange={(event) => setPlanMilestoneId(event.target.value)}><option value="">不关联</option>{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</select></label>
          <label className="block text-sm sm:col-span-2">主考纲节点<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={primaryNodeId} onChange={(event) => setPrimaryNodeId(event.target.value)}><option value="">不关联</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        </div>
        <fieldset className="min-w-0" disabled={readOnly}><legend className="text-sm font-medium text-white">相关考纲节点</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{nodes.filter((node) => node.id !== primaryNodeId).map((node) => <label key={node.id} className="flex min-w-0 items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={relatedNodeIds.includes(node.id)} onChange={() => toggleRelated(node.id)} /><span className="min-w-0 flex-1 truncate">{node.title}</span></label>)}{nodes.length === 0 ? <p className="text-sm text-zinc-500">选择科目后显示节点。</p> : null}</div></fieldset>
        <fieldset className="min-w-0" disabled={readOnly}><legend className="text-sm font-medium text-white">现有任务前置依赖</legend><div className="mt-2 space-y-2">{tasks.map((task) => { const entry = predecessors.find((value) => value.taskId === task.id); return <div key={task.id} className="flex min-w-0 flex-wrap items-center gap-2 text-sm"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={Boolean(entry)} onChange={() => togglePredecessor(task.id)} /><span className="min-w-0 flex-1 truncate">{task.subjectName} · {task.title}</span></label>{entry ? <select aria-label={`${task.title} 依赖类型`} className="h-9 rounded-md border border-white/10 bg-[#151a20] px-2" value={entry.dependencyType} onChange={(event) => setPredecessors((current) => current.map((value) => value.taskId === task.id ? { ...value, dependencyType: event.target.value as DependencyType } : value))}><option value="SOFT">软依赖</option><option value="HARD">硬依赖（阻止开始）</option></select> : null}</div>; })}{tasks.length === 0 ? <p className="text-sm text-zinc-500">当前工作区没有可用前置任务。</p> : null}</div></fieldset>
        {item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").map((ref) => <p key={ref.id} className="text-sm text-amber-200">前置计划 <Link className="text-teal-300 hover:underline" href={withReturnTo(`/roadmap/allocation/drafts?stableRef=${encodeURIComponent(`${ref.planStableKey ?? ""}@${ref.planOriginVersion ?? ""}`)}`, detailHref(item.id, returnTo))}>{ref.planStableKey}@{ref.planOriginVersion ?? "?"}</Link> 必须先转换（{ref.dependencyType}）。</p>)}
      </div>

      <section className="rounded-md border border-white/10 bg-[#101419] p-4"><h2 className="font-medium text-white">转换预览</h2><p className="mt-2 text-sm text-zinc-400">将创建 1 个正式任务、{relatedNodeIds.length} 个相关节点关系、{predecessors.length + item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").length} 条前置依赖。</p>{localMissing.length ? <p className="mt-2 text-sm text-amber-200">尚缺：{localMissing.join("、")}</p> : <p className="mt-2 text-sm text-emerald-300">必填字段完整。</p>}</section>

      <div className="flex flex-wrap gap-2">
        {item.status === "OPEN" && !readOnly ? <><button type="button" disabled={busy || !dirty} className="h-11 rounded-md border border-white/10 px-4 text-sm disabled:opacity-50" onClick={() => void save()}>{busy ? "处理中..." : "保存草稿"}</button><button type="button" disabled={busy || localMissing.length > 0} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void convert()}>{busy ? "保存并转换中..." : "转换为任务"}</button><button type="button" disabled={busy} className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-300 disabled:opacity-50" onClick={() => void transition("dismiss")}>忽略</button></> : null}
        {item.status === "DISMISSED" && !item.supersededByItemId ? <button type="button" disabled={busy || Boolean(pendingConvert)} className="h-11 rounded-md border border-white/10 px-4 text-sm text-teal-300 disabled:opacity-50" onClick={() => void transition("reopen")}>恢复 / Undo</button> : null}
        {item.convertedTaskId ? <Link href={withReturnTo(`/roadmap/allocation/tasks/${item.convertedTaskId}`, returnTo)} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium leading-[44px] text-black">打开任务</Link> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {item.requiredMilestoneKey && !item.planMilestoneId ? <div className="flex flex-wrap items-center gap-2 text-sm text-amber-200"><span>此草稿引用 canonical 里程碑 {item.requiredMilestoneKey}。</span><button type="button" className="text-teal-300 hover:underline disabled:opacity-50" disabled={busy || Boolean(pendingConvert) || !options.stagePlans.length} onClick={() => void createRequiredMilestone()}>创建并选中</button>{!options.stagePlans.length ? <Link className="text-teal-300 hover:underline" href={withReturnTo("/roadmap/stages", detailHref(item.id, returnTo))}>先创建阶段计划</Link> : null}</div> : null}
      {conflict ? <button type="button" className="text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>存在尚未处理的版本冲突</button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并 Inbox 版本冲突"
        description="服务端内容或状态已变化。本地输入与首次提交基线均已保留，系统不会自动采用、覆盖或重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? buildPlanInboxConflictComparisons(currentFormDraft(), baseRevision, item, conflict, pendingConvert) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={() => { if (conflict) applyServerVersion(conflict.latest); }}
        onManualMerge={() => { if (conflict) adoptLatestRevisionForManualMerge(conflict.latest); }}
        mergeLabel="保留本地输入并人工合并"
      />
    </section>
  );
}

function toPlanInboxFormDraft(item: PlanInboxItemDto): PlanInboxFormDraft {
  return {
    title: item.title,
    subjectId: item.subjectId ?? "",
    plannedDate: dateInput(item.plannedDate),
    estimatedMinutes: item.estimatedMinutes?.toString() ?? "",
    priority: item.priority?.toUpperCase() ?? "MEDIUM",
    type: item.type ?? "focus",
    planMilestoneId: item.planMilestoneId ?? "",
    primaryNodeId: item.primaryNodeId ?? "",
    relatedNodeIds: item.relatedNodeIds,
    predecessors: item.dependencyRefs
      .filter((ref) => ref.targetType === "TASK" && ref.taskId)
      .map((ref) => ({ taskId: ref.taskId as string, dependencyType: ref.dependencyType })),
  };
}

function planInboxStatusLabel(status: PlanInboxItemDto["status"]): string {
  if (status === "OPEN") return "待补全";
  if (status === "CONVERTED") return "已转为任务";
  return "已忽略";
}

function shanghaiDateOffset(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function buildPlanInboxConflictComparisons(
  local: PlanInboxFormDraft,
  baseRevision: number,
  localItem: PlanInboxItemDto,
  conflict: PlanInboxConflict,
  pendingConvert: PendingPlanInboxConvert | null,
): ConflictComparison[] {
  const server = toPlanInboxFormDraft(conflict.latest);
  const baseline = conflict.firstSubmissionSnapshot;
  const fields: Array<{ field: string; key: keyof PlanInboxFormDraft; label: string }> = [
    { field: "title", key: "title", label: "标题" },
    { field: "subjectId", key: "subjectId", label: "科目" },
    { field: "plannedDate", key: "plannedDate", label: "计划日期" },
    { field: "estimatedMinutes", key: "estimatedMinutes", label: "预计时长" },
    { field: "priority", key: "priority", label: "优先级" },
    { field: "type", key: "type", label: "类型" },
    { field: "planMilestoneId", key: "planMilestoneId", label: "里程碑" },
    { field: "primaryNodeId", key: "primaryNodeId", label: "主考纲节点" },
    { field: "relatedNodeIds", key: "relatedNodeIds", label: "相关考纲节点" },
    { field: "predecessorTasks", key: "predecessors", label: "前置依赖" },
  ];
  return [
    {
      field: "revision",
      label: "Inbox revision",
      ...(baseline ? { baseline: baseRevision } : {}),
      local: baseRevision,
      server: conflict.latest.revision,
    },
    {
      field: "status",
      label: "状态",
      local: localItem.status,
      server: conflict.latest.status,
    },
    ...fields.map(({ field, key, label }) => ({
      field,
      label,
      ...(baseline ? { baseline: baseline[key] } : {}),
      local: local[key],
      server: server[key],
    })),
    {
      field: "convertedTaskId",
      label: "转换结果任务",
      local: localItem.convertedTaskId,
      server: conflict.latest.convertedTaskId,
    },
    {
      field: "idempotencyKey",
      label: "本地转换命令身份",
      local: pendingConvert?.idempotencyKey ?? "未挂起",
      server: "服务端审计结果",
    },
  ];
}

function isPlanInboxFormDraft(value: unknown): value is PlanInboxFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PlanInboxFormDraft>;
  return [draft.title, draft.subjectId, draft.plannedDate, draft.estimatedMinutes, draft.priority, draft.type, draft.planMilestoneId, draft.primaryNodeId]
    .every((field) => typeof field === "string")
    && Array.isArray(draft.relatedNodeIds)
    && draft.relatedNodeIds.every((id) => typeof id === "string")
    && Array.isArray(draft.predecessors)
    && draft.predecessors.every((entry) => entry && typeof entry.taskId === "string" && (entry.dependencyType === "SOFT" || entry.dependencyType === "HARD"));
}

function isPlanInboxStoredDraftValue(value: unknown): value is PlanInboxStoredDraft | PlanInboxFormDraft {
  if (isPlanInboxFormDraft(value)) return true;
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PlanInboxStoredDraft>;
  return draft.version === 2
    && isPlanInboxFormDraft(draft.fields)
    && typeof draft.baseRevision === "number"
    && Number.isInteger(draft.baseRevision)
    && draft.baseRevision > 0
    && typeof draft.dirty === "boolean"
    && (draft.firstSubmissionSnapshot === null || isPlanInboxFormDraft(draft.firstSubmissionSnapshot))
    && (draft.pendingConvert === null || isPendingPlanInboxConvert(draft.pendingConvert));
}

function isPendingPlanInboxConvert(value: unknown): value is PendingPlanInboxConvert {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<PendingPlanInboxConvert>;
  return typeof command.idempotencyKey === "string"
    && command.idempotencyKey.length >= 8
    && typeof command.expectedRevision === "number"
    && Number.isInteger(command.expectedRevision)
    && command.expectedRevision > 0
    && isPlanInboxFormDraft(command.submittedSnapshot)
    && command.resultState === "unknown";
}

function legacyPlanInboxStoredDraft(fields: PlanInboxFormDraft, baseRevision: number): PlanInboxStoredDraft {
  return {
    version: 2,
    fields,
    baseRevision,
    dirty: true,
    firstSubmissionSnapshot: null,
    pendingConvert: null,
  };
}

function planInboxDraftsEqual(left: PlanInboxFormDraft, right: PlanInboxFormDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createPlanInboxConvertKey(itemId: string): string {
  const identity = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `plan-inbox-convert-${itemId}-${identity}`;
}

interface PlanInboxApiBody {
  item?: unknown;
  latest?: unknown;
  error?: string;
  conflictFields?: string[];
  workbench?: string;
}

async function readPlanInboxBody(response: Response): Promise<PlanInboxApiBody | null> {
  return response.json().catch(() => null) as Promise<PlanInboxApiBody | null>;
}

function isPlanInboxItemDto(value: unknown): value is PlanInboxItemDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PlanInboxItemDto>;
  return typeof item.id === "string"
    && typeof item.workspaceId === "string"
    && typeof item.originKey === "string"
    && typeof item.originVersion === "number"
    && (item.status === "OPEN" || item.status === "DISMISSED" || item.status === "CONVERTED")
    && typeof item.revision === "number"
    && Array.isArray(item.relatedNodeIds)
    && Array.isArray(item.dependencyRefs);
}

function detailHref(itemId: string, returnTo: string): string {
  return withReturnTo(`/roadmap/allocation/drafts/${itemId}`, returnTo);
}

function withInboxStatus(returnTo: string, status: "OPEN" | "DISMISSED" | "CONVERTED"): string {
  try {
    const url = new URL(returnTo, "https://areaforge.invalid");
    if (url.pathname !== "/roadmap/allocation/drafts") return `/roadmap/allocation/drafts?status=${status}`;
    url.searchParams.set("status", status);
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return `/roadmap/allocation/drafts?status=${status}`;
  }
}
