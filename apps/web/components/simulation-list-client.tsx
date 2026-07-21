"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SimulationListClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("阶段模拟");
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  async function createExam(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/simulation/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, examDate: new Date(`${examDate}T08:00:00+08:00`).toISOString() }),
    });
    const body = (await response.json().catch(() => null)) as { exam?: { id: string }; error?: string } | null;
    if (!response.ok || !body?.exam) {
      setError(body?.error ?? "创建模拟失败");
      return;
    }
    startTransition(() => router.push(`/stage/simulation/${body.exam!.id}`));
  }

  return (
    <form onSubmit={createExam} className="rounded-md border border-white/10 bg-[#101419] p-4">
      <h2 className="text-sm font-medium text-white">创建模拟</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <label className="text-sm text-zinc-400">名称
          <input className="mt-1 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="text-sm text-zinc-400">日期
          <input type="date" className="mt-1 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
        </label>
        <button disabled={pending} className="self-end h-11 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-60">创建考试</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
    </form>
  );
}
