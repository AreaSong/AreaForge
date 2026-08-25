"use client";

import { Button } from "@/components/ui/button";
import { Checkbox, Select, Textarea, Input } from "@/components/ui/field";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import { Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { Alert, PersistenceStatus } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/overlays";
import { updateTask } from "@/lib/api/tasks";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { useUnsavedChangesWarning } from "@/lib/client/use-unsaved-changes-warning";
import type { PlanMilestoneDto } from "@/lib/contracts";
import type { StagePlanDto } from "@/lib/contracts";
import type { TaskUpdateSnapshotDto } from "@/lib/contracts";
import type { SubjectDto, SyllabusOptionNodeDto } from "@/lib/contracts";
import type { KnowledgePointDto } from "@/lib/contracts";
import {
  editValuesEqual,
  flattenNodes,
  isTaskEditDraft,
  isTaskUpdateSnapshot,
  saveTaskDraft,
  studyDateToIso,
  taskConflictComparisons,
  valuesFromSnapshot,
  type TaskEditConflict,
  type TaskEditValues,
} from "@/components/task-detail-editor-utils";

export function TaskDetailEditor(props: {
  snapshot: TaskUpdateSnapshotDto;
  subjects: SubjectDto[];
  syllabusNodes: SyllabusOptionNodeDto[];
  milestones: PlanMilestoneDto[];
  stagePlans: StagePlanDto[];
  knowledgePoints: KnowledgePointDto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const draftKey = `areaforge.task.draft.${props.snapshot.id}`;
  const [baseline, setBaseline] = useState(props.snapshot);
  const [values, setValues] = useState<TaskEditValues>(() => valuesFromSnapshot(props.snapshot));
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<TaskEditConflict | null>(null);
  const [draftNeedsRebase, setDraftNeedsRebase] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const flatNodes = useMemo(() => flattenNodes(props.syllabusNodes), [props.syllabusNodes]);
  const availableNodes = flatNodes.filter((node) => node.subjectId === values.subjectId);
  const availableMilestones = props.milestones.filter((milestone) =>
    !milestone.archivedAt && (!milestone.subjectId || milestone.subjectId === values.subjectId),
  );
  const availableStagePlans = props.stagePlans.filter((stagePlan) => stagePlan.status === "draft" || stagePlan.status === "active");
  const dirty = !editValuesEqual(values, valuesFromSnapshot(baseline));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isTaskEditDraft);
      if (saved) {
        setValues(saved.values);
        if (saved.expectedStatus !== props.snapshot.status || saved.expectedUpdatedAt !== props.snapshot.updatedAt) {
          setDraftNeedsRebase(true);
          setError("本地草稿来自旧任务版本。确认以服务端最新版本为基线前，系统不会提交。");
        }
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, props.snapshot.status, props.snapshot.updatedAt]);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    saveTaskDraft(draftKey, baseline, values);
  }, [baseline, dirty, draftKey, hydrated, values]);

  useUnsavedChangesWarning(dirty);

  function changeSubject(subjectId: string) {
    setValues((current) => ({
      ...current,
      subjectId,
      syllabusNodeId: "",
      relatedSyllabusNodeIds: [],
      planMilestoneId: "",
    }));
  }

  function toggleRelatedNode(nodeId: string) {
    setValues((current) => ({
      ...current,
      relatedSyllabusNodeIds: current.relatedSyllabusNodeIds.includes(nodeId)
        ? current.relatedSyllabusNodeIds.filter((id) => id !== nodeId)
        : current.relatedSyllabusNodeIds.length < 20
          ? [...current.relatedSyllabusNodeIds, nodeId]
          : current.relatedSyllabusNodeIds,
    }));
  }

  function toggleStagePlan(stagePlanId: string) {
    setValues((current) => ({
      ...current,
      stagePlanIds: current.stagePlanIds.includes(stagePlanId)
        ? current.stagePlanIds.filter((id) => id !== stagePlanId)
        : current.stagePlanIds.length < 20
          ? [...current.stagePlanIds, stagePlanId]
          : current.stagePlanIds,
    }));
  }

  function toggleKnowledgePoint(pointId: string) {
    setValues((current) => ({
      ...current,
      knowledgePointIds: current.knowledgePointIds.includes(pointId)
        ? current.knowledgePointIds.filter((id) => id !== pointId)
        : current.knowledgePointIds.length < 50
          ? [...current.knowledgePointIds, pointId]
          : current.knowledgePointIds,
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (draftNeedsRebase) {
      setError("请先确认以服务端最新版本为基线，或放弃旧草稿。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await updateTask(props.snapshot.id, {
        expectedStatus: baseline.status,
        expectedUpdatedAt: baseline.updatedAt,
        subjectId: values.subjectId,
        syllabusNodeId: values.syllabusNodeId || null,
        relatedSyllabusNodeIds: values.relatedSyllabusNodeIds,
        knowledgePointIds: values.knowledgePointIds,
        stagePlanIds: values.stagePlanIds,
        planMilestoneId: values.planMilestoneId || null,
        title: values.title,
        type: values.type,
        priority: values.priority,
        plannedDate: studyDateToIso(values.plannedDate),
        estimatedMinutes: values.estimatedMinutes,
        reviewText: values.reviewText.trim() || null,
      });
      const body = result.body;

      if (isUnauthorized(result)) {
        saveTaskDraft(draftKey, baseline, values);
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (isConflict(result) && isTaskUpdateSnapshot(body?.latest)) {
        saveTaskDraft(draftKey, baseline, values);
        setConflict({
          baseline,
          latest: body.latest,
          conflictFields: body?.conflictFields ?? ["updatedAt"],
        });
        return;
      }
      if (!result.ok) {
        setError(body?.error ?? "保存失败，本地输入仍保留");
        return;
      }

      removePrivateBusinessDraft(draftKey);
      props.onSaved();
    } catch {
      saveTaskDraft(draftKey, baseline, values);
      setError("网络不可用，本地草稿已保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (dirty) setCloseConfirmationOpen(true);
    else props.onCancel();
  }

  return (
    <>
      <form className="space-y-5 border-y border-white/10 py-5" onSubmit={submit}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-white">编辑任务</h2>
            <PersistenceStatus state={conflict || draftNeedsRebase ? "conflict" : saving ? "saving" : dirty ? "local-draft" : "clean"} />
          </div>
        </div>

        <div className="af-content-grid-two grid gap-4">
          <label className="af-content-span-all grid gap-2 text-sm text-zinc-300">
            标题
            <Input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              value={values.title}
              maxLength={120}
              required
              onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            科目
            <Select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              value={values.subjectId}
              onChange={(event) => changeSubject(event.target.value)}
            >
              {props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            里程碑
            <Select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              value={values.planMilestoneId}
              onChange={(event) => setValues((current) => ({ ...current, planMilestoneId: event.target.value }))}
            >
              <option value="">不关联里程碑</option>
              {availableMilestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            主考纲节点
            <Select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              value={values.syllabusNodeId}
              onChange={(event) => setValues((current) => ({
                ...current,
                syllabusNodeId: event.target.value,
                relatedSyllabusNodeIds: current.relatedSyllabusNodeIds.filter((id) => id !== event.target.value),
              }))}
            >
              <option value="">不关联主节点</option>
              {availableNodes.map((node) => <option key={node.id} value={node.id}>{`${"  ".repeat(node.depth)}${node.title}`}</option>)}
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            计划日期
            <Input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              type="date"
              value={values.plannedDate}
              required
              onChange={(event) => setValues((current) => ({ ...current, plannedDate: event.target.value }))}
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            类型
            <Select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              value={values.type}
              onChange={(event) => setValues((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="study">学习</option>
              <option value="review">复习</option>
              <option value="practice">刷题</option>
              <option value="mistake">错题</option>
              <option value="simulation_exam">模拟</option>
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            优先级
            <Select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              value={values.priority}
              onChange={(event) => setValues((current) => ({ ...current, priority: event.target.value as TaskEditValues["priority"] }))}
            >
              <option value="critical">最高</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            预计分钟
            <Input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white"
              type="number"
              min={5}
              max={720}
              value={values.estimatedMinutes}
              onChange={(event) => setValues((current) => ({ ...current, estimatedMinutes: Number(event.target.value) }))}
            />
          </label>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-zinc-200">相关考纲节点（最多 20 个）</legend>
          <div className="af-content-grid-two grid max-h-52 gap-2 overflow-y-auto border-l border-white/10 pl-3">
            {availableNodes.filter((node) => node.id !== values.syllabusNodeId).map((node) => (
              <label key={node.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-400">
                <Checkbox
                  className="mt-1"
                  checked={values.relatedSyllabusNodeIds.includes(node.id)}
                  onChange={() => toggleRelatedNode(node.id)}
                />
                <span className="min-w-0 break-words">{`${"  ".repeat(node.depth)}${node.title}`}</span>
              </label>
            ))}
            {availableNodes.length === 0 ? <p className="text-sm text-zinc-500">该科目暂无可关联节点</p> : null}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-zinc-200">关联知识点（最多 50 个）</legend>
          <div className="af-content-grid-two grid max-h-52 gap-2 overflow-y-auto border-l border-white/10 pl-3">
            {props.knowledgePoints
              .filter((point) => point.subject.id === values.subjectId || point.relatedSubjects.some((subject) => subject.id === values.subjectId))
              .map((point) => (
                <label key={point.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-400">
                  <Checkbox className="mt-1" checked={values.knowledgePointIds.includes(point.id)} onChange={() => toggleKnowledgePoint(point.id)} />
                  <span className="min-w-0 break-words">{point.title}</span>
                </label>
              ))}
            {props.knowledgePoints.length === 0 ? <p className="text-sm text-zinc-500">当前还没有知识点</p> : null}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-zinc-200">所属阶段（可多选，最多 20 个）</legend>
          <div className="af-content-grid-two grid max-h-52 gap-2 overflow-y-auto border-l border-white/10 pl-3">
            {availableStagePlans.map((stagePlan) => (
              <label key={stagePlan.id} className="flex min-w-0 items-start gap-2 text-sm text-zinc-400">
                <Checkbox
                  className="mt-1"
                  checked={values.stagePlanIds.includes(stagePlan.id)}
                  onChange={() => toggleStagePlan(stagePlan.id)}
                />
                <span className="min-w-0 break-words">{stagePlan.name}</span>
              </label>
            ))}
            {availableStagePlans.length === 0 ? <p className="text-sm text-zinc-500">当前没有可关联的阶段</p> : null}
          </div>
        </fieldset>

        <label className="grid gap-2 text-sm text-zinc-300">
          任务复盘
          <Textarea
            className="min-h-28 rounded-md border border-white/10 bg-[#0d1117] p-3 text-white"
            value={values.reviewText}
            maxLength={2000}
            onChange={(event) => setValues((current) => ({ ...current, reviewText: event.target.value }))}
          />
        </label>

        {draftNeedsRebase ? (
          <div className="space-y-3 rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
            <p>服务端任务已在草稿保存后更新。请核对输入，再明确选择是否基于最新版本继续。</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-10 rounded-md border border-amber-200/30 px-3" onClick={() => {
                setDraftNeedsRebase(false);
                setError(null);
                saveTaskDraft(draftKey, baseline, values);
              }}>以最新版本为基线</Button>
              <Button type="button" className="h-10 px-3" onClick={() => {
                setValues(valuesFromSnapshot(baseline));
                setDraftNeedsRebase(false);
                setError(null);
                removePrivateBusinessDraft(draftKey);
              }}>放弃旧草稿</Button>
            </div>
          </div>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}
        <EditorActionBar
          primaryType="submit"
          primaryLabel="保存任务"
          primaryIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          primaryDisabled={draftNeedsRebase || !values.title.trim() || !values.subjectId || !values.plannedDate}
          loading={saving}
          secondaryLabel="关闭编辑"
          secondaryIcon={<X className="h-4 w-4" aria-hidden="true" />}
          onSecondary={requestClose}
          hint="保存后更新任务详情；关闭编辑不会写入服务端。"
        />
      </form>

      <Modal open={closeConfirmationOpen} title="保留未保存的任务编辑？" onClose={() => setCloseConfirmationOpen(false)}>
        <div className="space-y-4 text-sm text-zinc-300">
          <p>当前输入已保存在本设备。关闭编辑不会写入服务端。</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" className="h-10 px-3 text-zinc-300" onClick={() => setCloseConfirmationOpen(false)}>继续编辑</Button>
            <Button type="button" className="h-10 rounded-md border border-white/10 px-3" onClick={props.onCancel}>关闭并保留草稿</Button>
          </div>
        </div>
      </Modal>

      <ConflictResolutionModal
        open={Boolean(conflict)}
        title="任务已在其他页面更新"
        description="服务端版本已变化。本地草稿仍保留，请采用服务端版本，或基于最新版本人工合并后再次保存。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? taskConflictComparisons(conflict, values) : []}
        onAdoptServer={() => {
          if (!conflict) return;
          setBaseline(conflict.latest);
          setValues(valuesFromSnapshot(conflict.latest));
          setDraftNeedsRebase(false);
          removePrivateBusinessDraft(draftKey);
          setConflict(null);
        }}
        onManualMerge={() => {
          if (!conflict) return;
          setBaseline(conflict.latest);
          setDraftNeedsRebase(false);
          saveTaskDraft(draftKey, conflict.latest, values);
          setConflict(null);
        }}
      />
    </>
  );
}
