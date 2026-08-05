"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/overlays";
import { readActiveStudySession } from "@/lib/client/active-study-session";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import {
  acquireQuickReviewActivity,
  acquireQuickReviewActivityBarrier,
  acquireQuickReviewDraftWriter,
  getQuickReviewPageInstanceId,
  readActiveQuickReviewClaim,
  readQuickReviewHandoffClaim,
  requestQuickReviewCommand,
  subscribeQuickReviewCommands,
  tryAcquireQuickReviewActivityBarrier,
  type QuickReviewActivityClaim,
  type QuickReviewActivityCommand,
  type QuickReviewActivityLease,
  type QuickReviewCommandApplication,
  type QuickReviewCommandMessage,
} from "@/lib/client/quick-review-activity";
import { quickReviewActivityIdentityMatches } from "@/lib/client/quick-review-activity-protocol";
import {
  applyQuickReviewDraftCommand,
  findRunningQuickReviewDraft,
} from "@/lib/client/quick-review-draft";

interface GuardOptions {
  allowDiscard?: boolean;
}

type DraftCommandResult = { draftRevision: number | null };
type DraftCommandHandler = (
  action: QuickReviewActivityCommand,
) => DraftCommandResult | null | Promise<DraftCommandResult | null>;
type GuardedOperation = () => Promise<void>;

interface GuardContextValue {
  withActivityBarrier: (operation: GuardedOperation, options?: GuardOptions) => Promise<boolean>;
  startQuickReviewActivity: (scheduleId: string, draftId: string, subjectId: string) => Promise<boolean>;
  resolveQuickReviewActivity: (
    scheduleId: string,
    draftId: string,
    action: QuickReviewActivityCommand,
  ) => Promise<boolean>;
  finishQuickReviewActivity: (scheduleId: string, draftId: string) => Promise<boolean>;
  registerQuickReviewDraftHandler: (
    scheduleId: string,
    draftId: string,
    handler: DraftCommandHandler,
  ) => () => void;
}

interface PendingGuard {
  claim: QuickReviewActivityClaim | null;
  scheduleId: string;
  href: string;
  allowDiscard: boolean;
  operation: GuardedOperation;
  resolve: (allowed: boolean) => void;
}

interface PendingAcquire {
  scheduleId: string;
  draftId: string;
  subjectId: string;
  promise: Promise<boolean>;
}

const GuardContext = createContext<GuardContextValue | null>(null);

export function QuickReviewActivityGuardProvider(props: { userId: string; children: React.ReactNode }) {
  const router = useRouter();
  const leaseRef = useRef<QuickReviewActivityLease | null>(null);
  const acquireRef = useRef<PendingAcquire | null>(null);
  const pendingRef = useRef<PendingGuard | null>(null);
  const draftHandlersRef = useRef(new Map<string, DraftCommandHandler>());
  const mountedRef = useRef(true);
  const [pending, setPending] = useState<PendingGuard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startQuickReviewActivity = useCallback((scheduleId: string, draftId: string, subjectId: string): Promise<boolean> => {
    const current = leaseRef.current;
    if (current) {
      if (current.claim.phase !== "running" || current.claim.scheduleId !== scheduleId || current.claim.draftId !== draftId) {
        return Promise.resolve(false);
      }
      return ensureReviewSession(scheduleId, draftId, subjectId).catch(() => false);
    }
    const pendingAcquire = acquireRef.current;
    if (pendingAcquire) {
      return pendingAcquire.scheduleId === scheduleId && pendingAcquire.draftId === draftId
        ? pendingAcquire.promise
        : Promise.resolve(false);
    }

    const promise = acquireQuickReviewActivity({ userId: props.userId, scheduleId, draftId })
      .then(async (lease) => {
        if (!lease) return false;
        try {
          const activeSession = await ensureReviewSession(scheduleId, draftId, subjectId);
          if (!activeSession || !mountedRef.current) {
            lease.release();
            return false;
          }
        } catch {
          lease.release();
          return false;
        }
        leaseRef.current = lease;
        return true;
      })
      .finally(() => {
        if (acquireRef.current?.promise === promise) acquireRef.current = null;
      });
    acquireRef.current = { scheduleId, draftId, subjectId, promise };
    return promise;
  }, [props.userId]);

  const prepareOwnedCommand = useCallback(async (
    lease: QuickReviewActivityLease,
    commandId: string,
    action: QuickReviewActivityCommand,
  ): Promise<QuickReviewCommandApplication | null> => {
    if (leaseRef.current !== lease || lease.claim.phase !== "running") return null;
    if (!lease.markReleasing(commandId, action)) return null;

    const serverResolved = await resolveReviewSessionAction(lease.claim.scheduleId, action);
    if (!serverResolved) {
      lease.release();
      if (leaseRef.current === lease) leaseRef.current = null;
      return null;
    }

    const key = draftHandlerKey(lease.claim.scheduleId, lease.claim.draftId);
    const handler = draftHandlersRef.current.get(key);
    let result: DraftCommandResult | null = null;
    if (handler) {
      result = await handler(action);
    } else {
      const writer = await acquireQuickReviewDraftWriter({
        userId: props.userId,
        scheduleId: lease.claim.scheduleId,
      });
      if (writer) {
        try {
          const applied = applyQuickReviewDraftCommand({
            userId: props.userId,
            scheduleId: lease.claim.scheduleId,
            draftId: lease.claim.draftId,
            action,
          });
          if (applied.ok) result = { draftRevision: applied.draftRevision };
        } finally {
          writer.release();
        }
      }
    }
    if (!result) {
      lease.release();
      if (leaseRef.current === lease) leaseRef.current = null;
      return null;
    }
    return {
      draftRevision: result.draftRevision,
      afterReceiptPublished() {
        lease.release();
        if (leaseRef.current === lease) leaseRef.current = null;
      },
    };
  }, [props.userId]);

  const resolveQuickReviewActivity = useCallback(async (
    scheduleId: string,
    draftId: string,
    action: QuickReviewActivityCommand,
  ): Promise<boolean> => {
    const lease = leaseRef.current;
    if (!lease || lease.claim.scheduleId !== scheduleId || lease.claim.draftId !== draftId) return false;
    const application = await prepareOwnedCommand(lease, crypto.randomUUID(), action);
    if (!application) return false;
    application.afterReceiptPublished();
    return true;
  }, [prepareOwnedCommand]);

  const finishQuickReviewActivity = useCallback(async (scheduleId: string, draftId: string): Promise<boolean> => {
    const current = leaseRef.current;
    if (!current || current.claim.scheduleId !== scheduleId || current.claim.draftId !== draftId) return false;
    const closed = await finishReviewSession(scheduleId);
    if (!closed) return false;
    current.release();
    if (leaseRef.current === current) leaseRef.current = null;
    return true;
  }, []);

  const registerQuickReviewDraftHandler = useCallback((
    scheduleId: string,
    draftId: string,
    handler: DraftCommandHandler,
  ): (() => void) => {
    const key = draftHandlerKey(scheduleId, draftId);
    draftHandlersRef.current.set(key, handler);
    return () => {
      if (draftHandlersRef.current.get(key) === handler) draftHandlersRef.current.delete(key);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const ownerPageId = getQuickReviewPageInstanceId();
    const unsubscribe = subscribeQuickReviewCommands({
      userId: props.userId,
      ownerPageId,
      onCommand(command: QuickReviewCommandMessage) {
        const lease = leaseRef.current;
        if (!lease || !quickReviewActivityIdentityMatches(lease.claim, command)) return null;
        return prepareOwnedCommand(lease, command.commandId, command.action);
      },
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, [props.userId, prepareOwnedCommand]);

  const executeBarrier = useCallback(async (
    request: Omit<PendingGuard, "resolve">,
    action?: QuickReviewActivityCommand,
  ): Promise<boolean> => {
    const barrierPromise = acquireQuickReviewActivityBarrier(props.userId);
    let proof = true;
    const effectiveClaim = request.claim ?? readActiveQuickReviewClaim(props.userId);

    if (action && effectiveClaim) {
      const localLease = leaseRef.current;
      if (localLease && quickReviewActivityIdentityMatches(localLease.claim, effectiveClaim)) {
        proof = await resolveQuickReviewActivity(effectiveClaim.scheduleId, effectiveClaim.draftId, action);
      } else {
        proof = Boolean(await requestQuickReviewCommand(effectiveClaim, action));
      }
    }
    if (!proof) {
      void barrierPromise.then((lease) => lease?.release());
      return false;
    }

    const barrier = await barrierPromise;
    if (!barrier) return false;
    try {
      if (action && !effectiveClaim) {
        const writer = await acquireQuickReviewDraftWriter({
          userId: props.userId,
          scheduleId: request.scheduleId,
        });
        if (!writer) return false;
        try {
          const running = findRunningQuickReviewDraft(props.userId);
          if (!running || running.scheduleId !== request.scheduleId) return false;
          const applied = applyQuickReviewDraftCommand({
            userId: props.userId,
            scheduleId: request.scheduleId,
            draftId: running.draftId,
            action,
          });
          if (!applied.ok) return false;
        } finally {
          writer.release();
        }
      }

      if (readActiveQuickReviewClaim(props.userId) || findRunningQuickReviewDraft(props.userId)) return false;
      await request.operation();
      return true;
    } finally {
      barrier.release();
    }
  }, [props.userId, resolveQuickReviewActivity]);

  const executeUncontendedBarrier = useCallback(async (operation: GuardedOperation): Promise<boolean> => {
    let barrier = await tryAcquireQuickReviewActivityBarrier(props.userId);
    if (!barrier) {
      await Promise.resolve();
      barrier = await tryAcquireQuickReviewActivityBarrier(props.userId);
    }
    if (!barrier) return false;
    try {
      if (readActiveQuickReviewClaim(props.userId) || findRunningQuickReviewDraft(props.userId)) return false;
      await operation();
      return true;
    } finally {
      barrier.release();
    }
  }, [props.userId]);

  const enqueueGuard = useCallback((
    operation: GuardedOperation,
    options: GuardOptions,
    claim: QuickReviewActivityClaim | null,
    runningDraft: ReturnType<typeof findRunningQuickReviewDraft>,
  ): Promise<boolean> => {
    if (pendingRef.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      const scheduleId = claim?.scheduleId ?? runningDraft?.scheduleId ?? "";
      const request: PendingGuard = {
        claim,
        scheduleId,
        href: claim?.href ?? `/knowledge/reviews/${encodeURIComponent(scheduleId)}/run`,
        allowDiscard: options.allowDiscard !== false,
        operation,
        resolve,
      };
      pendingRef.current = request;
      setPending(request);
      setError(null);
    });
  }, []);

  const withActivityBarrier = useCallback(async (
    operation: GuardedOperation,
    options: GuardOptions = {},
  ): Promise<boolean> => {
    const claim = readActiveQuickReviewClaim(props.userId);
    const runningDraft = claim ? null : findRunningQuickReviewDraft(props.userId);
    if (!claim && !runningDraft) {
      const completed = await executeUncontendedBarrier(operation);
      if (completed) return true;
      const latestClaim = readActiveQuickReviewClaim(props.userId);
      const latestRunningDraft = latestClaim ? null : findRunningQuickReviewDraft(props.userId);
      if (!latestClaim && !latestRunningDraft) return false;
      return enqueueGuard(operation, options, latestClaim, latestRunningDraft);
    }
    if (!claim && runningDraft) {
      const probe = await tryAcquireQuickReviewActivityBarrier(props.userId);
      if (probe) {
        probe.release();
        return enqueueGuard(operation, options, null, runningDraft);
      }
      const handoffClaim = readQuickReviewHandoffClaim(props.userId);
      const matchingHandoff = handoffClaim?.scheduleId === runningDraft.scheduleId
        && handoffClaim.draftId === runningDraft.draftId
        ? handoffClaim
        : null;
      return enqueueGuard(operation, options, matchingHandoff, runningDraft);
    }
    return enqueueGuard(operation, options, claim, runningDraft);
  }, [enqueueGuard, executeUncontendedBarrier, props.userId]);

  function finish(allowed: boolean) {
    const request = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setError(null);
    request?.resolve(allowed);
  }

  async function release(action: QuickReviewActivityCommand) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const completed = await executeBarrier(pending, action);
      if (!completed) {
        setError("快速复习活动未完成原子交接。请返回该活动处理，或等待租约恢复后重试。");
        return;
      }
      finish(true);
    } catch {
      setError("后续操作没有确认完成。活动锁已释放，请检查最新状态后显式重试。");
    } finally {
      setBusy(false);
    }
  }

  const contextValue = useMemo<GuardContextValue>(() => ({
    withActivityBarrier,
    startQuickReviewActivity,
    resolveQuickReviewActivity,
    finishQuickReviewActivity,
    registerQuickReviewDraftHandler,
  }), [
    finishQuickReviewActivity,
    registerQuickReviewDraftHandler,
    resolveQuickReviewActivity,
    startQuickReviewActivity,
    withActivityBarrier,
  ]);

  return (
    <GuardContext.Provider value={contextValue}>
      {props.children}
      <Modal open={Boolean(pending)} title="已有快速复习正在计时" onClose={() => finish(false)}>
        <div className="space-y-3 text-sm text-zinc-300">
          <p>开始新的专注或切换工作区前，需要先处理当前浏览器中的快速复习。</p>
          {error ? <p role="alert" className="text-red-300">{error}</p> : null}
          <button type="button" disabled={busy} className="h-10 w-full rounded-md bg-teal-500 px-3 font-medium text-black disabled:opacity-50" onClick={() => { if (!pending) return; router.push(pending.href); finish(false); }}>返回继续</button>
          <button type="button" disabled={busy} className="h-10 w-full rounded-md border border-white/10 px-3 disabled:opacity-50" onClick={() => void release("suspend")}>挂起后继续当前操作</button>
          {pending?.allowDiscard ? <button type="button" disabled={busy} className="h-10 w-full rounded-md border border-red-400/30 px-3 text-red-200 disabled:opacity-50" onClick={() => void release("discard")}>丢弃后继续当前操作</button> : null}
          <button type="button" disabled={busy} className="h-10 w-full text-zinc-500" onClick={() => finish(false)}>取消</button>
        </div>
      </Modal>
    </GuardContext.Provider>
  );
}

export function useQuickReviewActivityGuard(): GuardContextValue {
  const context = useContext(GuardContext);
  if (!context) throw new Error("QuickReviewActivityGuardProvider is required");
  return context;
}

function draftHandlerKey(scheduleId: string, draftId: string): string {
  return `${scheduleId}:${draftId}`;
}

async function ensureReviewSession(scheduleId: string, draftId: string, subjectId: string): Promise<boolean> {
  const active = await readActiveStudySession();
  if (active) {
    if (active.activityMode !== "KNOWLEDGE_REVIEW" || active.reviewScheduleId !== scheduleId) return false;
    if (active.status === "closing") return false;
    if (active.status === "paused") return Boolean(await postReviewSessionCommand(active, "resume"));
    return true;
  }

  const idempotencyKey = `quick-review-session-${scheduleId}-${draftId}`;
  const response = await fetch("/api/study-sessions/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
    body: JSON.stringify({
      idempotencyKey,
      subjectId,
      activityKind: "REVIEW",
      activityMode: "KNOWLEDGE_REVIEW",
      reviewScheduleId: scheduleId,
      startSource: "KNOWLEDGE_REVIEW",
    }),
  });
  if (response.ok) return true;
  if (response.status === 409) {
    const latest = await readActiveStudySession().catch(() => null);
    return Boolean(latest && latest.activityMode === "KNOWLEDGE_REVIEW" && latest.reviewScheduleId === scheduleId);
  }
  return false;
}

async function resolveReviewSessionAction(
  scheduleId: string,
  action: QuickReviewActivityCommand,
): Promise<boolean> {
  const active = await readActiveStudySession();
  if (!active) return true;
  if (active.activityMode !== "KNOWLEDGE_REVIEW" || active.reviewScheduleId !== scheduleId) return false;
  if (action === "suspend") {
    if (active.status === "paused" || active.status === "closing") return true;
    return Boolean(await postReviewSessionCommand(active, "pause"));
  }
  return Boolean(await postReviewSessionCommand(active, "cancel"));
}

async function finishReviewSession(scheduleId: string): Promise<boolean> {
  let active = await readActiveStudySession();
  if (!active) return true;
  if (active.activityMode !== "KNOWLEDGE_REVIEW" || active.reviewScheduleId !== scheduleId) return false;
  if (active.status === "running" || active.status === "paused") {
    const prepared = await postReviewSessionCommand(active, "end", { mode: "prepare" });
    if (!prepared) return false;
    active = prepared;
  }
  if (active.status !== "closing") return false;
  return Boolean(await postReviewSessionCommand(active, "end", {
    mode: "complete",
    qualityScore: 3,
    isEffective: true,
    understandingLevel: "基本理解",
    minimalOutput: "快速复习计时完成，结果已记录在复习事件中。",
    nextAction: "继续按复习排期处理下一项",
    producedNote: false,
    producedMistake: false,
    completeTask: false,
    nextDisposition: "复习结果已提交",
  }));
}

async function postReviewSessionCommand(
  session: NonNullable<Awaited<ReturnType<typeof readActiveStudySession>>>,
  endpoint: "pause" | "resume" | "cancel" | "end",
  extra: Record<string, unknown> = {},
): Promise<NonNullable<Awaited<ReturnType<typeof readActiveStudySession>>> | null> {
  const response = await fetch(`/api/study-sessions/${encodeURIComponent(session.id)}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
    body: JSON.stringify({
      expectedStatus: session.status,
      expectedUpdatedAt: session.updatedAt,
      idempotencyKey: `quick-review-${session.id}-${endpoint}-${crypto.randomUUID()}`,
      ...extra,
    }),
  });
  const body = await response.json().catch(() => null) as { session?: NonNullable<Awaited<ReturnType<typeof readActiveStudySession>>> } | null;
  if (response.ok && body?.session) return body.session;
  if (response.status === 409) {
    const latest = await readActiveStudySession().catch(() => null);
    if (endpoint === "pause" && latest?.status === "paused") return latest;
    if (endpoint === "cancel" || endpoint === "end") return !latest ? null : latest.status === "completed" || latest.status === "canceled" ? latest : null;
  }
  return null;
}
