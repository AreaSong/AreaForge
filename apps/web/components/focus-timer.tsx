"use client";

import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getTimerElapsedSeconds, type TimerStatus } from "@areaforge/core";

interface FocusTimerProps {
  subject: string;
  taskTitle: string;
  syllabusNode: string;
}

export function FocusTimer({ subject, taskTitle, syllabusNode }: FocusTimerProps) {
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [startedAt, setStartedAt] = useState<Date | undefined>();
  const [pausedAt, setPausedAt] = useState<Date | undefined>();
  const [endedAt, setEndedAt] = useState<Date | undefined>();
  const [accumulatedPauseSeconds, setAccumulatedPauseSeconds] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const elapsedSeconds = useMemo(
    () =>
      getTimerElapsedSeconds({
        status,
        startedAt,
        pausedAt,
        endedAt,
        accumulatedPauseSeconds,
        now,
      }),
    [accumulatedPauseSeconds, endedAt, now, pausedAt, startedAt, status],
  );

  const isFocused = status === "running" || status === "paused";

  function start() {
    const next = new Date();
    setStartedAt(next);
    setPausedAt(undefined);
    setEndedAt(undefined);
    setAccumulatedPauseSeconds(0);
    setNow(next);
    setStatus("running");
  }

  function pause() {
    setPausedAt(new Date());
    setStatus("paused");
  }

  function resume() {
    if (pausedAt) {
      setAccumulatedPauseSeconds((value) => value + Math.floor((Date.now() - pausedAt.getTime()) / 1000));
    }
    setPausedAt(undefined);
    setNow(new Date());
    setStatus("running");
  }

  function end() {
    setEndedAt(new Date());
    setPausedAt(undefined);
    setStatus("completed");
  }

  function reset() {
    setStartedAt(undefined);
    setPausedAt(undefined);
    setEndedAt(undefined);
    setAccumulatedPauseSeconds(0);
    setNow(new Date());
    setStatus("idle");
  }

  return (
    <section
      className={`rounded-lg border bg-[#101419] p-5 transition-all duration-300 ${
        isFocused ? "border-teal-300/50 shadow-[0_0_0_1px_rgba(45,212,191,0.28)] lg:col-span-1" : "border-white/10"
      }`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-teal-300">{subject}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{taskTitle}</h2>
          <p className="mt-2 text-sm text-zinc-400">{syllabusNode}</p>
        </div>
        <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
          {labelStatus(status)}
        </span>
      </div>

      <div className={`mt-7 grid gap-5 ${isFocused ? "lg:grid-cols-[1fr_0.6fr]" : ""}`}>
        <div className="rounded-lg border border-white/10 bg-[#151a20] p-5">
          <p className="text-sm text-zinc-500">本次专注</p>
          <p className={`${isFocused ? "text-6xl" : "text-5xl"} mt-3 font-semibold tabular-nums text-white`}>
            {formatElapsed(elapsedSeconds)}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {status === "idle" || status === "completed" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] transition hover:bg-teal-300"
                type="button"
                onClick={start}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                开始
              </button>
            ) : null}
            {status === "running" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md border border-white/10 px-4 font-medium text-zinc-100 transition hover:bg-white/10"
                type="button"
                onClick={pause}
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                暂停
              </button>
            ) : null}
            {status === "paused" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] transition hover:bg-teal-300"
                type="button"
                onClick={resume}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                继续
              </button>
            ) : null}
            {status === "running" || status === "paused" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md border border-red-300/30 px-4 font-medium text-red-100 transition hover:bg-red-400/10"
                type="button"
                onClick={end}
              >
                <Square className="h-4 w-4" aria-hidden="true" />
                结束
              </button>
            ) : null}
            {status === "completed" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md border border-white/10 px-4 font-medium text-zinc-100 transition hover:bg-white/10"
                type="button"
                onClick={reset}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                重置
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151a20] p-5">
          <p className="text-sm text-zinc-500">结束后收口</p>
          <div className="mt-4 grid gap-3 text-sm text-zinc-300">
            <p>质量评分：未填写</p>
            <p>理解程度：未标记</p>
            <p>最小产出：未提交</p>
            <p>关联进度：线性表 / 链表基本操作</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function labelStatus(status: TimerStatus): string {
  switch (status) {
    case "idle":
      return "未开始";
    case "running":
      return "专注中";
    case "paused":
      return "已暂停";
    case "ending":
      return "收口中";
    case "completed":
      return "待复盘";
  }
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, "0")).join(":");
}

