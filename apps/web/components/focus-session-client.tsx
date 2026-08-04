"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type FocusContextOptions,
  type FocusEvidenceReceipt,
  type FocusEvidenceType,
  type TaskDisposition,
  type UnderstandingLevel,
} from "@/components/focus-session-panels";
import { Alert } from "@/components/ui/feedback";
import { isFocusEvidenceFlowOpen, linkFocusSessionEvidence, setFocusEvidenceFlowOpen } from "@/lib/client/focus-evidence";
import { getClientDeviceHeaders, getClientDeviceIdentity } from "@/lib/client/device-identity";
import { focusRequestErrorMessage, formatFocusElapsed } from "@/lib/client/focus-session";
import {
  applyLocalFocusCommand,
  enqueueFocusCommand,
  getFocusOfflineConflict,
  isLocalFocusSessionId,
  publishFocusSyncEvent,
  removeFocusCommand,
  resolveFocusOfflineConflict,
  retryDeferredFocusCommands,
  saveFocusOfflineSnapshot,
  subscribeFocusOfflineSync,
  syncFocusOfflineQueue,
  type FocusOfflineSyncState,
} from "@/lib/client/focus-offline-store";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { StudySessionDto, StudySessionLowReasonDto, SyllabusOptionNodeDto } from "@/lib/study/types";

const DRAFT_PREFIX = "areaforge.focus.closeout.";
const DRAFT_VERSION = 3;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type FocusPhase = "focus" | "closeout" | "low-conversion" | "evidence" | "complete";

interface FocusCloseoutDraft {
  qualityScore: string;
  isEffective: string;
  understandingLevel: UnderstandingLevel;
  lowReasons: StudySessionLowReasonDto[];
  focusLevel: string;
  energyLevel: string;
  minimalOutput: string;
  nextAction: string;
  nextDisposition: string;
  note: string;
  taskDisposition: TaskDisposition;
}

function focusDraftKey(userId: string, sessionId: string) {
  return `${DRAFT_PREFIX}v3.${userId}.${sessionId}`;
}

function readFocusDraft(userId: string, sessionId: string) {
  if (typeof window === "undefined") return null;
  const key = focusDraftKey(userId, sessionId);
  const raw = readFocusLocalStorage(key);
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
      lowReasons?: StudySessionLowReasonDto[];
      focusLevel?: string;
      energyLevel?: string;
      minimalOutput?: string;
      nextAction?: string;
      nextDisposition?: string;
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
      removeFocusLocalStorage(key);
      return null;
    }
    return parsed;
  } catch {
    removeFocusLocalStorage(key);
    return null;
  }
}

function defaultFocusCloseoutDraft(): FocusCloseoutDraft {
  return {
    qualityScore: "3",
    isEffective: "true",
    understandingLevel: "基本理解",
    lowReasons: [],
    focusLevel: "3",
    energyLevel: "3",
    minimalOutput: "",
    nextAction: "继续推进",
    nextDisposition: "",
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
    lowReasons: saved?.lowReasons ?? fallback.lowReasons,
    focusLevel: saved?.focusLevel ?? fallback.focusLevel,
    energyLevel: saved?.energyLevel ?? fallback.energyLevel,
    minimalOutput: saved?.minimalOutput ?? fallback.minimalOutput,
    nextAction: saved?.nextAction ?? fallback.nextAction,
    nextDisposition: saved?.nextDisposition ?? fallback.nextDisposition,
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
  contextOptions: FocusContextOptions;
  offlineOnly?: boolean;
  embeddedInWorkbench?: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState(props.session);
  const currentSessionRef = useRef(props.session);
  currentSessionRef.current = session;
  const [now, setNow] = useState(() => new Date(props.initialNow));
  const [phase, setPhase] = useState<FocusPhase>(() => initialPhase(props.session));
  const [error, setError] = useState<string | null>(null);
  const [closeoutError, setCloseoutError] = useState<string | null>(null);
  const [submittingCloseout, setSubmittingCloseout] = useState(false);
  const [conflict, setConflict] = useState<{
    latest?: StudySessionDto;
    localSession?: StudySessionDto | null;
    conflictFields: string[];
    action: "start" | "pause" | "resume" | "end" | "context";
    commandId?: string;
    localSessionId?: string;
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

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOfflineConflict(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadOfflineConflict]);

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
    writeFocusLocalStorage(focusDraftKey(props.userId, session.id), JSON.stringify({
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
      if (detail.state === "blocked") {
        void loadOfflineConflict(true, detail.session);
      }
      if (!detail.session) return;
      const foreignServerSession = isLocalFocusSessionId(session.id) && detail.session.id !== session.id;
      if (foreignServerSession && detail.state === "blocked") {
        void loadOfflineConflict(true, detail.session);
        return;
      }
      if (detail.session.id === session.id || (isLocalFocusSessionId(session.id) && detail.state !== "blocked" && detail.session.subjectId === session.subjectId)) {
        setSession(detail.session);
        if (detail.session.status === "completed") {
          if (detail.session.isLowConversion) setPhase("low-conversion");
          else if (isFocusEvidenceFlowOpen(props.userId, detail.session.id) || queuedOfflineRef.current) setPhase("evidence");
        }
        if (isLocalFocusSessionId(session.id) && !isLocalFocusSessionId(detail.session.id)) {
          if (detail.session.status === "completed" && isFocusEvidenceFlowOpen(props.userId, session.id)) {
            setFocusEvidenceFlowOpen(props.userId, detail.session.id, true);
            setFocusEvidenceFlowOpen(props.userId, session.id, false);
          }
          queuedOfflineRef.current = false;
        }
      }
    };
    const onOnline = () => {
      void syncFocusOfflineQueue(props.userId);
    };
    const unsubscribe = subscribeFocusOfflineSync(onSync);
    window.addEventListener("online", onOnline);
    void syncFocusOfflineQueue(props.userId).catch(() => undefined);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [loadOfflineConflict, props.userId, router, session.id, session.subjectId]);

  useEffect(() => {
    if (isLocalFocusSessionId(session.id)) return;
    if (session.status !== "running" && session.status !== "paused" && session.status !== "closing") return;
    let cancelled = false;
    const device = getClientDeviceIdentity();
    const heartbeat = async () => {
      try {
        const response = await fetch(`/api/study-sessions/${encodeURIComponent(session.id)}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
          body: JSON.stringify({ clientDeviceId: device.id, clientDeviceLabel: device.label }),
          cache: "no-store",
        });
        const body = await response.json().catch(() => null) as { session?: StudySessionDto } | null;
        if (!cancelled && response.ok && body?.session) {
          setSession((current) => current.id === body.session?.id ? body.session : current);
          publishFocusSyncEvent(props.userId, "current", body.session);
        }
      } catch {
        // The timer remains usable offline; the next heartbeat will retry.
      }
    };
    void heartbeat();
    const interval = window.setInterval(heartbeat, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [props.userId, session.id, session.status]);

  useEffect(() => {
    if (session.status !== "running" && session.status !== "paused" && session.status !== "closing" && !queuedOfflineRef.current) return;
    void saveFocusOfflineSnapshot(props.userId, session, syncState);
  }, [props.userId, session, syncState]);

  useEffect(() => {
    if (session.status !== "running") return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [session.status]);

  useEffect(() => {
    // The closeout is a state-changing boundary: browser back, refresh, and
    // closing the tab must not silently discard the required closeout step.
    const guarded = session.status === "closing" && phase === "closeout";
    if (!guarded) return;

    const guardState = { ...(window.history.state ?? {}), __areaforgeCloseoutGuard: true };
    window.history.pushState(guardState, "", window.location.href);

    const onPopState = () => {
      window.history.pushState(guardState, "", window.location.href);
      setCloseoutError("收口未完成，当前页面不能离开；请完成收口或保留本次记录后再离开。");
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [phase, session.status]);

  const timerStatus: TimerStatus =
    session.status === "running" || session.status === "paused"
      ? session.status
      : session.status === "closing"
        ? "completed"
        : "idle";

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

  async function mutate(path: string, body: unknown, action: "pause" | "resume" | "end" | "context") {
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
        headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
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
        publishFocusSyncEvent(props.userId, "current", completed);
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

  async function updateContext(selection: { taskId: string | null; syllabusNodeId: string | null; knowledgePointIds: string[] }) {
    const task = props.contextOptions.tasks.find((item) => item.id === selection.taskId);
    const node = flattenContextNodes(props.contextOptions.syllabusNodes).find((item) => item.id === selection.syllabusNodeId);
    try {
      await mutate(`/api/study-sessions/${session.id}/context`, {
        ...commandInput("context"),
        taskId: selection.taskId,
        syllabusNodeId: selection.syllabusNodeId,
        knowledgePointIds: selection.knowledgePointIds,
        taskTitle: task?.title ?? null,
        syllabusNodeTitle: node?.title ?? null,
        knowledgePoints: props.contextOptions.knowledgePoints.filter((point) => selection.knowledgePointIds.includes(point.id)).map((point) => ({ id: point.id, title: point.title, masteryState: point.masteryState })),
      }, "context");
      delete commandKeys.current["context:default"];
    } catch (err) {
      setError(focusRequestErrorMessage(err, "更新学习上下文失败"));
    }
  }

  async function pause() {
    try {
      await mutate(`/api/study-sessions/${session.id}/pause`, commandInput("pause"), "pause");
      delete commandKeys.current["pause:default"];
    } catch (err) {
      setError(focusRequestErrorMessage(err, "暂停失败"));
    }
  }

  async function resume() {
    try {
      await mutate(`/api/study-sessions/${session.id}/resume`, commandInput("resume"), "resume");
      delete commandKeys.current["resume:default"];
    } catch (err) {
      setError(focusRequestErrorMessage(err, "继续失败"));
    }
  }

  async function beginCloseout() {
    setError(null);
    setCloseoutError(null);
    try {
      const frozen = await mutate(`/api/study-sessions/${session.id}/end`, {
        ...commandInput("end", "prepare"),
        mode: "prepare",
      }, "end");
      delete commandKeys.current["end:prepare"];
      if (frozen?.status === "closing") setPhase("closeout");
    } catch (err) {
      setError(focusRequestErrorMessage(err, "结束计时失败"));
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
    if (draft.isEffective === "false" && draft.lowReasons.length === 0) {
      setCloseoutError("低效学习必须至少选择一个原因，方便后续补充和复盘。");
      return;
    }
    setSubmittingCloseout(true);
    setCloseoutError(null);
    try {
      const completed = await mutate(`/api/study-sessions/${session.id}/end`, {
        ...commandInput("end", "complete"),
        mode: "complete",
        qualityScore: Number(draft.qualityScore),
        isEffective: draft.isEffective === "true",
        understandingLevel: draft.understandingLevel,
        lowReasons: draft.lowReasons,
        focusLevel: Number(draft.focusLevel),
        energyLevel: Number(draft.energyLevel),
        minimalOutput,
        nextAction,
        nextDisposition: draft.nextDisposition.trim() || nextAction,
        producedNote: false,
        producedMistake: false,
        note: draft.note,
        completeTask: draft.taskDisposition === "complete",
      }, "end");
      delete commandKeys.current["end:complete"];
      removeFocusLocalStorage(focusDraftKey(props.userId, session.id));
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
    } finally {
      setSubmittingCloseout(false);
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
    clearCommandKeys(conflict.action);
    if (conflict.latest.status === "completed") setPhase(initialPhase(conflict.latest));
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
    if (latest) setSession(latest);
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
        <Link href="/focus" className="text-teal-300 hover:underline">
          继续当前活动
        </Link>
      </section>
    );
  }

  return (
    <section className={`${props.embeddedInWorkbench ? "h-full min-h-0" : "min-h-screen"} w-full bg-[var(--af-canvas)]`}>
      {!props.embeddedInWorkbench ? (
        <FocusHeader userId={props.userId} returnTo={props.returnTo} status={session.status} phaseLabel={phaseLabel(phase)} />
      ) : null}
      {syncState !== "current" ? (
        <div className="border-b border-amber-400/20 bg-amber-400/5 px-4 py-2 text-center text-xs text-amber-100" role="status">
          {syncState === "offline"
            ? "当前离线：计时和操作已保存在本机，恢复网络后自动同步。"
            : syncState === "blocked"
              ? "同步遇到状态冲突：请先选择如何处理本地离线记录。"
              : syncState === "deferred"
                ? "离线记录已保留：等待你显式重新对账，不会自动覆盖当前活动。"
                : "本机有待同步的计时操作，服务端确认前不会伪造完成。"}
          {syncState === "deferred" ? (
            <button type="button" className="ml-2 underline underline-offset-2" onClick={() => void retryDeferredConflict()}>
              重新对账
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="px-4 pt-4 sm:px-6 lg:px-8"><Alert tone="danger">{error}</Alert></div> : null}
      {phase === "focus" && (session.status === "running" || session.status === "paused") ? (
        <FocusTimerWorkspace
          context={context}
          options={props.contextOptions}
          onContextChange={(selection) => void updateContext(selection)}
          elapsedLabel={formatFocusElapsed(elapsedSeconds)}
          elapsedSeconds={elapsedSeconds}
          timerLabel={timerLabel}
          goalReached={goalReached}
          status={session.status}
          onPause={() => void pause()}
          onResume={() => void resume()}
          onEnd={() => void beginCloseout()}
          embeddedInWorkbench={props.embeddedInWorkbench}
        />
      ) : null}
      {phase === "closeout" ? (
        <CloseoutWorkspace
          context={context}
          options={props.contextOptions}
          onContextChange={(selection) => void updateContext(selection)}
          elapsedLabel={formatFocusElapsed(elapsedSeconds)}
          outcome={closeoutOutcome}
          understandingLevel={draft.understandingLevel}
          lowReasons={draft.lowReasons}
          focusLevel={draft.focusLevel}
          energyLevel={draft.energyLevel}
          minimalOutput={draft.minimalOutput}
          nextAction={draft.nextAction}
          nextDisposition={draft.nextDisposition}
          taskDisposition={draft.taskDisposition}
          validationError={closeoutError}
          submitting={submittingCloseout}
          onOutcomeChange={(outcome) => setDraft({
            ...draft,
            isEffective: outcome === "not-achieved" ? "false" : "true",
            qualityScore: outcome === "achieved" ? "4" : outcome === "partial" ? "3" : "1",
            lowReasons: outcome === "not-achieved" ? draft.lowReasons : [],
          })}
          onUnderstandingChange={(understandingLevel) => setDraft({ ...draft, understandingLevel })}
          onLowReasonsChange={(lowReasons) => { setCloseoutError(null); setDraft({ ...draft, lowReasons }); }}
          onFocusLevelChange={(focusLevel) => setDraft({ ...draft, focusLevel })}
          onEnergyLevelChange={(energyLevel) => setDraft({ ...draft, energyLevel })}
          onMinimalOutputChange={(minimalOutput) => { setCloseoutError(null); setDraft({ ...draft, minimalOutput }); }}
          onNextActionChange={(nextAction) => { setCloseoutError(null); setDraft({ ...draft, nextAction }); }}
          onNextDispositionChange={(nextDisposition) => setDraft({ ...draft, nextDisposition })}
          onTaskDispositionChange={(taskDisposition) => setDraft({
            ...draft,
            taskDisposition,
            nextAction: taskDisposition === "complete" ? "转入下一项" : taskDisposition === "blocked" ? "" : "继续推进",
          })}
          onCancel={() => {
            setCloseoutError(null);
            if (session.status === "closing") setError("计时已经冻结，必须完成或保留本次收口后才能离开。");
            else setPhase("focus");
          }}
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
      {conflict && !conflictOpen ? <button type="button" className="w-fit text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>{conflict.commandId ? "查看离线记录处理方式" : "处理活动状态冲突"}</button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并活动状态冲突"
        description="活动已在其他页面或设备变化。系统不会自动重放暂停、继续或结束命令。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={[
          { field: "status", label: "活动状态", local: conflict?.localSession?.status ?? session.status, server: conflict?.latest?.status },
          { field: "updatedAt", label: "更新时间", local: conflict?.localSession?.updatedAt ?? session.updatedAt, server: conflict?.latest?.updatedAt },
          { field: "closeout", label: "本地收口输入", local: draft, server: "服务端不保存未提交草稿" },
        ]}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={() => void adoptLatestSession()}
        onManualMerge={conflict?.commandId ? () => void deferOfflineConflict() : mergeDraftOntoLatestSession}
        onDiscard={conflict?.commandId ? () => void abandonOfflineConflict() : undefined}
        mergeLabel={conflict?.commandId ? "保留并稍后对账" : "基于最新状态重建命令"}
        discardLabel="放弃旧离线记录"
      />
    </section>
  );
}

function readFocusLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFocusLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // IndexedDB remains the primary offline store; drafts are best-effort.
  }
}

function removeFocusLocalStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // A blocked storage context should not prevent the closeout flow.
  }
}

function initialPhase(session: StudySessionDto): FocusPhase {
  if (session.status === "closing") return "closeout";
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

function flattenContextNodes(nodes: SyllabusOptionNodeDto): SyllabusOptionNodeDto[];
function flattenContextNodes(nodes: SyllabusOptionNodeDto[]): SyllabusOptionNodeDto[];
function flattenContextNodes(nodes: SyllabusOptionNodeDto | SyllabusOptionNodeDto[]): SyllabusOptionNodeDto[] {
  const roots = Array.isArray(nodes) ? nodes : [nodes];
  return roots.flatMap((node) => [node, ...flattenContextNodes(node.children)]);
}
