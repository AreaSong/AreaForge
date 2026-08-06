"use client";

import { Pause, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { publishActivityStatus } from "@/lib/client/activity-status";
import type { StudySessionDto } from "@/lib/study/types";

type ActivityTheme = "review" | "test";

const themeClasses: Record<ActivityTheme, { accent: string; ring: string; button: "secondary" | "primary" }> = {
  review: { accent: "text-sky-200", ring: "border-sky-300/35 bg-sky-300/[0.04]", button: "secondary" },
  test: { accent: "text-amber-200", ring: "border-amber-300/35 bg-amber-300/[0.04]", button: "primary" },
};

export function StudyActivityTimer(props: {
  userId: string;
  sessionId: string | null;
  theme: ActivityTheme;
  label: string;
  onFinished: () => void;
  initialNow: string;
}) {
  const theme = themeClasses[props.theme];
  const [session, setSession] = useState<StudySessionDto | null>(null);
  const [now, setNow] = useState(() => parseInitialNow(props.initialNow));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.sessionId) {
      return;
    }
    let cancelled = false;
    void fetch("/api/study-sessions/active", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { session?: StudySessionDto | null } | null;
        if (cancelled) return;
        if (!response.ok) {
          setError("无法恢复当前活动，请刷新后重试。");
          return;
        }
        if (body?.session?.id === props.sessionId) {
          setSession(body.session);
          publishActivityStatus(props.userId, body.session);
          setError(null);
        } else if (body?.session) {
          publishActivityStatus(props.userId, body.session);
          setError("当前已有另一项活动。请先完成公共工具栏中的活动。");
        } else {
          publishActivityStatus(props.userId, null);
          setError("计时活动已结束，请继续填写结果。");
        }
      })
      .catch(() => {
        if (!cancelled) setError("网络不可用，无法恢复计时活动。");
      });
    return () => {
      cancelled = true;
    };
  }, [props.sessionId, props.userId]);

  useEffect(() => {
    if (!session || (session.status !== "running" && session.status !== "paused")) return;
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, [session]);

  const elapsedSeconds = useMemo(() => {
    if (!session) return 0;
    return getTimerElapsedSeconds({
      status: session.status === "running" ? "running" : "paused",
      startedAt: new Date(session.startedAt),
      pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
      accumulatedPauseSeconds: session.accumulatedPauseSeconds,
      now,
    });
  }, [now, session]);

  if (!props.sessionId) return null;

  async function command(action: "pause" | "resume" | "finish") {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "finish") {
        const prepared = await postSession("end", {
          mode: "prepare",
          expectedStatus: session.status,
          expectedUpdatedAt: session.updatedAt,
        });
        if (prepared) {
          setSession(prepared);
          props.onFinished();
        }
        return;
      }
      const next = await postSession(action === "pause" ? "pause" : "resume", {
        expectedStatus: session.status,
        expectedUpdatedAt: session.updatedAt,
      });
      if (next) setSession(next);
    } finally {
      setBusy(false);
    }
  }

  async function postSession(endpoint: string, payload: Record<string, unknown>): Promise<StudySessionDto | null> {
    const response = await fetch(`/api/study-sessions/${encodeURIComponent(props.sessionId!)}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, idempotencyKey: `activity-${props.sessionId}-${endpoint}-${crypto.randomUUID()}` }),
    });
    const body = await response.json().catch(() => null) as { session?: StudySessionDto; latest?: StudySessionDto; error?: string } | null;
    if (!response.ok || !body?.session) {
      if (body?.latest) setSession(body.latest);
      if (body?.latest) publishActivityStatus(props.userId, body.latest);
      setError(body?.error ?? "活动状态已变化，请刷新后重试。");
      return null;
    }
    publishActivityStatus(props.userId, body.session);
    return body.session;
  }

  return (
    <section className={`space-y-5 border p-5 sm:p-6 ${theme.ring}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-medium ${theme.accent}`}>{props.label}</p>
          <p className="mt-1 text-sm text-zinc-400">结束计时后填写结果和复盘，提交时才会完成本次活动。</p>
        </div>
        <span className={`font-mono text-xs ${session?.status === "paused" ? "text-amber-200" : theme.accent}`}>
          {session?.status === "paused" ? "已暂停" : "计时中"}
        </span>
      </div>
      <div className="text-center">
        <p className={`font-mono text-6xl font-semibold tabular-nums sm:text-7xl ${theme.accent}`}>
          {formatDuration(elapsedSeconds)}
        </p>
      </div>
      {error ? <Alert tone="warning">{error}</Alert> : null}
      {session?.status === "running" ? (
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" variant="secondary" onClick={() => void command("pause")} loading={busy}><Pause size={16} aria-hidden />暂停</Button>
          <Button type="button" variant={theme.button} onClick={() => void command("finish")} loading={busy}><Square size={16} aria-hidden />结束计时</Button>
        </div>
      ) : session?.status === "paused" ? (
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" variant={theme.button} onClick={() => void command("resume")} loading={busy}><Play size={16} aria-hidden />继续</Button>
          <Button type="button" variant="secondary" onClick={() => void command("finish")} loading={busy}><Square size={16} aria-hidden />结束计时</Button>
        </div>
      ) : null}
    </section>
  );
}

function parseInitialNow(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
