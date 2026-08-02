"use client";

import { BookOpen, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { FocusSessionClient } from "@/components/focus-session-client";
import {
  FOCUS_OFFLINE_SYNC_EVENT,
  createLocalFocusSession,
  enqueueFocusCommand,
  isLocalFocusSessionId,
  readFocusOfflineSnapshot,
  removeFocusCommand,
  saveFocusOfflineSnapshot,
  syncFocusOfflineQueue,
  type FocusOfflineSnapshot,
} from "@/lib/client/focus-offline-store";
import type { StudySessionDto, SubjectDto } from "@/lib/study/types";

export function FocusLauncher({ subjects, userId }: { subjects: SubjectDto[]; userId: string }) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [offlineSnapshot, setOfflineSnapshot] = useState<FocusOfflineSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const snapshot = await readFocusOfflineSnapshot(userId);
      if (!cancelled && snapshot && (snapshot.session.status === "running" || snapshot.session.status === "paused" || isLocalFocusSessionId(snapshot.session.id))) {
        if (!isLocalFocusSessionId(snapshot.session.id) && snapshot.session.status !== "completed") {
          router.replace(`/focus/${snapshot.session.id}`);
          return;
        }
        setOfflineSnapshot(snapshot);
      }
      void syncFocusOfflineQueue(userId);
    };
    void load();
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; session?: StudySessionDto | null }>).detail;
      if (detail?.userId !== userId || !detail.session) return;
      if (isLocalFocusSessionId(detail.session.id)) {
        setOfflineSnapshot((current) => current ? { ...current, session: detail.session! } : current);
      } else if (detail.session.status === "running" || detail.session.status === "paused") {
        router.replace(`/focus/${detail.session.id}`);
      } else {
        setOfflineSnapshot(null);
      }
    };
    window.addEventListener(FOCUS_OFFLINE_SYNC_EVENT, onSync);
    return () => {
      cancelled = true;
      window.removeEventListener(FOCUS_OFFLINE_SYNC_EVENT, onSync);
    };
  }, [router, userId]);

  if (offlineSnapshot && isLocalFocusSessionId(offlineSnapshot.session.id)) {
    return (
      <FocusSessionClient
        userId={userId}
        session={offlineSnapshot.session}
        activeConflictId={null}
        returnTo="/focus"
        initialNow={new Date().toISOString()}
        initialEvidenceReceipts={[]}
        offlineOnly
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
      const localSession = createLocalFocusSession({
        userId,
        subjectId: subject.id,
        subjectName: subject.name,
      });
      const queuedStart = await enqueueFocusCommand({
        userId,
        localSessionId: localSession.id,
        action: "start",
        body: { subjectId, startSource: "SUBJECT_SHORTCUT" },
      });
      try {
        const response = await fetch("/api/study-sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId, startSource: "SUBJECT_SHORTCUT" }),
        });
        const body = await response.json().catch(() => null) as { session?: StudySessionDto; latest?: StudySessionDto; error?: string } | null;
        if (!response.ok) {
          const active = body?.latest;
          if (response.status === 409 && active?.id) {
            await removeFocusCommand(queuedStart.id);
            router.replace(`/focus/${active.id}`);
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
          setOfflineSnapshot(null);
          router.replace(`/focus/${body.session.id}`);
          return;
        }
        throw new TypeError("开始响应缺少活动");
      } catch (requestError) {
        if (!(requestError instanceof TypeError) && (typeof navigator === "undefined" || navigator.onLine)) {
          setError("无法开始学习，请稍后重试。");
          return;
        }
        await saveFocusOfflineSnapshot(userId, localSession, typeof navigator !== "undefined" && navigator.onLine ? "pending" : "offline", 1);
        setOfflineSnapshot({ userId, session: localSession, savedAt: new Date().toISOString(), syncState: "offline", pendingCount: 1 });
      }
    });
  }

  return (
    <main className="min-h-[calc(100vh-8rem)] w-full">
      <div className="grid min-h-[calc(100vh-8rem)] lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.5fr)]">
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
            <div><BookOpen className="size-6 text-teal-300" aria-hidden="true" /><h1 className="mt-4 text-2xl font-semibold text-white">今天先学什么？</h1><p className="mt-2 text-sm leading-6 text-zinc-400">科目是开始学习的唯一必选项，任务和考纲可以在学习过程中或收口时再补。</p></div>
            <label className="grid gap-2 text-sm text-zinc-300">科目<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="h-12 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100" disabled={!subjects.length}><option value="">选择科目</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
            {!subjects.length ? <Alert tone="warning" title="还没有可用科目">先到设置 → 工作区添加至少一个科目。</Alert> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Button type="button" variant="primary" size="lg" className="w-full" onClick={start} loading={isPending} disabled={!subjects.length}><Play size={17} aria-hidden />开始学习</Button>
            <p className="text-xs leading-5 text-zinc-600">同一用户无论打开多少个计时器页，都会回到当前唯一的活动计时。</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
