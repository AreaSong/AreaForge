"use client";

import { Archive, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { PlanMilestoneDto } from "@/lib/study/plan-milestone-service";
import type { StagePlanDto } from "@/lib/study/types";

export function StageMilestoneManager({ plan, milestones, initialStableKey, returnTo }: {
  plan: StagePlanDto;
  milestones: PlanMilestoneDto[];
  initialStableKey?: string;
  returnTo?: string;
}) {
  const [rows, setRows] = useState(milestones);
  const [stableKey, setStableKey] = useState(initialStableKey ?? "");
  const [title, setTitle] = useState(initialStableKey ?? "");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/plan-milestones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stagePlanId: plan.id,
        stableKey: stableKey.trim(),
        title: title.trim(),
        targetDate: targetDate ? new Date(`${targetDate}T00:00:00+08:00`).toISOString() : null,
        sortOrder: rows.length,
      }),
    });
    const body = await response.json().catch(() => null) as { milestone?: PlanMilestoneDto; error?: string } | null;
    setSaving(false);
    if (!response.ok || !body?.milestone) {
      setError(labelMilestoneError(body?.error));
      return;
    }
    setRows((current) => [...current, body.milestone as PlanMilestoneDto]);
    setStableKey("");
    setTitle("");
    setTargetDate("");
  }

  async function toggleArchive(row: PlanMilestoneDto) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/plan-milestones/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: row.revision, archive: !row.archivedAt }),
    });
    const body = await response.json().catch(() => null) as { milestone?: PlanMilestoneDto; error?: string } | null;
    setSaving(false);
    if (!response.ok || !body?.milestone) {
      setError(labelMilestoneError(body?.error));
      return;
    }
    setRows((current) => current.map((item) => item.id === row.id ? body.milestone as PlanMilestoneDto : item));
  }

  return (
    <section className="space-y-4 rounded-md border border-white/10 bg-[#101419] p-4" aria-labelledby="stage-milestones-heading">
      <div>
        <h2 id="stage-milestones-heading" className="text-lg font-medium text-white">里程碑</h2>
        <p className="mt-1 text-sm text-zinc-500">计划草稿中的 milestoneKey 只能引用这里的当前里程碑；归档不会删除历史引用。</p>
      </div>
      <ul className="space-y-2">
        {rows.length ? rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 p-3 text-sm">
            <div>
              <p className={row.archivedAt ? "text-zinc-500 line-through" : "text-zinc-100"}>{row.title}</p>
              <p className="text-xs text-zinc-500">{row.stableKey}{row.targetDate ? ` · ${new Date(row.targetDate).toLocaleDateString("zh-CN")}` : ""}{row.archivedAt ? " · 已归档" : ""}</p>
            </div>
            <button type="button" disabled={saving} onClick={() => void toggleArchive(row)} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-xs text-zinc-200 disabled:opacity-50">
              {row.archivedAt ? <RotateCcw size={14} aria-hidden /> : <Archive size={14} aria-hidden />}{row.archivedAt ? "恢复" : "归档"}
            </button>
          </li>
        )) : <li className="text-sm text-zinc-500">当前阶段还没有里程碑。</li>}
      </ul>
      <form className="grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-3" onSubmit={create}>
        <label className="grid gap-1 text-sm text-zinc-300">稳定键<input className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-2" maxLength={80} required value={stableKey} onChange={(event) => setStableKey(event.target.value)} placeholder="例如 mock-01" /></label>
        <label className="grid gap-1 text-sm text-zinc-300">标题<input className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-2" maxLength={200} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="阶段里程碑" /></label>
        <label className="grid gap-1 text-sm text-zinc-300">目标日期<input className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-2" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" disabled={saving} className="h-10 rounded-md bg-teal-400 px-4 text-sm font-medium text-[#071011] disabled:opacity-50">{saving ? "保存中..." : "创建里程碑"}</button>
          {returnTo ? <Link href={returnTo} className="text-sm text-teal-300 hover:underline">返回并重新预览导入</Link> : null}
        </div>
      </form>
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
    </section>
  );
}

function labelMilestoneError(error?: string): string {
  if (error === "PLAN_MILESTONE_STABLE_KEY_CONFLICT") return "这个稳定键已存在，请换一个。";
  if (error === "PLAN_MILESTONE_REVISION_CONFLICT") return "里程碑已被其他页面更新，请刷新后重试。";
  return error ?? "里程碑操作失败。";
}
