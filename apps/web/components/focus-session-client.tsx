"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTimerElapsedSeconds, type TimerStatus } from "@areaforge/core";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { FocusEvidenceForms } from "@/components/focus-evidence-forms";
import {
  CloseoutWorkspace,
  CompleteWorkspace,
  EvidenceWorkspace,
  FocusHeader,
  FocusTimerWorkspace,
  LowConversionWorkspace,
  type CloseoutOutcome,
  type FocusContext,
  type FocusEvidenceReceipt,
  type FocusEvidenceType,
  type TaskDisposition,
  type UnderstandingLevel,
} from "@/components/focus-session-panels";
import { Alert } from "@/components/ui/feedback";
import { isFocusEvidenceFlowOpen, linkFocusSessionEvidence, setFocusEvidenceFlowOpen } from "@/lib/client/focus-evidence";
import { focusRequestErrorMessage, formatFocusElapsed } from "@/lib/client/focus-session";
import {
  FOCUS_OFFLINE_SYNC_EVENT,
  applyLocalFocusCommand,
  enqueueFocusCommand,
  isLocalFocusSessionId,
  removeFocusCommand,
  saveFocusOfflineSnapshot,
  syncFocusOfflineQueue,
  type FocusOfflineSyncState,
} from "@/lib/client/focus-offline-store";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { StudySessionDto } from "@/lib/study/types";

const DRAFT_PREFIX = "areaforge.focus.closeout.";
const DRAFT_VERSION = 3;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type FocusPhase = "focus" | "closeout" | "low-conversion" | "evidence" | "complete";

interface FocusCloseoutDraft {
  qualityScore: string;
  isEffective: string;
  understandingLevel: UnderstandingLevel;
  minimalOutput: string;
  nextAction: string;
  note: string;
  taskDisposition: TaskDisposition;
}

function focusDraftKey(userId: string, sessionId: string) {
  return `${DRAFT_PREFIX}v3.${userId}.${sessionId}`;
}

function readFocusDraft(userId: string, sessionId: string) {
  if (typeof window === "undefined") return null;
  const key = focusDraftKey(userId, sessionId);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      userId?: string;
      sessionId?: string;
      updatedAt?: number;
      qualityScore?: string;
      isEffective?: string;
      understandingLevel?: UnderstandingLevel;
      minimalOutput?: string;
      nextAction?: string;
      note?: string;
      taskDisposition?: TaskDisposition;
    };
    if (
      parsed.version !== DRAFT_VERSION ||
      parsed.userId !== userId ||
      parsed.sessionId !== sessionId ||
      typeof parsed.updatedAt !== "number" ||
      Date.now() - parsed.updatedAt > DRAFT_TTL_MS
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function defaultFocusCloseoutDraft(): FocusCloseoutDraft {
  return {
    qualityScore: "3",
    isEffective: "true",
    understandingLevel: "基本理解",
    minimalOutput: "",
    nextAction: "继续推进",
    note: "",
    taskDisposition: "continue",
  };
}

function mergeFocusCloseoutDraft(saved: ReturnType<typeof readFocusDraft>): FocusCloseoutDraft {
  const fallback = defaultFocusCloseoutDraft();
  return {
    qualityScore: saved?.qualityScore ?? fallback.qualityScore,
    isEffective: saved?.isEffective ?? fallback.isEffective,
    understandingLevel: saved?.understandingLevel ?? fallback.understandingLevel,
    minimalOutput: saved?.minimalOutput ?? fallback.minimalOutput,
    nextAction: saved?.nextAction ?? fallback.nextAction,
    note: saved?.note ?? fallback.note,
    taskDisposition: saved?.taskDisposition ?? fallback.taskDisposition,
  };
}

export function FocusSessionClient(props: {
  userId: string;
  session: StudySessionDto;
  activeConflictId: string | null;
  returnTo: string;
  initialNow: string;
  initialEvidenceReceipts: FocusEvidenceReceipt[];
  offlineOnly?: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState(props.session);
  const [now, setNow] = useState(() => new Date(props.initialNow));
  const [phase, setPhase] = useState<FocusPhase>(() => initialPhase(props.session));
  const [error, setError] = useState<string | null>(null);
  const [closeoutError, setCloseoutError] = useState<string | null>(null);
  const [submittingCloseout, setSubmittingCloseout] = useState(false);
  const [conflict, setConflict] = useState<{
    latest?: StudySessionDto;
    conflictFields: string[];
    action: "pause" | "resume" | "end";
  } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const commandKeys = useRef<Record<string, string>>({});
  const [lowConversionAdded, setLowConversionAdded] = useState(false);
  const [activeEvidenceType, setActiveEvidenceType] = useState<FocusEvidenceType>("note");
  const [evidenceReceipts, setEvidenceReceipts] = useState(props.initialEvidenceReceipts);
  const [draft, setDraft] = useState<FocusCloseoutDraft>(defaultFocusCloseoutDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [syncState, setSyncState] = useState<FocusOfflineSyncState>(props.offlineOnly ? "pending" : "current");
  const queuedOfflineRef = useRef(Boolean(props.offlineOnly));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDraft(mergeFocusCloseoutDraft(readFocusDraft(props.userId, props.session.id)));
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.session.id, props.userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (session.status === "completed" && isFocusEvidenceFlowOpen(props.userId, session.id)) {
        setPhase("evidence");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.userId, session.id, session.status]);

  useEffect(() => {
    if (!draftReady) return;
    window.localStorage.setItem(focusDraftKey(props.userId, session.id), JSON.stringify({
      version: DRAFT_VERSION,
      userId: props.userId,
      sessionId: session.id,
      updatedAt: Date.now(),
      ...draft,
    }));
  }, [draft, draftReady, props.userId, session.id]);

  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; state?: FocusOfflineSyncState; session?: StudySessionDto | null }>).detail;
      if (detail?.userId !== props.userId) return;
      if (detail.state) setSyncState(detail.state);
      if (!detail.session) return;
      if (detail.session.id === session.id || (isLocalFocusSessionId(session.id) && detail.session.subjectId === session.subjectId)) {
        setSession(detail.session);
        if (detail.session.status === "completed" && isFocusEvidenceFlowOpen(props.userId, detail.session.id)) {
          setPhase("evidence");
        }
        if (isLocalFocusSessionId(session.id) && !isLocalFocusSessionId(detail.session.id)) {
          if (detail.session.status === "completed" && isFocusEvidenceFlowOpen(props.userId, session.id)) {
            setFocusEvidenceFlowOpen(props.userId, detail.session.id, true);
            setFocusEvidenceFlowOpen(props.userId, session.id, false);
          }
          queuedOfflineRef.current = false;
          router.replace(`/focus/${detail.session.id}`);
        }
      }
    };
    const onOnline = () => {
      void syncFocusOfflineQueue(props.userId);
    };
    window.addEventListener(FOCUS_OFFLINE_SYNC_EVENT, onSync);
    window.addEventListener("online", onOnline);
    void syncFocusOfflineQueue(props.userId).catch(() => undefined);
    return () => {
      window.removeEventListener(FOCUS_OFFLINE_SYNC_EVENT, onSync);
      window.removeEventListener("online", onOnline);
    };
  }, [props.userId, router, session.id, session.subjectId]);

  useEffect(() => {
    if (session.status !== "running" && session.status !== "paused" && !queuedOfflineRef.current) return;
    void saveFocusOfflineSnapshot(props.userId, session, syncState);
  }, [props.userId, session, syncState]);

  useEffect(() => {
    if (session.status !== "running") return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [session.status]);

  const timerStatus: TimerStatus =
    session.status === "running" || session.status === "paused" ? session.status : "idle";

  const elapsedSeconds = useMemo(
    () =>
      getTimerElapsedSeconds({
        status: timerStatus,
        startedAt: new Date(session.startedAt),
        pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
        endedAt: session.endedAt ? new Date(session.endedAt) : undefined,
        accumulatedPauseSeconds: session.accumulatedPauseSeconds,
        now,
      }),
    [now, session, timerStatus],
  );

  const goalReached =
    typeof session.goalMinutes === "number" && Math.floor(elapsedSeconds / 60) >= session.goalMinutes;
  const timerLabel = session.status === "running" ? "正计时" : session.status === "paused" ? "已暂停" : "已结束";
  const closeoutOutcome: CloseoutOutcome = draft.isEffective === "false"
    ? "not-achieved"
    : Number(draft.qualityScore) >= 4 ? "achieved" : "partial";
  const context: FocusContext = {
    subjectName: session.subjectName,
    taskTitle: session.taskTitle,
    syllabusNodeTitle: session.syllabusNodeTitle,
    goalMinutes: session.goalMinutes,
  };

  async function mutate(path: string, body: unknown, action: "pause" | "resume" | "end") {
    if (conflict) throw new Error("请先处理活动状态冲突，再提交新的状态命令。");
    setError(null);
    const commandBody = body as Record<string, unknown>;
    const localSession = isLocalFocusSessionId(session.id);
    const queuedCommand = await enqueueFocusCommand({
      userId: props.userId,
      localSessionId: session.id,
      serverSessionId: localSession ? null : session.id,
      action,
      body: commandBody,
    });
    if (localSession) {
      queuedOfflineRef.current = true;
      const projected = applyLocalFocusCommand(session, action, commandBody);
      setSyncState("pending");
      setSession(projected);
      await saveFocusOfflineSnapshot(props.userId, projected, "pending");
      return projected;
    }
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as { session?: StudySessionDto; error?: string; latest?: StudySessionDto; conflictFields?: string[] } | null;
      if (!response.ok) {
        if (response.status === 401) {
          redirectToLoginWithCurrentLocation();
          throw new Error("登录已过期，收口草稿已保留。重新登录后请显式重试。");
        }
        if (response.status === 409) {
          await removeFocusCommand(queuedCommand.id);
          setConflict({ latest: data?.latest, conflictFields: data?.conflictFields ?? ["status", "updatedAt"], action });
          setConflictOpen(true);
          throw new Error("活动状态已变化，草稿与命令键已保留。请先比较差异并人工选择新基线。");
        }
        if (response.status < 500) await removeFocusCommand(queuedCommand.id);
        if (response.status >= 500) {
          throw new TypeError("服务暂时不可用");
        }
        throw new Error(data?.error ?? "请求失败");
      }
      const completed = data?.session ?? null;
      queuedOfflineRef.current = false;
      await removeFocusCommand(queuedCommand.id);
      setSyncState("current");
      if (completed) {
        setSession(completed);
        await saveFocusOfflineSnapshot(props.userId, completed, "current");
      }
      return completed;
    } catch (error) {
      if (!(error instanceof TypeError) && (typeof navigator === "undefined" || navigator.onLine)) throw error;
      queuedOfflineRef.current = true;
      const projected = applyLocalFocusCommand(session, action, commandBody);
      setSession(projected);
      setSyncState(typeof navigator !== "undefined" && navigator.onLine ? "pending" : "offline");
      await saveFocusOfflineSnapshot(props.userId, projected, typeof navigator !== "undefined" && navigator.onLine ? "pending" : "offline");
      return projected;
    }
  }

  function commandInput(action: "pause" | "resume" | "end") {
    const key = commandKeys.current[action] ?? `study-session-${action}-${session.id}-${crypto.randomUUID()}`;
    commandKeys.current[action] = key;
    return {
      expectedStatus: session.status === "paused" ? "paused" as const : "running" as const,
      expectedUpdatedAt: session.updatedAt,
      idempotencyKey: key,
    };
  }

  async function pause() {
    try {
      await mutate(`/api/study-sessions/${session.id}/pause`, commandInput("pause"), "pause");
      delete commandKeys.current.pause;
    } catch (err) {
      setError(focusRequestErrorMessage(err, "暂停失败"));
    }
  }

  async function resume() {
    try {
      await mutate(`/api/study-sessions/${session.id}/resume`, commandInput("resume"), "resume");
      delete commandKeys.current.resume;
    } catch (err) {
      setError(focusRequestErrorMessage(err, "继续失败"));
    }
  }

  async function end() {
    const minimalOutput = draft.minimalOutput.trim();
    const nextAction = draft.nextAction.trim();
    if (minimalOutput.length < 4) {
      setCloseoutError("请填写至少 4 个字符的真实最小产出，系统不会代填学习事实。");
      return;
    }
    if (!nextAction) {
      setCloseoutError(draft.taskDisposition === "blocked" ? "请写明阻塞原因和恢复位置。" : "请填写下一动作。");
      return;
    }
    setSubmittingCloseout(true);
    setCloseoutError(null);
    try {
      const completed = await mutate(`/api/study-sessions/${session.id}/end`, {
        ...commandInput("end"),
        qualityScore: Number(draft.qualityScore),
        isEffective: draft.isEffective === "true",
        understandingLevel: draft.understandingLevel,
        minimalOutput,
        nextAction,
        producedNote: false,
        producedMistake: false,
        note: draft.note,
        completeTask: draft.taskDisposition === "complete",
      }, "end");
      delete commandKeys.current.end;
      window.localStorage.removeItem(focusDraftKey(props.userId, session.id));
      if (completed?.isLowConversion) {
        setPhase("low-conversion");
        return;
      }
      if (queuedOfflineRef.current || isLocalFocusSessionId(session.id)) {
        if (completed?.status === "completed") setFocusEvidenceFlowOpen(props.userId, completed.id, true);
        setPhase("complete");
        return;
      }
      openEvidenceFlow();
    } catch (err) {
      setError(focusRequestErrorMessage(err, "结束失败"));
    } finally {
      setSubmittingCloseout(false);
    }
  }

  function adoptLatestSession() {
    if (!conflict?.latest) {
      setConflictOpen(false);
      router.refresh();
      return;
    }
    setSession(conflict.latest);
    delete commandKeys.current[conflict.action];
    if (conflict.latest.status === "completed") setPhase(initialPhase(conflict.latest));
    setConflict(null);
    setConflictOpen(false);
    setError("已采用服务端最新活动状态；本地收口草稿仍保留。");
  }

  function mergeDraftOntoLatestSession() {
    if (!conflict?.latest) return;
    setSession(conflict.latest);
    delete commandKeys.current[conflict.action];
    setConflict(null);
    setConflictOpen(false);
    setError("已以服务端最新状态重建命令基线；本地草稿仍保留，请检查后显式重试。");
  }

  async function addLowConversionToInbox() {
    setError(null);
    try {
      const response = await fetch("/api/plan-inbox/low-conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          expectedCloseoutVersion: session.closeoutVersion || 1,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 401) {
          redirectToLoginWithCurrentLocation();
          setError("登录已过期。重新登录后请显式重试加入收件箱。");
          return;
        }
        setError(body?.error ?? "加入收件箱失败");
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
    setEvidenceReceipts((current) => current.some((receipt) =>
      receipt.evidenceType === body.receipt.evidenceType && receipt.evidenceId === body.receipt.evidenceId)
      ? current
      : [...current, body.receipt]);
  }

  if (props.activeConflictId) {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold text-white">活动冲突</h1>
        <p className="text-sm text-zinc-400">已有其他活动，只能继续当前活动。</p>
        <Link href={`/focus/${props.activeConflictId}`} className="text-teal-300 hover:underline">
          继续当前活动
        </Link>
      </section>
    );
  }

  return (
    <section className="min-h-screen w-full bg-[var(--af-canvas)]">
      <FocusHeader returnTo={props.returnTo} status={session.status} phaseLabel={phaseLabel(phase)} />
      {syncState !== "current" ? (
        <div className="border-b border-amber-400/20 bg-amber-400/5 px-4 py-2 text-center text-xs text-amber-100" role="status">
          {syncState === "offline" ? "当前离线：计时和操作已保存在本机，恢复网络后自动同步。" : syncState === "blocked" ? "同步遇到状态冲突：请回到当前活动比较后再继续。" : "本机有待同步的计时操作，服务端确认前不会伪造完成。"}
        </div>
      ) : null}
      {error ? <div className="px-4 pt-4 sm:px-6 lg:px-8"><Alert tone="danger">{error}</Alert></div> : null}
      {phase === "focus" && (session.status === "running" || session.status === "paused") ? (
        <FocusTimerWorkspace
          context={context}
          elapsedLabel={formatFocusElapsed(elapsedSeconds)}
          timerLabel={timerLabel}
          goalReached={goalReached}
          status={session.status}
          onPause={() => void pause()}
          onResume={() => void resume()}
          onEnd={() => { setError(null); setPhase("closeout"); }}
        />
      ) : null}
      {phase === "closeout" ? (
        <CloseoutWorkspace
          context={context}
          elapsedLabel={formatFocusElapsed(elapsedSeconds)}
          outcome={closeoutOutcome}
          understandingLevel={draft.understandingLevel}
          minimalOutput={draft.minimalOutput}
          nextAction={draft.nextAction}
          taskDisposition={draft.taskDisposition}
          validationError={closeoutError}
          submitting={submittingCloseout}
          onOutcomeChange={(outcome) => setDraft({
            ...draft,
            isEffective: outcome === "not-achieved" ? "false" : "true",
            qualityScore: outcome === "achieved" ? "4" : outcome === "partial" ? "3" : "1",
          })}
          onUnderstandingChange={(understandingLevel) => setDraft({ ...draft, understandingLevel })}
          onMinimalOutputChange={(minimalOutput) => { setCloseoutError(null); setDraft({ ...draft, minimalOutput }); }}
          onNextActionChange={(nextAction) => { setCloseoutError(null); setDraft({ ...draft, nextAction }); }}
          onTaskDispositionChange={(taskDisposition) => setDraft({
            ...draft,
            taskDisposition,
            nextAction: taskDisposition === "complete" ? "转入下一项" : taskDisposition === "blocked" ? "" : "继续推进",
          })}
          onCancel={() => { setCloseoutError(null); setPhase("focus"); }}
          onSubmit={() => void end()}
        />
      ) : null}
      {phase === "low-conversion" ? (
        <LowConversionWorkspace
          reason={session.antiFakeReason ?? "有效性判定需要补产出。"}
          addedToInbox={lowConversionAdded}
          returnTo={props.returnTo}
          onSupplement={openEvidenceFlow}
          onAddToInbox={() => void addLowConversionToInbox()}
          onAccept={completeEvidenceFlow}
        />
      ) : null}
      {phase === "evidence" ? (
        <EvidenceWorkspace
          activeType={activeEvidenceType}
          canRetest={Boolean(session.syllabusNodeId)}
          receipts={evidenceReceipts}
          onTypeChange={setActiveEvidenceType}
          onComplete={completeEvidenceFlow}
        >
          <FocusEvidenceForms
            userId={props.userId}
            sessionId={session.id}
            subjectId={session.subjectId}
            subjectName={session.subjectName}
            taskId={session.taskId}
            taskTitle={session.taskTitle}
            syllabusNodeId={session.syllabusNodeId}
            syllabusNodeTitle={session.syllabusNodeTitle}
            activeType={activeEvidenceType}
            onEvidenceSaved={linkEvidence}
          />
        </EvidenceWorkspace>
      ) : null}
      {phase === "complete" ? (
        <CompleteWorkspace
          elapsedLabel={formatFocusElapsed(elapsedSeconds)}
          lowConversion={session.isLowConversion === true}
          taskStatus={session.taskStatus}
          returnTo={props.returnTo}
          receipts={evidenceReceipts}
        />
      ) : null}
      {conflict && !conflictOpen ? <button type="button" className="w-fit text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理活动状态冲突</button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并活动状态冲突"
        description="活动已在其他页面或设备变化。系统不会自动重放暂停、继续或结束命令。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={[
          { field: "status", label: "活动状态", local: session.status, server: conflict?.latest?.status },
          { field: "updatedAt", label: "更新时间", local: session.updatedAt, server: conflict?.latest?.updatedAt },
          { field: "closeout", label: "本地收口输入", local: draft, server: "服务端不保存未提交草稿" },
        ]}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptLatestSession}
        onManualMerge={mergeDraftOntoLatestSession}
        mergeLabel="基于最新状态重建命令"
      />
    </section>
  );
}

function initialPhase(session: StudySessionDto): FocusPhase {
  if (session.status !== "completed") return "focus";
  return session.isLowConversion ? "low-conversion" : "complete";
}

function phaseLabel(phase: FocusPhase): string {
  if (phase === "focus") return "专注计时";
  if (phase === "closeout") return "学习收口";
  if (phase === "low-conversion") return "低转化补救";
  if (phase === "evidence") return "证据接力";
  return "完成摘要";
}
