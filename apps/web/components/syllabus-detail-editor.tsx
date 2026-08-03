"use client";

import { Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MasteryProofCondition } from "@areaforge/core";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { Alert, PersistenceStatus } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/overlays";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { useUnsavedChangesWarning } from "@/lib/client/use-unsaved-changes-warning";
import {
  MASTERY_STATUS_OPTIONS,
  masteryStatusLabel,
  syllabusLevelForMasteryStatus,
  type MasteryStatus,
} from "@/lib/study/mastery-status";
import type {
  SyllabusNodeDto,
  SyllabusNodeKindDto,
  SyllabusNodeStatusDto,
  SyllabusOptionNodeDto,
} from "@/lib/study/types";

interface SyllabusEditValues {
  parentId: string;
  title: string;
  kind: SyllabusNodeKindDto;
  status: SyllabusNodeStatusDto;
  masteryStatus: MasteryStatus | "";
  masteryConditions: MasteryProofCondition[];
  sortOrder: number;
  targetMinutes: number;
}

interface SyllabusEditDraft {
  baseRevision: number;
  values: SyllabusEditValues;
}

interface SyllabusConflict {
  baseline: SyllabusNodeDto;
  latest: SyllabusNodeDto;
  conflictFields: string[];
}

const masteryConditions: Array<{ value: MasteryProofCondition; label: string }> = [
  { value: "course_or_textbook", label: "课程或教材" },
  { value: "own_explanation", label: "能独立讲解" },
  { value: "basic_exercise", label: "基础题" },
  { value: "comprehensive_exercise", label: "综合题" },
  { value: "mistake_reviewed", label: "错题已复盘" },
  { value: "delayed_retest", label: "延迟复测" },
];

export function SyllabusDetailEditor(props: {
  node: SyllabusNodeDto;
  parentOptions: SyllabusOptionNodeDto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const draftKey = `areaforge.syllabus.draft.detail.${props.node.id}`;
  const [baseline, setBaseline] = useState(props.node);
  const [values, setValues] = useState<SyllabusEditValues>(() => valuesFromNode(props.node));
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SyllabusConflict | null>(null);
  const [draftNeedsRebase, setDraftNeedsRebase] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const options = useMemo(
    () => flattenParentOptions(props.parentOptions, props.node.id),
    [props.node.id, props.parentOptions],
  );
  const dirty = !valuesEqual(values, valuesFromNode(baseline));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isSyllabusEditDraft);
      if (draft) {
        setValues(draft.values);
        if (draft.baseRevision !== props.node.revision) {
          setDraftNeedsRebase(true);
          setError("本地草稿来自旧 revision。确认以服务端最新版本为基线前，系统不会提交。");
        }
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, props.node.revision]);

  useEffect(() => {
    if (!hydrated || !dirty) return;
    savePrivateBusinessDraft<SyllabusEditDraft>(draftKey, { baseRevision: baseline.revision, values });
  }, [baseline.revision, dirty, draftKey, hydrated, values]);

  useUnsavedChangesWarning(dirty);

  function toggleCondition(condition: MasteryProofCondition) {
    setValues((current) => ({
      ...current,
      masteryConditions: current.masteryConditions.includes(condition)
        ? current.masteryConditions.filter((item) => item !== condition)
        : [...current.masteryConditions, condition],
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
      const response = await fetch(`/api/syllabus/nodes/${props.node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: baseline.revision,
          parentId: values.parentId || null,
          title: values.title,
          kind: values.kind,
          status: values.status,
          masteryLevel: values.masteryStatus ? syllabusLevelForMasteryStatus(values.masteryStatus) : null,
          masteryConditions: values.masteryConditions,
          sortOrder: values.sortOrder,
          targetMinutes: values.targetMinutes,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        latest?: unknown;
        conflictFields?: string[];
      } | null;
      if (response.status === 401) {
        savePrivateBusinessDraft<SyllabusEditDraft>(draftKey, { baseRevision: baseline.revision, values });
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 409 && isSyllabusNodeDto(body?.latest)) {
        savePrivateBusinessDraft<SyllabusEditDraft>(draftKey, { baseRevision: baseline.revision, values });
        setConflict({ baseline, latest: body.latest, conflictFields: body?.conflictFields ?? ["revision"] });
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "保存失败，本地输入仍保留");
        return;
      }
      removePrivateBusinessDraft(draftKey);
      props.onSaved();
    } catch {
      savePrivateBusinessDraft<SyllabusEditDraft>(draftKey, { baseRevision: baseline.revision, values });
      setError("网络不可用，本地草稿已保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form className="space-y-5 border-y border-white/10 py-5" onSubmit={submit}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-white">编辑考纲节点</h2>
            <PersistenceStatus state={conflict || draftNeedsRebase ? "conflict" : saving ? "saving" : dirty ? "local-draft" : "clean"} />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-zinc-300 md:col-span-2">
            标题
            <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={values.title} maxLength={120} required onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            父节点
            <select className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={values.parentId} onChange={(event) => setValues((current) => ({ ...current, parentId: event.target.value }))}>
              <option value="">作为根节点</option>
              {values.parentId && !options.some((option) => option.id === values.parentId) ? <option value={values.parentId}>当前父节点（已归档或不可选）</option> : null}
              {options.map((option) => <option key={option.id} value={option.id}>{`${"  ".repeat(option.depth)}${option.title}`}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            节点类型
            <select className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={values.kind} onChange={(event) => setValues((current) => ({ ...current, kind: event.target.value as SyllabusNodeKindDto }))}>
              <option value="subject">科目</option><option value="chapter">章节</option><option value="topic">知识点</option><option value="problem_type">题型专题</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            状态
            <select className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={values.status} onChange={(event) => setValues((current) => ({ ...current, status: event.target.value as SyllabusNodeStatusDto }))}>
              <option value="not_started">未开始</option><option value="learning">学习中</option><option value="covered">已覆盖</option><option value="needs_review">待复习</option><option value="mastered">已掌握</option><option value="weak">薄弱</option><option value="deferred">延期</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            掌握状态
            <select className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={values.masteryStatus} onChange={(event) => setValues((current) => ({ ...current, masteryStatus: event.target.value as MasteryStatus | "" }))}>
              <option value="">未记录</option>
              {MASTERY_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{masteryStatusLabel(status)}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            排序
            <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" type="number" min={0} max={100000} value={values.sortOrder} onChange={(event) => setValues((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
          </label>
          <label className="grid gap-2 text-sm text-zinc-300">
            目标分钟
            <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" type="number" min={0} max={100000} value={values.targetMinutes} onChange={(event) => setValues((current) => ({ ...current, targetMinutes: Number(event.target.value) }))} />
          </label>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-zinc-200">掌握证明条件</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {masteryConditions.map((condition) => (
              <label key={condition.value} className="flex items-center gap-2 text-sm text-zinc-400">
                <input className="h-4 w-4 accent-teal-400" type="checkbox" checked={values.masteryConditions.includes(condition.value)} onChange={() => toggleCondition(condition.value)} />
                {condition.label}
              </label>
            ))}
          </div>
        </fieldset>
        {draftNeedsRebase ? (
          <div className="space-y-3 rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
            <p>服务端已在草稿保存后更新。请核对当前输入，再明确选择是否基于 r{baseline.revision} 继续。</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="h-10 rounded-md border border-amber-200/30 px-3" onClick={() => {
                setDraftNeedsRebase(false);
                setError(null);
                savePrivateBusinessDraft<SyllabusEditDraft>(draftKey, { baseRevision: baseline.revision, values });
              }}>以最新版本为基线</button>
              <button type="button" className="h-10 px-3" onClick={() => {
                setValues(valuesFromNode(baseline));
                setDraftNeedsRebase(false);
                setError(null);
                removePrivateBusinessDraft(draftKey);
              }}>放弃旧草稿</button>
            </div>
          </div>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <EditorActionBar
          primaryType="submit"
          primaryLabel="保存节点"
          primaryIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          primaryDisabled={draftNeedsRebase || !values.title.trim()}
          loading={saving}
          secondaryLabel="关闭编辑"
          secondaryIcon={<X className="h-4 w-4" aria-hidden="true" />}
          onSecondary={() => dirty ? setCloseConfirmationOpen(true) : props.onCancel()}
          hint="保存后更新节点结构；关闭编辑不会写入服务端。"
        />
      </form>

      <Modal open={closeConfirmationOpen} title="保留未保存的节点编辑？" onClose={() => setCloseConfirmationOpen(false)}>
        <div className="space-y-4 text-sm text-zinc-300"><p>当前输入已保存在本设备。关闭编辑不会写入服务端。</p><div className="flex justify-end gap-2"><button type="button" className="h-10 px-3" onClick={() => setCloseConfirmationOpen(false)}>继续编辑</button><button type="button" className="h-10 rounded-md border border-white/10 px-3" onClick={props.onCancel}>关闭并保留草稿</button></div></div>
      </Modal>
      <ConflictResolutionModal
        open={Boolean(conflict)}
        title="考纲节点已在其他页面更新"
        description="旧 revision 已失效。本地草稿仍保留，请采用服务端版本，或基于最新版本人工合并。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? conflictComparisons(conflict, values) : []}
        onAdoptServer={() => {
          if (!conflict) return;
          setBaseline(conflict.latest); setValues(valuesFromNode(conflict.latest)); setDraftNeedsRebase(false); removePrivateBusinessDraft(draftKey); setConflict(null);
        }}
        onManualMerge={() => {
          if (!conflict) return;
          setBaseline(conflict.latest); setDraftNeedsRebase(false); savePrivateBusinessDraft<SyllabusEditDraft>(draftKey, { baseRevision: conflict.latest.revision, values }); setConflict(null);
        }}
      />
    </>
  );
}

function valuesFromNode(node: SyllabusNodeDto): SyllabusEditValues {
  return { parentId: node.parentId ?? "", title: node.title, kind: node.kind, status: node.status, masteryStatus: node.masteryStatus, masteryConditions: node.masteryConditions, sortOrder: node.sortOrder, targetMinutes: node.targetMinutes };
}

function flattenParentOptions(nodes: SyllabusOptionNodeDto[], excludedId: string, depth = 0): Array<SyllabusOptionNodeDto & { depth: number }> {
  return nodes.flatMap((node) => node.id === excludedId ? [] : [{ ...node, depth }, ...flattenParentOptions(node.children, excludedId, depth + 1)]);
}

function conflictComparisons(conflict: SyllabusConflict, local: SyllabusEditValues) {
  const baseline = valuesFromNode(conflict.baseline); const server = valuesFromNode(conflict.latest);
  return (Object.keys(local) as Array<keyof SyllabusEditValues>).map((field) => ({ field, baseline: baseline[field], local: local[field], server: server[field] }));
}

function valuesEqual(left: SyllabusEditValues, right: SyllabusEditValues): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function isSyllabusEditDraft(value: unknown): value is SyllabusEditDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<SyllabusEditDraft>;
  return typeof draft.baseRevision === "number" && isSyllabusEditValues(draft.values);
}

function isSyllabusEditValues(value: unknown): value is SyllabusEditValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const values = value as Partial<SyllabusEditValues>;
  return typeof values.parentId === "string" && typeof values.title === "string" && typeof values.kind === "string" && typeof values.status === "string" && typeof values.masteryStatus === "string" && Array.isArray(values.masteryConditions) && typeof values.sortOrder === "number" && typeof values.targetMinutes === "number";
}

function isSyllabusNodeDto(value: unknown): value is SyllabusNodeDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Partial<SyllabusNodeDto>;
  return typeof node.id === "string" && typeof node.revision === "number" && typeof node.title === "string" && Array.isArray(node.masteryConditions);
}
