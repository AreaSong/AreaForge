"use client";

import { createStagePlan } from "@/lib/api/stage";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { StagePlanConflictLatest } from "@/lib/contracts";
import type { StagePlanDto } from "@/lib/contracts";
import { classifyApiFailure } from "@/lib/client/api-errors";
import {
  isShanghaiDateInputError,
  isValidShanghaiDateRangeInput,
  shiftShanghaiDateInput,
  shanghaiDateRangeInputToIso,
} from "@/lib/formatters";
import { listStageTemplates, STAGE_TEMPLATE_CATALOG_VERSION } from "@areaforge/core";

const commandScope = "stage-plan:create";
const formDraftKey = "areaforge.command.stage-plan.create-draft";
const stageTemplates = listStageTemplates();

interface StagePlanPayload {
  baseRevision: number | null;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  mode: StagePlanDto["mode"];
  status: "active";
}

interface StagePlanFormDraft {
  baseRevision: number | null;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  mode: StagePlanDto["mode"];
  firstSubmittedPayload: StagePlanPayload | null;
}

interface StagePlanConflict {
  latest: StagePlanConflictLatest;
  fields: string[];
  submitted: StagePlanPayload;
}

export function StagePlanCreateForm(props: { initialStartDate: string; initialEndDate: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [name, setName] = useState("当前备考阶段");
  const [goal, setGoal] = useState("完成当前阶段核心目标");
  const [startDate, setStartDate] = useState(props.initialStartDate);
  const [endDate, setEndDate] = useState(props.initialEndDate);
  const [mode, setMode] = useState<StagePlanDto["mode"]>("maintain");
  const [firstSubmittedPayload, setFirstSubmittedPayload] = useState<StagePlanPayload | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<StagePlanConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isStagePlanFormDraft);
      if (restored) {
        setBaseRevision(restored.baseRevision);
        setName(restored.name);
        setGoal(restored.goal);
        setStartDate(restored.startDate);
        setEndDate(restored.endDate);
        setMode(restored.mode);
        setFirstSubmittedPayload(restored.firstSubmittedPayload);
        setDirty(true);
        setNotice(restored.firstSubmittedPayload
          ? "检测到尚未完成的阶段计划命令，请核对后显式重试。"
          : "已恢复本地阶段计划草稿。");
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!draftReady || !dirty) return;
    savePrivateBusinessDraft<StagePlanFormDraft>(formDraftKey, {
      baseRevision,
      name,
      goal,
      startDate,
      endDate,
      mode,
      firstSubmittedPayload,
    });
  }, [baseRevision, dirty, draftReady, endDate, firstSubmittedPayload, goal, mode, name, startDate]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (conflict) {
      setConflictOpen(true);
      return;
    }
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const payload = currentPayload();
      const submitted = firstSubmittedPayload && samePayload(firstSubmittedPayload, payload)
        ? firstSubmittedPayload
        : payload;
      setFirstSubmittedPayload(submitted);
      setDirty(true);
      savePrivateBusinessDraft<StagePlanFormDraft>(formDraftKey, currentDraft(submitted));
      const response = await createStagePlan({
        ...submitted,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "stage-plan", submitted),
      });
      const body = response.body;
      const failure = classifyApiFailure(response);
      if (failure.kind === "unauthorized") {
        setError("登录已过期，阶段计划草稿与命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        if (failure.kind === "conflict" && isStagePlanConflictLatest(body?.latest)) {
          setConflict({ latest: body.latest, fields: body.conflictFields ?? [], submitted });
          setConflictOpen(true);
        }
        setError(labelStagePlanError(body?.error));
        if (response.status === 404 && body?.workbench) router.push(body.workbench);
        return;
      }
      if (!body?.plan) {
        setError("服务端未返回已创建阶段计划，当前输入与重试标识仍保留。");
        return;
      }
      removePrivateBusinessDraft(formDraftKey);
      completeIdempotentCommand(commandScope);
      setDirty(false);
      setFirstSubmittedPayload(null);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "阶段起止日期无效，或结束日期早于开始日期；请重新选择。"
        : "网络结果未知，阶段计划草稿与命令仍保留；请先核对服务端状态，再显式重试。");
    } finally {
      setSaving(false);
    }
  }

  function currentPayload(): StagePlanPayload {
    const range = shanghaiDateRangeInputToIso(startDate, endDate);
    return {
      baseRevision,
      name,
      goal,
      startDate: range.start,
      endDate: range.end,
      mode,
      status: "active",
    };
  }

  function currentDraft(submitted: StagePlanPayload | null): StagePlanFormDraft {
    return { baseRevision, name, goal, startDate, endDate, mode, firstSubmittedPayload: submitted };
  }

  function adoptServerPlan() {
    removePrivateBusinessDraft(formDraftKey);
    completeIdempotentCommand(commandScope);
    setDirty(false);
    setFirstSubmittedPayload(null);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已采用服务端阶段计划，本地创建命令未重放。");
    startTransition(() => router.refresh());
  }

  function preserveDraftForLaterMerge() {
    if (!conflict) return;
    const nextBaseRevision = conflict.latest.plan?.revision ?? baseRevision;
    setBaseRevision(nextBaseRevision);
    setFirstSubmittedPayload(null);
    setDirty(true);
    completeIdempotentCommand(commandScope);
    savePrivateBusinessDraft<StagePlanFormDraft>(formDraftKey, {
      ...currentDraft(null),
      baseRevision: nextBaseRevision,
    });
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("本地输入已保留，未创建第二个当前阶段；请先处理服务端阶段计划。"
    );
    startTransition(() => router.refresh());
  }

  function markEdited() {
    setDirty(true);
    setFirstSubmittedPayload(null);
  }

  function applyTemplate(templateId: string) {
    const template = stageTemplates.find((item) => item.id === templateId);
    if (!template) return;
    let templateEndDate: string;
    try {
      templateEndDate = shiftShanghaiDateInput(startDate, template.durationDays - 1);
    } catch {
      setError("请先填写有效的阶段开始日期，再载入模板。");
      return;
    }
    setError(null);
    setName(template.name);
    setGoal(template.goal);
    setMode(template.mode);
    setEndDate(templateEndDate);
    markEdited();
    setNotice(`已载入「${template.name}」模板。字段仍可编辑，提交前不会写入。`);
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Field label="从阶段模板开始（可选）" htmlFor="stage-plan-template">
        <Select
          id="stage-plan-template"
          className="h-11 bg-[#0d1117]"
          defaultValue=""
          onChange={(event) => applyTemplate(event.target.value)}
        >
          <option value="">不使用模板，完全自定义</option>
          {stageTemplates.map((template) => (
            <option key={`${template.id}:${template.version}`} value={template.id}>
              {template.name} · {template.durationDays} 天
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs leading-5 text-zinc-500">
        模板目录 {STAGE_TEMPLATE_CATALOG_VERSION} 只填充表单，不会创建隐藏阶段；载入后可以修改全部字段。
      </p>
      <div className="af-content-grid-two grid gap-3">
        <Field label="阶段名称" htmlFor="stage-plan-name">
          <Input id="stage-plan-name" className="h-11 bg-[#0d1117]" maxLength={160} onChange={(event) => { setName(event.target.value); markEdited(); }} required value={name} />
        </Field>
        <Field label="阶段模式" htmlFor="stage-plan-mode">
          <Select id="stage-plan-mode" className="h-11 bg-[#0d1117]" onChange={(event) => { setMode(event.target.value as StagePlanDto["mode"]); markEdited(); }} value={mode}><option value="maintain">维持</option><option value="recovery">恢复</option><option value="strengthen">强化</option><option value="sprint">冲刺</option></Select>
        </Field>
        <Field label="开始日期" htmlFor="stage-plan-start-date">
          <Input id="stage-plan-start-date" className="h-11 bg-[#0d1117]" onChange={(event) => { setStartDate(event.target.value); markEdited(); }} required type="date" value={startDate} />
        </Field>
        <Field label="结束日期" htmlFor="stage-plan-end-date">
          <Input id="stage-plan-end-date" className="h-11 bg-[#0d1117]" min={startDate} onChange={(event) => { setEndDate(event.target.value); markEdited(); }} required type="date" value={endDate} />
        </Field>
      </div>
      <Field label="阶段目标" htmlFor="stage-plan-goal">
        <Textarea id="stage-plan-goal" className="bg-[#0d1117]" maxLength={2000} onChange={(event) => { setGoal(event.target.value); markEdited(); }} required value={goal} />
      </Field>
      <Button className="af-container-action h-11" disabled={pending || saving} loading={saving} loadingLabel="创建中..." type="submit" variant="primary">创建阶段计划</Button>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理阶段计划创建冲突"
        description="服务端当前阶段已变化，本地创建命令不会自动重放。"
        conflictFields={conflict?.fields ?? []}
        comparisons={conflict ? stagePlanComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerPlan}
        onManualMerge={preserveDraftForLaterMerge}
        mergeLabel="保留本地输入稍后处理"
      />
    </form>
  );
}

function stagePlanComparisons(conflict: StagePlanConflict) {
  const server = conflict.latest.plan;
  return [
    { field: "baseRevision", label: "创建基线", local: conflict.submitted.baseRevision, server: server?.revision ?? null },
    { field: "plan.revision", label: "服务端阶段 revision", local: null, server: server?.revision ?? null },
    { field: "name", label: "阶段名称", local: conflict.submitted.name, server: server?.name ?? null },
    { field: "goal", label: "阶段目标", local: conflict.submitted.goal, server: server?.goal ?? null },
    { field: "mode", label: "阶段模式", local: conflict.submitted.mode, server: server?.mode ?? null },
  ];
}

function isStagePlanConflictLatest(value: unknown): value is StagePlanConflictLatest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "stage-plan");
}

function isStagePlanFormDraft(value: unknown): value is StagePlanFormDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<StagePlanFormDraft>;
  return (draft.baseRevision === null || typeof draft.baseRevision === "number")
    && typeof draft.name === "string"
    && typeof draft.goal === "string"
    && isValidShanghaiDateRangeInput(draft.startDate, draft.endDate)
    && ["maintain", "recovery", "strengthen", "sprint"].includes(draft.mode ?? "")
    && (draft.firstSubmittedPayload === null || isStagePlanPayload(draft.firstSubmittedPayload));
}

function isStagePlanPayload(value: unknown): value is StagePlanPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<StagePlanPayload>;
  return (payload.baseRevision === null || typeof payload.baseRevision === "number")
    && typeof payload.name === "string"
    && typeof payload.goal === "string"
    && typeof payload.startDate === "string"
    && typeof payload.endDate === "string"
    && ["maintain", "recovery", "strengthen", "sprint"].includes(payload.mode ?? "")
    && payload.status === "active";
}

function samePayload(left: StagePlanPayload, right: StagePlanPayload): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function labelStagePlanError(error?: string): string {
  if (error === "STAGE_PLAN_DATE_RANGE_INVALID") return "结束日期不能早于开始日期。";
  if (error === "STAGE_PLAN_BASE_REVISION_CONFLICT") return "其他页面已创建当前阶段，请先处理服务端版本。";
  return error ?? "创建阶段计划失败。";
}
