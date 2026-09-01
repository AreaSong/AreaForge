"use client";

import {
  archiveMistake,
  createMistakeAttempt,
  restoreMistake,
  updateMistake,
  type MistakeMutationResponse,
} from "@/lib/api/mistakes";
import {
  createReviewSchedule,
  rescheduleReview,
  resumeReviewSchedule,
} from "@/lib/api/review-schedule";
import { Eye, Pencil, RotateCcw, Save, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MistakeLinksPanel } from "@/components/mistake-links-panel";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { PersistenceStatus } from "@/components/ui/feedback";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { useUnsavedChangesWarning } from "@/lib/client/use-unsaved-changes-warning";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import type { MistakeCauseDto, MistakeDto } from "@/lib/contracts";
import { formatDate, formatDateTime, formatDuration, shanghaiDateInputToIso } from "@/lib/formatters";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input, Radio, Select, Textarea } from "@/components/ui/field";
import {
  addStudyDays,
  causeOptions,
  editDraftsEqual,
  isAnswerDraft,
  isCompleteMistake,
  isEditDraft,
  isMistakeDto,
  isScheduleDraft,
  labelCause,
  labelResult,
  MistakeTrendSummary,
  toDateInput,
  toEditDraft,
  toMistakeReviewSchedule,
  type MistakeAnswerDraft,
  type MistakeConflict,
  type MistakeDetailClientProps,
  type MistakeEditDraft,
  type MistakeScheduleDraft,
  type ReviewScheduleResponse,
} from "@/components/mistake-detail-support";
import { MistakeDetailOverview } from "@/components/mistake-detail-overview";
import { MistakeDetailDialogs } from "@/components/mistake-detail-dialogs";

export function MistakeDetailClient(props: MistakeDetailClientProps) {
  const router = useRouter();
  const answerDraftKey = `areaforge.mistake.draft.detail.answer.${props.userId}.${props.mistake.id}`;
  const editDraftKey = `areaforge.mistake.draft.detail.edit.${props.userId}.${props.mistake.id}`;
  const scheduleDraftKey = `areaforge.mistake.draft.detail.schedule.${props.userId}.${props.mistake.id}`;
  const initialReviewDate = toDateInput(props.mistake.reviewSchedule?.dueDate ?? props.mistake.nextReviewAt);
  const [savedBaseline, setSavedBaseline] = useState(() => toEditDraft(props.mistake));
  const [mistake, setMistake] = useState(props.mistake);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(props.mistake.updatedAt);
  const [title, setTitle] = useState(props.mistake.title);
  const [questionText, setQuestionText] = useState(props.mistake.questionText ?? "");
  const [source, setSource] = useState(props.mistake.source ?? "");
  const [cause, setCause] = useState(props.mistake.cause);
  const [causeNote, setCauseNote] = useState(props.mistake.causeNote ?? "");
  const [correctAnswer, setCorrectAnswer] = useState(props.mistake.correctAnswer ?? "");
  const [correctIdea, setCorrectIdea] = useState(props.mistake.correctIdea ?? "");
  const [answerMode, setAnswerMode] = useState<"TEXT" | "PAPER_OR_ORAL">("TEXT");
  const [answerText, setAnswerText] = useState("");
  const [paperOrOralCompleted, setPaperOrOralCompleted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [attemptResult, setAttemptResult] = useState<"PASSED" | "PARTIAL" | "FAILED">("PARTIAL");
  const [attemptNote, setAttemptNote] = useState("");
  const [attemptSaved, setAttemptSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewDate, setReviewDate] = useState(initialReviewDate);
  const [savedReviewDate, setSavedReviewDate] = useState(initialReviewDate);
  const [draftReady, setDraftReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MistakeConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<"archive" | "discard" | null>(null);

  const archived = Boolean(mistake.archivedAt);
  const complete = isCompleteMistake(mistake);
  const localEdit = { baseUpdatedAt, title, questionText, source, cause, causeNote, correctAnswer, correctIdea };
  const dirty = !editDraftsEqual(localEdit, savedBaseline);
  useUnsavedChangesWarning(editing && dirty);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const answerDraft = loadPrivateBusinessDraft(answerDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isAnswerDraft);
      if (answerDraft) {
        setAnswerMode(answerDraft.answerMode);
        setAnswerText(answerDraft.answerText);
        setPaperOrOralCompleted(answerDraft.paperOrOralCompleted);
        setRevealed(answerDraft.revealed);
        setAttemptResult(answerDraft.result);
        setAttemptNote(answerDraft.note);
      }
      if (!props.readOnly) {
        const editDraft = loadPrivateBusinessDraft(editDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isEditDraft);
        if (editDraft) {
          setBaseUpdatedAt(editDraft.baseUpdatedAt);
          setTitle(editDraft.title);
          setQuestionText(editDraft.questionText);
          setSource(editDraft.source);
          setCause(editDraft.cause);
          setCauseNote(editDraft.causeNote);
          setCorrectAnswer(editDraft.correctAnswer);
          setCorrectIdea(editDraft.correctIdea);
          setEditing(true);
        }
        const scheduleDraft = loadPrivateBusinessDraft(scheduleDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isScheduleDraft);
        if (scheduleDraft) setReviewDate(scheduleDraft.reviewDate);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [answerDraftKey, editDraftKey, props.readOnly, scheduleDraftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (attemptSaved) {
      removePrivateBusinessDraft(answerDraftKey);
      return;
    }
    if (!answerText && !paperOrOralCompleted && !revealed && !attemptNote) {
      removePrivateBusinessDraft(answerDraftKey);
      return;
    }
    savePrivateBusinessDraft<MistakeAnswerDraft>(answerDraftKey, { answerMode, answerText, paperOrOralCompleted, revealed, result: attemptResult, note: attemptNote });
  }, [answerDraftKey, answerMode, answerText, attemptNote, attemptResult, attemptSaved, draftReady, paperOrOralCompleted, revealed]);

  useEffect(() => {
    if (!draftReady || archived || props.readOnly) return;
    const draft = { baseUpdatedAt, title, questionText, source, cause, causeNote, correctAnswer, correctIdea };
    if (editDraftsEqual(draft, savedBaseline)) {
      removePrivateBusinessDraft(editDraftKey);
      return;
    }
    savePrivateBusinessDraft<MistakeEditDraft>(editDraftKey, draft);
  }, [archived, baseUpdatedAt, cause, causeNote, correctAnswer, correctIdea, draftReady, editDraftKey, props.readOnly, questionText, savedBaseline, source, title]);

  useEffect(() => {
    if (!draftReady || props.readOnly) return;
    if (reviewDate === savedReviewDate) {
      removePrivateBusinessDraft(scheduleDraftKey);
      return;
    }
    savePrivateBusinessDraft<MistakeScheduleDraft>(scheduleDraftKey, { reviewDate });
  }, [draftReady, props.readOnly, reviewDate, savedReviewDate, scheduleDraftKey]);

  async function saveEdit() {
    if (pending || archived || props.readOnly) return;
    if (!title.trim() || !questionText.trim() || cause === "unknown" || !correctIdea.trim()) {
      setError("请填写题面、明确错因和正确思路后再保存。");
      return;
    }
    const completionFields = {
      questionText: questionText.trim(),
      cause,
      causeNote: causeNote.trim() || null,
      correctAnswer: correctAnswer.trim() || null,
      correctIdea,
      expectedUpdatedAt: baseUpdatedAt,
    };
    const payload = complete ? { ...completionFields, title, source: source.trim() || null } : completionFields;
    setPending(true);
    setError(null);
    try {
      const response = await updateMistake(mistake.id, payload);
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，错题编辑草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        handleFailure(response.status, body, "edit", "保存失败，错题编辑草稿已保留。");
        return;
      }
      if (!body?.mistake) return setError("保存响应不完整，草稿仍保留；请刷新确认服务端状态。");
      adoptMistake(body.mistake, true);
      setEditing(false);
      router.refresh();
    } catch {
      setError("网络不可用，错题编辑草稿已保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  async function saveAttempt() {
    if (pending || archived || props.readOnly || attemptSaved) return;
    if (answerMode === "TEXT" && !answerText.trim()) return setError("请先填写本次答案或关键步骤。");
    if (answerMode === "PAPER_OR_ORAL" && !paperOrOralCompleted) return setError("请先确认已完成纸上或口头作答。");
    const payload = {
      answerMode,
      answerText: answerMode === "TEXT" ? answerText.trim() : null,
      result: attemptResult,
      durationSeconds: null,
      note: attemptNote.trim() || null,
    };
    const commandScope = `mistake-attempt:${props.userId}:${mistake.id}`;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await createMistakeAttempt(mistake.id, {
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mistake-attempt", payload),
        ...payload,
      });
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，本次作答草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !body?.attempt) throw new Error(body?.error ?? "保存本次作答失败，草稿已保留。");
      const attempt = body.attempt;
      setMistake((current) => ({
        ...current,
        attemptCount: current.attemptCount + 1,
        lastAttemptAt: attempt.attemptedAt,
        attempts: [attempt, ...current.attempts.filter((item) => item.id !== attempt.id)],
      }));
      completeIdempotentCommand(commandScope);
      setAttemptSaved(true);
      setNotice("本次作答已保存到历史；独立作答不会改变现有复习排期。");
      removePrivateBusinessDraft(answerDraftKey);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存本次作答失败，草稿已保留。");
    } finally {
      setPending(false);
    }
  }

  function resetAttempt() {
    setAnswerMode("TEXT");
    setAnswerText("");
    setPaperOrOralCompleted(false);
    setRevealed(false);
    setAttemptResult("PARTIAL");
    setAttemptNote("");
    setAttemptSaved(false);
    setNotice(null);
    removePrivateBusinessDraft(answerDraftKey);
  }

  async function toggleArchive() {
    if (pending || props.readOnly) return;
    if (!archived && dirty) {
      setError("请先保存或取消当前编辑草稿，再归档错题。");
      return;
    }
    const operation = archived ? "restore" : "archive";
    setPending(true);
    setError(null);
    try {
      const response = operation === "archive"
        ? await archiveMistake(mistake.id, { expectedUpdatedAt: baseUpdatedAt })
        : await restoreMistake(mistake.id, { expectedUpdatedAt: baseUpdatedAt });
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，当前草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        handleFailure(response.status, body, operation, `${archived ? "恢复" : "归档"}失败，当前状态未改变。`);
        return;
      }
      if (!body?.mistake) return setError("状态响应不完整，请刷新确认服务端状态。");
      adoptMistake(body.mistake, false);
      router.refresh();
    } catch {
      setError(`网络不可用，错题${archived ? "恢复" : "归档"}状态未改变；恢复网络后请显式重试。`);
    } finally {
      setPending(false);
    }
  }

  async function scheduleReview() {
    if (pending || archived || props.readOnly || !complete || !reviewDate) return;
    setPending(true);
    setError(null);
    try {
      const dueDate = shanghaiDateInputToIso(reviewDate);
      const response = schedule
        ? schedule.status === "ACTIVE"
          ? await rescheduleReview(schedule.id, { expectedRevision: schedule.revision, dueDate })
          : await resumeReviewSchedule(schedule.id, { expectedRevision: schedule.revision, dueDate })
        : await createReviewSchedule({ targetType: "MISTAKE", mistakeId: mistake.id, dueDate });
      if (isUnauthorized(response)) {
        setError("登录已过期，错题草稿已保留。重新登录后请显式设置排期。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      const body = response.body as ReviewScheduleResponse | null;
      if (!response.ok) {
        setError(body?.error ?? "设置复习日期失败，排期未改变；请显式重试。");
        return;
      }
      const savedSchedule = body?.schedule;
      if (!savedSchedule) {
        setError("排期响应不完整，请刷新确认服务端状态。");
        return;
      }
      setMistake((current) => ({ ...current, reviewSchedule: toMistakeReviewSchedule(savedSchedule) }));
      const nextReviewDate = toDateInput(savedSchedule.dueDate);
      setReviewDate(nextReviewDate);
      setSavedReviewDate(nextReviewDate);
      removePrivateBusinessDraft(scheduleDraftKey);
      router.refresh();
    } catch {
      setError("网络不可用，排期未改变；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  function handleFailure(status: number, body: MistakeMutationResponse | null, operation: MistakeConflict["operation"], fallback: string) {
    if (isConflict({ status, body }) && body?.latest && isMistakeDto(body.latest)) {
      setConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["updatedAt"], operation });
      setConflictOpen(true);
    }
    setError(body?.error ?? fallback);
  }

  function adoptMistake(latest: MistakeDto, resetDraft: boolean) {
    setMistake(latest);
    setBaseUpdatedAt(latest.updatedAt);
    if (resetDraft) {
      const next = toEditDraft(latest);
      setSavedBaseline(next);
      setTitle(next.title);
      setQuestionText(next.questionText);
      setSource(next.source);
      setCause(next.cause);
      setCauseNote(next.causeNote);
      setCorrectAnswer(next.correctAnswer);
      setCorrectIdea(next.correctIdea);
      removePrivateBusinessDraft(editDraftKey);
    } else {
      setSavedBaseline((current) => ({ ...current, baseUpdatedAt: latest.updatedAt }));
    }
  }

  function adoptLatestConflict() {
    if (!conflict) return;
    adoptMistake(conflict.latest, true);
    setEditing(false);
    setConflict(null);
    setConflictOpen(false);
    setError("已采用服务端最新状态。");
    router.refresh();
  }

  function mergeOntoLatest() {
    if (!conflict) return;
    setMistake(conflict.latest);
    setBaseUpdatedAt(conflict.latest.updatedAt);
    setConflict(null);
    setConflictOpen(false);
    setError("本地输入已保留，并改用服务端最新时间戳；请检查后显式重试。");
  }

  function cancelEdit() {
    const saved = savedBaseline;
    setBaseUpdatedAt(saved.baseUpdatedAt);
    setTitle(saved.title);
    setQuestionText(saved.questionText);
    setSource(saved.source);
    setCause(saved.cause);
    setCauseNote(saved.causeNote);
    setCorrectAnswer(saved.correctAnswer);
    setCorrectIdea(saved.correctIdea);
    removePrivateBusinessDraft(editDraftKey);
    setEditing(false);
    setError(null);
  }

  function requestCancelEdit() {
    if (dirty) setConfirmation("discard");
    else cancelEdit();
  }

  function startEditing() {
    setRevealed(true);
    setEditing(true);
  }

  const schedule = mistake.reviewSchedule;
  const reviewDue = schedule?.status === "ACTIVE" && Boolean(schedule.dueDate) && new Date(schedule.dueDate as string).getTime() <= Date.parse(props.renderedAt);
  const correctedIds = useMemo(
    () => new Set(mistake.reviewHistory.flatMap((event) => event.correctedEventId ? [event.correctedEventId] : [])),
    [mistake.reviewHistory],
  );
  const objectHref = props.returnTo
    ? withReturnTo(`/knowledge/mistakes/${mistake.id}`, props.returnTo)
    : `/knowledge/mistakes/${mistake.id}`;

  return (
    <article className="space-y-6">
      <MistakeDetailOverview
        context={{ mistake, readOnly: props.readOnly, subjectArchived: props.subjectArchived, workspaceName: props.workspaceName, returnTo: props.returnTo, objectHref }}
        state={{ archived, editing, reviewDue, complete, pending, revealed }}
        actions={{ restore: () => void toggleArchive(), startEditing, requestArchive: () => setConfirmation("archive") }}
      />

      <Card variant="master" className="space-y-4 p-5 sm:p-6" aria-labelledby="mistake-answer-heading">
        <div><p className="text-xs font-medium text-teal-300">本次作答</p><h2 id="mistake-answer-heading" className="mt-1 text-lg font-semibold text-white">先独立重做</h2></div>
        <div className="whitespace-pre-wrap rounded-xl border border-white/10 bg-[#151a20] p-4 text-sm leading-7 text-zinc-100">{mistake.questionText || "这条历史错题还没有完整题面，请先补全后再作答。"}</div>
        {!revealed ? <>
          <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-sm text-zinc-400">作答方式</legend>{([['TEXT', '文字作答'], ['PAPER_OR_ORAL', '纸上 / 口头']] as const).map(([value, label]) => <label key={value} className={`flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-colors ${answerMode === value ? 'border-teal-400/50 bg-teal-400/10 text-teal-100' : 'border-white/10 bg-white/[0.02] text-zinc-300'}`}><Radio name="answer-mode" value={value} checked={answerMode === value} onChange={() => setAnswerMode(value)} />{label}</label>)}</fieldset>
          {answerMode === "TEXT" ? <Textarea aria-label="本次作答" className="min-h-32 rounded-xl px-3 leading-6" value={answerText} onChange={(event) => setAnswerText(event.target.value)} placeholder="写下本次答案或关键步骤" /> : <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-200"><Checkbox checked={paperOrOralCompleted} onChange={(event) => setPaperOrOralCompleted(event.target.checked)} />我已在纸上或口头完成独立作答</label>}
          <Button type="button" variant="primary" disabled={archived || props.readOnly || !complete || (answerMode === "TEXT" ? !answerText.trim() : !paperOrOralCompleted)} onClick={() => setRevealed(true)} className="h-11 px-4"><Eye size={16} aria-hidden />查看答案与思路</Button>
        </> : <div className="space-y-4">
          <div><p className="text-xs text-zinc-500">你的作答</p><p className="mt-1 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-200">{answerMode === "TEXT" ? answerText : "已完成纸上或口头作答"}</p></div>
          <div className="af-content-grid-two grid gap-3"><Card variant="subtle" className="p-4"><p className="text-xs text-zinc-400 font-semibold">标准答案</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctAnswer || "未记录标准答案"}</p></Card><Card variant="subtle" className="p-4"><p className="text-xs text-teal-300 font-semibold">正确思路</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctIdea || "待补全"}</p></Card></div>
          {!attemptSaved && !props.readOnly && !archived ? <div className="space-y-3 border-t border-white/10 pt-3"><fieldset><legend className="mb-2 text-sm text-zinc-400">本次结果</legend><div className="flex flex-wrap gap-2">{([['PASSED', '通过'], ['PARTIAL', '部分掌握'], ['FAILED', '未通过']] as const).map(([value, label]) => <label key={value} className={`flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-colors ${attemptResult === value ? 'border-teal-400/50 bg-teal-400/10 text-teal-100' : 'border-white/10 text-zinc-300'}`}><Radio name="attempt-result" checked={attemptResult === value} onChange={() => setAttemptResult(value)} />{label}</label>)}</div></fieldset><label className="block text-sm text-zinc-400">复盘备注<Textarea value={attemptNote} onChange={(event) => setAttemptNote(event.target.value)} maxLength={2000} className="mt-1 min-h-20 rounded-xl px-3" placeholder="记录卡点、遗漏或下次注意事项" /></label><div className="flex flex-wrap gap-3"><Button type="button" variant="primary" disabled={pending} onClick={() => void saveAttempt()} className="h-10 px-3"><Save size={16} aria-hidden />{pending ? "保存中" : "保存本次作答"}</Button><Button type="button" variant="ghost" className="h-10 text-teal-300" onClick={() => setRevealed(false)}><Undo2 size={15} aria-hidden />返回修改</Button></div></div> : null}
          {attemptSaved ? <Button type="button" variant="ghost" className="h-10 text-teal-300" onClick={resetAttempt}><RotateCcw size={15} aria-hidden />再做一次</Button> : null}
        </div>}
      </Card>

      {revealed ? <>
        <Card variant="subtle" className="space-y-4 p-5 sm:p-6" aria-labelledby="mistake-review-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-3"><h2 id="mistake-review-heading" className="text-lg font-semibold text-white">错因与正确思路</h2>{editing ? <PersistenceStatus state={conflict ? "conflict" : pending ? "saving" : dirty ? "local-draft" : "clean"} /> : null}</div>{!props.readOnly && !archived && !editing ? <Button type="button" variant="ghost" size="sm" className="text-teal-300" onClick={startEditing}><Pencil size={15} aria-hidden />{complete ? "编辑错题" : "补全错题"}</Button> : null}</div>
          {editing && !archived && !props.readOnly ? <div className="grid gap-3">
            <label className="text-sm text-zinc-400">标题<Input className="mt-1 px-3 rounded-xl" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">题目正文<Textarea className="mt-1 min-h-32 px-3 rounded-xl" value={questionText} onChange={(event) => setQuestionText(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">来源<Input className="mt-1 px-3 rounded-xl" value={source} onChange={(event) => setSource(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">错因<Select className="mt-1 px-3 rounded-xl" value={cause} onChange={(event) => setCause(event.target.value as MistakeCauseDto)}>{causeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
            <label className="text-sm text-zinc-400">错因补充说明<Textarea className="mt-1 min-h-20 px-3 rounded-xl" value={causeNote} onChange={(event) => setCauseNote(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">标准答案（可选）<Textarea className="mt-1 min-h-24 px-3 rounded-xl" value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">正确思路<Textarea className="mt-1 min-h-32 px-3 rounded-xl" value={correctIdea} onChange={(event) => setCorrectIdea(event.target.value)} /></label>
            <EditorActionBar
              primaryLabel={complete ? "保存错题" : "补全错题"}
              primaryIcon={<Save size={16} aria-hidden />}
              primaryDisabled={Boolean(conflict) || !title.trim() || !questionText.trim() || cause === "unknown" || !correctIdea.trim()}
              loading={pending}
              onPrimary={() => void saveEdit()}
              secondaryLabel="放弃编辑"
              secondaryIcon={<X size={16} aria-hidden />}
              secondaryDisabled={pending}
              onSecondary={requestCancelEdit}
              hint="保存后更新错因与正确思路；放弃编辑会清除本机草稿。"
            />
          </div> : <dl className="af-content-grid-two grid gap-4"><div><dt className="text-xs text-zinc-500">错因</dt><dd className="mt-1 text-sm text-zinc-200">{labelCause(mistake.cause)}{mistake.causeNote ? <span className="mt-1 block whitespace-pre-wrap text-zinc-400">{mistake.causeNote}</span> : null}</dd></div><div><dt className="text-xs text-zinc-500">标准答案</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctAnswer || "未记录"}</dd></div><div className="af-content-span-all"><dt className="text-xs text-zinc-500">正确思路</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctIdea || "待补全"}</dd></div></dl>}
        </Card>

        <MistakeLinksPanel key={`${mistake.id}:${mistake.updatedAt}`} mistake={mistake} noteOptions={props.noteOptions} resourceOptions={props.resourceOptions} readOnly={props.readOnly || archived} onSaved={(saved) => { adoptMistake(saved, true); setNotice("关联已保存。"); }} />

        <Card variant="subtle" className="space-y-3 p-5 sm:p-6" aria-labelledby="mistake-attempt-history-heading"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs text-zinc-500">掌握趋势</p><h2 id="mistake-attempt-history-heading" className="mt-1 text-lg font-semibold text-white">作答历史</h2></div><span className="text-sm text-zinc-400">累计 {mistake.attemptCount} 次</span></div><MistakeTrendSummary mistake={mistake} />{mistake.attempts.length === 0 ? <p className="text-sm text-zinc-400">暂无已保存的作答记录。</p> : <ol className="grid gap-2">{mistake.attempts.map((attempt) => <li key={attempt.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-zinc-100">{labelResult(attempt.result)} · {attempt.answerMode === "TEXT" ? "文字作答" : "纸上 / 口头"}{attempt.reviewEventId ? " · 统一复习" : " · 独立重做"}</span><time className="text-xs text-zinc-500" dateTime={attempt.attemptedAt}>{formatDateTime(attempt.attemptedAt)}</time></div>{attempt.answerText ? <p className="mt-2 whitespace-pre-wrap text-zinc-300">{attempt.answerText}</p> : null}{attempt.note ? <p className="mt-2 whitespace-pre-wrap text-zinc-400">复盘：{attempt.note}</p> : null}</li>)}</ol>}{mistake.attemptCount > mistake.attempts.length ? <p className="text-xs text-zinc-500">当前展示最近 {mistake.attempts.length} 次。</p> : null}</Card>

        <Card variant="subtle" id="mistake-schedule-section" className="scroll-mt-6 space-y-3 p-5 sm:p-6" aria-labelledby="mistake-schedule-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mistake-schedule-heading" className="text-lg font-semibold text-white">复习排期</h2>{schedule && !props.readOnly ? <Link href={`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(objectHref)}`} className="text-sm font-medium text-teal-300 hover:underline">查看排期详情</Link> : null}</div>
          {schedule ? <p className="text-sm text-zinc-300">{schedule.status === "ACTIVE" ? `下次复习：${schedule.dueDate ? formatDate(schedule.dueDate) : "未设置"}` : `排期已暂停${schedule.pausedReason ? `：${schedule.pausedReason}` : ""}`} · 连续通过 {schedule.consecutivePassCount} 次</p> : mistake.nextReviewAt ? <p className="text-sm text-amber-100">旧复习日期：{formatDate(mistake.nextReviewAt)}。选择日期后会物化为统一复习排期。</p> : <p className="text-sm text-zinc-400">尚未设置统一复习排期。</p>}
          {!props.readOnly && !archived && complete ? <div className="space-y-2"><p className="text-xs text-zinc-500">排期建议只在你确认后生效。</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} size="sm" onClick={() => { setReviewDate(addStudyDays(1)); }}>明天</Button><Button type="button" disabled={pending} size="sm" onClick={() => { setReviewDate(addStudyDays(3)); }}>3 天后</Button><Input aria-label="复习日期" type="date" className="h-10 w-auto rounded-xl px-3" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /><Button type="button" disabled={pending || !reviewDate} className="h-10 border-teal-300/30 px-3 text-teal-100" onClick={() => void scheduleReview()}>{!schedule ? "确认首次复习" : schedule.status === "PAUSED" ? "确认恢复排期" : "确认调整日期"}</Button></div></div> : null}
        </Card>

        <Card variant="subtle" className="space-y-3 p-5 sm:p-6" aria-labelledby="mistake-history-heading">
          <h2 id="mistake-history-heading" className="text-lg font-semibold text-white">复习历史</h2>
          {mistake.reviewHistory.length === 0 ? <p className="text-sm text-zinc-400">暂无已确认的复习记录。</p> : <ol className="grid gap-2">{mistake.reviewHistory.map((event) => <li key={event.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-zinc-100">{labelResult(event.result)}{event.correctedEventId ? "（更正事件）" : correctedIds.has(event.id) ? "（已被更正）" : ""}</span><time className="text-xs text-zinc-500" dateTime={event.confirmedAt}>{formatDateTime(event.confirmedAt)}</time></div><p className="mt-1 text-xs text-zinc-400">有效时长 {formatDuration(event.durationSeconds)} · 下次 {formatDate(event.nextDueDate)}</p>{event.note ? <p className="mt-2 whitespace-pre-wrap text-zinc-300">{event.note}</p> : null}</li>)}</ol>}
        </Card>
      </> : <p className="border-t border-white/10 pt-5 text-sm text-zinc-400">完成本次作答后查看错因、正确思路、排期和历史。</p>}

      <MistakeDetailDialogs
        state={{ notice, error, conflict, conflictOpen, confirmation, pending }}
        localEdit={localEdit}
        mistake={mistake}
        actions={{
          openConflict: () => setConflictOpen(true),
          closeConflict: () => setConflictOpen(false),
          closeConfirmation: () => setConfirmation(null),
          archive: () => void toggleArchive(),
          discard: cancelEdit,
          adoptLatest: adoptLatestConflict,
          mergeOntoLatest,
        }}
      />
    </article>
  );
}
