"use client";

import { ArrowLeft, ArrowRight, BookOpen, History } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import { SafeMarkdownView } from "@/components/safe-markdown-view";
import { ButtonLink } from "@/components/ui/button";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { withReturnTo } from "@/lib/navigation/batch7";
import { getCompletionReturnLabel, getReturnContextLabel } from "@/lib/navigation/return-context";
import {
  acquireQuickReviewDraftWriter,
  type QuickReviewDraftWriterLease,
} from "@/lib/client/quick-review-activity";
import {
  bindQuickReviewDraftToSchedule,
  compareAndSwapQuickReviewDraft,
  createQuickReviewDraft,
  createQuickReviewDraftIfAbsent,
  createQuickReviewIdempotencyKey,
  quickReviewElapsedAt,
  readQuickReviewDraft,
  removeQuickReviewDraftCas,
  resumeQuickReviewDraft,
  subscribeQuickReviewDraft,
  suspendQuickReviewDraft,
  upgradeQuickReviewDraftStorage,
  type QuickReviewDraft,
  type QuickReviewResult,
} from "@/lib/client/quick-review-draft";
import type { ReviewEventDto, ReviewScheduleDto } from "@/lib/study/review-schedule-service";
import type { ReviewTargetDto } from "@/lib/study/review-target-service";

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
  workbench?: string;
}

type DraftAccess = "loading" | "writable" | "remote-readonly" | "stale";

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
  const {
    startQuickReviewActivity,
    resolveQuickReviewActivity,
    finishQuickReviewActivity,
    registerQuickReviewDraftHandler,
  } = useQuickReviewActivityGuard();
  const [draft, setDraft] = useState<QuickReviewDraft | null>(null);
  const draftRef = useRef<QuickReviewDraft | null>(null);
  const writerRef = useRef<QuickReviewDraftWriterLease | null>(null);
  const accessRef = useRef<DraftAccess>("loading");
  const [access, setAccess] = useState<DraftAccess>("loading");
  const [remoteDraft, setRemoteDraft] = useState<QuickReviewDraft | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<ConflictBody | null>(null);
  const [conflict, setConflict] = useState<ConflictBody | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [done, setDone] = useState<ConfirmResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const activityBlocked = access !== "writable";

  const publishDraft = useCallback((next: QuickReviewDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const publishAccess = useCallback((next: DraftAccess) => {
    accessRef.current = next;
    setAccess(next);
  }, []);

  const markStale = useCallback((latest: QuickReviewDraft | null) => {
    const writer = writerRef.current;
    writerRef.current = null;
    writer?.release();
    setRemoteDraft(latest);
    publishAccess("stale");
    setError({ error: "另一标签页已更新这份草稿。本页输入已冻结，请刷新并人工核对，系统不会自动覆盖。" });
  }, [publishAccess]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const writer = await acquireQuickReviewDraftWriter({
          userId: props.userId,
          scheduleId: props.schedule.id,
        });
        if (cancelled) {
          writer?.release();
          return;
        }
        if (!writer) {
          publishDraft(readQuickReviewDraft(props.userId, props.schedule));
          publishAccess("remote-readonly");
          setError({ error: "这份快速复习草稿正由另一个标签页编辑。本页只读，不会改写它。" });
          return;
        }
        writerRef.current = writer;
        publishAccess("writable");

        let current = readQuickReviewDraft(props.userId, props.schedule);
        if (current?.draftRevision === 0) {
          const upgraded = upgradeQuickReviewDraftStorage(current);
          if (!upgraded.ok) {
            markStale(upgraded.latest);
            return;
          }
          current = upgraded.draft;
        }
        if (current?.baseRevision === null) {
          const bound = bindQuickReviewDraftToSchedule(current, props.schedule);
          if (!bound.ok) {
            markStale(bound.latest);
            return;
          }
          current = bound.draft;
        }

        const canStart = props.target.canPass && props.schedule.status !== "PAUSED";
        let created = false;
        if (!current && canStart) {
          const result = createQuickReviewDraftIfAbsent(createQuickReviewDraft(props.userId, props.schedule));
          current = result.draft;
          created = result.created;
        }
        publishDraft(current);
        if (!current || !canStart) return;

        if (!current.suspended) {
          const recovered = await startQuickReviewActivity(props.schedule.id, current.draftId, props.target.subjectId ?? "");
          if (cancelled) return;
          if (!recovered) {
            writer.release();
            if (writerRef.current === writer) writerRef.current = null;
            publishAccess("remote-readonly");
            setError({ error: "无法证明这项运行中草稿的活动所有权。本页已转为只读。" });
          }
          return;
        }

        if (created) {
          const started = await startQuickReviewActivity(props.schedule.id, current.draftId, props.target.subjectId ?? "");
          if (cancelled) {
            if (started) void finishQuickReviewActivity(props.schedule.id, current.draftId);
            return;
          }
          if (!started) {
            setError({ error: "存在普通专注、另一项快速复习，或浏览器不支持安全互斥。本项草稿保持挂起。" });
            return;
          }
          const resumed = compareAndSwapQuickReviewDraft(current, resumeQuickReviewDraft(current));
          if (!resumed.ok) {
            void finishQuickReviewActivity(props.schedule.id, current.draftId);
            markStale(resumed.latest);
            return;
          }
          publishDraft(resumed.draft);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const writer = writerRef.current;
      writerRef.current = null;
      writer?.release();
    };
  }, [
    finishQuickReviewActivity,
    props.schedule,
    props.target.canPass,
    props.target.subjectId,
    props.userId,
    markStale,
    publishAccess,
    publishDraft,
    startQuickReviewActivity,
  ]);

  useEffect(() => {
    return subscribeQuickReviewDraft(
      props.userId,
      props.schedule.id,
      (nextDraft) => {
        if (accessRef.current === "writable") {
          const current = draftRef.current;
          if (!current || !nextDraft || current.draftId !== nextDraft.draftId || current.draftRevision !== nextDraft.draftRevision) {
            markStale(nextDraft);
          }
          return;
        }
        if (accessRef.current === "remote-readonly") publishDraft(nextDraft);
        else setRemoteDraft(nextDraft);
      },
    );
  }, [markStale, props.schedule.id, props.userId, publishDraft]);

  useEffect(() => {
    const registeredDraftId = draft?.draftId;
    if (access !== "writable" || !registeredDraftId) return;
    return registerQuickReviewDraftHandler(props.schedule.id, registeredDraftId, async (action) => {
      const current = draftRef.current;
      if (!writerRef.current || accessRef.current !== "writable" || !current || current.draftId !== registeredDraftId) {
        return null;
      }
      if (action === "discard") {
        const removed = removeQuickReviewDraftCas(current);
        if (!removed.ok) {
          markStale(removed.latest);
          return null;
        }
        publishDraft(null);
        window.setTimeout(() => router.replace(props.returnTo), 0);
        return { draftRevision: null };
      }
      const suspended = compareAndSwapQuickReviewDraft(current, suspendQuickReviewDraft(current));
      if (!suspended.ok) {
        markStale(suspended.latest);
        return null;
      }
      publishDraft(suspended.draft);
      return { draftRevision: suspended.draft.draftRevision };
    });
  }, [access, draft?.draftId, markStale, props.returnTo, props.schedule.id, publishDraft, registerQuickReviewDraftHandler, router]);

  useEffect(() => {
    if (!draft || !props.target.canPass || draft.suspended || done) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [done, draft, props.target.canPass]);

  const durationSeconds = useMemo(
    () => (draft ? draft.submittedDurationSeconds ?? quickReviewElapsedAt(draft, now) : 0),
    [draft, now],
  );

  if (props.schedule.status === "PAUSED") {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 px-4">
        <DetailHeading className="text-2xl font-semibold text-white">排期已暂停</DetailHeading>
        <p className="text-sm text-zinc-400">暂停的复习排期不能开始快速复习。</p>
        <Link href={props.returnTo} className="text-teal-300 hover:underline">{getReturnContextLabel(props.returnTo, "返回复习队列")}</Link>
      </section>
    );
  }

  if (!props.target.canPass) {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
        <DetailHeading className="text-2xl font-semibold text-white">错题需要先补全</DetailHeading>
        <p className="text-sm leading-6 text-zinc-400">这条旧错题缺少明确错因或正确思路，当前不能开始或确认快速复习。</p>
        <div className="flex flex-wrap gap-3">
          <Link href={withReturnTo(props.target.canonicalHref, props.returnTo)} className="inline-flex h-11 items-center rounded-md bg-teal-500 px-4 text-sm font-medium text-black">打开错题详情</Link>
          <Link href={props.returnTo} className="inline-flex h-11 items-center text-sm text-teal-300 hover:underline">{getReturnContextLabel(props.returnTo, "返回原位置")}</Link>
        </div>
      </section>
    );
  }

  if (done) {
    const completionActionLabel = done.nextScheduleId ? "继续下一项" : getCompletionReturnLabel(props.returnTo);
    const completionActionHref = done.nextScheduleId
      ? withReturnTo(`/knowledge/reviews/${done.nextScheduleId}/run`, props.returnTo)
      : props.returnTo;
    return (
      <section className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-5 px-4 py-8">
        <DetailHeading className="text-2xl font-semibold text-white">本次复习已确认</DetailHeading>
        <KnowledgeNextAction
          title={done.nextScheduleId ? "继续下一项复习" : completionActionLabel}
          description={done.nextScheduleId
            ? "当前结果已经写入复习历史，继续下一项会沿用本次来源。"
            : "当前结果已经写入复习历史，回到来源后可以继续处理下一行动。"}
          status={<span className="rounded-md border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-sm text-teal-100">结果已保存</span>}
          action={
            <ButtonLink href={completionActionHref} variant="primary" size="md">
              {done.nextScheduleId ? <ArrowRight size={16} aria-hidden /> : <ArrowLeft size={16} aria-hidden />}
              {completionActionLabel}
            </ButtonLink>
          }
        />
        <dl className="grid grid-cols-2 gap-3 rounded-md border border-white/10 bg-[#101419] p-4 text-sm">
          <div><dt className="text-zinc-500">本次结果</dt><dd className="mt-1 text-white">{reviewResultLabel(done.event.result)}</dd></div>
          <div><dt className="text-zinc-500">有效时长</dt><dd className="mt-1 text-white">{formatDuration(done.event.durationSeconds)}</dd></div>
          <div><dt className="text-zinc-500">下次复习</dt><dd className="mt-1 text-white">{new Date(done.event.nextDueDate).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd></div>
          <div><dt className="text-zinc-500">掌握变化</dt><dd className="mt-1 text-white">{masteryChangeLabel(props.schedule.consecutivePassCount, done.schedule.consecutivePassCount)}</dd></div>
        </dl>
        <section className="space-y-2 rounded-md border border-white/10 bg-[#101419] p-4">
          <p className="text-xs text-zinc-500">本次复习对象</p>
          <h2 className="text-lg font-medium text-white">{props.target.title}</h2>
          <p className="text-sm text-zinc-400">{props.target.subtitle}</p>
        </section>
        <p className="text-sm text-zinc-400">结果已经写入复习历史{done.reused ? "，本次为幂等重试复用" : ""}。</p>
        <div className="flex flex-wrap gap-3">
          <Link href={withReturnTo(props.target.canonicalHref, props.returnTo)} className="inline-flex h-10 items-center gap-2 px-2 text-sm text-teal-300 hover:underline"><BookOpen size={16} aria-hidden />查看对象详情</Link>
          <Link href={withReturnTo(`/knowledge/reviews/${done.schedule.id}`, props.returnTo)} className="inline-flex h-10 items-center gap-2 px-2 text-sm text-zinc-300 hover:text-white"><History size={16} aria-hidden />查看复习历史</Link>
        </div>
      </section>
    );
  }

  if (!draft) {
    return <p className="p-6 text-sm text-zinc-400">{access === "remote-readonly" ? "另一标签页正在创建或编辑这份草稿，本页保持只读。" : "正在恢复本地复习草稿..."}</p>;
  }

  const mistakeAnswered = draft.answerMode === "TEXT"
    ? draft.answerText.trim().length > 0
    : draft.paperOrOralCompleted;

  function updateDraft(patch: Partial<QuickReviewDraft>) {
    const current = draftRef.current;
    if (activityBlocked || !current || !writerRef.current) return;
    const changesSubmittedPayload = current.submittedDurationSeconds !== null && (
      patch.result !== undefined || patch.nextDueDate !== undefined || patch.note !== undefined
    );
    const next: QuickReviewDraft = {
      ...current,
      ...(changesSubmittedPayload ? {
        idempotencyKey: createQuickReviewIdempotencyKey(props.schedule.id),
        submittedDurationSeconds: null,
      } : {}),
      ...patch,
      version: 4,
      draftId: current.draftId,
      draftRevision: current.draftRevision,
      userId: current.userId,
      scheduleId: current.scheduleId,
    };
    const committed = compareAndSwapQuickReviewDraft(current, next);
    if (!committed.ok) {
      markStale(committed.latest);
      return;
    }
    publishDraft(committed.draft);
  }

  async function toggleSuspended() {
    const current = draftRef.current;
    if (!current || current.submittedDurationSeconds !== null || activityBlocked) return;
    const timestamp = Date.now();
    setNow(timestamp);
    if (current.suspended) {
      const started = await startQuickReviewActivity(props.schedule.id, current.draftId, props.target.subjectId ?? "");
      if (!started) {
        setError({ error: "存在普通专注、另一项快速复习，或无法安全取得活动锁，不能继续本项。" });
        return;
      }
      const resumed = compareAndSwapQuickReviewDraft(current, resumeQuickReviewDraft(current, timestamp), window.localStorage, timestamp);
      if (!resumed.ok) {
        void finishQuickReviewActivity(props.schedule.id, current.draftId);
        markStale(resumed.latest);
        return;
      }
      publishDraft(resumed.draft);
      setError(null);
      return;
    }
    if (!await resolveQuickReviewActivity(props.schedule.id, current.draftId, "suspend")) {
      setError({ error: "快速复习租约已变化，请检查另一标签页中的活动状态。" });
    }
  }

  async function confirm() {
    const currentDraft = draftRef.current;
    if (!currentDraft) return;
    if (activityBlocked) {
      setError({ error: "这项快速复习由另一个标签页持有，本页不能确认结果。" });
      return;
    }
    if (currentDraft.baseRevision === null) {
      setError({ error: "草稿尚未绑定有效排期 revision，不能确认。请刷新后检查草稿。" });
      return;
    }
    const submittedDurationSeconds = currentDraft.submittedDurationSeconds ?? quickReviewElapsedAt(currentDraft, Date.now());
    if (submittedDurationSeconds < 1) {
      setError({ error: "复习计时尚未产生有效秒数，请至少完成 1 秒后再确认。" });
      return;
    }
    const started = await startQuickReviewActivity(props.schedule.id, currentDraft.draftId, props.target.subjectId ?? "");
    if (!started) {
      setError({ error: "存在普通专注、另一项快速复习，或无法安全取得活动锁，不能确认结果。" });
      return;
    }
    let submittedDraft = currentDraft;
    if (currentDraft.submittedDurationSeconds === null) {
      const frozen = compareAndSwapQuickReviewDraft(currentDraft, {
        ...currentDraft,
        elapsedSeconds: submittedDurationSeconds,
        runningSince: null,
        suspended: true,
        submittedDurationSeconds,
      });
      if (!frozen.ok) {
        void finishQuickReviewActivity(props.schedule.id, currentDraft.draftId);
        markStale(frozen.latest);
        return;
      }
      submittedDraft = frozen.draft;
      publishDraft(submittedDraft);
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/review-schedules/${props.schedule.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: submittedDraft.result,
          durationSeconds: submittedDurationSeconds,
          nextDueDate: submittedDraft.nextDueDate || undefined,
          note: submittedDraft.note || undefined,
          expectedRevision: submittedDraft.baseRevision,
          idempotencyKey: submittedDraft.idempotencyKey,
        }),
      });
      const body = (await response.json().catch(() => null)) as ConfirmResponse | ConflictBody | null;
      if (response.status === 401) {
        setError({ error: "登录已过期，复习草稿已保留。重新登录后请显式重试。" });
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        setError({ error: "复习排期已不存在，草稿仍保留；正在返回统一复习工作台。" });
        router.replace(failureWorkbench(body, "/knowledge/reviews"));
        return;
      }
      if (!response.ok) {
        const failure = (body as ConflictBody | null) ?? { error: "确认失败，复习草稿已保留" };
        if (response.status === 409) {
          if (failure.error === "ACTIVE_SESSION_BLOCKS_QUICK_REVIEW") {
            setError(failure);
            return;
          }
          setConflict(failure);
          setConflictOpen(true);
          setError({ error: "排期或幂等状态已变化；复习草稿仍保留，系统不会自动重放。" });
        } else {
          setError(failure);
        }
        return;
      }
      const removed = removeQuickReviewDraftCas(submittedDraft);
      if (!removed.ok) {
        markStale(removed.latest);
        setError({ error: "复习已确认，但本地草稿已被另一标签更新，系统未删除较新的草稿。" });
        return;
      }
      publishDraft(null);
      setDone(body as ConfirmResponse);
    } catch {
      setError({ error: "网络不可用，复习草稿已保留；恢复网络后请显式重试。" });
    } finally {
      setSubmitting(false);
      void finishQuickReviewActivity(props.schedule.id, currentDraft.draftId);
    }
  }

  async function discardDraft() {
    const current = draftRef.current;
    if (!current) return;
    if (activityBlocked) {
      setError({ error: "这项快速复习由另一个标签页持有，本页不能丢弃它的草稿。" });
      return;
    }
    if (!current.suspended) {
      if (!await resolveQuickReviewActivity(props.schedule.id, current.draftId, "discard")) {
        setError({ error: "快速复习租约已变化，草稿未丢弃。" });
      }
      return;
    }
    const removed = removeQuickReviewDraftCas(current);
    if (!removed.ok) {
      markStale(removed.latest);
      return;
    }
    publishDraft(null);
    router.replace(props.returnTo);
  }

  async function adoptLatestReviewState() {
    if (activityBlocked) return;
    await discardDraft();
    setConflict(null);
    setConflictOpen(false);
    router.refresh();
  }

  async function leaveQuickReview() {
    const current = draftRef.current;
    if (!current || activityBlocked) return;
    if (!current.suspended && !await resolveQuickReviewActivity(props.schedule.id, current.draftId, "suspend")) {
      setError({ error: "活动租约已变化，未能安全挂起草稿。" });
      return;
    }
    router.push(props.returnTo);
  }

  function mergeReviewDraftOntoLatest() {
    const revision = readLatestRevision(conflict?.latest);
    if (revision === null) {
      setConflictOpen(false);
      setError({ error: "最新有效事件已变化。请先刷新排期并只对最新事件重新发起明确操作。" });
      router.refresh();
      return;
    }
    updateDraft({
      baseRevision: revision,
      idempotencyKey: createQuickReviewIdempotencyKey(props.schedule.id),
      elapsedSeconds: draft?.submittedDurationSeconds ?? durationSeconds,
      runningSince: null,
      suspended: true,
      submittedDurationSeconds: null,
    });
    setConflict(null);
    setConflictOpen(false);
    setError({ error: `已基于服务端 r${revision} 重建确认命令；草稿保留，请检查后显式重试。` });
  }

  return (
    <section className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4 py-8">
      <Link href={props.returnTo} className="text-sm text-zinc-400 hover:text-zinc-200" onClick={(event) => {
        event.preventDefault();
        void leaveQuickReview();
      }}>离开（草稿挂起并保留 24 小时）</Link>
      <div>
        <p className="text-sm text-teal-300">{props.target.subtitle}</p>
        <DetailHeading className="mt-2 text-3xl font-semibold text-white">快速复习</DetailHeading>
        <p className="mt-2 text-sm text-zinc-400">到期日 {props.schedule.dueDate ? new Date(props.schedule.dueDate).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "无"}</p>
      </div>

      <section className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4" aria-labelledby="quick-review-target">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-xs text-zinc-500">复习对象</p><h2 id="quick-review-target" className="mt-1 text-xl font-medium text-white">{props.target.title}</h2></div>
          <Link className="text-sm text-teal-300 hover:underline" href={withReturnTo(props.target.canonicalHref, props.returnTo)}>打开详情</Link>
        </div>
        <SafeMarkdownView nodes={props.target.body} />
        {props.schedule.targetType === "MISTAKE" && draft.revealed && props.target.revealBody.length ? (
          <div className="border-t border-white/10 pt-3"><p className="text-sm font-medium text-amber-200">{props.target.revealTitle}</p><div className="mt-2"><SafeMarkdownView nodes={props.target.revealBody} /></div></div>
        ) : null}
      </section>

      <div className="flex items-center justify-between rounded-md border border-white/10 bg-[#101419] p-4">
        <div><p className="text-xs text-zinc-500">有效计时</p><p className="mt-1 font-mono text-2xl text-white" aria-live="off">{formatDuration(durationSeconds)}</p></div>
        <button type="button" disabled={activityBlocked || draft.submittedDurationSeconds !== null} className="h-11 rounded-md border border-white/10 px-4 text-sm disabled:opacity-50" onClick={() => void toggleSuspended()}>
          {draft.submittedDurationSeconds !== null ? "提交时长已冻结" : draft.suspended ? "继续计时" : "挂起"}
        </button>
      </div>

      {props.schedule.targetType === "MISTAKE" && !draft.revealed ? (
        <div className="space-y-4 rounded-md border border-white/10 bg-[#101419] p-4">
          <p className="text-sm text-zinc-300">先完成作答，再揭示错题内容。</p>
          <fieldset disabled={activityBlocked} className="space-y-2 disabled:opacity-60">
            <legend className="text-sm text-zinc-400">作答方式</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={draft.answerMode === "TEXT"} onChange={() => updateDraft({ answerMode: "TEXT" })} />文字作答</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={draft.answerMode === "PAPER_OR_ORAL"} onChange={() => updateDraft({ answerMode: "PAPER_OR_ORAL" })} />纸上或口头作答</label>
          </fieldset>
          {draft.answerMode === "TEXT" ? (
            <label className="block text-sm">你的答案<textarea disabled={activityBlocked} className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#151a20] px-2 py-2 disabled:opacity-60" value={draft.answerText} onChange={(event) => updateDraft({ answerText: event.target.value })} /></label>
          ) : (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={activityBlocked} checked={draft.paperOrOralCompleted} onChange={(event) => updateDraft({ paperOrOralCompleted: event.target.checked })} />我已完成纸上或口头作答</label>
          )}
          <button type="button" disabled={activityBlocked || !mistakeAnswered} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40" onClick={() => updateDraft({ revealed: true })}>完成作答，继续</button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          {props.schedule.targetType === "MISTAKE" ? <p className="text-xs text-zinc-500">已完成{draft.answerMode === "TEXT" ? "文字" : "纸上或口头"}作答</p> : null}
          <label className="block text-sm">结果<select disabled={activityBlocked} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={draft.result} onChange={(event) => updateDraft({ result: event.target.value as QuickReviewResult })}><option value="PASSED">通过</option><option value="PARTIAL">部分</option><option value="FAILED">失败</option></select></label>
          <label className="block text-sm">下次日期（可选）<input type="date" disabled={activityBlocked} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={draft.nextDueDate} onChange={(event) => updateDraft({ nextDueDate: event.target.value })} /></label>
          <label className="block text-sm">备注<textarea disabled={activityBlocked} className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] px-2 py-2 disabled:opacity-60" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={activityBlocked || submitting || durationSeconds < 1} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void confirm()}>{submitting ? "确认中..." : "确认本次复习"}</button>
            <button type="button" disabled={activityBlocked} className="h-11 rounded-md border border-white/10 px-4 text-sm disabled:opacity-50" onClick={() => void discardDraft()}>丢弃草稿</button>
          </div>
          {durationSeconds < 1 ? <p role="status" className="text-xs text-zinc-400">计时达到 1 秒后才可确认，服务端不会接受 0 秒复习。</p> : null}
        </div>
      )}

      {error ? (
        <div role="alert" className="rounded-md border border-red-400/20 bg-red-950/20 p-3 text-sm text-red-200">
          <p>{error.error ?? "UNKNOWN_ERROR"}</p>
          {error.conflictFields?.length ? <p className="mt-1">冲突字段：{error.conflictFields.join("、")}</p> : null}
          {error.latest !== undefined ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{JSON.stringify(error.latest, null, 2)}</pre> : null}
          <p className="mt-2 text-zinc-400">草稿与幂等键已保留。刷新查看最新排期后再决定是否重试。</p>
          {safeConflictWorkbench(error.workbench) ? <Link className="mt-2 inline-flex text-teal-300 hover:underline" href={safeConflictWorkbench(error.workbench)!}>打开当前活动</Link> : null}
        </div>
      ) : null}
      {access === "stale" && remoteDraft ? (
        <p role="status" className="text-xs text-amber-200">检测到外部草稿 revision {remoteDraft.draftRevision}；本页不会自动采用或回写。</p>
      ) : null}
      {conflict && !conflictOpen ? <button type="button" className="w-fit text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理复习确认冲突</button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并复习确认冲突"
        description="服务端排期或有效事件已变化。系统已停止提交并保留本地草稿与计时结果。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={[
          { field: "revision", label: "排期 revision", local: draft.baseRevision, server: readLatestRevision(conflict?.latest) },
          { field: "result", label: "本次结果", local: draft.result, server: readLatestField(conflict?.latest, "result") },
          { field: "nextDueDate", label: "下次日期", local: draft.nextDueDate, server: readLatestField(conflict?.latest, "nextDueDate") },
          { field: "note", label: "本地备注", local: draft.note, server: readLatestField(conflict?.latest, "note") },
        ]}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={() => void adoptLatestReviewState()}
        onManualMerge={mergeReviewDraftOntoLatest}
        adoptLabel="采用服务端并退出本次草稿"
        mergeLabel="基于最新排期重建命令"
      />
    </section>
  );
}

function readLatestRevision(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = record.schedule && typeof record.schedule === "object"
    ? record.schedule as { revision?: unknown }
    : record as { revision?: unknown };
  return typeof candidate.revision === "number" ? candidate.revision : null;
}

function readLatestField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.event && typeof record.event === "object" && field in record.event) {
    return (record.event as Record<string, unknown>)[field];
  }
  if (record.schedule && typeof record.schedule === "object" && field in record.schedule) {
    return (record.schedule as Record<string, unknown>)[field];
  }
  if (record.target && typeof record.target === "object" && field in record.target) {
    return (record.target as Record<string, unknown>)[field];
  }
  return record[field];
}

function failureWorkbench(body: ConflictBody | ConfirmResponse | null, fallback: string): string {
  return body && "workbench" in body && body.workbench === "/knowledge/reviews"
    ? body.workbench
    : fallback;
}

function safeConflictWorkbench(value: string | undefined): string | null {
  return value === "/focus" || value === "/knowledge/reviews" ? value : null;
}

function reviewResultLabel(value: ReviewEventDto["result"]) {
  return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过";
}

function masteryChangeLabel(before: number, after: number) {
  if (after > before) return `连续通过 ${before} → ${after} 次`;
  if (after < before) return `连续通过已重置为 ${after} 次`;
  return `连续通过保持 ${after} 次`;
}
