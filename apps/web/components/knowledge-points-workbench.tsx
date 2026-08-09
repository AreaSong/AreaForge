"use client";

import { ArrowRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { SubjectDto } from "@/lib/study/types";
import type { KnowledgePointDto } from "@/lib/study/knowledge-point-service";
import {
  MASTERY_STATUS_OPTIONS,
  masteryStatusLabel,
  masteryStatusTone,
  type MasteryStatus,
} from "@/lib/study/mastery-status";

export function KnowledgePointsWorkbench(props: {
  subjects: SubjectDto[];
  knowledgePoints: KnowledgePointDto[];
  initialSubjectId?: string;
  initialQuery?: string;
  initialMasteryStatus?: MasteryStatus;
}) {
  const [subjectId, setSubjectId] = useState(props.initialSubjectId ?? "");
  const [masteryStatus, setMasteryStatus] = useState<MasteryStatus | "">(props.initialMasteryStatus ?? "");
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [title, setTitle] = useState("");
  const [boundary, setBoundary] = useState("");
  const [createSubjectId, setCreateSubjectId] = useState(props.initialSubjectId ?? props.subjects[0]?.id ?? "");
  const [createdPoints, setCreatedPoints] = useState<KnowledgePointDto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const points = useMemo(() => {
    const merged = [...createdPoints, ...props.knowledgePoints];
    const seen = new Set<string>();
    return merged.filter((point) => {
      if (seen.has(point.id)) return false;
      seen.add(point.id);
      return true;
    });
  }, [createdPoints, props.knowledgePoints]);

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    const payload = { subjectId: createSubjectId, title: title.trim(), boundary: boundary.trim() || null };
    if (!payload.subjectId || !payload.title) {
      setError("请选择科目并填写知识点名称。");
      return;
    }
    startTransition(async () => {
      const scope = `knowledge-point:create:${createSubjectId}`;
      const idempotencyKey = getOrCreateIdempotencyKey(scope, "knowledge-point", payload);
      const response = await fetch("/api/knowledge-points", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey }) });
      const body = await response.json().catch(() => null) as { knowledgePoint?: KnowledgePointDto; error?: string } | null;
      if (!response.ok || !body?.knowledgePoint) {
        setError(body?.error === "KNOWLEDGE_POINT_STABLE_KEY_CONFLICT" ? "这个知识点已经存在，请换一个名称。" : "知识点创建失败，请稍后重试。");
        return;
      }
      completeIdempotentCommand(scope);
      setCreatedPoints((current) => [body.knowledgePoint as KnowledgePointDto, ...current]);
      setTitle("");
      setBoundary("");
      setNotice("知识点已加入知识中心。");
    });
  }

  const filteredPoints = points.filter((point) => {
    if (subjectId && point.subject.id !== subjectId) return false;
    if (masteryStatus && point.masteryStatus !== masteryStatus) return false;
    if (query.trim() && !point.title.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN"))) return false;
    return true;
  });
  const currentListHref = `/knowledge/points${new URLSearchParams(
    Object.entries({ subjectId, q: query, masteryStatus }).filter(([, value]) => Boolean(value)),
  ).toString() ? `?${new URLSearchParams(
    Object.entries({ subjectId, q: query, masteryStatus }).filter(([, value]) => Boolean(value)),
  ).toString()}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="知识 · 核心对象"
        title="知识点"
        description="知识点独立于考纲、任务和考试范围；每次学习、复测和复盘都会在这里汇聚掌握证据。"
      />

      <section className="border-y border-white/10 py-4">
        <SectionHeader title="新增知识点" description="先确定科目和知识边界，任务与考纲可以之后再关联。" />
        <form onSubmit={submitCreate} className="mt-4 grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
          <label className="grid gap-1 text-xs text-zinc-400">科目<select value={createSubjectId} onChange={(event) => setCreateSubjectId(event.target.value)} className="h-10 rounded-md border border-white/10 bg-[#0b0e12] px-3 text-sm text-zinc-100" disabled={!props.subjects.length}><option value="">选择科目</option>{props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
          <label className="grid gap-1 text-xs text-zinc-400">知识点名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} placeholder="例如：二次函数最值" className="h-10 rounded-md border border-white/10 bg-[#0b0e12] px-3 text-sm text-zinc-100 outline-none focus:border-teal-400/50" /></label>
          <label className="grid gap-1 text-xs text-zinc-400">边界（可选）<input value={boundary} onChange={(event) => setBoundary(event.target.value)} maxLength={3000} placeholder="说明要掌握什么、暂不包含什么" className="h-10 rounded-md border border-white/10 bg-[#0b0e12] px-3 text-sm text-zinc-100 outline-none focus:border-teal-400/50" /></label>
          <Button type="submit" variant="primary" loading={isPending} className="self-end"><Plus size={16} aria-hidden />加入知识中心</Button>
        </form>
        {notice ? <p className="mt-3 text-sm text-emerald-300" role="status">{notice}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-300" role="alert">{error}</p> : null}
      </section>

      <Toolbar label="知识点筛选">
        <label className="flex items-center gap-2 text-xs text-zinc-500">科目<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="h-9 rounded-md border border-white/10 bg-[#0b0e12] px-2 text-xs text-zinc-200"><option value="">全部科目</option>{props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">状态<select value={masteryStatus} onChange={(event) => setMasteryStatus(event.target.value as MasteryStatus | "")} className="h-9 rounded-md border border-white/10 bg-[#0b0e12] px-2 text-xs text-zinc-200"><option value="">全部状态</option>{MASTERY_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{masteryStatusLabel(status)}</option>)}</select></label>
        <label className="ml-auto flex min-w-48 flex-1 items-center gap-2 border-l border-white/10 pl-2 text-xs text-zinc-500 sm:max-w-xs"><Search size={15} aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识点" className="h-9 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none" /></label>
      </Toolbar>

      {filteredPoints.length ? <ul className="divide-y divide-white/10 border-y border-white/10">{filteredPoints.map((point) => { const detailHref = withReturnTo(`/knowledge/points/${point.id}`, currentListHref); return <li key={point.id} className="flex min-w-0 items-center gap-4 py-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Link href={detailHref} className="truncate font-medium text-zinc-100 hover:text-teal-200">{point.title}</Link><Badge tone={masteryStatusTone(point.masteryStatus)}>{masteryStatusLabel(point.masteryStatus)}</Badge>{point.needsRetest ? <Badge tone="warning">待复测</Badge> : null}</div><p className="mt-1 truncate text-xs text-zinc-500">{point.subject.name}{point.primaryGroup ? ` · ${point.primaryGroup.title}` : ""}{point.boundary ? ` · ${point.boundary}` : ""}</p><p className="mt-2 text-xs text-zinc-600">{point.counts.evidence} 条证据 · {point.counts.sessions} 次学习 · {point.counts.retests} 次复测 · 量化可信度 {point.masteryConfidence}%</p></div><Link href={detailHref} aria-label={`打开 ${point.title}`} title="打开知识点" className="grid size-9 shrink-0 place-items-center rounded-md text-teal-300 hover:bg-white/[0.06]"><ArrowRight size={16} aria-hidden /></Link></li>; })}</ul> : <EmptyState title="还没有匹配的知识点" description="从一个具体、可解释边界的知识点开始，后续学习与复测证据会持续汇聚到这里。" />}
    </div>
  );
}
