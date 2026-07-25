"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { StagePlanDto } from "@/lib/study/types";

const today = new Date();
const defaultEndDate = new Date(today);
defaultEndDate.setDate(defaultEndDate.getDate() + 90);

export function StagePlanCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("当前备考阶段");
  const [goal, setGoal] = useState("完成当前阶段核心目标");
  const [startDate, setStartDate] = useState(toDateInput(today));
  const [endDate, setEndDate] = useState(toDateInput(defaultEndDate));
  const [mode, setMode] = useState<StagePlanDto["mode"]>("maintain");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/stage-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          goal,
          startDate: toIsoDate(startDate),
          endDate: toIsoDate(endDate),
          mode,
          status: "active",
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(labelStagePlanError(body?.error));
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-zinc-300">
          阶段名称
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100" maxLength={160} onChange={(event) => setName(event.target.value)} required value={name}/>
        </label>
        <label className="grid gap-1 text-sm text-zinc-300">
          阶段模式
          <select className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100" onChange={(event) => setMode(event.target.value as StagePlanDto["mode"])} value={mode}>
            <option value="maintain">维持</option>
            <option value="recovery">恢复</option>
            <option value="strengthen">强化</option>
            <option value="sprint">冲刺</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-zinc-300">
          开始日期
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100" onChange={(event) => setStartDate(event.target.value)} required type="date" value={startDate}/>
        </label>
        <label className="grid gap-1 text-sm text-zinc-300">
          结束日期
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100" min={startDate} onChange={(event) => setEndDate(event.target.value)} required type="date" value={endDate}/>
        </label>
      </div>
      <label className="grid gap-1 text-sm text-zinc-300">
        阶段目标
        <textarea className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-zinc-100" maxLength={2000} onChange={(event) => setGoal(event.target.value)} required value={goal}/>
      </label>
      <button className="h-11 w-fit rounded-md bg-teal-400 px-4 text-sm font-medium text-[#071011] disabled:opacity-60" disabled={pending || saving} type="submit">
        {saving ? "创建中..." : "创建阶段计划"}
      </button>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </form>
  );
}

function toDateInput(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

function toIsoDate(value: string): string {
  return new Date(`${value}T00:00:00+08:00`).toISOString();
}

function labelStagePlanError(error?: string): string {
  if (error === "STAGE_PLAN_DATE_RANGE_INVALID") return "结束日期不能早于开始日期。";
  return error ?? "创建阶段计划失败。";
}
