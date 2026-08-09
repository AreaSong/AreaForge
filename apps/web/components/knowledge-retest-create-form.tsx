"use client";

import { ArrowLeft, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { sanitizeReturnPath, withReturnTo } from "@/lib/navigation/app-navigation";
import type { KnowledgePointDto } from "@/lib/study/knowledge-point-service";
import { masteryStatusLabel } from "@/lib/study/mastery-status";

export function KnowledgeRetestCreateForm({ points, returnTo = "/test/retests" }: { points: KnowledgePointDto[]; returnTo?: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("专项复测");
  const [method, setMethod] = useState("主动回忆 + 讲解");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(pointId: string) {
    setSelected((current) => current.includes(pointId) ? current.filter((id) => id !== pointId) : [...current, pointId]);
  }

  function submit() {
    if (!selected.length) {
      setError("至少选择一个知识点。");
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload = { title, method, knowledgePointIds: selected };
      const response = await fetch("/api/knowledge-retests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: getOrCreateIdempotencyKey("knowledge-retest:create", "knowledge-retest", payload),
          ...payload,
        }),
      });
      const body = await response.json().catch(() => null) as { retest?: { id: string }; error?: string } | null;
      if (!response.ok || !body?.retest?.id) {
        setError(body?.error ?? "无法安排复测，请稍后显式重试。");
        return;
      }
      router.push(withReturnTo(`/test/retests/${body.retest.id}`, sanitizeReturnPath(returnTo)));
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <Link href={returnTo} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={16} aria-hidden="true" />返回专项复测</Link>
        <span className="inline-flex items-center gap-2 text-xs text-zinc-500"><ClipboardCheck size={15} aria-hidden="true" />{selected.length} 个知识点</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-zinc-300">复测名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="h-11 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 text-white" /></label>
        <label className="grid gap-2 text-sm text-zinc-300">复测方法<select value={method} onChange={(event) => setMethod(event.target.value)} className="h-11 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 text-white"><option>主动回忆 + 讲解</option><option>基础题</option><option>变式应用</option><option>限时综合应用</option></select></label>
      </div>
      <div>
        <p className="text-sm font-medium text-white">选择知识点</p>
        <div className="mt-3 divide-y divide-white/10 border-y border-white/10">
          {points.map((point) => (
            <label key={point.id} className="flex cursor-pointer items-start gap-3 py-3">
              <input type="checkbox" checked={selected.includes(point.id)} onChange={() => toggle(point.id)} className="mt-1 size-4 accent-teal-300" />
              <span className="min-w-0"><span className="block text-sm text-white">{point.title}</span><span className="mt-1 block text-xs text-zinc-500">{point.subject.name} · {masteryStatusLabel(point.masteryStatus)}{point.needsRetest ? " · 待复测" : ""}</span></span>
            </label>
          ))}
        </div>
        {!points.length ? <Alert tone="warning">还没有知识点，先在知识点工作台创建对象。</Alert> : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="button" variant="primary" size="lg" onClick={submit} loading={pending} disabled={!points.length}>安排并开始复测</Button>
    </div>
  );
}
