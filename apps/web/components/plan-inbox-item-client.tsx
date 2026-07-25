"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlanInboxFormOptions, PlanInboxItemDto } from "@/lib/study/plan-inbox-service";

type DependencyType = "SOFT" | "HARD";

function dateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

export function PlanInboxItemClient({ item: initialItem, options }: { item: PlanInboxItemDto; options: PlanInboxFormOptions }) {
  const [item, setItem] = useState(initialItem);
  const [title, setTitle] = useState(initialItem.title);
  const [subjectId, setSubjectId] = useState(initialItem.subjectId ?? "");
  const [plannedDate, setPlannedDate] = useState(dateInput(initialItem.plannedDate));
  const [estimatedMinutes, setEstimatedMinutes] = useState(initialItem.estimatedMinutes?.toString() ?? "");
  const [priority, setPriority] = useState(initialItem.priority?.toUpperCase() ?? "MEDIUM");
  const [type, setType] = useState(initialItem.type ?? "focus");
  const [planMilestoneId, setPlanMilestoneId] = useState(initialItem.planMilestoneId ?? "");
  const [createdMilestone, setCreatedMilestone] = useState<{ id: string; subjectId: string | null; title: string } | null>(null);
  const [primaryNodeId, setPrimaryNodeId] = useState(initialItem.primaryNodeId ?? "");
  const [relatedNodeIds, setRelatedNodeIds] = useState(initialItem.relatedNodeIds);
  const [predecessors, setPredecessors] = useState<Array<{ taskId: string; dependencyType: DependencyType }>>(
    initialItem.dependencyRefs.filter((ref) => ref.targetType === "TASK" && ref.taskId).map((ref) => ({ taskId: ref.taskId as string, dependencyType: ref.dependencyType })),
  );
  const [idempotencyKey] = useState(() => `plan-inbox-convert-${initialItem.id}-${crypto.randomUUID()}`);
  const [error, setError] = useState<string | null>(null);
  const [conflictDetail, setConflictDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nodes = useMemo(() => options.nodes.filter((node) => node.subjectId === subjectId), [options.nodes, subjectId]);
  const milestones = useMemo(() => [...options.milestones, ...(createdMilestone ? [createdMilestone] : [])].filter((milestone) => !milestone.subjectId || milestone.subjectId === subjectId), [options.milestones, createdMilestone, subjectId]);
  const tasks = useMemo(() => options.tasks.filter((task) => task.subjectId === subjectId), [options.tasks, subjectId]);
  const localMissing = [!title.trim() ? "标题" : null, !subjectId ? "科目" : null, !plannedDate ? "日期" : null, !Number(estimatedMinutes) || Number(estimatedMinutes) < 1 ? "预计时长" : null].filter((value): value is string => Boolean(value));
  const readOnly = item.status === "CONVERTED" || Boolean(item.supersededByItemId);

  function toggleRelated(nodeId: string) {
    setRelatedNodeIds((current) => current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]);
  }

  function togglePredecessor(taskId: string) {
    setPredecessors((current) => current.some((entry) => entry.taskId === taskId) ? current.filter((entry) => entry.taskId !== taskId) : [...current, { taskId, dependencyType: "SOFT" }]);
  }

  async function save(): Promise<PlanInboxItemDto | null> {
    setError(null);
    setConflictDetail(null);
    setSaving(true);
    const response = await fetch(`/api/plan-inbox/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: item.revision, title, subjectId: subjectId || null,
        plannedDate: plannedDate ? new Date(`${plannedDate}T00:00:00+08:00`).toISOString() : null,
        estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
        priority, type, planMilestoneId: planMilestoneId || null, primaryNodeId: primaryNodeId || null,
        relatedNodeIds, predecessorTasks: predecessors,
      }),
    });
    const body = await response.json().catch(() => null) as { item?: PlanInboxItemDto; error?: string; conflictFields?: string[]; latest?: PlanInboxItemDto } | null;
    setSaving(false);
    if (!response.ok || !body?.item) {
      setError(`${body?.error ?? "保存失败"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
      if (response.status === 409 && body?.latest) setConflictDetail(formatConflict(item, body.latest, body.conflictFields));
      if (body?.latest) setItem(body.latest);
      return null;
    }
    setItem(body.item);
    return body.item;
  }

  async function convert() {
    const saved = await save();
    if (!saved) return;
    const response = await fetch(`/api/plan-inbox/${saved.id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: saved.revision, idempotencyKey }),
    });
    const body = await response.json().catch(() => null) as { item?: PlanInboxItemDto; error?: string; conflictFields?: string[]; latest?: PlanInboxItemDto } | null;
    if (!response.ok || !body?.item) {
      setError(`${body?.error ?? "转换失败"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
      if (response.status === 409 && body?.latest) setConflictDetail(formatConflict(saved, body.latest, body.conflictFields));
      if (body?.latest) setItem(body.latest);
      return;
    }
    setItem(body.item);
  }

  async function transition(action: "dismiss" | "reopen") {
    setError(null);
    const response = await fetch(`/api/plan-inbox/${item.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: item.revision }) });
    const body = await response.json().catch(() => null) as { item?: PlanInboxItemDto; error?: string; latest?: PlanInboxItemDto } | null;
    if (!response.ok || !body?.item) { setError(body?.error ?? "操作失败"); if (response.status === 409 && body?.latest) setConflictDetail(formatConflict(item, body.latest, undefined)); if (body?.latest) setItem(body.latest); return; }
    setItem(body.item);
  }

  async function createRequiredMilestone() {
    const stableKey = item.requiredMilestoneKey;
    const stagePlan = options.stagePlans[0];
    if (!stableKey || !stagePlan) {
      setError("请先创建当前阶段计划，再创建里程碑。");
      return;
    }
    setError(null);
    const response = await fetch("/api/plan-milestones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stagePlanId: stagePlan.id, stableKey, title: stableKey, subjectId: subjectId || null }),
    });
    const body = await response.json().catch(() => null) as { milestone?: { id: string; subjectId: string | null; title: string }; error?: string } | null;
    if (!response.ok || !body?.milestone) {
      setError(body?.error ?? "创建里程碑失败");
      return;
    }
    setCreatedMilestone(body.milestone);
    setPlanMilestoneId(body.milestone.id);
  }

  return (
    <section className="space-y-5">
      <Link href="/today/inbox" className="text-sm text-zinc-400 hover:text-zinc-200">返回收件箱</Link>
      <header><p className="text-sm text-teal-300">{item.originType} · {item.originKey}@{item.originVersion}</p><h1 className="mt-1 text-3xl font-semibold text-white">计划草稿</h1><p className="mt-2 text-sm text-zinc-500">状态 {item.status} · rev {item.revision}</p></header>
      {item.supersededByItemId ? <p className="rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-sm text-amber-200">已被新版本取代。<Link href={`/today/inbox/${item.supersededByItemId}`} className="ml-2 text-teal-300 hover:underline">查看最新</Link></p> : null}

      <details className="rounded-md border border-white/10 bg-[#101419] p-4"><summary className="cursor-pointer text-sm font-medium text-white">来源快照</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-zinc-400">{JSON.stringify(item.originSnapshot, null, 2)}</pre></details>

      <div className="space-y-4 rounded-md border border-white/10 bg-[#101419] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">标题<input disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="block text-sm">科目<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setPrimaryNodeId(""); setRelatedNodeIds([]); setPredecessors([]); }}><option value="">请选择</option>{options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
          <label className="block text-sm">计划日期<input disabled={readOnly} type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></label>
          <label className="block text-sm">预计时长（分钟）<input disabled={readOnly} type="number" min="1" max="1440" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(event.target.value)} /></label>
          <label className="block text-sm">优先级<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option><option value="CRITICAL">关键</option></select></label>
          <label className="block text-sm">类型<input disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={type} onChange={(event) => setType(event.target.value)} /></label>
          <label className="block text-sm">里程碑<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={planMilestoneId} onChange={(event) => setPlanMilestoneId(event.target.value)}><option value="">不关联</option>{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</select></label>
          <label className="block text-sm sm:col-span-2">主考纲节点<select disabled={readOnly} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={primaryNodeId} onChange={(event) => setPrimaryNodeId(event.target.value)}><option value="">不关联</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        </div>
        <fieldset disabled={readOnly}><legend className="text-sm font-medium text-white">相关考纲节点</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{nodes.filter((node) => node.id !== primaryNodeId).map((node) => <label key={node.id} className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={relatedNodeIds.includes(node.id)} onChange={() => toggleRelated(node.id)} />{node.title}</label>)}{nodes.length === 0 ? <p className="text-sm text-zinc-500">选择科目后显示节点。</p> : null}</div></fieldset>
        <fieldset disabled={readOnly}><legend className="text-sm font-medium text-white">现有任务前置依赖</legend><div className="mt-2 space-y-2">{tasks.map((task) => { const entry = predecessors.find((value) => value.taskId === task.id); return <div key={task.id} className="flex flex-wrap items-center gap-2 text-sm"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={Boolean(entry)} onChange={() => togglePredecessor(task.id)} /><span className="truncate">{task.title}</span></label>{entry ? <select aria-label={`${task.title} 依赖类型`} className="h-9 rounded-md border border-white/10 bg-[#151a20] px-2" value={entry.dependencyType} onChange={(event) => setPredecessors((current) => current.map((value) => value.taskId === task.id ? { ...value, dependencyType: event.target.value as DependencyType } : value))}><option value="SOFT">软依赖</option><option value="HARD">硬依赖（阻止开始）</option></select> : null}</div>; })}{tasks.length === 0 ? <p className="text-sm text-zinc-500">当前科目没有可用前置任务。</p> : null}</div></fieldset>
        {item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").map((ref) => <p key={ref.id} className="text-sm text-amber-200">前置计划 <Link className="text-teal-300 hover:underline" href={`/today/inbox?stableRef=${encodeURIComponent(`${ref.planStableKey ?? ""}@${ref.planOriginVersion ?? ""}`)}`}>{ref.planStableKey}@{ref.planOriginVersion ?? "?"}</Link> 必须先转换（{ref.dependencyType}）。</p>)}
      </div>

      <section className="rounded-md border border-white/10 bg-[#101419] p-4"><h2 className="font-medium text-white">转换预览</h2><p className="mt-2 text-sm text-zinc-400">将创建 1 个正式任务、{relatedNodeIds.length} 个相关节点关系、{predecessors.length + item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").length} 条前置依赖。</p>{localMissing.length ? <p className="mt-2 text-sm text-amber-200">尚缺：{localMissing.join("、")}</p> : <p className="mt-2 text-sm text-emerald-300">必填字段完整。</p>}</section>

      <div className="flex flex-wrap gap-2">
        {item.status === "OPEN" && !readOnly ? <><button type="button" disabled={saving} className="h-11 rounded-md border border-white/10 px-4 text-sm disabled:opacity-50" onClick={() => void save()}>{saving ? "保存中..." : "保存草稿"}</button><button type="button" disabled={saving || localMissing.length > 0} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void convert()}>转换为任务</button><button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-300" onClick={() => void transition("dismiss")}>忽略</button></> : null}
        {item.status === "DISMISSED" && !item.supersededByItemId ? <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm text-teal-300" onClick={() => void transition("reopen")}>恢复 / Undo</button> : null}
        {item.convertedTaskId ? <Link href={`/today/tasks/${item.convertedTaskId}`} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium leading-[44px] text-black">打开任务</Link> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {item.requiredMilestoneKey && !item.planMilestoneId ? <div className="flex flex-wrap items-center gap-2 text-sm text-amber-200"><span>此草稿引用 canonical 里程碑 {item.requiredMilestoneKey}。</span><button type="button" className="text-teal-300 hover:underline disabled:opacity-50" disabled={saving || !options.stagePlans.length} onClick={() => void createRequiredMilestone()}>创建并选中</button>{!options.stagePlans.length ? <Link className="text-teal-300 hover:underline" href="/stage/overview">先创建阶段计划</Link> : null}</div> : null}
      {conflictDetail ? <p role="status" className="text-xs text-amber-200">冲突字段对照：{conflictDetail}</p> : null}
    </section>
  );
}

function formatConflict(local: PlanInboxItemDto, server: PlanInboxItemDto, fields?: string[]): string {
  const keys = fields?.length ? fields : ["revision", "status", "originVersion"];
  return keys.map((field) => `${field} 本地=${String((local as unknown as Record<string, unknown>)[field] ?? "空")} / 服务端=${String((server as unknown as Record<string, unknown>)[field] ?? "空")}`).join("；");
}
