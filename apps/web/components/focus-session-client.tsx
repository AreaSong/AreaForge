"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { getTimerElapsedSeconds, type TimerStatus } from "@areaforge/core";
import type {
  CloseoutOutcome,
  FocusContext,
  FocusContextOptions,
  FocusEvidenceReceipt,
  FocusEvidenceType,
} from "@/components/focus-session-panels";
import { linkFocusSessionEvidence, setFocusEvidenceFlowOpen } from "@/lib/client/focus-evidence";
import { focusRequestErrorMessage } from "@/lib/client/focus-session";
import {
  getFocusOfflineConflict,
  isLocalFocusSessionId,
  resolveFocusOfflineConflict,
  retryDeferredFocusCommands,
  syncFocusOfflineQueue,
  type FocusOfflineSyncState,
} from "@/lib/client/focus-offline-store";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { addLowConversionToInbox as addLowConversionToInboxCommand } from "@/lib/api/plan-inbox";
import type { StudySessionDto } from "@/lib/contracts";
import { isUnauthorized } from "@/lib/client/api-errors";
import { mutationFeedback } from "@/lib/client/mutation-feedback";
import {
  buildFocusCloseoutSubmission,
  defaultFocusCloseoutDraft,
  initialFocusPhase,
  removeFocusDraft,
  type FocusCloseoutDraft,
  type FocusPhase,
} from "@/components/focus-session-draft";
import {
  executeFocusSessionCommand,
  type FocusSessionCommandAction,
} from "@/components/focus-session-command";
import { useFocusSessionEffects } from "@/components/focus-session-effects";
import { useEntityOperationMap } from "@/lib/client/use-entity-operation-map";
import {
  FocusSessionWorkspace,
  type FocusSessionConflict,
} from "@/components/focus-session-workspace";

export function FocusSessionClient(props: {
  userId: string;
  session: StudySessionDto;
  activeConflictId: string | null;
  returnTo: string;
  initialNow: string;
  initialEvidenceReceipts: FocusEvidenceReceipt[];
  contextOptions: FocusContextOptions;
  offlineOnly?: boolean;
  embeddedInWorkbench?: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState(props.session);
  const currentSessionRef = useRef(props.session);
  currentSessionRef.current = session;
  const [now, setNow] = useState(() => new Date(props.initialNow));
  const [phase, setPhase] = useState<FocusPhase>(() => initialFocusPhase(props.session));
  const [error, setError] = useState<string | null>(null);
  const [closeoutError, setCloseoutError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<FocusSessionConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const commandKeys = useRef<Record<string, string>>({});
  const [lowConversionAdded, setLowConversionAdded] = useState(false);
  const [activeEvidenceType, setActiveEvidenceType] = useState<FocusEvidenceType>("note");
  const [evidenceReceipts, setEvidenceReceipts] = useState(props.initialEvidenceReceipts);
  const [draft, setDraft] = useState<FocusCloseoutDraft>(defaultFocusCloseoutDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [syncState, setSyncState] = useState<FocusOfflineSyncState>(props.offlineOnly ? "pending" : "current");
  const queuedOfflineRef = useRef(Boolean(props.offlineOnly));
  const commandOperations = useEntityOperationMap<"session">();
  const [activeCommand, setActiveCommand] = useState<FocusSessionCommandAction | null>(null);

  // Monotonic elapsed time guard to prevent any backward time jump
  const monotonicMaxElapsedRef = useRef(0);
  const prevSessionIdRef = useRef(session.id);

  useEffect(() => {
    if (prevSessionIdRef.current !== session.id) {
      monotonicMaxElapsedRef.current = 0;
      prevSessionIdRef.current = session.id;
    }
  }, [session.id]);

  const loadOfflineConflict = useCallback(async (open: boolean, latestOverride?: StudySessionDto | null) => {
    const record = await getFocusOfflineConflict(props.userId);
    if (!record) return;
    setConflict({
      latest: latestOverride ?? record.latestSession ?? (!isLocalFocusSessionId(currentSessionRef.current.id) ? currentSessionRef.current : undefined),
      localSession: record.localSession,
      conflictFields: ["status", "updatedAt", "device", "timeline"],
      action: record.command.action,
      commandId: record.command.id,
      localSessionId: record.command.localSessionId,
    });
    if (open && record.command.state === "blocked") setConflictOpen(true);
  }, [props.userId]);

  useFocusSessionEffects({
    userId: props.userId,
    initialSessionId: props.session.id,
    session,
    syncState,
    draft,
    draftReady,
    queuedOfflineRef,
    setSession,
    setNow,
    setPhase,
    setSyncState,
    setDraft,
    setDraftReady,
    loadOfflineConflict,
  });

  const timerStatus: TimerStatus =
    session.status === "running" || session.status === "paused"
      ? session.status
      : session.status === "closing"
        ? "completed"
        : "idle";

  const elapsedSeconds = useMemo(() => {
    const computed = getTimerElapsedSeconds({
      status: timerStatus,
      startedAt: new Date(session.startedAt),
      pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
      endedAt: session.endedAt ? new Date(session.endedAt) : undefined,
      accumulatedPauseSeconds: session.accumulatedPauseSeconds,
      now,
    });

    if (timerStatus === "running" || timerStatus === "paused") {
      monotonicMaxElapsedRef.current = Math.max(monotonicMaxElapsedRef.current, computed);
      return monotonicMaxElapsedRef.current;
    }
    return computed;
  }, [now, session, timerStatus]);

  const timerLabel = session.status === "running" ? "正计时" : session.status === "paused" ? "已暂停" : session.status === "closing" ? "已冻结，待收口" : "已结束";
  const closeoutOutcome: CloseoutOutcome = draft.isEffective === "false"
    ? "not-achieved"
    : Number(draft.qualityScore) >= 4 ? "achieved" : "partial";
  const context: FocusContext = {
    subjectId: session.subjectId,
    subjectName: session.subjectName,
    taskId: session.taskId,
    taskTitle: session.taskTitle,
    syllabusNodeId: session.syllabusNodeId,
    syllabusNodeTitle: session.syllabusNodeTitle,
    knowledgePoints: session.knowledgePoints,
    goalMinutes: session.goalMinutes,
  };

  async function mutate(body: Record<string, unknown>, action: FocusSessionCommandAction) {
    if (conflict) throw new Error("请先处理活动状态冲突，再提交新的状态命令。");
    const generation = commandOperations.tryBegin("session");
    if (generation === null) return undefined;
    const sessionSnapshot = session;
    setActiveCommand(action);
    try {
      setError(null);
      const outcome = await executeFocusSessionCommand({
        userId: props.userId,
        session: sessionSnapshot,
        action,
        body,
      });
      if (outcome.kind === "unauthorized") {
        redirectToLoginWithCurrentLocation();
        throw new Error("登录已过期，收口草稿已保留。重新登录后请显式重试。");
      }
      if (outcome.kind === "conflict") {
        setConflict({
          latest: outcome.latest,
          conflictFields: outcome.conflictFields,
          action,
        });
        setConflictOpen(true);
        throw new Error("活动状态已变化，草稿与命令键已保留。请先比较差异并人工选择新基线。");
      }
      if (outcome.kind === "rejected") throw new Error(outcome.message);
      queuedOfflineRef.current = outcome.queuedOffline;
      setSyncState(outcome.syncState);
      if (outcome.session) {
        setSession(outcome.session);
        setNow(new Date());
      }
      return outcome.session;
    } finally {
      commandOperations.succeed("session", generation);
      setActiveCommand(null);
    }
  }

  function commandInput(action: "pause" | "resume" | "end" | "context", mode?: "prepare" | "complete") {
    const commandKey = `${action}:${mode ?? "default"}`;
    const key = commandKeys.current[commandKey] ?? `study-session-${action}-${mode ?? "default"}-${session.id}-${crypto.randomUUID()}`;
    commandKeys.current[commandKey] = key;
    return {
      expectedStatus: session.status,
      expectedUpdatedAt: session.updatedAt,
      idempotencyKey: key,
    };
  }

  async function pause() {
    setNow(new Date());
    try {
      const result = await mutate(commandInput("pause"), "pause");
      if (result === undefined) return;
      setNow(new Date());
      delete commandKeys.current["pause:default"];
    } catch (err) {
      setError(focusRequestErrorMessage(err, "暂停失败"));
    }
  }

  async function resume() {
    setNow(new Date());
    try {
      const result = await mutate(commandInput("resume"), "resume");
      if (result === undefined) return;
      setNow(new Date());
      delete commandKeys.current["resume:default"];
    } catch (err) {
      setError(focusRequestErrorMessage(err, "继续失败"));
    }
  }

  async function beginCloseout() {
    setError(null);
    setCloseoutError(null);
    setNow(new Date());
    try {
      const frozen = await mutate({
        ...commandInput("end", "prepare"),
        mode: "prepare",
      }, "end");
      if (frozen === undefined) return;
      delete commandKeys.current["end:prepare"];
      if (frozen?.status === "closing") setPhase("closeout");
    } catch (err) {
      setError(focusRequestErrorMessage(err, "结束计时失败"));
    }
  }

  async function end() {
    const submission = buildFocusCloseoutSubmission(draft);
    if (!submission.ok) {
      setCloseoutError(submission.error);
      return;
    }
    setCloseoutError(null);
    try {
      const completed = await mutate({
        ...commandInput("end", "complete"),
        ...submission.body,
      }, "end");
      if (completed === undefined) return;
      delete commandKeys.current["end:complete"];
      removeFocusDraft(props.userId, session.id);
      if (completed?.status === "completed" && completed.isLowConversion) {
        setPhase("low-conversion");
        return;
      }
      if (queuedOfflineRef.current || isLocalFocusSessionId(session.id)) {
        setError("收口内容已保存在本机，等待服务端确认后才会标记为已保存。");
        setPhase("closeout");
        return;
      }
      openEvidenceFlow();
    } catch (err) {
      setError(focusRequestErrorMessage(err, "结束失败"));
    }
  }

  async function adoptLatestSession() {
    if (!conflict?.latest) {
      setConflictOpen(false);
      router.refresh();
      return;
    }
    if (conflict.commandId && conflict.localSessionId) {
      await resolveFocusOfflineConflict({
        userId: props.userId,
        localSessionId: conflict.localSessionId,
        commandId: conflict.commandId,
        resolution: "adopt-server",
      });
    }
    setSession(conflict.latest);
    setNow(new Date());
    clearCommandKeys(conflict.action);
    if (conflict.latest.status === "completed") setPhase(initialFocusPhase(conflict.latest));
    setConflict(null);
    setConflictOpen(false);
    queuedOfflineRef.current = false;
    setSyncState("current");
    setError("已采用服务端最新活动状态；旧离线命令已按你的选择停止同步。");
  }

  async function deferOfflineConflict() {
    if (!conflict?.commandId || !conflict.localSessionId) return;
    await resolveFocusOfflineConflict({
      userId: props.userId,
      localSessionId: conflict.localSessionId,
      commandId: conflict.commandId,
      resolution: "defer",
    });
    setConflictOpen(false);
    setSyncState("deferred");
    setError("已保留离线记录，稍后可从这里显式重新对账；系统不会自动覆盖当前活动。");
  }

  async function abandonOfflineConflict() {
    if (!conflict?.commandId || !conflict.localSessionId) return;
    const latest = await resolveFocusOfflineConflict({
      userId: props.userId,
      localSessionId: conflict.localSessionId,
      commandId: conflict.commandId,
      resolution: "abandon",
    });
    if (latest) {
      setSession(latest);
      setNow(new Date());
    }
    setConflict(null);
    setConflictOpen(false);
    queuedOfflineRef.current = false;
    setSyncState("current");
    setError("已明确放弃旧离线命令；服务端当前活动仍保留。");
  }

  async function retryDeferredConflict() {
    const record = await getFocusOfflineConflict(props.userId);
    if (!record || record.command.state !== "deferred") {
      setSyncState("current");
      return;
    }
    await retryDeferredFocusCommands(props.userId, record.command.localSessionId);
    setSyncState("pending");
    await syncFocusOfflineQueue(props.userId);
    await loadOfflineConflict(true);
  }

  function mergeDraftOntoLatestSession() {
    if (!conflict?.latest) return;
    setSession(conflict.latest);
    setNow(new Date());
    clearCommandKeys(conflict.action);
    setConflict(null);
    setConflictOpen(false);
    setError("已以服务端最新状态重建命令基线；本地草稿仍保留，请检查后显式重试。");
  }

  function clearCommandKeys(action: "start" | "pause" | "resume" | "end" | "context") {
    if (action === "start") return;
    for (const key of Object.keys(commandKeys.current)) {
      if (key.startsWith(`${action}:`)) delete commandKeys.current[key];
    }
  }

  async function addLowConversionToInbox() {
    setError(null);
    try {
      const result = await addLowConversionToInboxCommand(session.id, session.closeoutVersion || 1);
      if (!result.ok) {
        if (isUnauthorized(result)) {
          redirectToLoginWithCurrentLocation();
          setError("登录已过期。重新登录后请显式重试加入收件箱。");
          return;
        }
        const feedback = mutationFeedback(result, "加入收件箱失败");
        setError(feedback.message);
        return;
      }
      setLowConversionAdded(true);
    } catch (err) {
      setError(focusRequestErrorMessage(err, "加入收件箱失败"));
    }
  }

  function openEvidenceFlow() {
    if (isLocalFocusSessionId(session.id)) {
      setFocusEvidenceFlowOpen(props.userId, session.id, true);
      setError("当前收口仍在本机，联网同步后会自动进入证据接力；当前不会伪造服务端证据。");
      setPhase("complete");
      return;
    }
    setFocusEvidenceFlowOpen(props.userId, session.id, true);
    setPhase("evidence");
  }

  function completeEvidenceFlow() {
    setFocusEvidenceFlowOpen(props.userId, session.id, false);
    setPhase("complete");
  }

  async function linkEvidence(input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) {
    const body = await linkFocusSessionEvidence(session, input);
    setSession(body.session);
    setNow(new Date());
    setEvidenceReceipts((current) => current.some((receipt) =>
      receipt.evidenceType === body.receipt.evidenceType && receipt.evidenceId === body.receipt.evidenceId)
      ? current
      : [...current, body.receipt]);
  }

  return (
    <FocusSessionWorkspace
      userId={props.userId}
      activeConflictId={props.activeConflictId}
      returnTo={props.returnTo}
      embeddedInWorkbench={props.embeddedInWorkbench}
      session={session}
      phase={phase}
      syncState={syncState}
      error={error}
      elapsedSeconds={elapsedSeconds}
      timerLabel={timerLabel}
      context={context}
      outcome={closeoutOutcome}
      draft={draft}
      closeoutError={closeoutError}
      commandBusy={activeCommand !== null}
      submittingCloseout={activeCommand === "end"}
      lowConversionAdded={lowConversionAdded}
      activeEvidenceType={activeEvidenceType}
      evidenceReceipts={evidenceReceipts}
      conflict={conflict}
      conflictOpen={conflictOpen}
      onRetryDeferredConflict={() => void retryDeferredConflict()}
      onPause={() => void pause()}
      onResume={() => void resume()}
      onBeginCloseout={() => void beginCloseout()}
      onDraftChange={setDraft}
      onClearCloseoutError={() => setCloseoutError(null)}
      onCancelCloseout={() => {
        setCloseoutError(null);
        setError(null);
        if (session.status === "closing" || session.status === "paused") {
          void resume();
        }
        setPhase("focus");
      }}
      onSubmitCloseout={() => void end()}
      onOpenEvidence={openEvidenceFlow}
      onAddLowConversion={() => void addLowConversionToInbox()}
      onCompleteEvidence={completeEvidenceFlow}
      onEvidenceTypeChange={setActiveEvidenceType}
      onLinkEvidence={linkEvidence}
      onOpenConflict={() => setConflictOpen(true)}
      onCloseConflict={() => setConflictOpen(false)}
      onAdoptServer={() => void adoptLatestSession()}
      onManualMerge={conflict?.commandId
        ? () => void deferOfflineConflict()
        : mergeDraftOntoLatestSession}
      onDiscardConflict={conflict?.commandId
        ? () => void abandonOfflineConflict()
        : undefined}
    />
  );
}
