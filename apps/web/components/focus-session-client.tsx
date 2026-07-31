"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTimerElapsedSeconds, type TimerStatus } from "@areaforge/core";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { StudySessionDto } from "@/lib/study/types";

const DRAFT_PREFIX = "areaforge.focus.closeout.";
const DRAFT_VERSION = 2;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface FocusCloseoutDraft {
  qualityScore: string;
  isEffective: string;
  understandingLevel: string;
  minimalOutput: string;
  nextAction: string;
  note: string;
  completeTask: boolean;
}

function focusDraftKey(userId: string, sessionId: string) {
  return `${DRAFT_PREFIX}v2.${userId}.${sessionId}`;
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
      understandingLevel?: string;
      minimalOutput?: string;
      nextAction?: string;
      note?: string;
      completeTask?: boolean;
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
    completeTask: false,
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
    completeTask: saved?.completeTask ?? fallback.completeTask,
  };
}

export function FocusSessionClient(props: {
  userId: string;
  session: StudySessionDto;
  activeConflictId: string | null;
  returnTo: string;
  initialNow: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState(props.session);
  const [now, setNow] = useState(() => new Date(props.initialNow));
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    latest?: StudySessionDto;
    conflictFields: string[];
    action: "pause" | "resume" | "end";
  } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const commandKeys = useRef<Record<string, string>>({});
  const [lowConversionStep, setLowConversionStep] = useState(
    props.session.status === "completed" && props.session.isLowConversion === true,
  );
  const [evidenceStep, setEvidenceStep] = useState(false);
  const [lowConversionAdded, setLowConversionAdded] = useState(false);
  const [draft, setDraft] = useState<FocusCloseoutDraft>(defaultFocusCloseoutDraft);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDraft(mergeFocusCloseoutDraft(readFocusDraft(props.userId, props.session.id)));
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.session.id, props.userId]);

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
  const goalStatus = session.status === "completed"
    ? goalReached ? " · 已达目标" : " · 未达目标"
    : goalReached ? " · 已到点提醒（不自动结束）" : "";
  const closeoutOutcome = draft.isEffective === "false"
    ? "not-achieved"
    : Number(draft.qualityScore) >= 4 ? "achieved" : "partial";

  async function mutate(path: string, body: unknown, action: "pause" | "resume" | "end") {
    if (conflict) throw new Error("请先处理活动状态冲突，再提交新的状态命令。");
    setError(null);
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
        setConflict({ latest: data?.latest, conflictFields: data?.conflictFields ?? ["status", "updatedAt"], action });
        setConflictOpen(true);
        throw new Error("活动状态已变化，草稿与命令键已保留。请先比较差异并人工选择新基线。");
      }
      throw new Error(data?.error ?? "请求失败");
    }
    if (data?.session) setSession(data.session);
    return data?.session ?? null;
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
      setError(requestErrorMessage(err, "暂停失败"));
    }
  }

  async function resume() {
    try {
      await mutate(`/api/study-sessions/${session.id}/resume`, commandInput("resume"), "resume");
      delete commandKeys.current.resume;
    } catch (err) {
      setError(requestErrorMessage(err, "继续失败"));
    }
  }

  async function end() {
    try {
      const completed = await mutate(`/api/study-sessions/${session.id}/end`, {
        ...commandInput("end"),
        qualityScore: Number(draft.qualityScore),
        isEffective: draft.isEffective === "true",
        understandingLevel: draft.understandingLevel,
        minimalOutput: draft.minimalOutput || "本次最小产出",
        nextAction: draft.nextAction,
        producedNote: false,
        producedMistake: false,
        note: draft.note,
        completeTask: draft.completeTask,
      }, "end");
      delete commandKeys.current.end;
      window.localStorage.removeItem(focusDraftKey(props.userId, session.id));
      setEnding(false);
      if (completed?.isLowConversion) {
        setLowConversionStep(true);
        return;
      }
      setEvidenceStep(true);
    } catch (err) {
      setError(requestErrorMessage(err, "结束失败"));
    }
  }

  function finishReplace() {
    router.replace(props.returnTo);
  }

  function adoptLatestSession() {
    if (!conflict?.latest) {
      setConflictOpen(false);
      router.refresh();
      return;
    }
    setSession(conflict.latest);
    delete commandKeys.current[conflict.action];
    if (conflict.latest.status === "completed") setEnding(false);
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
      setError(requestErrorMessage(err, "加入收件箱失败"));
    }
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
        <span className="text-xs text-zinc-500" aria-live="assertive" aria-atomic="true">
          {session.status === "paused" ? "已暂停" : session.status === "running" ? "进行中" : "已结束"}
        </span>
      </div>

      <div>
        <p className="text-sm text-teal-300">{session.subjectName}</p>
        <DetailHeading className="mt-2 text-3xl font-semibold text-white">{session.taskTitle ?? "科目快捷专注"}</DetailHeading>
        {session.syllabusNodeTitle ? <p className="mt-2 text-sm text-zinc-400">{session.syllabusNodeTitle}</p> : null}
      </div>

      <div className="rounded-lg border border-teal-300/30 bg-[#101419] p-6">
        <p className="text-sm text-zinc-500">{timerLabel}</p>
        <p className="mt-3 text-6xl font-semibold tabular-nums text-white">{formatElapsed(elapsedSeconds)}</p>
        {session.goalMinutes ? (
          <p className={`mt-2 text-sm ${goalReached ? "text-amber-200" : "text-zinc-500"}`}>
            目标 {session.goalMinutes} 分钟{goalStatus}
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
            收口结果
            <select
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={closeoutOutcome}
              onChange={(event) => {
                const outcome = event.target.value;
                setDraft({
                  ...draft,
                  isEffective: outcome === "not-achieved" ? "false" : "true",
                  qualityScore: outcome === "achieved" ? "4" : outcome === "partial" ? "3" : "1",
                });
              }}
            >
              <option value="achieved">达成</option>
              <option value="partial">部分达成</option>
              <option value="not-achieved">未达成</option>
            </select>
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
            {lowConversionAdded ? <Link href="/today/inbox" className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10 text-teal-300">查看收件箱</Link> : <button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm" onClick={() => void addLowConversionToInbox()}>加入收件箱</button>}
            <button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm" onClick={() => setEvidenceStep(true)}>
              跳过
            </button>
          </div>
        </div>
      ) : null}

      {evidenceStep ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="font-medium text-white">证据接力（可跳过）</h2>
          <p className="text-sm text-zinc-400">进入同一套知识表单，当前科目、任务和主考纲节点会随入口预填。</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/knowledge/notes?subjectId=${encodeURIComponent(session.subjectId)}${session.syllabusNodeId ? `&syllabusNodeId=${encodeURIComponent(session.syllabusNodeId)}` : ""}${session.taskId ? `&taskId=${encodeURIComponent(session.taskId)}` : ""}`} className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10 text-teal-300">新增知识卡片</Link>
            <Link href={`/knowledge/mistakes?subjectId=${encodeURIComponent(session.subjectId)}${session.syllabusNodeId ? `&syllabusNodeId=${encodeURIComponent(session.syllabusNodeId)}` : ""}`} className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10 text-teal-300">新增错题</Link>
            {session.syllabusNodeId ? <Link href={`/knowledge/syllabus/${session.syllabusNodeId}`} className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10 text-teal-300">记录复测</Link> : null}
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

      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
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

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function requestErrorMessage(error: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "网络不可用，草稿与当前状态已保留。恢复网络后请显式重试。";
  }
  if (error instanceof TypeError) {
    return "请求未送达，草稿与当前状态已保留。请检查网络后显式重试。";
  }
  return error instanceof Error ? error.message : fallback;
}
