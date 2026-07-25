"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SafeMarkdownView } from "@/components/safe-markdown-view";
import type { ReviewEventDto, ReviewScheduleDto } from "@/lib/study/review-schedule-service";
import type { ReviewTargetDto } from "@/lib/study/review-target-service";

const DRAFT_PREFIX = "areaforge.quick-review.v2.";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type ReviewResult = "PASSED" | "PARTIAL" | "FAILED";
type AnswerMode = "TEXT" | "PAPER_OR_ORAL";

interface QuickReviewDraft {
  version: 2;
  userId: string;
  scheduleId: string;
  createdAt: number;
  updatedAt: number;
  idempotencyKey: string;
  elapsedSeconds: number;
  runningSince: number | null;
  suspended: boolean;
  result: ReviewResult;
  nextDueDate: string;
  note: string;
  answerMode: AnswerMode;
  answerText: string;
  paperOrOralCompleted: boolean;
  revealed: boolean;
}

interface ConfirmResponse {
  schedule: ReviewScheduleDto;
  event: ReviewEventDto;
  reused: boolean;
  nextScheduleId: string | null;
}

interface ConflictBody {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
}

function draftKey(userId: string, scheduleId: string) {
  return `${DRAFT_PREFIX}${userId}.${scheduleId}`;
}

function createIdempotencyKey(scheduleId: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `quick-review-${scheduleId}-${random}`;
}

function createDraft(userId: string, schedule: ReviewScheduleDto): QuickReviewDraft {
  const now = Date.now();
  return {
    version: 2,
    userId,
    scheduleId: schedule.id,
    createdAt: now,
    updatedAt: now,
    idempotencyKey: createIdempotencyKey(schedule.id),
    elapsedSeconds: 0,
    runningSince: now,
    suspended: false,
    result: "PARTIAL",
    nextDueDate: "",
    note: "",
    answerMode: "TEXT",
    answerText: "",
    paperOrOralCompleted: false,
    revealed: schedule.targetType !== "MISTAKE",
  };
}

function readDraft(userId: string, schedule: ReviewScheduleDto): QuickReviewDraft | null {
  try {
    const key = draftKey(userId, schedule.id);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuickReviewDraft>;
    if (
      parsed.version !== 2 ||
      parsed.userId !== userId ||
      parsed.scheduleId !== schedule.id ||
      typeof parsed.updatedAt !== "number" ||
      Date.now() - parsed.updatedAt > DRAFT_TTL_MS ||
      typeof parsed.idempotencyKey !== "string"
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed as QuickReviewDraft;
  } catch {
    return null;
  }
}

function elapsedAt(draft: QuickReviewDraft, now: number) {
  if (draft.suspended || draft.runningSince === null) return draft.elapsedSeconds;
  return draft.elapsedSeconds + Math.max(0, Math.floor((now - draft.runningSince) / 1000));
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function QuickReviewClient(props: {
  userId: string;
  schedule: ReviewScheduleDto;
  target: ReviewTargetDto;
  returnTo: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<QuickReviewDraft | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<ConflictBody | null>(null);
  const [done, setDone] = useState<ConfirmResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDraft(readDraft(props.userId, props.schedule) ?? createDraft(props.userId, props.schedule));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.schedule, props.userId]);

  useEffect(() => {
    if (!draft) return;
    window.localStorage.setItem(
      draftKey(props.userId, props.schedule.id),
      JSON.stringify({ ...draft, updatedAt: Date.now() }),
    );
  }, [draft, props.schedule.id, props.userId]);

  useEffect(() => {
    if (!draft || draft.suspended || done) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [done, draft]);

  const durationSeconds = useMemo(
    () => (draft ? Math.max(1, elapsedAt(draft, now)) : 1),
    [draft, now],
  );

  if (props.schedule.status === "PAUSED") {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 px-4">
        <h1 className="text-2xl font-semibold text-white">排期已暂停</h1>
        <p className="text-sm text-zinc-400">暂停的 Schedule 不能开始快速复习。</p>
        <Link href={props.returnTo} className="text-teal-300 hover:underline">返回</Link>
      </section>
    );
  }

  if (!draft) {
    return <p className="p-6 text-sm text-zinc-400">正在恢复本地复习草稿...</p>;
  }

  const mistakeAnswered = draft.answerMode === "TEXT"
    ? draft.answerText.trim().length > 0
    : draft.paperOrOralCompleted;

  function updateDraft(patch: Partial<QuickReviewDraft>) {
    setDraft((current) => current ? { ...current, ...patch, updatedAt: Date.now() } : current);
  }

  function toggleSuspended() {
    setNow(Date.now());
    setDraft((current) => {
      if (!current) return current;
      const timestamp = Date.now();
      if (current.suspended) {
        return { ...current, suspended: false, runningSince: timestamp, updatedAt: timestamp };
      }
      return {
        ...current,
        elapsedSeconds: elapsedAt(current, timestamp),
        runningSince: null,
        suspended: true,
        updatedAt: timestamp,
      };
    });
  }

  async function confirm() {
    const currentDraft = draft;
    if (!currentDraft) return;
    setError(null);
    setSubmitting(true);
    const response = await fetch(`/api/review-schedules/${props.schedule.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result: currentDraft.result,
        durationSeconds,
        nextDueDate: currentDraft.nextDueDate || undefined,
        note: currentDraft.note || undefined,
        expectedRevision: props.schedule.revision,
        idempotencyKey: currentDraft.idempotencyKey,
      }),
    });
    const body = (await response.json().catch(() => null)) as ConfirmResponse | ConflictBody | null;
    setSubmitting(false);
    if (!response.ok) {
      setError((body as ConflictBody | null) ?? { error: "确认失败" });
      return;
    }
    window.localStorage.removeItem(draftKey(props.userId, props.schedule.id));
    setDone(body as ConfirmResponse);
  }

  function discardDraft() {
    window.localStorage.removeItem(draftKey(props.userId, props.schedule.id));
    router.replace(props.returnTo);
  }

  if (done) {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold text-white">本次复习已确认</h1>
        <dl className="grid grid-cols-2 gap-3 rounded-md border border-white/10 bg-[#101419] p-4 text-sm">
          <div><dt className="text-zinc-500">结果</dt><dd className="mt-1 text-white">{done.event.result}</dd></div>
          <div><dt className="text-zinc-500">有效时长</dt><dd className="mt-1 text-white">{formatDuration(done.event.durationSeconds)}</dd></div>
          <div><dt className="text-zinc-500">下次复习</dt><dd className="mt-1 text-white">{new Date(done.event.nextDueDate).toLocaleDateString("zh-CN")}</dd></div>
          <div><dt className="text-zinc-500">排期版本</dt><dd className="mt-1 text-white">r{done.schedule.revision}{done.reused ? "（重试复用）" : ""}</dd></div>
        </dl>
        <section className="space-y-2 rounded-md border border-white/10 bg-[#101419] p-4">
          <p className="text-xs text-zinc-500">本次复习对象</p>
          <h2 className="text-lg font-medium text-white">{props.target.title}</h2>
          <p className="text-sm text-zinc-400">{props.target.subtitle}</p>
          <Link className="text-sm text-teal-300 hover:underline" href={props.target.canonicalHref}>查看对象详情</Link>
        </section>
        <p className="text-sm text-zinc-400">结果页不会自动跳转，由你决定下一步。</p>
        <div className="flex flex-wrap gap-3">
          {done.nextScheduleId ? <Link href={`/quick-review/${done.nextScheduleId}?returnTo=${encodeURIComponent(props.returnTo)}`} className="text-teal-300 hover:underline">开始下一项</Link> : <Link href="/knowledge/reviews" className="text-teal-300 hover:underline">返回复习队列</Link>}
          <Link href="/today" className="text-teal-300 hover:underline">回今日</Link>
          <Link href={`/knowledge/reviews/${done.schedule.id}`} className="text-teal-300 hover:underline">查看排期详情</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4 py-8">
      <Link href={props.returnTo} className="text-sm text-zinc-400 hover:text-zinc-200">离开（草稿保留 24 小时）</Link>
      <div>
        <p className="text-sm text-teal-300">{props.target.subtitle}</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">快速复习</h1>
        <p className="mt-2 text-sm text-zinc-400">到期日 {props.schedule.dueDate ? new Date(props.schedule.dueDate).toLocaleDateString("zh-CN") : "无"}</p>
      </div>

      <section className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4" aria-labelledby="quick-review-target">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-xs text-zinc-500">复习对象</p><h2 id="quick-review-target" className="mt-1 text-xl font-medium text-white">{props.target.title}</h2></div>
          <Link className="text-sm text-teal-300 hover:underline" href={props.target.canonicalHref}>打开详情</Link>
        </div>
        <SafeMarkdownView nodes={props.target.body} />
        {props.schedule.targetType === "MISTAKE" && draft.revealed && props.target.revealBody.length ? (
          <div className="border-t border-white/10 pt-3"><p className="text-sm font-medium text-amber-200">{props.target.revealTitle}</p><div className="mt-2"><SafeMarkdownView nodes={props.target.revealBody} /></div></div>
        ) : null}
      </section>

      <div className="flex items-center justify-between rounded-md border border-white/10 bg-[#101419] p-4">
        <div><p className="text-xs text-zinc-500">有效计时</p><p className="mt-1 font-mono text-2xl text-white" aria-live="off">{formatDuration(durationSeconds)}</p></div>
        <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm" onClick={toggleSuspended}>
          {draft.suspended ? "继续计时" : "挂起"}
        </button>
      </div>

      {props.schedule.targetType === "MISTAKE" && !draft.revealed ? (
        <div className="space-y-4 rounded-md border border-white/10 bg-[#101419] p-4">
          <p className="text-sm text-zinc-300">先完成作答，再揭示错题内容。</p>
          <fieldset className="space-y-2">
            <legend className="text-sm text-zinc-400">作答方式</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={draft.answerMode === "TEXT"} onChange={() => updateDraft({ answerMode: "TEXT" })} />文字作答</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={draft.answerMode === "PAPER_OR_ORAL"} onChange={() => updateDraft({ answerMode: "PAPER_OR_ORAL" })} />纸上或口头作答</label>
          </fieldset>
          {draft.answerMode === "TEXT" ? (
            <label className="block text-sm">你的答案<textarea className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#151a20] px-2 py-2" value={draft.answerText} onChange={(event) => updateDraft({ answerText: event.target.value })} /></label>
          ) : (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.paperOrOralCompleted} onChange={(event) => updateDraft({ paperOrOralCompleted: event.target.checked })} />我已完成纸上或口头作答</label>
          )}
          <button type="button" disabled={!mistakeAnswered} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40" onClick={() => updateDraft({ revealed: true })}>完成作答，继续</button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          {props.schedule.targetType === "MISTAKE" ? <p className="text-xs text-zinc-500">已完成{draft.answerMode === "TEXT" ? "文字" : "纸上或口头"}作答</p> : null}
          {!props.target.canPass ? <p role="status" className="rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-sm text-amber-100">这条旧错题还缺少明确错因或正确思路，补全前不能确认通过。<Link href={props.target.canonicalHref} className="ml-2 text-teal-300 hover:underline">打开错题详情</Link></p> : null}
          <label className="block text-sm">结果<select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={draft.result} onChange={(event) => updateDraft({ result: event.target.value as ReviewResult })}><option value="PASSED" disabled={!props.target.canPass}>通过</option><option value="PARTIAL">部分</option><option value="FAILED">失败</option></select></label>
          <label className="block text-sm">下次日期（可选）<input type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={draft.nextDueDate} onChange={(event) => updateDraft({ nextDueDate: event.target.value })} /></label>
          <label className="block text-sm">备注<textarea className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] px-2 py-2" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={submitting} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50" onClick={() => void confirm()}>{submitting ? "确认中..." : "确认本次复习"}</button>
            <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm" onClick={discardDraft}>丢弃草稿</button>
          </div>
        </div>
      )}

      {error ? (
        <div role="alert" className="rounded-md border border-red-400/20 bg-red-950/20 p-3 text-sm text-red-200">
          <p>确认失败：{error.error ?? "UNKNOWN_ERROR"}</p>
          {error.conflictFields?.length ? <p className="mt-1">冲突字段：{error.conflictFields.join("、")}</p> : null}
          {error.latest !== undefined ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{JSON.stringify(error.latest, null, 2)}</pre> : null}
          <p className="mt-2 text-zinc-400">草稿与幂等键已保留。刷新查看最新排期后再决定是否重试。</p>
        </div>
      ) : null}
    </section>
  );
}
