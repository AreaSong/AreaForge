"use client";

import { Archive, ArrowRight, CalendarCheck, Eye, Pencil, Play, RotateCcw, Save, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { KnowledgeObjectDetailHeader } from "@/components/knowledge-object-detail-header";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { MistakeLinksPanel } from "@/components/mistake-links-panel";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { Alert, PersistenceStatus } from "@/components/ui/feedback";
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
import type { MistakeCauseDto, MistakeDto } from "@/lib/study/types";

interface MistakeAnswerDraft {
  answerMode: "TEXT" | "PAPER_OR_ORAL";
  answerText: string;
  paperOrOralCompleted: boolean;
  revealed: boolean;
  result: "PASSED" | "PARTIAL" | "FAILED";
  note: string;
}

interface MistakeEditDraft {
  baseUpdatedAt: string;
  title: string;
  questionText: string;
  source: string;
  cause: MistakeCauseDto;
  causeNote: string;
  correctAnswer: string;
  correctIdea: string;
}

interface MistakeScheduleDraft {
  reviewDate: string;
}

interface MistakeConflict {
  latest: MistakeDto;
  conflictFields: string[];
  operation: "edit" | "archive" | "restore";
}

const causeOptions: Array<[MistakeCauseDto, string]> = [
  ["unknown", "未分类"],
  ["concept_confusion", "概念混淆"],
  ["formula_unfamiliar", "公式不熟"],
  ["wrong_approach", "方法错误"],
  ["careless", "粗心"],
  ["time_pressure", "时间压力"],
  ["unfamiliar_pattern", "题型陌生"],
];

export function MistakeDetailClient(props: {
  userId: string;
  mistake: MistakeDto;
  readOnly: boolean;
  subjectArchived: boolean;
  workspaceName: string;
  noteOptions: Array<{ id: string; title: string }>;
  resourceOptions: Array<{ id: string; title: string }>;
  returnTo?: string;
  renderedAt: string;
}) {
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
      const response = await fetch(`/api/mistakes/${mistake.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await readMistakeResponse(response);
      if (response.status === 401) {
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
      const response = await fetch(`/api/mistakes/${mistake.id}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mistake-attempt", payload), ...payload }),
      });
      const body = await response.json().catch(() => null) as { attempt?: MistakeDto["attempts"][number]; error?: string } | null;
      if (response.status === 401) {
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
      const response = await fetch(`/api/mistakes/${mistake.id}/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: baseUpdatedAt }),
      });
      const body = await readMistakeResponse(response);
      if (response.status === 401) {
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
      const dueDate = new Date(`${reviewDate}T00:00:00+08:00`).toISOString();
      const request = schedule
        ? schedule.status === "ACTIVE"
          ? { url: `/api/review-schedules/${schedule.id}`, method: "PATCH", body: { expectedRevision: schedule.revision, dueDate } }
          : { url: `/api/review-schedules/${schedule.id}/resume`, method: "POST", body: { expectedRevision: schedule.revision, dueDate } }
        : { url: "/api/review-schedules", method: "POST", body: { targetType: "MISTAKE", mistakeId: mistake.id, dueDate } };
      const response = await fetch(request.url, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      if (response.status === 401) {
        setError("登录已过期，错题草稿已保留。重新登录后请显式设置排期。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      const body = await response.json().catch(() => null) as ReviewScheduleResponse | null;
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

  function handleFailure(status: number, body: MistakeResponse | null, operation: MistakeConflict["operation"], fallback: string) {
    if (status === 409 && body?.latest && isMistakeDto(body.latest)) {
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
      <KnowledgeObjectDetailHeader
        fallbackHref="/knowledge/mistakes"
        fallbackLabel="返回错题列表"
        returnTo={props.returnTo}
        eyebrow={`${mistake.subjectName} · ${mistake.syllabusNodeTitle ?? "未关联考纲"}`}
        title={mistake.title}
        description={mistake.source ? `来源：${mistake.source}` : "来源尚未记录"}
        actions={!props.readOnly ? <>
          {archived ? (
            <button type="button" disabled={pending} onClick={() => void toggleArchive()} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black disabled:opacity-50"><RotateCcw size={16} aria-hidden />恢复错题</button>
          ) : editing ? null : reviewDue && schedule && complete ? (
            <Link href={`/knowledge/reviews/${schedule.id}/run?returnTo=${encodeURIComponent(objectHref)}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black"><Play size={16} aria-hidden />开始复习</Link>
          ) : complete ? (
            <button type="button" onClick={startEditing} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black"><Pencil size={16} aria-hidden />编辑错题</button>
          ) : null}
          {!archived && reviewDue && complete ? <button type="button" title="编辑错题" aria-label="编辑错题" onClick={startEditing} className="grid size-10 place-items-center rounded-md border border-white/10 text-zinc-200"><Pencil size={16} aria-hidden /></button> : null}
          {!archived && !editing ? <button type="button" title="归档错题" aria-label="归档错题" disabled={pending} onClick={() => setConfirmation("archive")} className="grid size-10 place-items-center rounded-md border border-white/10 text-zinc-300 disabled:opacity-50"><Archive size={16} aria-hidden /></button> : null}
        </> : null}
      />

      {props.readOnly ? <p role="status" className="border-l-2 border-zinc-500 pl-3 text-sm leading-6 text-zinc-300">{props.subjectArchived ? `“${mistake.subjectName}”科目已归档` : `“${props.workspaceName}”工作区已归档`}，本页只读保留错题与复习历史；不会进入当前排期或写事务。</p> : archived ? <p role="status" className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">错题已归档，当前只读；相关复习排期已暂停。恢复错题后仍需重新选择复习日期。</p> : !complete ? <p role="status" className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">待补全：这条旧错题缺少明确错因或正确思路。补全前不能新增或开始复习。</p> : null}

      <KnowledgeNextAction
        title={props.readOnly || archived ? "保留错题内容与复习历史" : !complete ? "先补全错因与正确思路" : !revealed ? "先独立重做这道错题" : reviewDue ? "完成这道错题的到期复习" : schedule?.status === "ACTIVE" ? "按排期继续复习这道错题" : "安排这道错题的首次复习"}
        description={props.readOnly || archived
          ? "当前对象只读，仍可查看题面、正确思路和历史。"
          : !complete
            ? "补全后才能建立或开始统一复习排期。"
            : !revealed
              ? "先选择作答方式并完成答案，再揭示标准答案和正确思路。"
              : reviewDue
                ? "到期复习由页头主操作承接，确认结果后会写入复习历史。"
                : schedule?.status === "ACTIVE"
                  ? `下一次复习：${schedule.dueDate ? formatDate(schedule.dueDate) : "未设置日期"}。`
                  : "先选择一个日期建立统一复习排期，之后会出现在复习队列中。"}
        status={props.readOnly ? <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-400">只读</span> : archived ? <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-400">已归档</span> : reviewDue ? <span className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">已到期 · 从页头开始</span> : null}
        action={!props.readOnly && !archived && !complete ? (
          <button type="button" onClick={startEditing} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] hover:bg-teal-300"><Pencil size={16} aria-hidden />补全错题<ArrowRight size={16} aria-hidden /></button>
        ) : !props.readOnly && !archived && complete && revealed && !reviewDue && schedule?.status === "ACTIVE" ? (
          <Link href={`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(objectHref)}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 hover:bg-teal-300/10"><CalendarCheck size={16} aria-hidden />查看复习排期<ArrowRight size={16} aria-hidden /></Link>
        ) : !props.readOnly && !archived && complete && revealed && !reviewDue ? (
          <a href="#mistake-schedule-section" className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] hover:bg-teal-300"><CalendarCheck size={16} aria-hidden />设置首次复习<ArrowRight size={16} aria-hidden /></a>
        ) : null}
      />

      <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-answer-heading">
        <div><p className="text-xs text-zinc-500">本次作答</p><h2 id="mistake-answer-heading" className="mt-1 text-lg font-medium text-white">先独立重做</h2></div>
        <div className="whitespace-pre-wrap rounded-md border border-white/10 bg-[#101419] p-4 text-sm leading-7 text-zinc-100">{mistake.questionText || "这条历史错题还没有完整题面，请先补全后再作答。"}</div>
        {!revealed ? <>
          <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-sm text-zinc-400">作答方式</legend>{([['TEXT', '文字作答'], ['PAPER_OR_ORAL', '纸上 / 口头']] as const).map(([value, label]) => <label key={value} className={`flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${answerMode === value ? 'border-teal-300/50 bg-teal-300/10 text-teal-100' : 'border-white/10 text-zinc-300'}`}><input type="radio" name="answer-mode" value={value} checked={answerMode === value} onChange={() => setAnswerMode(value)} />{label}</label>)}</fieldset>
          {answerMode === "TEXT" ? <textarea aria-label="本次作答" className="min-h-32 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-sm leading-6" value={answerText} onChange={(event) => setAnswerText(event.target.value)} placeholder="写下本次答案或关键步骤" /> : <label className="flex items-center gap-3 rounded-md border border-white/10 p-4 text-sm text-zinc-200"><input type="checkbox" checked={paperOrOralCompleted} onChange={(event) => setPaperOrOralCompleted(event.target.checked)} />我已在纸上或口头完成独立作答</label>}
          <button type="button" disabled={archived || props.readOnly || !complete || (answerMode === "TEXT" ? !answerText.trim() : !paperOrOralCompleted)} onClick={() => setRevealed(true)} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"><Eye size={16} aria-hidden />查看答案与思路</button>
        </> : <div className="space-y-3">
          <div><p className="text-xs text-zinc-500">你的作答</p><p className="mt-1 whitespace-pre-wrap rounded-md border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-200">{answerMode === "TEXT" ? answerText : "已完成纸上或口头作答"}</p></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-zinc-500">标准答案</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctAnswer || "未记录标准答案"}</p></div><div><p className="text-xs text-zinc-500">正确思路</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctIdea || "待补全"}</p></div></div>
          {!attemptSaved && !props.readOnly && !archived ? <div className="space-y-3 border-t border-white/10 pt-3"><fieldset><legend className="mb-2 text-sm text-zinc-400">本次结果</legend><div className="flex flex-wrap gap-2">{([['PASSED', '通过'], ['PARTIAL', '部分掌握'], ['FAILED', '未通过']] as const).map(([value, label]) => <label key={value} className={`flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${attemptResult === value ? 'border-teal-300/50 bg-teal-300/10 text-teal-100' : 'border-white/10 text-zinc-300'}`}><input type="radio" name="attempt-result" checked={attemptResult === value} onChange={() => setAttemptResult(value)} />{label}</label>)}</div></fieldset><label className="block text-sm text-zinc-400">复盘备注<textarea value={attemptNote} onChange={(event) => setAttemptNote(event.target.value)} maxLength={2000} className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-zinc-100" placeholder="记录卡点、遗漏或下次注意事项" /></label><div className="flex flex-wrap gap-3"><button type="button" disabled={pending} onClick={() => void saveAttempt()} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black disabled:opacity-40"><Save size={16} aria-hidden />{pending ? "保存中" : "保存本次作答"}</button><button type="button" className="inline-flex h-10 items-center gap-2 text-sm text-teal-300" onClick={() => setRevealed(false)}><Undo2 size={15} aria-hidden />返回修改</button></div></div> : null}
          {attemptSaved ? <button type="button" className="inline-flex h-10 items-center gap-2 text-sm text-teal-300" onClick={resetAttempt}><RotateCcw size={15} aria-hidden />再做一次</button> : null}
        </div>}
      </section>

      {revealed ? <>
        <section className="space-y-4 border-t border-white/10 pt-5" aria-labelledby="mistake-review-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-3"><h2 id="mistake-review-heading" className="text-lg font-medium text-white">错因与正确思路</h2>{editing ? <PersistenceStatus state={conflict ? "conflict" : pending ? "saving" : dirty ? "local-draft" : "clean"} /> : null}</div>{!props.readOnly && !archived && !editing ? <button type="button" onClick={startEditing} className="inline-flex h-9 items-center gap-2 text-sm text-teal-300"><Pencil size={15} aria-hidden />{complete ? "编辑错题" : "补全错题"}</button> : null}</div>
          {editing && !archived && !props.readOnly ? <div className="grid gap-3">
            <label className="text-sm text-zinc-400">标题<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-zinc-100" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">题目正文<textarea className="mt-1 min-h-32 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-zinc-100" value={questionText} onChange={(event) => setQuestionText(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">来源<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-zinc-100" value={source} onChange={(event) => setSource(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">错因<select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-zinc-100" value={cause} onChange={(event) => setCause(event.target.value as MistakeCauseDto)}>{causeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm text-zinc-400">错因补充说明<textarea className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-zinc-100" value={causeNote} onChange={(event) => setCauseNote(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">标准答案（可选）<textarea className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-zinc-100" value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">正确思路<textarea className="mt-1 min-h-32 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-zinc-100" value={correctIdea} onChange={(event) => setCorrectIdea(event.target.value)} /></label>
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
          </div> : <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">错因</dt><dd className="mt-1 text-sm text-zinc-200">{labelCause(mistake.cause)}{mistake.causeNote ? <span className="mt-1 block whitespace-pre-wrap text-zinc-400">{mistake.causeNote}</span> : null}</dd></div><div><dt className="text-xs text-zinc-500">标准答案</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctAnswer || "未记录"}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-zinc-500">正确思路</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctIdea || "待补全"}</dd></div></dl>}
        </section>

        <MistakeLinksPanel key={`${mistake.id}:${mistake.updatedAt}`} mistake={mistake} noteOptions={props.noteOptions} resourceOptions={props.resourceOptions} readOnly={props.readOnly || archived} onSaved={(saved) => { adoptMistake(saved, true); setNotice("关联已保存。"); }} />

        <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-attempt-history-heading"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs text-zinc-500">掌握趋势</p><h2 id="mistake-attempt-history-heading" className="mt-1 text-lg font-medium text-white">作答历史</h2></div><span className="text-sm text-zinc-400">累计 {mistake.attemptCount} 次</span></div><MistakeTrendSummary mistake={mistake} />{mistake.attempts.length === 0 ? <p className="text-sm text-zinc-400">暂无已保存的作答记录。</p> : <ol className="grid gap-2">{mistake.attempts.map((attempt) => <li key={attempt.id} className="rounded-md border border-white/10 bg-[#101419] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-zinc-100">{labelResult(attempt.result)} · {attempt.answerMode === "TEXT" ? "文字作答" : "纸上 / 口头"}{attempt.reviewEventId ? " · 统一复习" : " · 独立重做"}</span><time className="text-xs text-zinc-500" dateTime={attempt.attemptedAt}>{formatDateTime(attempt.attemptedAt)}</time></div>{attempt.answerText ? <p className="mt-2 whitespace-pre-wrap text-zinc-300">{attempt.answerText}</p> : null}{attempt.note ? <p className="mt-2 whitespace-pre-wrap text-zinc-400">复盘：{attempt.note}</p> : null}</li>)}</ol>}{mistake.attemptCount > mistake.attempts.length ? <p className="text-xs text-zinc-500">当前展示最近 {mistake.attempts.length} 次。</p> : null}</section>

        <section id="mistake-schedule-section" className="scroll-mt-6 space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-schedule-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mistake-schedule-heading" className="text-lg font-medium text-white">复习排期</h2>{schedule && !props.readOnly ? <Link href={`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(objectHref)}`} className="text-sm text-teal-300 hover:underline">查看排期详情</Link> : null}</div>
          {schedule ? <p className="text-sm text-zinc-300">{schedule.status === "ACTIVE" ? `下次复习：${formatDate(schedule.dueDate)}` : `排期已暂停${schedule.pausedReason ? `：${schedule.pausedReason}` : ""}`} · 连续通过 {schedule.consecutivePassCount} 次</p> : mistake.nextReviewAt ? <p className="text-sm text-amber-100">旧复习日期：{formatDate(mistake.nextReviewAt)}。选择日期后会物化为统一复习排期。</p> : <p className="text-sm text-zinc-400">尚未设置统一复习排期。</p>}
          {!props.readOnly && !archived && complete ? <div className="space-y-2"><p className="text-xs text-zinc-500">排期建议只在你确认后生效。</p><div className="flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => { setReviewDate(addStudyDays(1)); }} className="h-9 rounded-md border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-40">明天</button><button type="button" disabled={pending} onClick={() => { setReviewDate(addStudyDays(3)); }} className="h-9 rounded-md border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-40">3 天后</button><input aria-label="复习日期" type="date" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /><button type="button" disabled={pending || !reviewDate} onClick={() => void scheduleReview()} className="h-10 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 disabled:opacity-40">{!schedule ? "确认首次复习" : schedule.status === "PAUSED" ? "确认恢复排期" : "确认调整日期"}</button></div></div> : null}
        </section>

        <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-history-heading">
          <h2 id="mistake-history-heading" className="text-lg font-medium text-white">复习历史</h2>
          {mistake.reviewHistory.length === 0 ? <p className="text-sm text-zinc-400">暂无已确认的复习记录。</p> : <ol className="grid gap-2">{mistake.reviewHistory.map((event) => <li key={event.id} className="rounded-md border border-white/10 bg-[#101419] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-zinc-100">{labelResult(event.result)}{event.correctedEventId ? "（更正事件）" : correctedIds.has(event.id) ? "（已被更正）" : ""}</span><time className="text-xs text-zinc-500" dateTime={event.confirmedAt}>{formatDateTime(event.confirmedAt)}</time></div><p className="mt-1 text-xs text-zinc-400">有效时长 {formatDuration(event.durationSeconds)} · 下次 {formatDate(event.nextDueDate)}</p>{event.note ? <p className="mt-2 whitespace-pre-wrap text-zinc-300">{event.note}</p> : null}</li>)}</ol>}
        </section>
      </> : <p className="border-t border-white/10 pt-5 text-sm text-zinc-400">完成本次作答后查看错因、正确思路、排期和历史。</p>}

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {conflict && !conflictOpen ? <button type="button" className="text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理错题状态冲突</button> : null}
      <ConfirmationDialog
        open={confirmation !== null}
        title={confirmation === "archive" ? "归档这道错题？" : "放弃本机编辑？"}
        description={confirmation === "archive"
          ? "归档后错题变为只读，活动复习排期会暂停。恢复错题不会自动恢复排期。"
          : "当前未提交的错因、题面和正确思路会被清除，服务端已保存内容不会改变。"}
        confirmLabel={confirmation === "archive" ? "确认归档" : "放弃并清除草稿"}
        pending={pending && confirmation === "archive"}
        pendingLabel="正在归档"
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation === "archive") {
            setConfirmation(null);
            void toggleArchive();
          } else {
            cancelEdit();
            setConfirmation(null);
          }
        }}
      />
      <ConflictResolutionModal open={conflictOpen && Boolean(conflict)} title="处理错题状态冲突" description="服务端错题已变化。本地作答与编辑草稿仍保留，系统不会强制覆盖或自动重放。" conflictFields={conflict?.conflictFields ?? []} comparisons={conflictComparisons(localEdit, mistake, conflict?.latest)} onClose={() => setConflictOpen(false)} onAdoptServer={adoptLatestConflict} onManualMerge={mergeOntoLatest} mergeLabel="保留本地输入并采用最新基线" />
    </article>
  );
}

interface MistakeResponse { mistake?: MistakeDto; latest?: unknown; conflictFields?: string[]; error?: string }
interface ReviewScheduleResponse { schedule?: NonNullable<MistakeDto["reviewSchedule"]>; error?: string }

async function readMistakeResponse(response: Response): Promise<MistakeResponse | null> {
  return response.json().catch(() => null) as Promise<MistakeResponse | null>;
}

function toEditDraft(mistake: MistakeDto): MistakeEditDraft { return { baseUpdatedAt: mistake.updatedAt, title: mistake.title, questionText: mistake.questionText ?? "", source: mistake.source ?? "", cause: mistake.cause, causeNote: mistake.causeNote ?? "", correctAnswer: mistake.correctAnswer ?? "", correctIdea: mistake.correctIdea ?? "" }; }
function editDraftsEqual(left: MistakeEditDraft, right: MistakeEditDraft) { return JSON.stringify(left) === JSON.stringify(right); }
function isCompleteMistake(mistake: Pick<MistakeDto, "questionText" | "cause" | "correctIdea">) { return Boolean(mistake.questionText?.trim()) && mistake.cause !== "unknown" && Boolean(mistake.correctIdea?.trim()); }
function isAnswerDraft(value: unknown): value is MistakeAnswerDraft { if (!value || typeof value !== "object") return false; const draft = value as Partial<MistakeAnswerDraft>; return (draft.answerMode === "TEXT" || draft.answerMode === "PAPER_OR_ORAL") && typeof draft.answerText === "string" && typeof draft.paperOrOralCompleted === "boolean" && typeof draft.revealed === "boolean" && (draft.result === "PASSED" || draft.result === "PARTIAL" || draft.result === "FAILED") && typeof draft.note === "string"; }
function isEditDraft(value: unknown): value is MistakeEditDraft { if (!value || typeof value !== "object") return false; const draft = value as Partial<MistakeEditDraft>; return [draft.baseUpdatedAt, draft.title, draft.questionText, draft.source, draft.causeNote, draft.correctAnswer, draft.correctIdea].every((field) => typeof field === "string") && causeOptions.some(([cause]) => cause === draft.cause); }
function isScheduleDraft(value: unknown): value is MistakeScheduleDraft { return Boolean(value && typeof value === "object" && typeof (value as Partial<MistakeScheduleDraft>).reviewDate === "string"); }
function isMistakeDto(value: unknown): value is MistakeDto { if (!value || typeof value !== "object") return false; const row = value as Partial<MistakeDto>; return typeof row.id === "string" && typeof row.updatedAt === "string" && typeof row.title === "string" && Array.isArray(row.reviewHistory); }
function toMistakeReviewSchedule(schedule: NonNullable<MistakeDto["reviewSchedule"]>) { return schedule; }
function toDateInput(value: string | null) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未设置"; }
function formatDateTime(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }); }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const remainder = seconds % 60; return minutes > 0 ? `${minutes} 分 ${remainder} 秒` : `${remainder} 秒`; }
function labelCause(cause: MistakeCauseDto) { return causeOptions.find(([value]) => value === cause)?.[1] ?? cause; }
function labelResult(result: "PASSED" | "PARTIAL" | "FAILED") { return result === "PASSED" ? "通过" : result === "PARTIAL" ? "部分掌握" : "未通过"; }
function addStudyDays(days: number) { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + days); return toDateInput(date.toISOString()); }
function MistakeTrendSummary({ mistake }: { mistake: MistakeDto }) { const recent = mistake.attempts.slice(0, 5); const passed = recent.filter((attempt) => attempt.result === "PASSED").length; const failed = recent.filter((attempt) => attempt.result === "FAILED").length; const rate = recent.length ? Math.round((passed / recent.length) * 100) : 0; const latest = recent[0]; return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><TrendMetric label="最近通过率" value={`${rate}%`} /><TrendMetric label="连续通过" value={`${mistake.reviewSchedule?.consecutivePassCount ?? 0} 次`} /><TrendMetric label="最近失败" value={`${failed} 次`} /><TrendMetric label="最近结果" value={latest ? labelResult(latest.result) : "暂无"} /></div>; }
function TrendMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-white/10 bg-[#101419] px-3 py-2"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-sm font-medium text-zinc-100">{value}</p></div>; }
function conflictComparisons(local: MistakeEditDraft, baseline: MistakeDto, latest?: MistakeDto) { return [
  { field: "updatedAt", label: "更新时间", baseline: baseline.updatedAt, local: local.baseUpdatedAt, server: latest?.updatedAt },
  { field: "archivedAt", label: "归档状态", local: baseline.archivedAt, server: latest?.archivedAt },
  { field: "title", label: "题面", local: local.title, server: latest?.title },
  { field: "source", label: "来源", local: local.source || null, server: latest?.source },
  { field: "cause", label: "错因", local: local.cause, server: latest?.cause },
  { field: "correctIdea", label: "正确思路", local: local.correctIdea, server: latest?.correctIdea },
]; }
