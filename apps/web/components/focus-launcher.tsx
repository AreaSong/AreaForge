"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FocusSessionClient } from "@/components/focus-session-client";
import { FocusHeroDial } from "@/components/focus-launcher-views";
import { FocusLauncherSetupPanel } from "@/components/focus-launcher-setup-panel";
import {
  createLocalFocusSession,
  createFocusStartIdempotencyKey,
  clearFocusOfflineSnapshot,
  enqueueFocusCommand,
  getFocusOfflineConflict,
  isLocalFocusSessionId,
  publishFocusSyncEvent,
  readFocusOfflineSnapshot,
  removeFocusCommand,
  resolveFocusOfflineConflict,
  retryDeferredFocusCommands,
  saveFocusOfflineSnapshot,
  subscribeFocusOfflineSync,
  syncFocusOfflineQueue,
  type FocusOfflineSnapshot,
} from "@/lib/client/focus-offline-store";
import { readActiveStudySession } from "@/lib/client/active-study-session";
import { useEntityOperationMap } from "@/lib/client/use-entity-operation-map";
import { startStudySession } from "@/lib/api/session";
import { getClientDeviceHeaders, getClientDeviceIdentity } from "@/lib/client/device-identity";
import { shouldUseOfflineFocusSnapshot } from "@/lib/client/focus-launcher-state";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { FocusLauncherSummaryDto, StudySessionDto, StudyTaskDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/contracts";
import type { KnowledgePointDto } from "@/lib/contracts";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { FocusStartConflictModal, type FocusStartConflict } from "@/components/focus-start-conflict-modal";

export function FocusLauncher({
  subjects,
  userId,
  returnTo,
  contextOptions,
  initialNow,
  commandMode,
  commandText,
  launcherSummary,
  initialSubjectId,
  initialTaskId,
  initialGoalMinutes,
  initialStartSource,
}: {
  subjects: SubjectDto[];
  userId: string;
  returnTo: string;
  initialNow: string;
  commandMode?: "now";
  commandText?: string;
  contextOptions: { tasks: StudyTaskDto[]; syllabusNodes: SyllabusOptionNodeDto[]; knowledgePoints: KnowledgePointDto[] };
  launcherSummary?: FocusLauncherSummaryDto | null;
  initialSubjectId?: string;
  initialTaskId?: string;
  initialGoalMinutes?: number;
  initialStartSource?: "RECOVERY";
}) {
  const [subjectId, setSubjectId] = useState(initialSubjectId ?? "");
  const [taskId, setTaskId] = useState(initialTaskId ?? "");
  const [durationPreset, setDurationPreset] = useState(initialGoalMinutes ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [offlineSnapshot, setOfflineSnapshot] = useState<FocusOfflineSnapshot | null>(null);
  const [inlineSession, setInlineSession] = useState<StudySessionDto | null>(null);
  const [startConflict, setStartConflict] = useState<FocusStartConflict | null>(null);
  const [startConflictOpen, setStartConflictOpen] = useState(false);
  const offlineSnapshotRef = useRef<FocusOfflineSnapshot | null>(null);
  const startOperations = useEntityOperationMap<"start">();
  const startBusy = startOperations.get("start").pending || isPending;

  const selectedSubject = useMemo(() => subjects.find((item) => item.id === subjectId) ?? null, [subjects, subjectId]);
  const relatedSubjectTasks = useMemo(() => {
    if (!selectedSubject) return [];
    return contextOptions.tasks.filter(
      (task) => task.subjectId === selectedSubject.id && (task.status === "todo" || task.status === "in_progress"),
    );
  }, [selectedSubject, contextOptions.tasks]);
  const selectedTask = useMemo(
    () => relatedSubjectTasks.find((task) => task.id === taskId) ?? null,
    [relatedSubjectTasks, taskId],
  );
  useEffect(() => {
    offlineSnapshotRef.current = offlineSnapshot;
  }, [offlineSnapshot]);
  useEffect(() => {
    if (commandMode !== "now") return;
    const timer = window.setTimeout(() => document.getElementById("focus-subject-select")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [commandMode]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const snapshot = await readFocusOfflineSnapshot(userId);
      if (cancelled) return;
      if (navigator.onLine && snapshot && !isLocalFocusSessionId(snapshot.session.id)) {
        try {
          const active = await readActiveStudySession();
          if (cancelled) return;
          const snapshotDecision = shouldUseOfflineFocusSnapshot({
            online: true,
            snapshotSessionId: snapshot.session.id,
            snapshotStatus: snapshot.session.status,
            activeSessionId: active?.id ?? null,
          });
          if (snapshotDecision === "redirect-active" && active) {
            offlineSnapshotRef.current = null;
            setOfflineSnapshot(null);
            setInlineSession(active);
            return;
          }
          if (snapshotDecision === "clear-stale") await clearFocusOfflineSnapshot(userId);
        } catch {
          if (snapshot.session.status !== "completed") {
            offlineSnapshotRef.current = null;
            setOfflineSnapshot(null);
            setInlineSession(snapshot.session);
            return;
          }
        }
      }
      if (!cancelled && snapshot && (
        isLocalFocusSessionId(snapshot.session.id)
        || (!navigator.onLine && (snapshot.session.status === "running" || snapshot.session.status === "paused" || snapshot.session.status === "closing"))
      )) {
        offlineSnapshotRef.current = snapshot;
        setOfflineSnapshot(snapshot);
      }
      void syncFocusOfflineQueue(userId);
    };
    void load();
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; state?: string; session?: StudySessionDto | null }>).detail;
      if (detail?.userId !== userId) return;
      if (detail.state === "blocked") {
        void getFocusOfflineConflict(userId).then((record) => {
          if (!record) return;
          const localSession = record.localSession ?? offlineSnapshotRef.current?.session;
          if (!localSession) return;
          setStartConflict({
            localSession,
            latest: detail.session ?? record.latestSession,
            commandId: record.command.id,
            localSessionId: record.command.localSessionId,
            conflictFields: ["status", "updatedAt", "device", "timeline"],
          });
          setStartConflictOpen(true);
        });
        return;
      }
      if (!detail.session) return;
      if (isLocalFocusSessionId(detail.session.id)) {
        const current = offlineSnapshotRef.current;
        if (!current) return;
        const next = { ...current, session: detail.session };
        offlineSnapshotRef.current = next;
        setOfflineSnapshot(next);
      } else if (detail.session.status === "running" || detail.session.status === "paused" || detail.session.status === "closing") {
        if (offlineSnapshotRef.current && isLocalFocusSessionId(offlineSnapshotRef.current.session.id)) return;
        offlineSnapshotRef.current = null;
        setOfflineSnapshot(null);
        setInlineSession(detail.session);
      } else {
        if (offlineSnapshotRef.current && isLocalFocusSessionId(offlineSnapshotRef.current.session.id)) return;
        offlineSnapshotRef.current = null;
        setOfflineSnapshot(null);
      }
    };
    const unsubscribe = subscribeFocusOfflineSync(onSync);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);
  const start = useCallback(() => {
    if (!subjectId) {
      setError("开始学习前必须选择科目。");
      return;
    }
    const generation = startOperations.tryBegin("start");
    if (generation === null) return;
    setError(null);
    startTransition(async () => {
      try {
        const subject = subjects.find((item) => item.id === subjectId);
        if (!subject) return;
        const device = getClientDeviceIdentity();
        const localSession = createLocalFocusSession({
          userId,
          subjectId: subject.id,
          subjectName: subject.name,
          taskId: selectedTask?.id ?? null,
          taskTitle: selectedTask?.title ?? null,
          syllabusNodeId: selectedTask?.syllabusNodeId ?? null,
          syllabusNodeTitle: selectedTask?.syllabusNodeTitle ?? null,
          goalMinutes: durationPreset > 0 ? durationPreset : null,
          startSource: selectedTask ? "TASK" : initialStartSource ?? "SUBJECT_SHORTCUT",
          clientDeviceId: device.id,
          clientDeviceLabel: device.label,
        });
        const startBody = {
          idempotencyKey: createFocusStartIdempotencyKey(),
          startedAt: localSession.startedAt,
          subjectId: subject.id,
          taskId: selectedTask?.id,
          goalMinutes: durationPreset > 0 ? durationPreset : null,
          startSource: selectedTask ? "TASK" : initialStartSource ?? "SUBJECT_SHORTCUT",
          clientDeviceId: device.id,
          clientDeviceLabel: device.label,
        };
        const queuedStart = await enqueueFocusCommand({
          userId,
          localSessionId: localSession.id,
          action: "start",
          body: startBody,
        });
        try {
          const result = await startStudySession(queuedStart.body, getClientDeviceHeaders());
          const body = result.body;
          if (!result.ok) {
            const active = body?.latest;
            if (isUnauthorized(result)) {
              await saveFocusOfflineSnapshot(userId, localSession, "deferred", 1);
              await resolveFocusOfflineConflict({
                userId,
                localSessionId: localSession.id,
                commandId: queuedStart.id,
                resolution: "defer",
              });
              setError("登录已过期，开始命令已保留。重新登录后请回到开始学习页面显式重试。");
              redirectToLoginWithCurrentLocation();
              return;
            }
            if (isConflict(result) && active?.id) {
              await saveFocusOfflineSnapshot(userId, localSession, "pending", 1);
              const conflict: FocusStartConflict = {
                localSession,
                latest: active,
                commandId: queuedStart.id,
                localSessionId: localSession.id,
                conflictFields: body?.conflictFields ?? ["activeSession", "status"],
              };
              setStartConflict(conflict);
              setStartConflictOpen(true);
              setError("当前已有活动学习。开始命令与本地记录已保留，请明确采用当前活动或保留命令重试。");
              return;
            }
            if (result.status < 500 && typeof navigator !== "undefined" && navigator.onLine) {
              await removeFocusCommand(queuedStart.id);
              setError(body?.error === "SUBJECT_REQUIRED" ? "开始学习前必须选择科目。" : "无法开始学习，请稍后重试。");
              return;
            }
            throw new TypeError("开始请求未送达");
          }
          if (body?.session?.id) {
            await removeFocusCommand(queuedStart.id);
            offlineSnapshotRef.current = null;
            setOfflineSnapshot(null);
            setInlineSession(body.session);
            publishFocusSyncEvent(userId, "current", body.session);
            return;
          }
          throw new TypeError("开始响应缺少活动");
        } catch (requestError) {
          if (!(requestError instanceof TypeError) && (typeof navigator === "undefined" || navigator.onLine)) {
            setError("无法开始学习，请稍后重试。");
            return;
          }
          const syncState = typeof navigator !== "undefined" && navigator.onLine ? "pending" : "offline";
          await saveFocusOfflineSnapshot(userId, localSession, syncState, 1);
          const nextSnapshot: FocusOfflineSnapshot = { userId, session: localSession, savedAt: new Date().toISOString(), syncState, pendingCount: 1 };
          offlineSnapshotRef.current = nextSnapshot;
          setInlineSession(null);
          setOfflineSnapshot(nextSnapshot);
          publishFocusSyncEvent(userId, syncState, localSession);
        }
      } finally {
        startOperations.succeed("start", generation);
      }
    });
  }, [durationPreset, initialStartSource, selectedTask, startOperations, subjectId, subjects, userId]);
  async function adoptStartConflict() {
    if (!startConflict) return;
    if (!startConflict.latest) {
      setStartConflictOpen(false);
      setError("服务端没有可采用的活动版本，请刷新后确认当前状态；开始命令仍保留。");
      return;
    }
    await resolveFocusOfflineConflict({
      userId,
      localSessionId: startConflict.localSessionId,
      commandId: startConflict.commandId,
      resolution: "adopt-server",
    });
    offlineSnapshotRef.current = null;
    setOfflineSnapshot(null);
    setStartConflict(null);
    setStartConflictOpen(false);
    setInlineSession(startConflict.latest);
    setError("已采用当前服务端活动，原开始命令未重放。");
  }
  async function retryStartConflict() {
    if (!startConflict) return;
    await resolveFocusOfflineConflict({
      userId,
      localSessionId: startConflict.localSessionId,
      commandId: startConflict.commandId,
      resolution: "defer",
    });
    setStartConflictOpen(false);
    setStartConflict(null);
    setError("开始命令已保留，正在执行你明确触发的重试；若仍冲突会再次停在这里。");
    await retryDeferredFocusCommands(userId, startConflict.localSessionId);
    await syncFocusOfflineQueue(userId);
  }
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key >= "1" && event.key <= "9") {
        const index = parseInt(event.key, 10) - 1;
        if (subjects[index]) {
          setSubjectId(subjects[index].id);
          setTaskId("");
          setError(null);
        }
      } else if (event.key === "ArrowLeft" || event.key === "[") {
        event.preventDefault();
        setDurationPreset((prev) => Math.max(0, prev - 5));
      } else if (event.key === "ArrowRight" || event.key === "]") {
        event.preventDefault();
        setDurationPreset((prev) => Math.min(180, prev + 5));
      } else if (event.key === "Enter" && subjectId && !startBusy) {
        start();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [subjects, subjectId, startBusy, start]);
  if (inlineSession) {
    return (
      <div className="h-full min-h-0 w-full animate-[fade-in_0.25s_ease-out]">
        <FocusSessionClient
          userId={userId}
          session={inlineSession}
          activeConflictId={null}
          returnTo={returnTo}
          initialNow={initialNow}
          initialEvidenceReceipts={[]}
          contextOptions={contextOptions}
          embeddedInWorkbench
        />
        <FocusStartConflictModal
          conflict={startConflict}
          open={startConflictOpen}
          onClose={() => setStartConflictOpen(false)}
          onAdopt={() => void adoptStartConflict()}
          onRetry={() => void retryStartConflict()}
        />
      </div>
    );
  }
  if (offlineSnapshot && isLocalFocusSessionId(offlineSnapshot.session.id)) {
    return (
      <div className="h-full min-h-0 w-full animate-[fade-in_0.25s_ease-out]">
        <FocusSessionClient
          userId={userId}
          session={offlineSnapshot.session}
          activeConflictId={null}
          returnTo={returnTo}
          initialNow={initialNow}
          initialEvidenceReceipts={[]}
          contextOptions={contextOptions}
          offlineOnly
          embeddedInWorkbench
        />
        <FocusStartConflictModal
          conflict={startConflict}
          open={startConflictOpen}
          onClose={() => setStartConflictOpen(false)}
          onAdopt={() => void adoptStartConflict()}
          onRetry={() => void retryStartConflict()}
        />
      </div>
    );
  }
  return (
    <div className="af-focus-launcher-scroll h-full min-h-0 w-full p-2.5 sm:p-4 lg:p-5">
      <div className="af-focus-launcher-grid grid min-h-full w-full gap-4 sm:gap-5">
        {/* Main Hero Focus Cockpit */}
        <FocusHeroDial
          selectedSubject={selectedSubject}
          summary={launcherSummary}
          durationPreset={durationPreset}
          onPresetChange={setDurationPreset}
          tasks={contextOptions.tasks}
          initialNow={initialNow}
        />
        <FocusLauncherSetupPanel
          subjects={subjects}
          subjectId={subjectId}
          selectedSubject={selectedSubject}
          relatedSubjectTasks={relatedSubjectTasks}
          taskId={taskId}
          tasks={contextOptions.tasks}
          commandMode={commandMode}
          commandText={commandText}
          error={error}
          startBusy={startBusy}
          conflictDialog={(
            <FocusStartConflictModal
              conflict={startConflict}
              open={startConflictOpen}
              onClose={() => setStartConflictOpen(false)}
              onAdopt={() => void adoptStartConflict()}
              onRetry={() => void retryStartConflict()}
            />
          )}
          onSubjectSelect={(id) => {
            setSubjectId(id);
            setTaskId("");
            setError(null);
          }}
          onTaskSelect={setTaskId}
          onStart={start}
        />
      </div>
    </div>
  );
}
