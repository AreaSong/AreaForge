"use client";

import { Save } from "lucide-react";
import { Children, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import type { KnowledgeMasteryStateDto, KnowledgePointDetailDto } from "@/lib/study/knowledge-point-service";
import {
  MASTERY_STATUS_OPTIONS,
  knowledgeMasteryStatusView,
  knowledgeStateForMasteryStatus,
  masteryStatusLabel,
  masteryStatusTone,
  type MasteryStatus,
} from "@/lib/study/mastery-status";

export function KnowledgePointDetail({ knowledgePoint }: { knowledgePoint: KnowledgePointDetailDto }) {
  const [revision, setRevision] = useState(knowledgePoint.revision);
  const [title, setTitle] = useState(knowledgePoint.title);
  const [boundary, setBoundary] = useState(knowledgePoint.boundary ?? "");
  const [masteryStatus, setMasteryStatus] = useState<MasteryStatus>(knowledgePoint.masteryStatus);
  const [nextRetestAt, setNextRetestAt] = useState(knowledgePoint.nextRetestAt?.slice(0, 10) ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/knowledge-points/${knowledgePoint.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, title, boundary: boundary.trim() || null, masteryState: knowledgeStateForMasteryStatus(masteryStatus), nextRetestAt: nextRetestAt ? new Date(`${nextRetestAt}T00:00:00.000Z`).toISOString() : null }) });
      const body = await response.json().catch(() => null) as { knowledgePoint?: KnowledgePointDetailDto; error?: string; latest?: KnowledgePointDetailDto } | null;
      if (!response.ok || !body?.knowledgePoint) {
        if (body?.latest) setRevision(body.latest.revision);
        setError(body?.error === "KNOWLEDGE_POINT_REVISION_CONFLICT" ? "页面数据已更新，请确认最新内容后再保存。" : "保存失败，请稍后重试。");
        return;
      }
      setRevision(body.knowledgePoint.revision);
      setMasteryStatus(body.knowledgePoint.masteryStatus);
      setNotice("已保存，掌握状态仍以学习与复测证据为依据。");
    });
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 border-b border-white/10 pb-6 sm:grid-cols-3">{Object.entries(knowledgePoint.counts).map(([key, value]) => <div key={key} className="border-l border-white/10 pl-3"><p className="text-xs text-zinc-500">{countLabel(key)}</p><p className="mt-1 text-2xl font-semibold text-white">{value}</p></div>)}<div className="border-l border-white/10 pl-3"><p className="text-xs text-zinc-500">量化可信度</p><p className="mt-1 text-2xl font-semibold text-white">{knowledgePoint.masteryConfidence}%</p></div></section>

      <section className="space-y-4 border-b border-white/10 pb-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-medium text-white">对象信息</h2><p className="mt-1 text-sm text-zinc-500">掌握状态可以调整，但不会替代真实学习证据。</p></div><Button type="button" variant="primary" onClick={save} loading={isPending}><Save size={15} aria-hidden />保存</Button></div>
        <div className="grid gap-4 lg:grid-cols-2"><label className="grid gap-1 text-xs text-zinc-400">名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} className="h-10 rounded-md border border-white/10 bg-[#0b0e12] px-3 text-sm text-zinc-100 outline-none focus:border-teal-400/50" /></label><label className="grid gap-1 text-xs text-zinc-400">掌握状态<select value={masteryStatus} onChange={(event) => setMasteryStatus(event.target.value as MasteryStatus)} className="h-10 rounded-md border border-white/10 bg-[#0b0e12] px-3 text-sm text-zinc-100">{MASTERY_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{masteryStatusLabel(status)}</option>)}</select></label><label className="grid gap-1 text-xs text-zinc-400 lg:col-span-2">知识边界<textarea value={boundary} onChange={(event) => setBoundary(event.target.value)} rows={4} maxLength={3000} className="rounded-md border border-white/10 bg-[#0b0e12] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-teal-400/50" /></label><label className="grid gap-1 text-xs text-zinc-400">下一次复测日期<input type="date" value={nextRetestAt} onChange={(event) => setNextRetestAt(event.target.value)} className="h-10 rounded-md border border-white/10 bg-[#0b0e12] px-3 text-sm text-zinc-100" /></label></div>
        <div className="flex flex-wrap items-center gap-2"><Badge tone={masteryStatusTone(knowledgePoint.masteryStatus)}>{masteryStatusLabel(knowledgePoint.masteryStatus)}</Badge>{knowledgePoint.needsRetest ? <Badge tone="warning">待复测</Badge> : null}<span className="text-xs text-zinc-500">量化可信度来自学习证据、复测和证据新鲜度。</span></div>
        {notice ? <p className="text-sm text-emerald-300" role="status">{notice}</p> : null}{error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
      </section>

      <RelationSection title="关联考纲" empty="还没有关联考纲节点。">{knowledgePoint.syllabusLinks.map((link) => <li key={link.id} className="flex items-center justify-between gap-3 py-3"><span className="text-sm text-zinc-200">{link.node.title}</span><Badge>{link.role}</Badge></li>)}</RelationSection>
      <RelationSection title="阶段目标" empty="还没有进入阶段目标。">{knowledgePoint.stageTargets.map((target) => { const view = knowledgeMasteryStatusView(target.targetState as KnowledgeMasteryStateDto); return <li key={target.id} className="flex items-center justify-between gap-3 py-3"><span className="text-sm text-zinc-200">{target.stage?.name ?? "未命名阶段"}</span><span className="text-xs text-zinc-500">目标：{view.label} · 重要度 {target.importance}</span></li>; })}</RelationSection>
      <RelationSection title="学习记录" empty="完成一次开始学习并收口后，这里会出现学习记录。">{knowledgePoint.recentSessions.map((session) => <li key={session.id} className="flex items-center justify-between gap-3 py-3"><span className="text-sm text-zinc-200">{formatDate(session.startedAt)} · {session.effectiveMinutes} 分钟</span><span className="text-xs text-zinc-500">{session.understanding ?? "尚未收口"}</span></li>)}</RelationSection>
      <RelationSection title="掌握证据" empty="学习收口、复测和其他可验证产出会沉淀在这里。">{knowledgePoint.evidence.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-3"><span className="text-sm text-zinc-200">{item.summary || item.sourceType}</span><span className="text-xs text-zinc-500">{formatDate(item.occurredAt)}{item.confidence !== null ? ` · ${(item.confidence * 100).toFixed(0)}%` : ""}</span></li>)}</RelationSection>
    </div>
  );
}

function RelationSection(props: { title: string; empty: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h2 className="text-lg font-medium text-white">{props.title}</h2>{Children.count(props.children) > 0 ? <ul className="divide-y divide-white/10 border-y border-white/10">{props.children}</ul> : <EmptyState title={props.empty} />}</section>;
}

function countLabel(key: string): string {
  return ({ syllabusLinks: "考纲关联", stageTargets: "阶段目标", arrangements: "投入安排", sessions: "学习记录", retests: "复测次数", evidence: "掌握证据" } as Record<string, string>)[key] ?? key;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}
