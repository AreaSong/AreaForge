"use client";

import { BookOpen, Play } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { FocusSessionClient } from "@/components/focus-session-client";
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
import type { StudySessionDto, StudyTaskDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";
import type { KnowledgePointDto } from "@/lib/study/knowledge-point-service";

export function FocusLauncher({ subjects, userId, returnTo, contextOptions, initialNow, commandMode, commandText }: { subjects: SubjectDto[]; userId: string; returnTo: string; initialNow: string; commandMode?: "now"; commandText?: string; contextOptions: { tasks: StudyTaskDto[]; syllabusNodes: SyllabusOptionNodeDto[]; knowledgePoints: KnowledgePointDto[] } }) {
  const subjectRef = useRef<HTMLSelectElement>(null);
  const [subjectId, setSubjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [offlineSnapshot, setOfflineSnapshot] = useState<FocusOfflineSnapshot | null>(null);
  const [inlineSession, setInlineSession] = useState<StudySessionDto | null>(null);
  const offlineSnapshotRef = useRef<FocusOfflineSnapshot | null>(null);

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

      // A server snapshot can outlive the real session after a completed
      // closeout. When online, the authoritative activity endpoint must win;
      // otherwise a stale closing snapshot traps the user on the old detail
      // page and prevents a fresh focus session from starting.
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
          // Keep the snapshot as a best-effort recovery path if the activity
          // endpoint is temporarily unavailable.
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
        // The session client owns local-to-server reconciliation. Remounting
        // it here could reset an in-progress closeout draft or conflict view.
        if (offlineSnapshotRef.current && isLocalFocusSessionId(offlineSnapshotRef.current.session.id)) return;
        offlineSnapshotRef.current = null;
        setOfflineSnapshot(null);
        setInlineSession(detail.session);
      } else {
        // Keep the mounted session client through server-side completion so it
        // can finish evidence handoff after a local session is remapped.
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

  function start() {
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
  }

  return (
    <div className="h-full min-h-0 w-full">
      <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.5fr)]">
        <section className="flex min-h-[34rem] flex-col items-center justify-center border-b border-white/10 px-5 py-12 text-center lg:border-b-0 lg:border-r">
          <p className="text-sm font-medium text-teal-300">开始学习</p>
          <div className="relative mt-8 grid size-64 place-items-center rounded-full border border-white/15 bg-[#101419] shadow-[0_0_0_12px_rgba(255,255,255,0.02)] sm:size-72">
            <span className="absolute inset-5 rounded-full border border-white/10" aria-hidden="true" />
            <span className="absolute bottom-1/2 left-1/2 h-[42%] w-px origin-bottom -translate-x-1/2 rotate-0 bg-teal-300" aria-hidden="true" />
            <span className="absolute bottom-1/2 left-1/2 size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-teal-300" aria-hidden="true" />
            <div className="relative z-10"><p className="font-mono text-5xl font-semibold tabular-nums text-white sm:text-6xl">00:00:00</p><p className="mt-3 text-sm text-zinc-500">选择科目后开始计时</p></div>
          </div>
          <p className="mt-8 max-w-lg text-sm leading-6 text-zinc-500">不预设目标时长，也不要求先绑定任务或考纲。先把注意力交给当前科目，学习结束后再用收口和复测判断掌握情况。</p>
        </section>
        <aside className="flex items-start px-5 py-10 sm:px-8 lg:items-center">
          <div className="w-full max-w-md space-y-6">
            <div><BookOpen className="size-6 text-teal-300" aria-hidden="true" /><h1 className="mt-4 text-2xl font-semibold text-white">今天先学什么？</h1><p className="mt-2 text-sm leading-6 text-zinc-400">科目是开始学习的唯一必选项。具体学了什么，结束后再按实际情况记录。</p>{commandMode === "now" ? <p className="mt-3 text-xs text-teal-200">已识别“立即开始”命令{commandText ? `：${commandText}` : ""}，选择科目后启动计时。</p> : null}</div>
            <label className="grid gap-2 text-sm text-zinc-300">科目<select ref={subjectRef} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="h-12 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100" disabled={!subjects.length}><option value="">选择科目</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
            {!subjects.length ? <Alert tone="warning" title="还没有可用科目">先到设置 → 考试与科目添加至少一个科目。</Alert> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Button type="button" variant="primary" size="lg" className="w-full" onClick={start} loading={isPending} disabled={!subjects.length || !subjectId}><Play size={17} aria-hidden />开始学习</Button>
            <p className="text-xs leading-5 text-zinc-600">同一用户无论打开多少个计时器页，都会回到当前唯一的活动计时。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
