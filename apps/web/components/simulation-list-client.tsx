"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";

export function SimulationListClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("阶段模拟");
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function createExam(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = { name, examDate: new Date(`${examDate}T08:00:00+08:00`).toISOString() };
      const commandScope = "simulation-exam:create";
      const response = await fetch("/api/simulation/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "simulation-exam", payload),
        }),
      });
      const body = (await response.json().catch(() => null)) as { exam?: { id: string }; error?: string } | null;
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok || !body?.exam) {
        setError(body?.error ?? "创建模拟失败，当前输入仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      startTransition(() => router.push(`/stage/simulation/${body.exam!.id}`));
    } catch {
      setError("网络不可用，模拟考试输入仍保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="create-simulation" onSubmit={createExam} className="border-t border-white/10 pt-5">
      <SectionHeader title="创建新模拟" description="先建立一场考试，再进入详情录入分科成绩与失分事实。" />
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <label className="text-sm text-zinc-400">名称
          <input className="mt-1 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="text-sm text-zinc-400">日期
          <input type="date" className="mt-1 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
        </label>
        <Button type="submit" variant="primary" size="lg" loading={pending || saving} loadingLabel="创建中..." className="self-end">创建考试</Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
    </form>
  );
}
