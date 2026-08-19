"use client";

import { BookOpen, ListTodo, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { FocusSessionClient } from "@/components/focus-session-client";
import {
  FocusHeroDial,
  SubjectTileGrid,
} from "@/components/focus-launcher-views";
import {
  createLocalFocusSession,
  createFocusStartIdempotencyKey,
  clearFocusOfflineSnapshot,
  enqueueFocusCommand,
  isLocalFocusSessionId,
  publishFocusSyncEvent,
  readFocusOfflineSnapshot,
  removeFocusCommand,
  saveFocusOfflineSnapshot,
  subscribeFocusOfflineSync,
  syncFocusOfflineQueue,
  type FocusOfflineSnapshot,
} from "@/lib/client/focus-offline-store";
import { readActiveStudySession } from "@/lib/client/active-study-session";
import { getClientDeviceHeaders, getClientDeviceIdentity } from "@/lib/client/device-identity";
import { shouldUseOfflineFocusSnapshot } from "@/lib/client/focus-launcher-state";
import type { FocusLauncherSummaryDto, StudySessionDto, StudyTaskDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";
import type { KnowledgePointDto } from "@/lib/study/knowledge-point-service";

export function FocusLauncher({
  subjects,
  userId,
  returnTo,
  contextOptions,
  initialNow,
  commandMode,
  commandText,
  launcherSummary,
}: {
  subjects: SubjectDto[];
  userId: string;
  returnTo: string;
  initialNow: string;
  commandMode?: "now";
  commandText?: string;
  contextOptions: { tasks: StudyTaskDto[]; syllabusNodes: SyllabusOptionNodeDto[]; knowledgePoints: KnowledgePointDto[] };
  launcherSummary?: FocusLauncherSummaryDto | null;
}) {
  const subjectRef = useRef<HTMLSelectElement>(null);
  const [subjectId, setSubjectId] = useState("");
  const [durationPreset, setDurationPreset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [offlineSnapshot, setOfflineSnapshot] = useState<FocusOfflineSnapshot | null>(null);
  const [inlineSession, setInlineSession] = useState<StudySessionDto | null>(null);
  const offlineSnapshotRef = useRef<FocusOfflineSnapshot | null>(null);

  const selectedSubject = useMemo(() => subjects.find((item) => item.id === subjectId) ?? null, [subjects, subjectId]);
  
  const relatedSubjectTasks = useMemo(() => {
    if (!selectedSubject) return [];
    return contextOptions.tasks.filter((task) => task.subjectId === selectedSubject.id && task.status !== "done");
  }, [selectedSubject, contextOptions.tasks]);

  useEffect(() => {
    offlineSnapshotRef.current = offlineSnapshot;
  }, [offlineSnapshot]);

  useEffect(() => {
    if (commandMode !== "now") return;
    const timer = window.setTimeout(() => subjectRef.current?.focus(), 0);
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
      if (detail?.userId !== userId || !detail.session) return;
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
    setError(null);
    startTransition(async () => {
      const subject = subjects.find((item) => item.id === subjectId);
      if (!subject) return;
      const device = getClientDeviceIdentity();
      const localSession = createLocalFocusSession({
        userId,
        subjectId: subject.id,
        subjectName: subject.name,
        clientDeviceId: device.id,
        clientDeviceLabel: device.label,
      });
      const startBody = {
        idempotencyKey: createFocusStartIdempotencyKey(),
        startedAt: localSession.startedAt,
        subjectId,
        startSource: "SUBJECT_SHORTCUT",
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
        const response = await fetch("/api/study-sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
          body: JSON.stringify(queuedStart.body),
        });
        const body = await response.json().catch(() => null) as { session?: StudySessionDto; latest?: StudySessionDto; error?: string } | null;
        if (!response.ok) {
          const active = body?.latest;
          if (response.status === 409 && active?.id) {
            await removeFocusCommand(queuedStart.id);
            offlineSnapshotRef.current = null;
            setOfflineSnapshot(null);
            setInlineSession(active);
            return;
          }
          if (response.status < 500 && typeof navigator !== "undefined" && navigator.onLine) {
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
    });
  }, [subjectId, subjects, userId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key >= "1" && event.key <= "9") {
        const index = parseInt(event.key, 10) - 1;
        if (subjects[index]) {
          setSubjectId(subjects[index].id);
          setError(null);
        }
      } else if (event.key === "ArrowLeft" || event.key === "[") {
        event.preventDefault();
        setDurationPreset((prev) => Math.max(0, prev - 5));
      } else if (event.key === "ArrowRight" || event.key === "]") {
        event.preventDefault();
        setDurationPreset((prev) => Math.min(180, prev + 5));
      } else if (event.key === "Enter" && subjectId && !isPending) {
        start();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [subjects, subjectId, isPending, start]);

  if (inlineSession) {
    return (
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
    );
  }

  if (offlineSnapshot && isLocalFocusSessionId(offlineSnapshot.session.id)) {
    return (
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
    );
  }

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto lg:overflow-hidden p-2.5 sm:p-4 lg:p-5">
      <div className="grid h-full min-h-0 w-full gap-4 sm:gap-5 lg:grid-cols-12 lg:gap-5">
        {/* Main Hero Focus Cockpit */}
        <FocusHeroDial
          selectedSubject={selectedSubject}
          summary={launcherSummary}
          durationPreset={durationPreset}
          onPresetChange={setDurationPreset}
          tasks={contextOptions.tasks}
        />

        {/* Action & Configuration Panel */}
        <aside className="flex h-full min-h-0 flex-col justify-between rounded-2xl border border-white/10 bg-[var(--af-surface-subtle)] p-4 sm:p-5 lg:p-6 lg:col-span-5 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 focus-scrollbar">
            <div>
              <div className="flex items-center gap-2 text-teal-300">
                <BookOpen className="size-4 sm:size-5" aria-hidden="true" />
                <span className="text-[11px] sm:text-xs font-medium uppercase tracking-wider">Focus Setup</span>
              </div>
              <h1 className="mt-2 text-xl sm:text-2xl font-semibold text-white">今天先学什么？</h1>
              <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
                科目是开始学习的唯一必选项。具体学了什么，结束后再按实际情况沉淀。
              </p>
              {commandMode === "now" ? (
                <p className="mt-2 rounded-md bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 text-xs text-teal-200">
                  已识别“立即开始”命令{commandText ? `：${commandText}` : ""}，选定科目后即刻启动计时。
                </p>
              ) : null}
            </div>

            {/* Quick Subject Tiles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="focus-subject-select" className="text-xs sm:text-sm font-medium text-zinc-300">
                  选择科目 <span className="text-[11px] sm:text-xs text-zinc-500">(按数字键 1-{Math.min(subjects.length, 9)} 快捷选择)</span>
                </label>
              </div>

              <SubjectTileGrid
                subjects={subjects}
                subjectId={subjectId}
                onSelect={(id) => {
                  setSubjectId(id);
                  setError(null);
                }}
                tasks={contextOptions.tasks}
              />

              {/* Accessible Hidden/Native Select fallback */}
              <select
                id="focus-subject-select"
                ref={subjectRef}
                value={subjectId}
                onChange={(event) => {
                  setSubjectId(event.target.value);
                  setError(null);
                }}
                className="sr-only"
                disabled={!subjects.length}
                aria-label="科目"
              >
                <option value="">选择科目</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Contextual Tasks Reference Peek (Optional) */}
            {selectedSubject && relatedSubjectTasks.length > 0 ? (
              <div className="rounded-xl border border-white/10 bg-[var(--af-surface)] p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <ListTodo className="size-3.5 text-teal-300" aria-hidden="true" />
                  <span>今日待办参考 ({relatedSubjectTasks.length})</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {relatedSubjectTasks.slice(0, 3).map((task) => (
                    <li key={task.id} className="flex items-center justify-between text-xs text-zinc-400">
                      <span className="truncate pr-2">• {task.title}</span>
                      {task.estimatedMinutes ? (
                        <span className="shrink-0 text-zinc-500">{task.estimatedMinutes}m</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!subjects.length ? (
              <Alert tone="warning" title="还没有可用科目">
                先到设置 → 考试与科目添加至少一个科目。
              </Alert>
            ) : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </div>

          <div className="shrink-0 pt-3 space-y-2 border-t border-white/5">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className={`w-full h-11 sm:h-12 text-sm sm:text-base font-medium transition-all duration-200 ${
                selectedSubject
                  ? "hover:scale-[1.01] active:scale-[0.98] shadow-[0_0_24px_rgba(45,212,191,0.25)] hover:shadow-[0_0_36px_rgba(45,212,191,0.45)] ring-1 ring-teal-400/40"
                  : "shadow-[0_0_16px_rgba(45,212,191,0.1)]"
              }`}
              onClick={start}
              loading={isPending}
              disabled={!subjects.length || !subjectId}
            >
              <Play className="size-4 fill-current transition-transform group-hover:scale-110" aria-hidden="true" />
              {selectedSubject ? `开始【${selectedSubject.name}】专注` : "开始学习"}
            </Button>
            <p className="text-center text-[11px] sm:text-xs leading-normal text-zinc-500">
              多标签页与设备自动单实例互斥 · 离开页面计时后台继续
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
