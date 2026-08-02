"use client";

import { Archive, ArchiveRestore, ArrowRight, Check, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { withReturnTo } from "@/lib/navigation/batch7";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { SimulationRemediationDto } from "@/lib/study/simulation-service";
import type {
  SimulationExamDto,
  SimulationLossItemDto,
  SimulationLossReasonDto,
  SyllabusOptionNodeDto,
} from "@/lib/study/types";

const reasons: Array<{ value: SimulationLossReasonDto; label: string }> = [
  ["CONCEPT_GAP", "概念缺口"], ["MEMORY_FORMULA", "记忆/公式"], ["METHOD_ERROR", "方法错误"],
  ["CALCULATION_CARELESS", "计算/粗心"], ["TIME_ALLOCATION", "时间分配"], ["READING_COMPREHENSION", "审题理解"],
  ["UNFAMILIAR_PATTERN", "题型陌生"], ["MINDSET", "心态"], ["UNANSWERED", "未作答"], ["OTHER", "其他"],
].map(([value, label]) => ({ value: value as SimulationLossReasonDto, label }));

interface SimulationLossItemDraft {
  clientKey: string;
  id: string | null;
  revision: number | null;
  archivedAt: string | null;
  dirty: boolean;
  reason: SimulationLossReasonDto;
  syllabusNodeId: string | null;
  lostScore: number;
  note: string;
}

interface SubjectDraft {
  subjectId: string;
  subjectResultId: string | null;
  expectedRevision?: number;
  paperFullScore: number;
  targetScore: number;
  actualScore: number;
  durationMinutes: number;
  blankQuestionCount: number;
  summary: string;
  lossItems: SimulationLossItemDraft[];
}

interface SimulationEditorDraft {
  schemaVersion: 2;
  baseRevision: number;
  summary: string;
  mindset: string;
  subjectDrafts: SubjectDraft[];
}

interface SimulationConflict {
  latest: SimulationExamDto;
  conflictFields: string[];
}

type LossItemAction = "save" | "archive" | "restore";

interface LossItemConflict {
  subjectId: string;
  clientKey: string;
  action: LossItemAction;
  latest: SimulationLossItemDto;
  conflictFields: string[];
}

interface SimulationErrorBody {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
}

interface LossItemMutationBody extends SimulationErrorBody {
  lossItem?: SimulationLossItemDto;
  versions?: {
    subjectResultRevision: number;
    examRevision: number;
    examStatus: SimulationExamDto["status"];
  };
}

interface SimulationDetailClientProps {
  userId: string;
  exam: SimulationExamDto;
  subjects: Array<{ id: string; name: string }>;
  syllabus: SyllabusOptionNodeDto[];
  remediations: SimulationRemediationDto[];
  returnTo: string;
}

export function SimulationDetailClient(props: SimulationDetailClientProps) {
  const router = useRouter();
  const subjectTabsId = useId();
  const [refreshPending, startTransition] = useTransition();
  const draftKey = `areaforge.simulation.draft.${props.userId}.${props.exam.id}`;
  const initialEditorDraft = toSimulationEditorDraft(props.exam, props.subjects);
  const savedBaseline = useRef(initialEditorDraft);
  const [selectedSubjectId, setSelectedSubjectId] = useState(props.subjects[0]?.id ?? "");
  const [summary, setSummary] = useState(initialEditorDraft.summary);
  const [mindset, setMindset] = useState(initialEditorDraft.mindset);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [examRevision, setExamRevision] = useState(initialEditorDraft.baseRevision);
  const [examStatus, setExamStatus] = useState(props.exam.status);
  const [hasStructuredResults, setHasStructuredResults] = useState(hasPersistedSubjectResults(props.exam));
  const [selectedOriginKeys, setSelectedOriginKeys] = useState<string[]>(props.remediations.filter((item) => !item.inboxItemId).map((item) => item.originKey));
  const [subjectDrafts, setSubjectDrafts] = useState(initialEditorDraft.subjectDrafts);
  const [draftReady, setDraftReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<SimulationConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [lossConflict, setLossConflict] = useState<LossItemConflict | null>(null);
  const [lossConflictOpen, setLossConflictOpen] = useState(false);
  const [remediationReceipt, setRemediationReceipt] = useState<{ created: number; reused: number } | null>(null);
  const pendingRemediations = props.remediations.filter((item) => !item.inboxItemId);
  const active = subjectDrafts.find((draft) => draft.subjectId === selectedSubjectId) ?? subjectDrafts[0];
  const conflictedLossItem = lossConflict
    ? subjectDrafts
        .find((draft) => draft.subjectId === lossConflict.subjectId)
        ?.lossItems.find((item) => item.clientKey === lossConflict.clientKey)
    : undefined;
  const nodes = useMemo(
    () => flattenNodes(props.syllabus).filter((node) => node.subjectId === active?.subjectId),
    [active?.subjectId, props.syllabus],
  );
  const busy = submitting || refreshPending;

  function handleSubjectTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || tabs.length === 0) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (props.exam.status === "CONFIRMED") {
        removePrivateBusinessDraft(draftKey);
        setDraftReady(true);
        return;
      }
      const saved = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isSimulationEditorDraft);
      if (saved) {
        setSummary(saved.summary);
        setMindset(saved.mindset);
        setExamRevision(saved.baseRevision);
        setSubjectDrafts(saved.subjectDrafts);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, props.exam.status]);

  useEffect(() => {
    if (!draftReady) return;
    if (examStatus === "CONFIRMED") {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    const current = buildEditorDraft(examRevision, summary, mindset, subjectDrafts);
    if (editorDraftsEqual(current, savedBaseline.current)) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft(draftKey, current);
  }, [draftKey, draftReady, examRevision, examStatus, mindset, subjectDrafts, summary]);

  function updateActive(patch: Partial<SubjectDraft>) {
    if (!active) return;
    setSubjectDrafts((items) => items.map((item) => item.subjectId === active.subjectId ? { ...item, ...patch } : item));
  }

  function addLossItem() {
    if (!active) return;
    updateActive({
      lossItems: [...active.lossItems, {
        clientKey: crypto.randomUUID(),
        id: null,
        revision: null,
        archivedAt: null,
        dirty: true,
        reason: "CONCEPT_GAP",
        syllabusNodeId: null,
        lostScore: 0.5,
        note: "",
      }],
    });
  }

  function updateLossItem(clientKey: string, patch: Partial<SimulationLossItemDraft>) {
    if (!active) return;
    updateActive({
      lossItems: active.lossItems.map((item) => item.clientKey === clientKey
        ? { ...item, ...patch, dirty: true }
        : item),
    });
  }

  function removeUnsavedLossItem(clientKey: string) {
    if (!active) return;
    updateActive({ lossItems: active.lossItems.filter((item) => item.clientKey !== clientKey) });
  }

  async function save() {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (hasPendingPersistedLossEdits(subjectDrafts)) {
      setError("已有分科仍有未保存的失分条目，请先逐项创建或保存，再保存整场结果。");
      return;
    }
    setSubmitting(true);
    const upgradingLegacy = !hasStructuredResults;
    try {
      const response = await fetch(`/api/simulation-exams/${props.exam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: examRevision,
          mindset,
          summary,
          lossReasons: [],
          subjectResults: subjectDrafts.map(toSubjectResultPayload),
        }),
      });
      const body = await readSimulationResponse(response);
      if (!response.ok) {
        handleWriteFailure(response.status, body, "保存模拟结果失败");
        return;
      }
      if (!body.exam) {
        setError("服务端未返回已保存考试；当前草稿仍保留，请显式重试。");
        return;
      }
      adoptExam(body.exam, true);
      setNotice(body.exam.warnings.length
        ? body.exam.warnings.join("；")
        : upgradingLegacy
          ? "旧记录已补齐分科并升级；原历史总分不再参与当前统计。"
          : "模拟结果已保存，补救不会自动入箱。");
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，模拟结果草稿已保留；恢复网络后请显式重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm() {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (hasPendingPersistedLossEdits(subjectDrafts)) {
      setError("仍有未保存的失分条目，请先逐项处理后再确认模拟结果。");
      return;
    }
    if (!summary.trim()) {
      setError("每次模拟考试都必须写下整场复盘，再确认考试事实。");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/simulation-exams/${props.exam.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: examRevision }),
      });
      const body = await readSimulationResponse(response);
      if (!response.ok) {
        handleWriteFailure(response.status, body, "确认模拟结果失败");
        return;
      }
      if (!body.exam) {
        setError("服务端未返回已确认考试；当前页面未假定成功，请刷新核对。");
        return;
      }
      adoptExam(body.exam, true);
      setNotice("模拟考试已确认并进入只读状态，补救仍需单独加入收件箱。");
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，确认结果未知；当前草稿已保留，请恢复网络后先刷新核对。");
    } finally {
      setSubmitting(false);
    }
  }

  async function mutateLossItem(subject: SubjectDraft, item: SimulationLossItemDraft, action: LossItemAction) {
    if (busy) return;
    if (!subject.subjectResultId) {
      setError("该分科尚未建立，请先保存整场分科结果；失分条目会在同一事务中创建。");
      return;
    }
    if (subject.expectedRevision == null) {
      setError("分科结果缺少 revision，请刷新后核对。");
      return;
    }
    if ((action !== "save" || item.id) && (!item.id || item.revision == null)) {
      setError("失分条目缺少稳定版本信息，请刷新后核对。");
      return;
    }

    setError(null);
    setNotice(null);
    setSubmitting(true);
    const commandScope = `simulation-loss:${props.exam.id}:${subject.subjectId}:${item.clientKey}`;
    const basePath = `/api/simulation/subject-results/${encodeURIComponent(subject.subjectResultId)}/loss-items`;
    const creating = action === "save" && !item.id;
    const endpoint = creating
      ? basePath
      : `${basePath}/${encodeURIComponent(item.id as string)}${action === "save" ? "" : `/${action}`}`;
    const parentRevisions = {
      expectedExamRevision: examRevision,
      expectedSubjectResultRevision: subject.expectedRevision,
    };
    const payload = action === "save"
      ? {
          ...parentRevisions,
          reason: item.reason,
          syllabusNodeId: item.syllabusNodeId,
          lostScore: item.lostScore,
          note: item.note || null,
        }
      : { ...parentRevisions, expectedRevision: item.revision };
    const requestBody = creating
      ? { ...payload, idempotencyKey: getOrCreateIdempotencyKey(commandScope, "simulation-loss-create", payload) }
      : action === "save"
        ? { ...payload, expectedRevision: item.revision }
        : payload;

    try {
      const response = await fetch(endpoint, {
        method: creating || action !== "save" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const body = await readLossItemMutationResponse(response);
      if (!response.ok) {
        handleLossItemWriteFailure(response.status, body, subject, item, action);
        return;
      }
      if (!body.lossItem || !body.versions) {
        setError("条目可能已写入，但服务端未返回父版本；请刷新页面核对后再继续。");
        return;
      }
      if (creating) completeIdempotentCommand(commandScope);
      adoptLossItemMutation(subject.subjectId, item, action, body.lossItem, body.versions);
      setNotice(lossMutationNotice(creating ? "create" : action));
      startTransition(() => router.refresh());
    } catch {
      setError("网络结果未知，失分操作意图仍保留；请先刷新核对服务端状态，再显式重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleLossItemWriteFailure(
    status: number,
    body: LossItemMutationBody,
    subject: SubjectDraft,
    item: SimulationLossItemDraft,
    action: LossItemAction,
  ) {
    if (status === 401) {
      setError("登录已过期，失分操作意图仍保留。重新登录后请显式重试。");
      redirectToLoginWithCurrentLocation();
      return;
    }
    if (status === 404) {
      setError("失分条目或分科结果已不存在；当前输入仍保留，正在返回模拟工作台。");
    router.replace(body.workbench === "/test/simulations" ? body.workbench : "/test/simulations");
      return;
    }
    if (status === 409 && isSimulationLossItemDto(body.latest)) {
      setLossConflict({
        subjectId: subject.subjectId,
        clientKey: item.clientKey,
        action,
        latest: body.latest,
        conflictFields: body.conflictFields ?? ["revision"],
      });
      setLossConflictOpen(true);
    } else if (status === 409 && isSimulationExamDto(body.latest)) {
      setConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["revision"] });
      setConflictOpen(true);
    }
    setError(labelLossItemError(body.error));
  }

  function adoptLossItemMutation(
    subjectId: string,
    submitted: SimulationLossItemDraft,
    action: LossItemAction,
    lossItem: SimulationLossItemDto,
    versions: NonNullable<LossItemMutationBody["versions"]>,
  ) {
    setExamRevision(versions.examRevision);
    setExamStatus(versions.examStatus);
    setSubjectDrafts((drafts) => drafts.map((draft) => draft.subjectId !== subjectId ? draft : {
      ...draft,
      expectedRevision: versions.subjectResultRevision,
      lossItems: draft.lossItems.map((candidate) => {
        if (candidate.clientKey !== submitted.clientKey) return candidate;
        if (action === "restore" && candidate.dirty) {
          return {
            ...candidate,
            clientKey: lossItem.id,
            id: lossItem.id,
            revision: lossItem.revision,
            archivedAt: lossItem.archivedAt,
          };
        }
        return toLossItemDraft(lossItem);
      }),
    }));
  }

  function adoptLossConflictServerVersion() {
    if (!lossConflict) return;
    const current = lossConflict;
    setSubjectDrafts((drafts) => replaceLossConflictItem(drafts, current, false));
    setLossConflict(null);
    setLossConflictOpen(false);
    setError(null);
    setNotice("已采用服务端失分条目；原操作未重放。");
    void refreshParentVersions(current.subjectId);
  }

  function keepLossIntentOnLatestRevision() {
    if (!lossConflict) return;
    const current = lossConflict;
    setSubjectDrafts((drafts) => replaceLossConflictItem(drafts, current, true));
    setLossConflict(null);
    setLossConflictOpen(false);
    setError(null);
    setNotice("已基于服务端最新 revision 保留本地输入或生命周期意图，请检查后再次提交。");
    void refreshParentVersions(current.subjectId);
  }

  async function refreshParentVersions(subjectId: string) {
    try {
      const response = await fetch(`/api/simulation-exams/${encodeURIComponent(props.exam.id)}`);
      const body = await readSimulationResponse(response);
      if (!response.ok || !body.exam) {
        setError("无法刷新模拟父版本，请刷新页面后再继续写入。");
        return;
      }
      const subject = body.exam.subjectResults.find((result) => result.subjectId === subjectId);
      setExamRevision(body.exam.revision);
      setExamStatus(body.exam.status);
      setSubjectDrafts((drafts) => drafts.map((draft) => draft.subjectId === subjectId
        ? { ...draft, subjectResultId: subject?.id ?? draft.subjectResultId, expectedRevision: subject?.revision }
        : draft));
    } catch {
      setError("网络不可用，无法刷新模拟父版本；请刷新页面后再继续写入。");
    }
  }

  async function addRemediations() {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (selectedOriginKeys.length === 0) {
      setError("请至少选择一项补救建议");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/simulation/exams/${props.exam.id}/remediations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: props.remediations
            .filter((item) => selectedOriginKeys.includes(item.originKey))
            .map((item) => ({ originKey: item.originKey, originVersion: item.originVersion })),
        }),
      });
      const body = (await response.json().catch(() => null)) as { created?: number; reused?: number; error?: string } | null;
      if (response.status === 401) {
        setError("登录已过期，模拟草稿与补救选择仍保留；重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        router.replace("/test/simulations");
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "加入收件箱失败；当前选择仍保留。");
        return;
      }
      const receipt = { created: body?.created ?? 0, reused: body?.reused ?? 0 };
      setRemediationReceipt(receipt);
      setNotice(`已加入 ${receipt.created} 项，复用 ${receipt.reused} 项。`);
    } catch {
      setError("网络不可用，补救选择仍保留；恢复网络后请显式重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleWriteFailure(status: number, body: SimulationErrorBody, fallback: string) {
    if (status === 401) {
      setError("登录已过期，模拟草稿仍保留；重新登录后请显式重试。");
      redirectToLoginWithCurrentLocation();
      return;
    }
    if (status === 404) {
      setError("模拟记录已不存在或不可访问；当前草稿仍保留，正在返回模拟工作台。");
        router.replace(body.workbench === "/test/simulations" ? body.workbench : "/test/simulations");
      return;
    }
    if (status === 409 && isSimulationExamDto(body.latest)) {
      setConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["revision"] });
      setConflictOpen(true);
    }
    setError(labelSaveError(body.error, fallback));
  }

  function adoptExam(exam: SimulationExamDto, clearDraft: boolean) {
    const next = toSimulationEditorDraft(exam, props.subjects);
    setExamRevision(next.baseRevision);
    setExamStatus(exam.status);
    setHasStructuredResults(hasPersistedSubjectResults(exam));
    setSummary(next.summary);
    setMindset(next.mindset);
    setSubjectDrafts(next.subjectDrafts);
    savedBaseline.current = next;
    if (clearDraft) removePrivateBusinessDraft(draftKey);
  }

  function adoptLatest() {
    if (!conflict) return;
    const latestRevision = conflict.latest.revision;
    adoptExam(conflict.latest, true);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice(`已采用服务端最新模拟版本 r${latestRevision}。`);
  }

  function mergeOntoLatest() {
    if (!conflict) return;
    const latest = conflict.latest;
    if (latest.status !== "DRAFT") {
      adoptExam(latest, true);
      setConflict(null);
      setConflictOpen(false);
      setError("服务端已确认这场模拟，已切换到只读冻结结果；旧本地草稿不会继续恢复或覆盖。");
      return;
    }
    setExamRevision(latest.revision);
    setHasStructuredResults(hasPersistedSubjectResults(latest));
    setSubjectDrafts((items) => items.map((item) => ({
      ...item,
      expectedRevision: latest.subjectResults.find((result) => result.subjectId === item.subjectId)?.revision,
    })));
    savedBaseline.current = toSimulationEditorDraft(latest, props.subjects);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice(`本地输入已改为基于服务端 r${latest.revision}；请检查差异后显式保存，不会自动重放旧请求。`);
  }

  if (!active) return <p className="text-sm text-amber-200">当前工作区没有可用科目。</p>;
  const activeLossItems = active.lossItems.filter((item) => !item.archivedAt);
  const archivedLossItems = active.lossItems.filter((item) => Boolean(item.archivedAt));
  const currentStep = examStatus === "CONFIRMED" ? 3 : hasStructuredResults ? 2 : 1;
  return (
    <div className="space-y-5">
      <ol className="grid border-y border-white/10 sm:grid-cols-3" aria-label="模拟考试处理进度">
        {[
          [1, "录入成绩", "记录分科事实"],
          [2, "分析失分", "核对并确认考试"],
          [3, "安排补救", "送入计划收件箱"],
        ].map(([step, title, description]) => {
          const stepNumber = Number(step);
          const completed = stepNumber < currentStep;
          const activeStep = stepNumber === currentStep;
          return (
            <li key={stepNumber} aria-current={activeStep ? "step" : undefined} className={`flex min-h-20 items-center gap-3 px-4 py-3 ${activeStep ? "bg-white/[0.04]" : ""}`}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs ${completed ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : activeStep ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-600"}`}>{completed ? <Check size={14} /> : stepNumber}</span>
              <span className="min-w-0"><span className={`block text-sm font-medium ${activeStep || completed ? "text-white" : "text-zinc-500"}`}>{title}</span><span className="block text-xs text-zinc-500">{description}</span></span>
            </li>
          );
        })}
      </ol>

      {examStatus === "CONFIRMED" ? (
        <section className="space-y-4 border-b border-white/10 pb-5">
          <SectionHeader title="选择补救动作" description="考试事实已经冻结。只选择需要进入计划的补救，系统不会自动创建正式任务。" meta={<Badge tone="success">事实已确认</Badge>} />
          {props.remediations.length > 0 ? (
            <div className="grid gap-2 lg:grid-cols-2">{props.remediations.map((item) => (
              <label key={item.originKey} className="flex min-w-0 items-start gap-3 border border-white/10 p-3 text-sm hover:border-white/20">
                <input type="checkbox" className="mt-1" disabled={Boolean(item.inboxItemId)} checked={Boolean(item.inboxItemId) || selectedOriginKeys.includes(item.originKey)} onChange={(event) => setSelectedOriginKeys((keys) => event.target.checked ? Array.from(new Set([...keys, item.originKey])) : keys.filter((key) => key !== item.originKey))} />
                <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-white">{item.subjectName} · {reasons.find((reason) => reason.value === item.reason)?.label}{item.inboxStatus ? <Badge tone={item.inboxStatus === "CONVERTED" ? "success" : item.inboxStatus === "DISMISSED" ? "neutral" : "info"}>{remediationInboxStatusLabel(item.inboxStatus)}</Badge> : null}</span><span className="mt-1 block text-xs text-zinc-500">{item.lostScore} 分{item.syllabusNodeTitle ? ` · ${item.syllabusNodeTitle}` : ""}</span></span>
              </label>
            ))}</div>
          ) : (
            <Alert tone="success" title="没有待安排的结构化补救">考试事实已完成，可回到阶段概览判断是否需要调整下一阶段。</Alert>
          )}
          {remediationReceipt ? (
            <Alert tone="success" title="补救已送入计划收件箱" action={<div className="flex flex-wrap gap-2"><ButtonLink href={withReturnTo("/plan/inbox", props.returnTo)} variant="primary" size="sm">处理收件箱<ArrowRight size={15} /></ButtonLink><ButtonLink href={withReturnTo("/plan/stages", props.returnTo)} variant="secondary" size="sm">重新评估阶段</ButtonLink></div>}>
              新建 {remediationReceipt.created} 项，复用已有 {remediationReceipt.reused} 项；仍需在收件箱中补全日期并显式转为任务。
            </Alert>
          ) : pendingRemediations.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="primary" size="lg" loading={busy} loadingLabel="送入中..." disabled={selectedOriginKeys.length === 0} onClick={() => void addRemediations()}>将选中补救送入收件箱</Button>
              <ButtonLink href={withReturnTo("/plan/stages", props.returnTo)} variant="ghost" size="lg">返回阶段安排</ButtonLink>
            </div>
          ) : props.remediations.length > 0 ? (
            <Alert tone="success" title="补救均已处理" action={<div className="flex flex-wrap gap-2"><ButtonLink href={withReturnTo("/plan/inbox", props.returnTo)} variant="primary" size="sm">查看计划收件箱<ArrowRight size={15} /></ButtonLink><ButtonLink href={withReturnTo("/plan/stages", props.returnTo)} variant="secondary" size="sm">重新评估阶段</ButtonLink></div>}>
              已入箱、已忽略或已转换的补救不会重复提交。
            </Alert>
          ) : (
            <ButtonLink href={withReturnTo("/plan/stages", props.returnTo)} variant="ghost" size="lg">返回阶段安排</ButtonLink>
          )}
        </section>
      ) : (
        <Alert tone="warning" title={hasStructuredResults ? "下一步：核对失分并确认考试事实" : "下一步：录入分科成绩"}>
          {hasStructuredResults ? "确认后成绩与失分将变为只读，之后才会进入补救安排。" : "先保存分科结果；每项分数按 0.5 分步进。"}
        </Alert>
      )}

      <SectionHeader title={examStatus === "CONFIRMED" ? "考试事实" : "录分与失分分析"} description={examStatus === "CONFIRMED" ? "以下内容已确认，只读保留。" : "按科目切换并记录成绩、用时和结构化失分。"} />
      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="模拟科目">
        {props.subjects.map((subject) => (
          <button
            key={subject.id}
            id={`${subjectTabsId}-tab-${subject.id}`}
            type="button"
            role="tab"
            aria-selected={active.subjectId === subject.id}
            aria-controls={`${subjectTabsId}-panel-${subject.id}`}
            tabIndex={active.subjectId === subject.id ? 0 : -1}
            onClick={() => setSelectedSubjectId(subject.id)}
            onKeyDown={handleSubjectTabKeyDown}
            className={`shrink-0 rounded-md border px-3 py-2 text-sm ${active.subjectId === subject.id ? "border-teal-400 text-teal-200" : "border-white/10 text-zinc-400"}`}
          >
            {subject.name}
          </button>
        ))}
      </div>
      <fieldset disabled={examStatus === "CONFIRMED" || busy} className="contents disabled:opacity-70">
        <div
          id={`${subjectTabsId}-panel-${active.subjectId}`}
          role="tabpanel"
          aria-labelledby={`${subjectTabsId}-tab-${active.subjectId}`}
          className="space-y-5"
        >
        <section className="border-y border-white/10 py-4">
          <h2 className="font-medium text-white">{props.subjects.find((item) => item.id === active.subjectId)?.name}分科结果</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(["paperFullScore", "targetScore", "actualScore", "durationMinutes", "blankQuestionCount"] as const).map((key) => (
              <label key={key} className="text-sm text-zinc-400">
                {{ paperFullScore: "卷面满分", targetScore: "目标分", actualScore: "实际分", durationMinutes: "用时（分）", blankQuestionCount: "未作答数" }[key]}
                <input type="number" step={key.includes("Score") ? 0.5 : 1} min={0} value={active[key]} onChange={(event) => updateActive({ [key]: Number(event.target.value) })} className="mt-1 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white" />
              </label>
            ))}
          </div>
          <label className="mt-3 block text-sm text-zinc-400">分科总结<textarea value={active.summary} onChange={(event) => updateActive({ summary: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] p-3 text-white" /></label>
        </section>
        <section className="border-y border-white/10 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-white">结构化失分</h2>
            <button type="button" onClick={addLossItem} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-200">
              <Plus aria-hidden="true" size={16} />新增失分
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {activeLossItems.length === 0 ? <p className="text-sm text-zinc-500">暂无结构化失分。</p> : null}
            {activeLossItems.map((item) => (
              <div key={item.id ?? item.clientKey} className="grid gap-2 rounded-md border border-white/10 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(9rem,1fr)_minmax(10rem,1fr)_7rem_minmax(10rem,1fr)_auto]">
                <select aria-label="失分原因" value={item.reason} onChange={(event) => updateLossItem(item.clientKey, { reason: event.target.value as SimulationLossReasonDto })} className="h-11 min-w-0 rounded-md bg-[#151a20] px-2">{reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select>
                <select aria-label="考纲节点" value={item.syllabusNodeId ?? ""} onChange={(event) => updateLossItem(item.clientKey, { syllabusNodeId: event.target.value || null })} className="h-11 min-w-0 rounded-md bg-[#151a20] px-2"><option value="">不关联节点</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
                <input aria-label="失分值" type="number" min={0.5} step={0.5} value={item.lostScore} onChange={(event) => updateLossItem(item.clientKey, { lostScore: Number(event.target.value) })} className="h-11 min-w-0 rounded-md bg-[#151a20] px-2" />
                <input aria-label="失分备注" value={item.note} maxLength={500} onChange={(event) => updateLossItem(item.clientKey, { note: event.target.value })} placeholder="备注" className="h-11 min-w-0 rounded-md bg-[#151a20] px-2" />
                <div className="flex min-h-11 flex-wrap items-center justify-end gap-1 sm:col-span-2 lg:col-span-1">
                  {item.id ? (
                    <>
                      <button type="button" disabled={busy || !item.dirty} aria-label="保存失分" title="保存失分" onClick={() => void mutateLossItem(active, item, "save")} className="grid h-10 w-10 place-items-center rounded-md text-teal-300 disabled:opacity-40"><Save aria-hidden="true" size={17} /></button>
                      <button type="button" disabled={busy || item.dirty} aria-label="归档失分" title={item.dirty ? "请先保存修改" : "归档失分"} onClick={() => void mutateLossItem(active, item, "archive")} className="grid h-10 w-10 place-items-center rounded-md text-red-300 disabled:opacity-40"><Archive aria-hidden="true" size={17} /></button>
                    </>
                  ) : active.subjectResultId ? (
                    <>
                      <button type="button" disabled={busy} aria-label="创建失分" title="创建失分" onClick={() => void mutateLossItem(active, item, "save")} className="grid h-10 w-10 place-items-center rounded-md text-teal-300 disabled:opacity-40"><Save aria-hidden="true" size={17} /></button>
                      <button type="button" disabled={busy} aria-label="移除未保存失分" title="移除未保存失分" onClick={() => removeUnsavedLossItem(item.clientKey)} className="grid h-10 w-10 place-items-center rounded-md text-red-300 disabled:opacity-40"><Trash2 aria-hidden="true" size={17} /></button>
                    </>
                  ) : (
                    <>
                      <span className="px-1 text-xs text-zinc-500">随分科保存</span>
                      <button type="button" disabled={busy} aria-label="移除未保存失分" title="移除未保存失分" onClick={() => removeUnsavedLossItem(item.clientKey)} className="grid h-10 w-10 place-items-center rounded-md text-red-300 disabled:opacity-40"><Trash2 aria-hidden="true" size={17} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {archivedLossItems.length > 0 ? (
            <details className="mt-4 border-t border-white/10 pt-3">
              <summary className="cursor-pointer text-sm text-zinc-400">已归档失分（{archivedLossItems.length}）</summary>
              <div className="mt-3 space-y-2">
                {archivedLossItems.map((item) => (
                  <div key={item.id ?? item.clientKey} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 p-3 text-sm">
                    <span className="min-w-0 text-zinc-400">{reasons.find((reason) => reason.value === item.reason)?.label ?? item.reason} · {item.lostScore} 分{item.note ? ` · ${item.note}` : ""}</span>
                    <button type="button" disabled={busy || !item.id} onClick={() => void mutateLossItem(active, item, "restore")} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-zinc-200 disabled:opacity-40"><ArchiveRestore aria-hidden="true" size={16} />恢复</button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>
        </div>
        <section className="border-y border-white/10 py-4">
          <h2 className="font-medium text-white">完成分析</h2>
          <p className="mt-1 text-sm text-zinc-500">记录整场状态与结论，作为确认前的最后核对。</p>
          <label className="mt-3 block text-sm text-zinc-400">心态<textarea value={mindset} onChange={(event) => setMindset(event.target.value)} className="mt-1 min-h-16 w-full rounded-md bg-[#151a20] p-3 text-white" /></label>
          <label className="mt-3 block text-sm text-zinc-400">整场总结<textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="mt-1 min-h-20 w-full rounded-md bg-[#151a20] p-3 text-white" /></label>
        </section>
      </fieldset>
      {examStatus === "DRAFT" ? (
        <section className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-medium text-white">保存后再确认</p><p className="mt-1 text-xs text-zinc-500">保存用于保留编辑结果；确认会冻结考试事实，不能直接撤销。</p></div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="lg" loading={busy} loadingLabel="保存中..." onClick={() => void save()}>{hasStructuredResults ? "保存模拟结果" : "补齐并升级分科记录"}</Button>
            {hasStructuredResults ? <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => void confirm()}>确认考试事实</Button> : null}
          </div>
        </section>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice && !remediationReceipt ? <Alert tone="success">{notice}</Alert> : null}
      {conflict && !conflictOpen ? <button type="button" className="text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理模拟版本冲突</button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并模拟结果冲突"
        description="这场模拟已在其他页面或设备更新。当前分科成绩、失分和总结仍保留，系统不会强制覆盖或自动重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={[
          { field: "revision", label: "考试 revision", local: examRevision, server: conflict?.latest.revision },
          { field: "summary", label: "整场总结", local: summary, server: conflict?.latest.summary },
          { field: "mindset", label: "心态", local: mindset, server: conflict?.latest.mindset },
          { field: "subjectResults", label: "分科成绩与失分", local: subjectDrafts, server: conflict?.latest.subjectResults },
          { field: "status", label: "考试状态", local: examStatus, server: conflict?.latest.status },
        ]}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptLatest}
        onManualMerge={mergeOntoLatest}
        adoptLabel="采用服务端最新结果"
        mergeLabel="基于最新版本人工合并"
      />
      <ConflictResolutionModal
        open={lossConflictOpen && Boolean(lossConflict)}
        title="处理失分条目冲突"
        description="该失分条目已在其他页面更新，原操作不会自动重放。"
        conflictFields={lossConflict?.conflictFields ?? []}
        comparisons={lossConflict ? [
          { field: "revision", label: "条目 revision", local: conflictedLossItem?.revision, server: lossConflict.latest.revision },
          { field: "reason", label: "失分原因", local: conflictedLossItem?.reason, server: lossConflict.latest.reason },
          { field: "lostScore", label: "失分值", local: conflictedLossItem?.lostScore, server: lossConflict.latest.lostScore },
          { field: "archivedAt", label: "归档状态", local: conflictedLossItem?.archivedAt, server: lossConflict.latest.archivedAt },
        ] : []}
        onClose={() => setLossConflictOpen(false)}
        onAdoptServer={adoptLossConflictServerVersion}
        onManualMerge={keepLossIntentOnLatestRevision}
        adoptLabel="采用服务端条目"
        mergeLabel="基于最新 revision 保留意图"
      />
    </div>
  );
}

async function readSimulationResponse(response: Response): Promise<SimulationErrorBody & { exam?: SimulationExamDto }> {
  return await response.json().catch(() => ({})) as SimulationErrorBody & { exam?: SimulationExamDto };
}

function flattenNodes(nodes: SyllabusOptionNodeDto[]): SyllabusOptionNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function hasPersistedSubjectResults(exam: SimulationExamDto): boolean {
  return exam.totalsSource === "subject_sum" && exam.subjectResults.length > 0;
}

function buildSubjectDrafts(exam: SimulationExamDto, subjects: Array<{ id: string }>): SubjectDraft[] {
  return subjects.map((subject) => {
    const existing = exam.subjectResults.find((result) => result.subjectId === subject.id);
    return {
      subjectId: subject.id,
      subjectResultId: existing?.id ?? null,
      expectedRevision: existing?.revision,
      paperFullScore: existing?.paperFullScore ?? 100,
      targetScore: existing?.targetScore ?? 0,
      actualScore: existing?.actualScore ?? 0,
      durationMinutes: existing?.durationMinutes ?? 0,
      blankQuestionCount: existing?.blankQuestionCount ?? 0,
      summary: existing?.summary ?? "",
      lossItems: existing?.lossItems.map(toLossItemDraft) ?? [],
    };
  });
}

function toSimulationEditorDraft(exam: SimulationExamDto, subjects: Array<{ id: string }>): SimulationEditorDraft {
  return buildEditorDraft(exam.revision, exam.summary ?? "", exam.mindset ?? "", buildSubjectDrafts(exam, subjects));
}

function buildEditorDraft(
  baseRevision: number,
  summary: string,
  mindset: string,
  subjectDrafts: SubjectDraft[],
): SimulationEditorDraft {
  return { schemaVersion: 2, baseRevision, summary, mindset, subjectDrafts };
}

function editorDraftsEqual(left: SimulationEditorDraft, right: SimulationEditorDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSimulationEditorDraft(value: unknown): value is SimulationEditorDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SimulationEditorDraft>;
  return draft.schemaVersion === 2
    && typeof draft.baseRevision === "number"
    && typeof draft.summary === "string"
    && typeof draft.mindset === "string"
    && Array.isArray(draft.subjectDrafts)
    && draft.subjectDrafts.every(isSubjectDraft);
}

function isSubjectDraft(value: unknown): value is SubjectDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SubjectDraft>;
  return typeof draft.subjectId === "string"
    && (draft.subjectResultId === null || typeof draft.subjectResultId === "string")
    && (draft.expectedRevision === undefined || typeof draft.expectedRevision === "number")
    && [draft.paperFullScore, draft.targetScore, draft.actualScore, draft.durationMinutes, draft.blankQuestionCount]
      .every((field) => typeof field === "number")
    && typeof draft.summary === "string"
    && Array.isArray(draft.lossItems)
    && draft.lossItems.every(isSimulationLossItemDraft);
}

function isSimulationLossItemDraft(value: unknown): value is SimulationLossItemDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<SimulationLossItemDraft>;
  return typeof item.clientKey === "string"
    && (item.id === null || typeof item.id === "string")
    && (item.revision === null || typeof item.revision === "number")
    && (item.archivedAt === null || typeof item.archivedAt === "string")
    && typeof item.dirty === "boolean"
    && reasons.some((reason) => reason.value === item.reason)
    && (item.syllabusNodeId === null || typeof item.syllabusNodeId === "string")
    && typeof item.lostScore === "number"
    && typeof item.note === "string";
}

function toSubjectResultPayload(draft: SubjectDraft) {
  return {
    subjectId: draft.subjectId,
    expectedRevision: draft.expectedRevision,
    paperFullScore: draft.paperFullScore,
    targetScore: draft.targetScore,
    actualScore: draft.actualScore,
    durationMinutes: draft.durationMinutes,
    blankQuestionCount: draft.blankQuestionCount,
    lossReasons: [],
    summary: draft.summary,
    ...(draft.subjectResultId ? {} : {
      lossItems: draft.lossItems.filter((item) => !item.archivedAt).map((item) => ({
        reason: item.reason,
        syllabusNodeId: item.syllabusNodeId,
        lostScore: item.lostScore,
        note: item.note || null,
      })),
    }),
  };
}

function hasPendingPersistedLossEdits(drafts: SubjectDraft[]): boolean {
  return drafts.some((draft) => Boolean(draft.subjectResultId)
    && draft.lossItems.some((item) => !item.id || item.dirty));
}

function toLossItemDraft(item: SimulationLossItemDto): SimulationLossItemDraft {
  return {
    clientKey: item.id,
    id: item.id,
    revision: item.revision,
    archivedAt: item.archivedAt,
    dirty: false,
    reason: item.reason,
    syllabusNodeId: item.syllabusNodeId,
    lostScore: item.lostScore,
    note: item.note ?? "",
  };
}

function replaceLossConflictItem(
  drafts: SubjectDraft[],
  conflict: LossItemConflict,
  preserveIntent: boolean,
): SubjectDraft[] {
  return drafts.map((draft) => draft.subjectId !== conflict.subjectId ? draft : {
    ...draft,
    lossItems: draft.lossItems.map((item) => {
      if (item.clientKey !== conflict.clientKey) return item;
      const latest = { ...toLossItemDraft(conflict.latest), clientKey: item.clientKey };
      if (!preserveIntent || conflict.action !== "save") return latest;
      return {
        ...item,
        id: conflict.latest.id,
        revision: conflict.latest.revision,
        archivedAt: conflict.latest.archivedAt,
        dirty: true,
      };
    }),
  });
}

function isSimulationLossItemDto(value: unknown): value is SimulationLossItemDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<SimulationLossItemDto>;
  return typeof item.id === "string"
    && typeof item.revision === "number"
    && typeof item.reason === "string"
    && typeof item.lostScore === "number"
    && (item.archivedAt === null || typeof item.archivedAt === "string");
}

async function readLossItemMutationResponse(response: Response): Promise<LossItemMutationBody> {
  return await response.json().catch(() => ({})) as LossItemMutationBody;
}

function lossMutationNotice(action: "create" | LossItemAction): string {
  if (action === "create") return "失分条目已创建，稳定 ID 与父版本已更新。";
  if (action === "archive") return "失分条目已归档，可在当前分科中恢复。";
  if (action === "restore") return "失分条目已恢复。";
  return "失分条目已保存。";
}

function remediationInboxStatusLabel(status: NonNullable<SimulationRemediationDto["inboxStatus"]>): string {
  if (status === "CONVERTED") return "已转任务";
  if (status === "DISMISSED") return "已忽略";
  return "已入收件箱";
}

function labelLossItemError(error: string | undefined): string {
  if (error === "SIMULATION_LOSS_ITEM_REVISION_CONFLICT") {
    return "失分条目已在其他页面更新；当前意图仍保留，请人工处理差异。";
  }
  if (error === "SIMULATION_EXAM_REVISION_CONFLICT" || error === "SIMULATION_SUBJECT_REVISION_CONFLICT") {
    return "考试或分科已在其他页面更新；失分操作未执行，请先处理父版本差异。";
  }
  if (error === "SIMULATION_EXAM_CONFIRMED") return "这场模拟已确认，失分条目已只读。";
  if (error === "SIMULATION_REVIEW_REQUIRED") return "请先保存整场复盘，再确认模拟考试。";
  if (error === "SUBJECT_ARCHIVED") return "相关科目已归档，失分操作未执行。";
  return error ?? "失分操作失败，当前输入仍保留。";
}

function isSimulationExamDto(value: unknown): value is SimulationExamDto {
  if (!value || typeof value !== "object") return false;
  const exam = value as Partial<SimulationExamDto>;
  return typeof exam.id === "string"
    && typeof exam.revision === "number"
    && (exam.status === "DRAFT" || exam.status === "CONFIRMED")
    && Array.isArray(exam.subjectResults);
}

function labelSaveError(error: string | undefined, fallback: string): string {
  if (error === "SIMULATION_EXAM_REVISION_CONFLICT" || error === "SIMULATION_SUBJECT_REVISION_CONFLICT") {
    return "其他页面已更新这场模拟；当前输入已保留，请先处理差异再显式提交。";
  }
  if (error === "SIMULATION_EXAM_CONFIRMED") {
    return "这场模拟已在服务端确认；当前本地草稿不会覆盖只读结果。";
  }
  if (error === "SUBJECT_ARCHIVED") {
    return "相关科目已归档；当前输入已保留，请先处理服务端最新状态。";
  }
  return error ?? `${fallback}；当前输入已保留。`;
}
