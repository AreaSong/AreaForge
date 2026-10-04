"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  convertPlanInboxItem,
  transitionPlanInboxItem,
  updatePlanInboxItem,
} from "@/lib/api/plan-inbox";
import { createPlanMilestone } from "@/lib/api/planning";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { shanghaiDateInputToIso } from "@/lib/formatters";
import type { PlanInboxFormOptions, PlanInboxItemDto } from "@/lib/contracts";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { PlanInboxItemView } from "@/components/plan-inbox-item-view";
import {
  createPlanInboxConvertKey,
  isPlanInboxItemDto,
  isPlanInboxStoredDraftValue,
  legacyPlanInboxStoredDraft,
  initialPlanInboxEditorFields,
  planInboxDraftsEqual,
  toPlanInboxFormDraft,
  withInboxStatus,
  type DependencyType,
  type PendingPlanInboxConvert,
  type PlanInboxConflict,
  type PlanInboxFormDraft,
  type PlanInboxEditorFields,
  type PlanInboxStoredDraft,
} from "@/components/plan-inbox-item-utils";

export function PlanInboxItemClient({ userId, item: initialItem, options, returnTo: initialReturnTo }: { userId: string; item: PlanInboxItemDto; options: PlanInboxFormOptions; returnTo?: string }) {
  const router = useRouter();
  const returnTo = initialReturnTo ?? "/roadmap/allocation/drafts";
  const formDraftKey = `areaforge.plan-inbox.draft.${userId}.${initialItem.id}`;
  const savedBaseline = useRef(toPlanInboxFormDraft(initialItem));
  const [item, setItem] = useState(initialItem);
  const [title, setTitle] = useState(initialItem.title);
  const [subjectId, setSubjectId] = useState(initialItem.subjectId ?? "");
  const [plannedDate, setPlannedDate] = useState(toPlanInboxFormDraft(initialItem).plannedDate);
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
  const [editorFields, setEditorFields] = useState<PlanInboxEditorFields>(() => (
    initialPlanInboxEditorFields(savedBaseline.current, initialItem.requiredMilestoneKey)
  ));

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

  function toggleRelated(nodeId: string) {
    setRelatedNodeIds((current) => current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]);
  }

  function togglePredecessor(taskId: string) {
    setPredecessors((current) => current.some((entry) => entry.taskId === taskId) ? current.filter((entry) => entry.taskId !== taskId) : [...current, { taskId, dependencyType: "SOFT" }]);
  }

  function changeDependencyType(taskId: string, dependencyType: DependencyType) {
    setPredecessors((current) => current.map((entry) => entry.taskId === taskId
      ? { ...entry, dependencyType }
      : entry));
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
      const result = await updatePlanInboxItem(item.id, {
        expectedRevision: baseRevision,
        title: snapshot.title,
        subjectId: snapshot.subjectId || null,
        plannedDate: snapshot.plannedDate ? shanghaiDateInputToIso(snapshot.plannedDate) : null,
        estimatedMinutes: snapshot.estimatedMinutes ? Number(snapshot.estimatedMinutes) : null,
        priority: snapshot.priority,
        type: snapshot.type,
        planMilestoneId: snapshot.planMilestoneId || null,
        primaryNodeId: snapshot.primaryNodeId || null,
        relatedNodeIds: snapshot.relatedNodeIds,
        predecessorTasks: snapshot.predecessors,
      });
      const body = result.body;
      if (isUnauthorized(result)) {
        setError("登录已过期，Inbox 草稿和首次提交基线已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return null;
      }
      if (result.status === 404) {
        setError("这条 Inbox 草稿已不可用，本地输入仍保留；正在返回投入草稿。");
        router.replace(returnTo);
        return null;
      }
      if (!result.ok || !body?.item || !isPlanInboxItemDto(body.item)) {
        setError(`${body?.error ?? "保存失败，Inbox 草稿已保留"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
        if (isConflict(result) && isPlanInboxItemDto(body?.latest)) {
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
      const result = await convertPlanInboxItem(item.id, {
        expectedRevision: command.expectedRevision,
        idempotencyKey: command.idempotencyKey,
      });
      const body = result.body;
      if (isUnauthorized(result)) {
        setError("登录已过期，转换命令身份已保留。重新登录后请显式确认结果。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (result.status === 404) {
        clearPendingConvert(command);
        setError("这条 Inbox 草稿已不可用；正在返回投入草稿。");
        router.replace(returnTo);
        return;
      }
      if (!result.ok || !body?.item || !isPlanInboxItemDto(body.item)) {
        setError(`${body?.error ?? "转换失败，命令不会自动重放"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
        if (isConflict(result) && isPlanInboxItemDto(body?.latest)) {
          clearPendingConvert(command);
          setConflict({
            latest: body.latest,
            conflictFields: body.conflictFields ?? ["revision"],
            firstSubmissionSnapshot: firstSubmissionSnapshot ?? command.submittedSnapshot,
          });
          setConflictOpen(true);
        } else if (!isUnauthorized(result)) {
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
      const result = await transitionPlanInboxItem(item.id, action, item.revision);
      const body = result.body;
      if (isUnauthorized(result)) {
        setError("登录已过期，Inbox 草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (result.status === 404) {
        router.replace(returnTo);
        return;
      }
      if (!result.ok || !body?.item || !isPlanInboxItemDto(body.item)) {
        setError(body?.error ?? "操作失败，当前状态没有改变；请显式重试。");
        if (isConflict(result) && isPlanInboxItemDto(body?.latest)) {
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
      const result = await createPlanMilestone({
        stagePlanId: stagePlan.id,
        stableKey,
        title: stableKey,
        subjectId: subjectId || null,
      });
      const body = result.body;
      if (isUnauthorized(result)) return redirectToLoginWithCurrentLocation();
      if (!result.ok || !body?.milestone) {
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
    <PlanInboxItemView
      item={item}
      options={options}
      returnTo={returnTo}
      createdMilestone={createdMilestone}
      draft={currentDraft}
      baseRevision={baseRevision}
      dirty={dirty}
      pendingConvert={pendingConvert}
      error={error}
      conflict={conflict}
      conflictOpen={conflictOpen}
      busy={busy}
      editorFields={editorFields}
      onDraftChange={(patch) => applyFormDraft({ ...currentDraft, ...patch })}
      onToggleRelated={toggleRelated}
      onTogglePredecessor={togglePredecessor}
      onDependencyTypeChange={changeDependencyType}
      onRetryUnknownConvert={() => void retryUnknownConvert()}
      onSave={() => void save()}
      onConvert={() => void convert()}
      onTransition={(action) => void transition(action)}
      onCreateRequiredMilestone={() => void createRequiredMilestone()}
      onOpenAllFields={() => setEditorFields("all")}
      onConflictOpen={() => setConflictOpen(true)}
      onConflictClose={() => setConflictOpen(false)}
      onApplyServerVersion={applyServerVersion}
      onAdoptLatestRevision={adoptLatestRevisionForManualMerge}
    />
  );
}
