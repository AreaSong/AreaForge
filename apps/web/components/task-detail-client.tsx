"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TaskDependencyDto } from "@/lib/study/task-dependency-service";
import type { StudyTaskDto } from "@/lib/study/types";

export function TaskDetailClient(props: { task: StudyTaskDto; dependencies: TaskDependencyDto[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function startTask() {
    setError(null);
    const response = await fetch("/api/study-sessions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: props.task.id,
        subjectId: props.task.subjectId,
        startSource: "TASK",
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { session?: { id: string }; error?: string; latest?: { id?: string } }
      | null;
    if (!response.ok) {
      if (response.status === 409 && body?.latest?.id) {
        router.push(`/focus/${body.latest.id}`);
        return;
      }
      setError(body?.error ?? "无法开始");
      return;
    }
    if (body?.session?.id) router.push(`/focus/${body.session.id}`);
  }

  return (
    <section className="space-y-4">
      <Link href="/today/plan" className="text-sm text-zinc-400 hover:text-zinc-200">
        返回计划
      </Link>
      <h1 className="text-3xl font-semibold text-white">{props.task.title}</h1>
      <p className="text-sm text-zinc-400">
        {props.task.subjectName} · {props.task.status} · 预计 {props.task.estimatedMinutes} 分钟
      </p>
      {props.task.syllabusNodeTitle ? <p className="text-sm text-zinc-500">考纲：{props.task.syllabusNodeTitle}</p> : null}

      {props.dependencies.length > 0 ? (
        <div className="rounded-md border border-white/10 p-3 text-sm">
          <p className="text-zinc-300">依赖</p>
          <ul className="mt-2 space-y-1 text-zinc-500">
            {props.dependencies.map((dep) => (
              <li key={dep.id}>
                {dep.type} · {dep.predecessorId} → {dep.successorId}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <button
        type="button"
        className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black"
        onClick={() => void startTask()}
      >
        开始或继续任务
      </button>
    </section>
  );
}
