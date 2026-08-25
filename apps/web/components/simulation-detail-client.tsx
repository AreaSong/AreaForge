"use client";

import {
  addSimulationRemediationsToInbox,
  startSimulationExam,
  updateSimulationExamResults,
  type SimulationApiError,
} from "@/lib/api/simulation";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { publishActivityStatus } from "@/lib/client/activity-status";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { SimulationRemediationDto } from "@/lib/contracts";
import type {
  SimulationExamDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";
import {
  buildEditorDraft,
  editorDraftsEqual,
  flattenNodes,
  hasPendingPersistedLossEdits,
  hasPersistedSubjectResults,
  initialSimulationSubjectIds,
  isReadyForConfirmation,
  isSimulationExamDto,
  labelSaveError,
  sameStringSet,
  toSimulationEditorDraft,
  toSubjectResultPayload,
  type SimulationLossItemDraft,
  type SubjectDraft,
} from "@/components/simulation-detail-drafts";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { useSimulationDraftPersistence } from "@/components/simulation-detail-draft-persistence";
import { useSimulationLossItems } from "@/components/simulation-detail-loss-items";
import {
  SimulationDetailWorkspace,
  type SimulationConflict,
} from "@/components/simulation-detail-workspace";

type SimulationErrorBody = SimulationApiError;

interface SimulationDetailClientProps {
  userId: string;
  exam: SimulationExamDto;
  subjects: Array<{ id: string; name: string }>;
  syllabus: SyllabusOptionNodeDto[];
  remediations: SimulationRemediationDto[];
  returnTo: string;
  initialNow: string;
  embeddedInWorkbench?: boolean;
}

export function SimulationDetailClient(props: SimulationDetailClientProps) {
  const router = useRouter();
  const subjectTabsId = useId();
  const [refreshPending, startTransition] = useTransition();
  const draftKey = `areaforge.simulation.draft.${props.userId}.${props.exam.id}`;
  const initialEditorDraft = toSimulationEditorDraft(props.exam, props.subjects);
  const [savedBaseline, setSavedBaseline] = useState(initialEditorDraft);
  const [selectedSubjectId, setSelectedSubjectId] = useState(props.subjects[0]?.id ?? "");
  const [summary, setSummary] = useState(initialEditorDraft.summary);
  const [mindset, setMindset] = useState(initialEditorDraft.mindset);
  const [reviewText, setReviewText] = useState(initialEditorDraft.reviewText);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [examRevision, setExamRevision] = useState(initialEditorDraft.baseRevision);
  const [examStatus, setExamStatus] = useState(props.exam.status);
  const [timerSessionId, setTimerSessionId] = useState<string | null>(props.exam.timerSessionId);
  const [timerCloseoutPending, setTimerCloseoutPending] = useState(props.exam.timerSessionStatus === "CLOSING");
  const [hasStructuredResults, setHasStructuredResults] = useState(hasPersistedSubjectResults(props.exam));
  const [hasReviewText, setHasReviewText] = useState(Boolean(props.exam.reviewText?.trim()));
  const initialSubjectIds = initialSimulationSubjectIds(props.exam, props.subjects);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(initialSubjectIds);
  const [savedSubjectIds, setSavedSubjectIds] = useState<string[]>(initialSubjectIds);
  const [selectedOriginKeys, setSelectedOriginKeys] = useState<string[]>(props.remediations.filter((item) => !item.inboxItemId).map((item) => item.originKey));
  const [subjectDrafts, setSubjectDrafts] = useState(initialEditorDraft.subjectDrafts);
  const [draftReady, setDraftReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<SimulationConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [remediationReceipt, setRemediationReceipt] = useState<{ created: number; reused: number } | null>(null);
  const configuredSubjectDrafts = subjectDrafts.filter((draft) => selectedSubjectIds.includes(draft.subjectId));
  const active = configuredSubjectDrafts.find((draft) => draft.subjectId === selectedSubjectId) ?? configuredSubjectDrafts[0];
  const activeSubjectId = active?.subjectId;
  const nodes = flattenNodes(props.syllabus).filter((node) => node.subjectId === activeSubjectId);
  const busy = submitting || refreshPending;

  useSimulationDraftPersistence({
    draftKey,
    initialExamStatus: props.exam.status,
    examStatus,
    examRevision,
    summary,
    mindset,
    reviewText,
    subjectDrafts,
    savedBaseline,
    draftReady,
    setSummary,
    setMindset,
    setReviewText,
    setExamRevision,
    setSubjectDrafts,
    setDraftReady,
  });

  const lossItems = useSimulationLossItems({
    examId: props.exam.id,
    examRevision,
    busy,
    subjectDrafts,
    setExamRevision,
    setExamStatus,
    setSubjectDrafts,
    setSubmitting,
    setError,
    setNotice,
    onExamConflict: (latest, conflictFields) => {
      setConflict({ latest, conflictFields });
      setConflictOpen(true);
    },
    onNotFound: () => router.replace("/test/simulations"),
    onRefresh: () => startTransition(() => router.refresh()),
  });

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
        mistakeId: null,
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
    if (hasPendingPersistedLossEdits(configuredSubjectDrafts)) {
      setError("已有分科仍有未保存的失分条目，请先逐项创建或保存，再保存整场结果。");
      return;
    }
    setSubmitting(true);
    const completingTimer = timerCloseoutPending;
    const upgradingLegacy = !hasStructuredResults;
    const configuringBeforeStart = props.exam.status === "DRAFT"
      && props.exam.subjectResults.length === 0
      && !props.exam.timerSessionId;
    try {
      const response = await updateSimulationExamResults(props.exam.id, {
        expectedRevision: examRevision,
        mindset,
        summary,
        reviewText,
        lossReasons: [],
        subjectResults: configuredSubjectDrafts.map(toSubjectResultPayload),
      });
      const body = response.body ?? {};
      if (!response.ok) {
        handleWriteFailure(response.status, body, "保存模拟结果失败");
        return;
      }
      if (!body.exam) {
        setError("服务端未返回已保存考试；当前草稿仍保留，请显式重试。");
        return;
      }
      adoptExam(body.exam, true);
      if (completingTimer) publishActivityStatus(props.userId, null);
      setNotice(body.exam.warnings.length
        ? body.exam.warnings.join("；")
        : configuringBeforeStart
          ? "本场科目配置已保存，可以开始模拟考试；成绩、心态和复盘在计时结束后填写。"
        : upgradingLegacy
          ? "旧记录已补齐分科并升级；原历史总分不再参与当前统计。"
          : isReadyForConfirmation(body.exam)
            ? "模拟结果已保存，已进入确认中心；确认后才会冻结考试事实。"
            : "模拟结果已保存，补救不会自动入箱。");
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，模拟结果草稿已保留；恢复网络后请显式重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function startExam() {
    if (busy || timerSessionId) return;
    if (!hasStructuredResults || hasPendingEditorChanges) {
      setError("请先保存完整的分科配置，再开始模拟考试。");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const payload = { expectedRevision: examRevision };
    try {
      const response = await startSimulationExam(props.exam.id, {
        ...payload,
        idempotencyKey: getOrCreateIdempotencyKey(`simulation:${props.exam.id}:start`, "simulation-start", payload),
      });
      const body = response.body ?? {};
      if (!response.ok || !body.exam) {
        handleWriteFailure(response.status, body, "无法开始模拟考试");
        return;
      }
      completeIdempotentCommand(`simulation:${props.exam.id}:start`);
      adoptExam(body.exam, false);
      setNotice("模拟考试已开始。完成计时后，再录入成绩和复盘。");
    } catch {
      setError("网络不可用，模拟考试尚未开始；请恢复网络后重试。");
    } finally {
      setSubmitting(false);
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
      const response = await addSimulationRemediationsToInbox(
        props.exam.id,
        props.remediations
          .filter((item) => selectedOriginKeys.includes(item.originKey))
          .map((item) => ({ originKey: item.originKey, originVersion: item.originVersion })),
      );
      const body = response.body;
      if (isUnauthorized(response)) {
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
    const source = { status, body };
    if (isUnauthorized(source)) {
      setError("登录已过期，模拟草稿仍保留；重新登录后请显式重试。");
      redirectToLoginWithCurrentLocation();
      return;
    }
    if (status === 404) {
      setError("模拟记录已不存在或不可访问；当前草稿仍保留，正在返回模拟工作台。");
        router.replace(body.workbench === "/test/simulations" ? body.workbench : "/test/simulations");
      return;
    }
    if (isConflict(source) && isSimulationExamDto(body.latest)) {
      setConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["revision"] });
      setConflictOpen(true);
    }
    setError(labelSaveError(body.error, fallback, body.details));
  }

  function adoptExam(exam: SimulationExamDto, clearDraft: boolean) {
    const next = toSimulationEditorDraft(exam, props.subjects);
    const nextSubjectIds = initialSimulationSubjectIds(exam, props.subjects);
    setExamRevision(next.baseRevision);
    setExamStatus(exam.status);
    setTimerSessionId(exam.timerSessionId);
    setTimerCloseoutPending(exam.timerSessionStatus === "CLOSING");
    setHasStructuredResults(hasPersistedSubjectResults(exam));
    setHasReviewText(Boolean(exam.reviewText?.trim()));
    setSelectedSubjectIds(nextSubjectIds);
    setSavedSubjectIds(nextSubjectIds);
    setSummary(next.summary);
    setMindset(next.mindset);
    setReviewText(next.reviewText);
    setSubjectDrafts(next.subjectDrafts);
    setSavedBaseline(next);
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
    if (latest.status === "CONFIRMED") {
      adoptExam(latest, true);
      setConflict(null);
      setConflictOpen(false);
      setError("服务端已确认这场模拟，已切换到只读冻结结果；旧本地草稿不会继续恢复或覆盖。");
      return;
    }
    setExamRevision(latest.revision);
    setHasStructuredResults(hasPersistedSubjectResults(latest));
    const latestSubjectIds = initialSimulationSubjectIds(latest, props.subjects);
    setSelectedSubjectIds(latestSubjectIds);
    setSavedSubjectIds(latestSubjectIds);
    setSubjectDrafts((items) => items.map((item) => ({
      ...item,
      expectedRevision: latest.subjectResults.find((result) => result.subjectId === item.subjectId)?.revision,
    })));
    setSavedBaseline(toSimulationEditorDraft(latest, props.subjects));
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice(`本地输入已改为基于服务端 r${latest.revision}；请检查差异后显式保存，不会自动重放旧请求。`);
  }

  function toggleSubject(subjectId: string, checked: boolean) {
    setError(null);
    if (checked) {
      if (selectedSubjectIds.length >= 8) {
        setError("一场模拟考试最多选择 8 个科目。");
        return;
      }
      setSelectedSubjectIds((current) => current.includes(subjectId) ? current : [...current, subjectId]);
      setSelectedSubjectId(subjectId);
      return;
    }
    if (selectedSubjectIds.length <= 1) {
      setError("一场模拟考试至少需要保留一个科目。");
      return;
    }
    const next = selectedSubjectIds.filter((id) => id !== subjectId);
    setSelectedSubjectIds(next);
    if (selectedSubjectId === subjectId) setSelectedSubjectId(next[0] ?? "");
  }

  if (!active) return <p className="text-sm text-amber-200">当前工作区没有可用科目。</p>;
  const activeLossItems = active.lossItems.filter((item) => !item.archivedAt);
  const archivedLossItems = active.lossItems.filter((item) => Boolean(item.archivedAt));
  const currentEditorDraft = buildEditorDraft(examRevision, summary, mindset, reviewText, subjectDrafts);
  const hasUnsavedChanges = !editorDraftsEqual(currentEditorDraft, savedBaseline);
  const subjectSelectionChanged = !sameStringSet(selectedSubjectIds, savedSubjectIds);
  const hasPendingEditorChanges = hasUnsavedChanges || subjectSelectionChanged;
  const readyForConfirmation = examStatus !== "CONFIRMED"
    && draftReady
    && !hasPendingEditorChanges
    && hasStructuredResults
    && hasReviewText
    && summary.trim().length > 0
    && mindset.trim().length > 0;
  const currentStep = examStatus === "CONFIRMED" ? 3 : hasStructuredResults ? 2 : 1;
  return (
    <SimulationDetailWorkspace
      userId={props.userId}
      examId={props.exam.id}
      initialNow={props.initialNow}
      returnTo={props.returnTo}
      embeddedInWorkbench={props.embeddedInWorkbench}
      subjects={props.subjects}
      remediations={props.remediations}
      examStatus={examStatus}
      examRevision={examRevision}
      timerSessionId={timerSessionId}
      currentStep={currentStep}
      readyForConfirmation={readyForConfirmation}
      hasStructuredResults={hasStructuredResults}
      hasPendingEditorChanges={hasPendingEditorChanges}
      selectedOriginKeys={selectedOriginKeys}
      remediationReceipt={remediationReceipt}
      configuredSubjectDrafts={configuredSubjectDrafts}
      selectedSubjectIds={selectedSubjectIds}
      active={active}
      activeLossItems={activeLossItems}
      archivedLossItems={archivedLossItems}
      nodes={nodes}
      subjectTabsId={subjectTabsId}
      busy={busy}
      mindset={mindset}
      summary={summary}
      reviewText={reviewText}
      subjectDrafts={subjectDrafts}
      error={error}
      notice={notice}
      conflict={conflict}
      conflictOpen={conflictOpen}
      lossConflict={lossItems.conflict}
      lossConflictOpen={lossItems.conflictOpen}
      conflictedLossItem={lossItems.conflictedItem}
      onOriginSelectionChange={setSelectedOriginKeys}
      onAddRemediations={() => void addRemediations()}
      onTimerFinished={() => {
        setTimerSessionId(null);
        setTimerCloseoutPending(true);
      }}
      onToggleSubject={toggleSubject}
      onSelectSubject={setSelectedSubjectId}
      onSubjectTabKeyDown={handleSubjectTabKeyDown}
      onUpdateField={(field, value) =>
        updateActive({ [field]: value } as Partial<SubjectDraft>)}
      onUpdateSubjectSummary={(value) => updateActive({ summary: value })}
      onAddLossItem={addLossItem}
      onUpdateLossItem={updateLossItem}
      onRemoveUnsavedLossItem={removeUnsavedLossItem}
      onMutateLossItem={(item, action) => void lossItems.mutate(active, item, action)}
      onMindsetChange={setMindset}
      onSummaryChange={setSummary}
      onReviewTextChange={setReviewText}
      onSave={() => void save()}
      onStartExam={() => void startExam()}
      onOpenConflict={() => setConflictOpen(true)}
      onCloseConflict={() => setConflictOpen(false)}
      onAdoptLatest={adoptLatest}
      onMergeLatest={mergeOntoLatest}
      onCloseLossConflict={() => lossItems.setConflictOpen(false)}
      onAdoptLossServer={lossItems.adoptServerVersion}
      onKeepLossIntent={lossItems.keepIntentOnLatestRevision}
    />
  );
}
