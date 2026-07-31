"use client";

import { Archive, Eye, Pencil, Play, RotateCcw, Save, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { BackToListLink } from "@/components/list-return-context";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { MistakeCauseDto, MistakeDto } from "@/lib/study/types";

interface MistakeAnswerDraft {
  answerText: string;
  revealed: boolean;
}

interface MistakeEditDraft {
  baseUpdatedAt: string;
  title: string;
  source: string;
  cause: MistakeCauseDto;
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
  const [source, setSource] = useState(props.mistake.source ?? "");
  const [cause, setCause] = useState(props.mistake.cause);
  const [correctIdea, setCorrectIdea] = useState(props.mistake.correctIdea ?? "");
  const [answerText, setAnswerText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewDate, setReviewDate] = useState(initialReviewDate);
  const [savedReviewDate, setSavedReviewDate] = useState(initialReviewDate);
  const [renderedAt] = useState(() => Date.now());
  const [draftReady, setDraftReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MistakeConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const archived = Boolean(mistake.archivedAt);
  const complete = isCompleteMistake(mistake);
  const localEdit = { baseUpdatedAt, title, source, cause, correctIdea };
  const dirty = !editDraftsEqual(localEdit, savedBaseline);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const answerDraft = loadPrivateBusinessDraft(answerDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isAnswerDraft);
      if (answerDraft) {
        setAnswerText(answerDraft.answerText);
        setRevealed(answerDraft.revealed);
      }
      if (!props.readOnly) {
        const editDraft = loadPrivateBusinessDraft(editDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isEditDraft);
        if (editDraft) {
          setBaseUpdatedAt(editDraft.baseUpdatedAt);
          setTitle(editDraft.title);
          setSource(editDraft.source);
          setCause(editDraft.cause);
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
    if (!answerText && !revealed) {
      removePrivateBusinessDraft(answerDraftKey);
      return;
    }
    savePrivateBusinessDraft<MistakeAnswerDraft>(answerDraftKey, { answerText, revealed });
  }, [answerDraftKey, answerText, draftReady, revealed]);

  useEffect(() => {
    if (!draftReady || archived || props.readOnly) return;
    const draft = { baseUpdatedAt, title, source, cause, correctIdea };
    if (editDraftsEqual(draft, savedBaseline)) {
      removePrivateBusinessDraft(editDraftKey);
      return;
    }
    savePrivateBusinessDraft<MistakeEditDraft>(editDraftKey, draft);
  }, [archived, baseUpdatedAt, cause, correctIdea, draftReady, editDraftKey, props.readOnly, savedBaseline, source, title]);

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
    if (!title.trim() || cause === "unknown" || !correctIdea.trim()) {
      setError("请填写题面、明确错因和正确思路后再保存。");
      return;
    }
    const payload = complete
      ? { title, source: source.trim() || null, cause, correctIdea, expectedUpdatedAt: baseUpdatedAt }
      : { cause, correctIdea, expectedUpdatedAt: baseUpdatedAt };
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
      setSource(next.source);
      setCause(next.cause);
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
    setSource(saved.source);
    setCause(saved.cause);
    setCorrectIdea(saved.correctIdea);
    removePrivateBusinessDraft(editDraftKey);
    setEditing(false);
    setError(null);
  }

  const schedule = mistake.reviewSchedule;
  const reviewDue = schedule?.status === "ACTIVE" && Boolean(schedule.dueDate) && new Date(schedule.dueDate as string).getTime() <= renderedAt;
  const correctedIds = useMemo(
    () => new Set(mistake.reviewHistory.flatMap((event) => event.correctedEventId ? [event.correctedEventId] : [])),
    [mistake.reviewHistory],
  );

  return (
    <article className="space-y-6">
      <BackToListLink className="text-sm text-teal-300 hover:underline" fallbackHref="/knowledge/mistakes">返回错题列表</BackToListLink>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500">{mistake.subjectName} · {mistake.syllabusNodeTitle ?? "未关联考纲"}</p>
          <DetailHeading className="mt-1 text-2xl font-semibold text-white">{mistake.title}</DetailHeading>
          {mistake.source ? <p className="mt-2 text-sm text-zinc-400">来源：{mistake.source}</p> : null}
        </div>
        {!props.readOnly ? <button type="button" disabled={pending} onClick={() => void toggleArchive()} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm disabled:opacity-50">
          {archived ? <RotateCcw size={16} aria-hidden /> : <Archive size={16} aria-hidden />}
          {archived ? "恢复错题" : "归档错题"}
        </button> : null}
      </header>

      {props.readOnly ? <p role="status" className="border-l-2 border-zinc-500 pl-3 text-sm leading-6 text-zinc-300">{props.subjectArchived ? `“${mistake.subjectName}”科目已归档` : `“${props.workspaceName}”工作区已归档`}，本页只读保留错题与复习历史；不会进入当前排期或写事务。</p> : archived ? <p role="status" className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">错题已归档，当前只读；相关复习排期已暂停。恢复错题后仍需重新选择复习日期。</p> : !complete ? <p role="status" className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">待补全：这条旧错题缺少明确错因或正确思路。补全前不能新增或开始复习。</p> : null}

      <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-answer-heading">
        <div><p className="text-xs text-zinc-500">本次作答</p><h2 id="mistake-answer-heading" className="mt-1 text-lg font-medium text-white">先独立重做</h2></div>
        {!revealed ? <>
          <textarea aria-label="本次作答" className="min-h-32 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-sm leading-6" value={answerText} onChange={(event) => setAnswerText(event.target.value)} placeholder="写下本次答案或关键步骤" />
          <button type="button" disabled={!answerText.trim()} onClick={() => setRevealed(true)} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"><Eye size={16} aria-hidden />提交本次作答</button>
        </> : <div className="space-y-3">
          <p className="whitespace-pre-wrap rounded-md border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-200">{answerText}</p>
          <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-zinc-500">本次答案仅保存在当前设备，不计入复习历史。</span><button type="button" className="inline-flex h-9 items-center gap-2 text-sm text-teal-300" onClick={() => setRevealed(false)}><Undo2 size={15} aria-hidden />重新作答</button></div>
        </div>}
      </section>

      {revealed ? <>
        <section className="space-y-4 border-t border-white/10 pt-5" aria-labelledby="mistake-review-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mistake-review-heading" className="text-lg font-medium text-white">错因与正确思路</h2>{!props.readOnly && !archived && !editing ? <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 items-center gap-2 text-sm text-teal-300"><Pencil size={15} aria-hidden />{complete ? "编辑错题" : "补全错题"}</button> : null}</div>
          {editing && !archived && !props.readOnly ? <div className="grid gap-3">
            {complete ? <><label className="text-sm text-zinc-400">题面<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-zinc-100" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="text-sm text-zinc-400">来源<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-zinc-100" value={source} onChange={(event) => setSource(event.target.value)} /></label></> : null}
            <label className="text-sm text-zinc-400">错因<select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-zinc-100" value={cause} onChange={(event) => setCause(event.target.value as MistakeCauseDto)}>{causeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm text-zinc-400">正确思路<textarea className="mt-1 min-h-32 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-zinc-100" value={correctIdea} onChange={(event) => setCorrectIdea(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={pending || !title.trim() || cause === "unknown" || !correctIdea.trim()} onClick={() => void saveEdit()} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-40"><Save size={16} aria-hidden />保存</button><button type="button" disabled={pending} onClick={cancelEdit} className="h-11 rounded-md border border-white/10 px-4 text-sm">取消</button></div>
          </div> : <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">错因</dt><dd className="mt-1 text-sm text-zinc-200">{labelCause(mistake.cause)}</dd></div><div><dt className="text-xs text-zinc-500">正确思路</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{mistake.correctIdea || "待补全"}</dd></div></dl>}
        </section>

        <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-schedule-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mistake-schedule-heading" className="text-lg font-medium text-white">复习排期</h2>{schedule && !props.readOnly ? <Link href={`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(`/knowledge/mistakes/${mistake.id}`)}`} className="text-sm text-teal-300 hover:underline">查看排期详情</Link> : null}</div>
          {schedule ? <p className="text-sm text-zinc-300">{schedule.status === "ACTIVE" ? `下次复习：${formatDate(schedule.dueDate)}` : `排期已暂停${schedule.pausedReason ? `：${schedule.pausedReason}` : ""}`} · 连续通过 {schedule.consecutivePassCount} 次</p> : mistake.nextReviewAt ? <p className="text-sm text-amber-100">旧复习日期：{formatDate(mistake.nextReviewAt)}。选择日期后会物化为统一复习排期。</p> : <p className="text-sm text-zinc-400">尚未设置统一复习排期。</p>}
          {!props.readOnly && !archived && complete ? <div className="flex flex-wrap gap-2"><input aria-label="复习日期" type="date" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /><button type="button" disabled={pending || !reviewDate} onClick={() => void scheduleReview()} className="h-10 rounded-md border border-white/10 px-3 text-sm disabled:opacity-40">{!schedule ? "设置首次复习日期" : schedule.status === "PAUSED" ? "选择日期并恢复排期" : "调整复习日期"}</button></div> : null}
          {reviewDue && complete && !props.readOnly && !archived && schedule ? <Link href={`/quick-review/${schedule.id}?returnTo=${encodeURIComponent(`/knowledge/mistakes/${mistake.id}`)}`} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-500 px-4 text-sm font-medium text-black"><Play size={16} aria-hidden />开始复习</Link> : null}
        </section>

        <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-history-heading">
          <h2 id="mistake-history-heading" className="text-lg font-medium text-white">复习历史</h2>
          {mistake.reviewHistory.length === 0 ? <p className="text-sm text-zinc-400">暂无已确认的复习记录。</p> : <ol className="grid gap-2">{mistake.reviewHistory.map((event) => <li key={event.id} className="rounded-md border border-white/10 bg-[#101419] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-zinc-100">{labelResult(event.result)}{event.correctedEventId ? "（更正事件）" : correctedIds.has(event.id) ? "（已被更正）" : ""}</span><time className="text-xs text-zinc-500" dateTime={event.confirmedAt}>{formatDateTime(event.confirmedAt)}</time></div><p className="mt-1 text-xs text-zinc-400">有效时长 {formatDuration(event.durationSeconds)} · 下次 {formatDate(event.nextDueDate)}</p>{event.note ? <p className="mt-2 whitespace-pre-wrap text-zinc-300">{event.note}</p> : null}</li>)}</ol>}
        </section>
      </> : <p className="border-t border-white/10 pt-5 text-sm text-zinc-400">完成本次作答后查看错因、正确思路、排期和历史。</p>}

      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      {conflict && !conflictOpen ? <button type="button" className="text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理错题状态冲突</button> : null}
      <ConflictResolutionModal open={conflictOpen && Boolean(conflict)} title="处理错题状态冲突" description="服务端错题已变化。本地作答与编辑草稿仍保留，系统不会强制覆盖或自动重放。" conflictFields={conflict?.conflictFields ?? []} comparisons={conflictComparisons(localEdit, mistake, conflict?.latest)} onClose={() => setConflictOpen(false)} onAdoptServer={adoptLatestConflict} onManualMerge={mergeOntoLatest} mergeLabel="保留本地输入并采用最新基线" />
    </article>
  );
}

interface MistakeResponse { mistake?: MistakeDto; latest?: unknown; conflictFields?: string[]; error?: string }
interface ReviewScheduleResponse { schedule?: NonNullable<MistakeDto["reviewSchedule"]>; error?: string }

async function readMistakeResponse(response: Response): Promise<MistakeResponse | null> {
  return response.json().catch(() => null) as Promise<MistakeResponse | null>;
}

function toEditDraft(mistake: MistakeDto): MistakeEditDraft { return { baseUpdatedAt: mistake.updatedAt, title: mistake.title, source: mistake.source ?? "", cause: mistake.cause, correctIdea: mistake.correctIdea ?? "" }; }
function editDraftsEqual(left: MistakeEditDraft, right: MistakeEditDraft) { return JSON.stringify(left) === JSON.stringify(right); }
function isCompleteMistake(mistake: Pick<MistakeDto, "cause" | "correctIdea">) { return mistake.cause !== "unknown" && Boolean(mistake.correctIdea?.trim()); }
function isAnswerDraft(value: unknown): value is MistakeAnswerDraft { if (!value || typeof value !== "object") return false; const draft = value as Partial<MistakeAnswerDraft>; return typeof draft.answerText === "string" && typeof draft.revealed === "boolean"; }
function isEditDraft(value: unknown): value is MistakeEditDraft { if (!value || typeof value !== "object") return false; const draft = value as Partial<MistakeEditDraft>; return [draft.baseUpdatedAt, draft.title, draft.source, draft.correctIdea].every((field) => typeof field === "string") && causeOptions.some(([cause]) => cause === draft.cause); }
function isScheduleDraft(value: unknown): value is MistakeScheduleDraft { return Boolean(value && typeof value === "object" && typeof (value as Partial<MistakeScheduleDraft>).reviewDate === "string"); }
function isMistakeDto(value: unknown): value is MistakeDto { if (!value || typeof value !== "object") return false; const row = value as Partial<MistakeDto>; return typeof row.id === "string" && typeof row.updatedAt === "string" && typeof row.title === "string" && Array.isArray(row.reviewHistory); }
function toMistakeReviewSchedule(schedule: NonNullable<MistakeDto["reviewSchedule"]>) { return schedule; }
function toDateInput(value: string | null) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未设置"; }
function formatDateTime(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }); }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const remainder = seconds % 60; return minutes > 0 ? `${minutes} 分 ${remainder} 秒` : `${remainder} 秒`; }
function labelCause(cause: MistakeCauseDto) { return causeOptions.find(([value]) => value === cause)?.[1] ?? cause; }
function labelResult(result: "PASSED" | "PARTIAL" | "FAILED") { return result === "PASSED" ? "通过" : result === "PARTIAL" ? "部分掌握" : "未通过"; }
function conflictComparisons(local: MistakeEditDraft, baseline: MistakeDto, latest?: MistakeDto) { return [
  { field: "updatedAt", label: "更新时间", baseline: baseline.updatedAt, local: local.baseUpdatedAt, server: latest?.updatedAt },
  { field: "archivedAt", label: "归档状态", local: baseline.archivedAt, server: latest?.archivedAt },
  { field: "title", label: "题面", local: local.title, server: latest?.title },
  { field: "source", label: "来源", local: local.source || null, server: latest?.source },
  { field: "cause", label: "错因", local: local.cause, server: latest?.cause },
  { field: "correctIdea", label: "正确思路", local: local.correctIdea, server: latest?.correctIdea },
]; }
