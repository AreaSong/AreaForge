"use client";

import { ArrowLeft, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Badge } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import type { KnowledgeRetestDetailDto, KnowledgeRetestResultDto } from "@/lib/study/knowledge-retest-service";

export function KnowledgeRetestDetailClient({ initial }: { initial: KnowledgeRetestDetailDto }) {
  const router = useRouter();
  const [retest, setRetest] = useState(initial);
  const [points, setPoints] = useState(() => initial.points.map((point) => ({ ...point, result: point.result ?? "PARTIAL" as KnowledgeRetestResultDto })));
  const [summary, setSummary] = useState(initial.summary ?? "");
  const [reviewText, setReviewText] = useState(initial.reviewText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const scope = `knowledge-retest:${retest.id}:start`;
      const payload = { expectedRevision: retest.revision };
      const response = await fetch(`/api/knowledge-retests/${retest.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: getOrCreateIdempotencyKey(scope, "knowledge-retest-start", payload), ...payload }),
      });
      const body = await response.json().catch(() => null) as { retest?: KnowledgeRetestDetailDto; error?: string } | null;
      if (!response.ok || !body?.retest) return setError(body?.error ?? "无法开始复测。");
      completeIdempotentCommand(scope);
      setRetest(body.retest);
    });
  }

  function submit() {
    if (!summary.trim() || !reviewText.trim()) {
      setError("完成每个知识点结果后，还必须写复测总结和复盘。");
      return;
    }
    startTransition(async () => {
      const payload = {
        expectedRevision: retest.revision,
        summary,
        reviewText,
        points: points.map((point) => ({ pointId: point.id, result: point.result, score: point.score, understanding: point.understanding, note: point.note })),
      };
      const scope = `knowledge-retest:${retest.id}:submit`;
      const response = await fetch(`/api/knowledge-retests/${retest.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: getOrCreateIdempotencyKey(scope, "knowledge-retest-submit", payload), ...payload }),
      });
      const body = await response.json().catch(() => null) as { retest?: KnowledgeRetestDetailDto; error?: string } | null;
      if (!response.ok || !body?.retest) return setError(body?.error ?? "复测结果不完整，请检查后重试。");
      completeIdempotentCommand(scope);
      setRetest(body.retest);
    });
  }

  function confirm() {
    startTransition(async () => {
      const scope = `knowledge-retest:${retest.id}:confirm`;
      const payload = { expectedRevision: retest.revision };
      const response = await fetch(`/api/knowledge-retests/${retest.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: getOrCreateIdempotencyKey(scope, "knowledge-retest-confirm", payload), ...payload }),
      });
      const body = await response.json().catch(() => null) as { retest?: KnowledgeRetestDetailDto; error?: string } | null;
      if (!response.ok || !body?.retest) return setError(body?.error ?? "确认失败，知识点掌握状态未更新。");
      completeIdempotentCommand(scope);
      setRetest(body.retest);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <Link href="/test/retests" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={16} aria-hidden="true" />返回专项复测</Link>
        <Badge tone={retest.status === "CLOSED" ? "success" : retest.status === "PENDING_REVIEW" ? "warning" : "info"}>{statusLabel(retest.status, retest.result)}</Badge>
      </div>
      <div><h1 className="text-2xl font-semibold text-white">{retest.title}</h1><p className="mt-2 text-sm text-zinc-400">{retest.method} · {retest.pointCount} 个知识点</p></div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {retest.status === "DRAFT" ? <Button type="button" variant="primary" onClick={start} loading={pending}>开始复测</Button> : null}
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-white">逐点结果</h2>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {points.map((point, index) => (
            <div key={point.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_12rem_10rem] lg:items-start">
              <div><p className="text-sm font-medium text-white">{index + 1}. {point.title}</p><textarea value={point.note ?? ""} onChange={(event) => updatePoint(point.id, { note: event.target.value })} placeholder="个人反馈：哪里清楚、哪里仍然卡住" maxLength={2000} className="mt-2 min-h-20 w-full rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 py-2 text-sm text-white placeholder:text-zinc-600" disabled={retest.status !== "IN_PROGRESS"} /></div>
              <select value={point.result} onChange={(event) => updatePoint(point.id, { result: event.target.value as KnowledgeRetestResultDto })} className="h-10 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-2 text-sm text-white" disabled={retest.status !== "IN_PROGRESS"}><option value="PASSED">通过</option><option value="PARTIAL">部分掌握</option><option value="FAILED">未通过</option></select>
              <input type="number" min={0} max={100} value={point.score ?? ""} onChange={(event) => updatePoint(point.id, { score: event.target.value ? Number(event.target.value) : null })} placeholder="量化分数" className="h-10 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-2 text-sm text-white placeholder:text-zinc-600" disabled={retest.status !== "IN_PROGRESS"} />
            </div>
          ))}
        </div>
      </section>
      {retest.status === "IN_PROGRESS" ? <section className="space-y-3"><label className="grid gap-2 text-sm text-zinc-300">复测总结<textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={4000} className="min-h-24 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 py-2 text-white" /></label><label className="grid gap-2 text-sm text-zinc-300">复盘<textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} maxLength={4000} className="min-h-28 rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 py-2 text-white" /></label><Button type="button" variant="primary" onClick={submit} loading={pending}>提交复测，进入确认</Button></section> : null}
      {retest.status === "PENDING_REVIEW" ? <section className="space-y-3 border border-amber-300/20 bg-amber-400/5 p-4"><p className="text-sm text-amber-100">结果、总结和复盘已保存。确认后才会更新知识点掌握状态，并安排下一次复测。</p><Button type="button" variant="primary" onClick={confirm} loading={pending}><CheckCheck size={16} aria-hidden="true" />确认并更新掌握状态</Button></section> : null}
      {retest.status === "CLOSED" ? <Alert tone="success">已确认。下一次复测：{retest.nextDueAt ? formatDate(retest.nextDueAt) : "待安排"}。</Alert> : null}
    </div>
  );

  function updatePoint(id: string, patch: Partial<typeof points[number]>) {
    setPoints((current) => current.map((point) => point.id === id ? { ...point, ...patch } : point));
  }
}

function statusLabel(status: string, result: string | null): string {
  if (status === "CLOSED") return result === "PASSED" ? "已确认 · 稳定掌握" : result === "PARTIAL" ? "已确认 · 部分掌握" : "已确认 · 需要再测";
  if (status === "PENDING_REVIEW") return "待确认";
  if (status === "IN_PROGRESS") return "进行中";
  return "待开始";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value));
}
