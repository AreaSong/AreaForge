"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { PlanRollingDto } from "@/lib/study/plan-rolling-service";

export function PlanRollingClient(props: {
  initial: PlanRollingDto;
  subjects: Array<{ id: string; name: string }>;
  createMinimum: boolean;
  query: { date?: string; subjectId?: string; status?: string; q?: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(props.createMinimum ? "今天最小任务" : "");
  const [subjectId, setSubjectId] = useState(props.subjects[0]?.id ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(props.createMinimum ? 25 : 45);
  const selectedDate = props.query.date ?? props.initial.days[0]?.date;

  const selectedDayTasks = useMemo(() => {
    return props.initial.days.find((day) => day.date === selectedDate)?.tasks ?? props.initial.tasks;
  }, [props.initial.days, props.initial.tasks, selectedDate]);

  function pushQuery(next: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { ...props.query, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    startTransition(() => router.push(`/today/plan?${params.toString()}`));
  }

  async function createTask() {
    setError(null);
    if (!subjectId || !title.trim()) {
      setError("科目和标题必填");
      return;
    }
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        title: title.trim(),
        estimatedMinutes,
        type: "study",
        priority: "high",
        plannedDate: selectedDate ? new Date(`${selectedDate}T08:00:00+08:00`).toISOString() : undefined,
      }),
    });
    const body = (await response.json().catch(() => null)) as { task?: { id: string }; error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "创建失败");
      return;
    }
    setTitle("");
    startTransition(() => router.refresh());
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">计划</h1>
          <p className="mt-1 text-sm text-zinc-400">正式任务、欠账与带日期 Inbox 数量入口</p>
        </div>
        <Link href={props.initial.inboxEntryPath} className="text-sm text-teal-300 hover:underline">
          带日期收件箱 {props.initial.datedInboxCount}
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="日期条">
        {props.initial.days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={`shrink-0 rounded-md border px-3 py-2 text-xs ${selectedDate === day.date ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-400"}`}
            onClick={() => pushQuery({ date: day.date })}
          >
            {day.date.slice(5)} · {day.tasks.length}
          </button>
        ))}
      </div>

      <div className="hidden gap-3 overflow-x-auto lg:flex" aria-label="七天列">
        {props.initial.days.map((day) => (
          <div key={day.date} className="min-w-[12rem] flex-1 rounded-md border border-white/10 bg-[#101419] p-3">
            <p className="text-xs text-zinc-500">{day.date}</p>
            <ul className="mt-2 space-y-2">
              {day.tasks.map((task) => (
                <li key={task.id}>
                  <Link href={`/today/tasks/${task.id}`} className="text-sm text-white hover:text-teal-300">
                    {task.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-white/10 bg-[#101419] p-4 lg:hidden">
        <h2 className="text-sm font-medium text-zinc-200">当日任务</h2>
        <ul className="mt-2 space-y-2">
          {selectedDayTasks.map((task) => (
            <li key={task.id}>
              <Link href={`/today/tasks/${task.id}`} className="text-sm text-white hover:text-teal-300">
                {task.title}
              </Link>
              <p className="text-xs text-zinc-500">{task.subjectName}</p>
            </li>
          ))}
        </ul>
      </div>

      {props.initial.debt.length > 0 ? (
        <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-4">
          <h2 className="text-sm font-medium text-amber-100">欠账</h2>
          <ul className="mt-2 space-y-2">
            {props.initial.debt.map((task) => (
              <li key={task.id}>
                <Link href={`/today/tasks/${task.id}`} className="text-sm text-white hover:text-teal-300">
                  {task.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-white/10 bg-[#101419] p-4">
        <h2 className="text-sm font-medium text-white">新建任务</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-zinc-400">标题</span>
            <input
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">科目</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              {props.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">预计分钟</span>
            <input
              type="number"
              min={5}
              max={720}
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(Number(event.target.value) || 25)}
            />
          </label>
        </div>
        {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
        <button
          type="button"
          disabled={pending}
          className="mt-3 h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-60"
          onClick={() => void createTask()}
        >
          新建任务
        </button>
      </div>
    </section>
  );
}
