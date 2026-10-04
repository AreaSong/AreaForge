"use client";

import { confirmReviewEvent } from "@/lib/api/review-schedule";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import { Button } from "@/components/ui/button";
import { useQuickReviewDraftRuntime } from "@/components/quick-review-draft-runtime";
import {
  QuickReviewDone,
  QuickReviewFailure,
  QuickReviewForm,
  QuickReviewPaused,
  QuickReviewTargetCard,
  QuickReviewUnavailable,
} from "@/components/quick-review-client-views";
import {
  failureWorkbench,
  readLatestField,
  readLatestRevision,
  type ConfirmResponse,
  type ConflictBody,
} from "@/components/quick-review-client-support";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import {
  compareAndSwapQuickReviewDraft,
  createQuickReviewIdempotencyKey,
  quickReviewElapsedAt,
  removeQuickReviewDraftCas,
  resumeQuickReviewDraft,
  type QuickReviewDraft,
} from "@/lib/client/quick-review-draft";
import { getBrowserStoragePortOrMemory } from "@/lib/client/storage-port";
import type { ReviewScheduleDto } from "@/lib/contracts";
import type { ReviewTargetDto } from "@/lib/contracts";
import { formatDate, formatShortDuration } from "@/lib/formatters";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

export function QuickReviewClient(props: {
  userId: string;
  schedule: ReviewScheduleDto;
  target: ReviewTargetDto;
  returnTo: string;
  initialNow: string;
}) {
  const router = useRouter();
  const {
    startQuickReviewActivity,
    resolveQuickReviewActivity,
    finishQuickReviewActivity,
    registerQuickReviewDraftHandler,
  } = useQuickReviewActivityGuard();
  const {
    access,
    draft,
    error,
    getCurrentDraft,
    hasWriter,
    markStale,
    now,
    publishDraft,
    remoteDraft,
    setError,
    setNow,
  } = useQuickReviewDraftRuntime({
    userId: props.userId,
    schedule: props.schedule,
    targetCanPass: props.target.canPass,
    targetSubjectId: props.target.subjectId,
    returnTo: props.returnTo,
    initialNow: props.initialNow,
    startActivity: startQuickReviewActivity,
    finishActivity: finishQuickReviewActivity,
    registerDraftHandler: registerQuickReviewDraftHandler,
  });
  const [conflict, setConflict] = useState<ConflictBody | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [done, setDone] = useState<ConfirmResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const activityBlocked = access !== "writable";

  useEffect(() => {
    if (!draft || !props.target.canPass || draft.suspended || done) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [done, draft, props.target.canPass, setNow]);

  const durationSeconds = useMemo(
    () => (draft ? draft.submittedDurationSeconds ?? quickReviewElapsedAt(draft, now) : 0),
    [draft, now],
  );

  if (props.schedule.status === "PAUSED") {
    return <QuickReviewPaused returnTo={props.returnTo} />;
  }

  if (!props.target.canPass) {
    return <QuickReviewUnavailable target={props.target} returnTo={props.returnTo} />;
  }

  if (done) {
    return <QuickReviewDone done={done} target={props.target} schedule={props.schedule} returnTo={props.returnTo} />;
  }

  if (!draft) {
    return <p className="p-6 text-sm text-zinc-400">{access === "remote-readonly" ? "另一标签页正在创建或编辑这份草稿，本页保持只读。" : "正在恢复本地复习草稿..."}</p>;
  }

  const mistakeAnswered = draft.answerMode === "TEXT"
    ? draft.answerText.trim().length > 0
    : draft.paperOrOralCompleted;

  function updateDraft(patch: Partial<QuickReviewDraft>) {
    const current = getCurrentDraft();
    if (activityBlocked || !current || !hasWriter()) return;
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
    const current = getCurrentDraft();
    if (!current || current.submittedDurationSeconds !== null || activityBlocked) return;
    const timestamp = Date.now();
    setNow(timestamp);
    if (current.suspended) {
      const started = await startQuickReviewActivity(props.schedule.id, current.draftId, props.target.subjectId ?? "");
      if (!started) {
        setError({ error: "存在普通专注、另一项快速复习，或无法安全取得活动锁，不能继续本项。" });
        return;
      }
      const resumed = compareAndSwapQuickReviewDraft(current, resumeQuickReviewDraft(current, timestamp), getBrowserStoragePortOrMemory("local"), timestamp);
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
    const currentDraft = getCurrentDraft();
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
        void resolveQuickReviewActivity(props.schedule.id, currentDraft.draftId, "suspend");
        markStale(frozen.latest);
        return;
      }
      submittedDraft = frozen.draft;
      publishDraft(submittedDraft);
    }
    setError(null);
    setSubmitting(true);
    let eventSaved = false;
    try {
      const response = await confirmReviewEvent(props.schedule.id, {
        result: submittedDraft.result,
        durationSeconds: submittedDurationSeconds,
        nextDueDate: submittedDraft.nextDueDate || undefined,
        note: submittedDraft.note || undefined,
        answerMode: props.schedule.targetType === "MISTAKE" ? submittedDraft.answerMode : undefined,
        answerText: props.schedule.targetType === "MISTAKE" && submittedDraft.answerMode === "TEXT" ? submittedDraft.answerText : undefined,
        expectedRevision: submittedDraft.baseRevision,
        idempotencyKey: submittedDraft.idempotencyKey,
      });
      const body = response.body as ConfirmResponse | ConflictBody | null;
      if (isUnauthorized(response)) {
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
        if (isConflict(response)) {
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
      eventSaved = true;
      const closed = await finishQuickReviewActivity(props.schedule.id, currentDraft.draftId);
      if (!closed) {
        setError({ error: "复习结果已保存，但活动尚未完成收口。请再次点击确认，重试完成收口。" });
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
      if (!eventSaved) {
        void resolveQuickReviewActivity(props.schedule.id, currentDraft.draftId, "suspend");
      }
    }
  }

  async function discardDraft() {
    const current = getCurrentDraft();
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
    const current = getCurrentDraft();
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
    <section className="mx-auto flex min-h-full max-w-xl flex-col gap-5 px-4 py-8">
      <Link href={props.returnTo} className="text-sm text-zinc-400 hover:text-zinc-200" onClick={(event) => {
        event.preventDefault();
        void leaveQuickReview();
      }}>离开（草稿挂起并保留 24 小时）</Link>
      <div>
        <p className="text-sm text-teal-300">{props.target.subtitle}</p>
        <DetailHeading className="mt-2 text-3xl font-semibold text-white">快速复习</DetailHeading>
        <p className="mt-2 text-sm text-zinc-400">到期日 {props.schedule.dueDate ? formatDate(props.schedule.dueDate) : "无"}</p>
      </div>

      <QuickReviewTargetCard target={props.target} schedule={props.schedule} draft={draft} returnTo={props.returnTo} />

      <div className="flex items-center justify-between rounded-md border border-white/10 bg-[#101419] p-4">
        <div><p className="text-xs text-zinc-500">有效计时</p><p className="mt-1 font-mono text-2xl text-white" aria-live="off">{formatShortDuration(durationSeconds)}</p></div>
        <Button type="button" disabled={activityBlocked || draft.submittedDurationSeconds !== null} className="h-11 px-4" onClick={() => void toggleSuspended()}>
          {draft.submittedDurationSeconds !== null ? "提交时长已冻结" : draft.suspended ? "继续计时" : "挂起"}
        </Button>
      </div>

      <QuickReviewForm
        targetType={props.schedule.targetType}
        draft={draft}
        activityBlocked={activityBlocked}
        durationSeconds={durationSeconds}
        submitting={submitting}
        mistakeAnswered={mistakeAnswered}
        onUpdate={updateDraft}
        onConfirm={() => void confirm()}
        onDiscard={() => void discardDraft()}
      />

      <QuickReviewFailure
        error={error}
        access={access}
        remoteDraft={remoteDraft}
        conflict={conflict}
        conflictOpen={conflictOpen}
        onOpenConflict={() => setConflictOpen(true)}
      />
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
