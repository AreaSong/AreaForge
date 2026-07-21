"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getTimerElapsedSeconds, type TimerStatus } from "@areaforge/core";
import type { StudySessionDto } from "@/lib/study/types";

const DRAFT_PREFIX = "areaforge.focus.closeout.";

function readFocusDraft(sessionId: string) {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(`${DRAFT_PREFIX}${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      qualityScore?: string;
      isEffective?: string;
      understandingLevel?: string;
      minimalOutput?: string;
      nextAction?: string;
      note?: string;
      completeTask?: boolean;
    };
  } catch {
    return null;
  }
}

export function FocusSessionClient(props: {
  session: StudySessionDto;
  activeConflictId: string | null;
  returnTo: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState(props.session);
  const [now, setNow] = useState(() => new Date());
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowConversionStep, setLowConversionStep] = useState(false);
  const [evidenceStep, setEvidenceStep] = useState(false);
  const [draft, setDraft] = useState(() => {
    const saved = readFocusDraft(props.session.id);
    return {
      qualityScore: saved?.qualityScore ?? "3",
      isEffective: saved?.isEffective ?? "true",
      understandingLevel: saved?.understandingLevel ?? "基本理解",
      minimalOutput: saved?.minimalOutput ?? "",
      nextAction: saved?.nextAction ?? "继续推进",
      note: saved?.note ?? "",
      completeTask: saved?.completeTask ?? false,
    };
  });

  useEffect(() => {
    window.sessionStorage.setItem(`${DRAFT_PREFIX}${session.id}`, JSON.stringify(draft));
  }, [draft, session.id]);

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

  async function mutate(path: string, body?: unknown) {
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => null)) as { session?: StudySessionDto; error?: string } | null;
    if (!response.ok) throw new Error(data?.error ?? "请求失败");
    if (data?.session) setSession(data.session);
    return data?.session ?? null;
  }

  async function pause() {
    try {
      await mutate(`/api/study-sessions/${session.id}/pause`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "暂停失败");
    }
  }

  async function resume() {
    try {
      await mutate(`/api/study-sessions/${session.id}/resume`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "继续失败");
    }
  }

  async function end() {
    try {
      const completed = await mutate(`/api/study-sessions/${session.id}/end`, {
        qualityScore: Number(draft.qualityScore),
        isEffective: draft.isEffective === "true",
        understandingLevel: draft.understandingLevel,
        minimalOutput: draft.minimalOutput || "本次最小产出",
        nextAction: draft.nextAction,
        producedNote: false,
        producedMistake: false,
        note: draft.note,
        completeTask: draft.completeTask,
      });
      window.sessionStorage.removeItem(`${DRAFT_PREFIX}${session.id}`);
      setEnding(false);
      if (completed?.isLowConversion) {
        setLowConversionStep(true);
        return;
      }
      setEvidenceStep(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "结束失败");
    }
  }

  function finishReplace() {
    router.replace(props.returnTo);
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
    <section className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <Link href={props.returnTo} className="text-sm text-zinc-400 hover:text-zinc-200">
          离开视图（不结束活动）
        </Link>
        <span className="text-xs text-zinc-500">{session.status}</span>
      </div>

      <div>
        <p className="text-sm text-teal-300">{session.subjectName}</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">{session.taskTitle ?? "科目快捷专注"}</h1>
        {session.syllabusNodeTitle ? <p className="mt-2 text-sm text-zinc-400">{session.syllabusNodeTitle}</p> : null}
      </div>

      <div className="rounded-lg border border-teal-300/30 bg-[#101419] p-6">
        <p className="text-sm text-zinc-500">正计时</p>
        <p className="mt-3 text-6xl font-semibold tabular-nums text-white">{formatElapsed(elapsedSeconds)}</p>
        {session.goalMinutes ? (
          <p className={`mt-2 text-sm ${goalReached ? "text-amber-200" : "text-zinc-500"}`}>
            目标 {session.goalMinutes} 分钟{goalReached ? " · 已到点提醒（不自动结束）" : ""}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {session.status === "running" ? (
            <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm" onClick={() => void pause()}>
              暂停
            </button>
          ) : null}
          {session.status === "paused" ? (
            <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm" onClick={() => void resume()}>
              继续
            </button>
          ) : null}
          {session.status === "running" || session.status === "paused" ? (
            <button type="button" className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black" onClick={() => setEnding(true)}>
              结束并收口
            </button>
          ) : null}
        </div>
      </div>

      {ending ? (
        <form
          className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void end();
          }}
        >
          <h2 className="text-lg font-medium text-white">收口确认</h2>
          <label className="block text-sm">
            达成感（1-5）
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={draft.qualityScore} onChange={(e) => setDraft({ ...draft, qualityScore: e.target.value })} />
          </label>
          <label className="block text-sm">
            理解程度
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={draft.understandingLevel} onChange={(e) => setDraft({ ...draft, understandingLevel: e.target.value })} />
          </label>
          <label className="block text-sm">
            最小产出
            <textarea className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] px-2 py-2" value={draft.minimalOutput} onChange={(e) => setDraft({ ...draft, minimalOutput: e.target.value })} />
          </label>
          <label className="block text-sm">
            下一动作
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={draft.nextAction} onChange={(e) => setDraft({ ...draft, nextAction: e.target.value })} />
          </label>
          {session.taskId ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.completeTask} onChange={(e) => setDraft({ ...draft, completeTask: e.target.checked })} />
              同时完成任务
            </label>
          ) : null}
          <button type="submit" className="h-11 w-full rounded-md bg-teal-500/90 text-sm font-medium text-black">
            保存收口
          </button>
        </form>
      ) : null}

      {lowConversionStep ? (
        <div className="space-y-3 rounded-md border border-amber-400/30 bg-amber-500/10 p-4">
          <h2 className="font-medium text-amber-100">低转化：先已保存 session</h2>
          <p className="text-sm text-amber-50/80">{session.antiFakeReason ?? "有效性判定需要补产出。"}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-10 rounded-md bg-teal-500/90 px-3 text-sm text-black" onClick={() => setEvidenceStep(true)}>
              立即补产出
            </button>
            <Link href="/today/inbox" className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10">
              加入收件箱
            </Link>
            <button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm" onClick={() => setEvidenceStep(true)}>
              跳过
            </button>
          </div>
        </div>
      ) : null}

      {evidenceStep ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="font-medium text-white">证据接力（可跳过）</h2>
          <p className="text-sm text-zinc-400">本批仅提供入口提示；笔记/错题/复测完整页属后续批次。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm" onClick={finishReplace}>
              跳过并返回
            </button>
            <button type="button" className="h-10 rounded-md bg-teal-500/90 px-3 text-sm text-black" onClick={finishReplace}>
              完成
            </button>
          </div>
        </div>
      ) : null}

      {session.status === "completed" && !lowConversionStep && !evidenceStep ? (
        <button type="button" className="h-11 rounded-md bg-teal-500/90 text-sm font-medium text-black" onClick={finishReplace}>
          返回来源
        </button>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
