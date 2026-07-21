"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { SimulationExamDto, SimulationLossReasonDto, SyllabusOptionNodeDto } from "@/lib/study/types";
import type { SimulationRemediationDto } from "@/lib/study/simulation-service";

const reasons: Array<{ value: SimulationLossReasonDto; label: string }> = [
  ["CONCEPT_GAP", "概念缺口"], ["MEMORY_FORMULA", "记忆/公式"], ["METHOD_ERROR", "方法错误"],
  ["CALCULATION_CARELESS", "计算/粗心"], ["TIME_ALLOCATION", "时间分配"], ["READING_COMPREHENSION", "审题理解"],
  ["UNFAMILIAR_PATTERN", "题型陌生"], ["MINDSET", "心态"], ["UNANSWERED", "未作答"], ["OTHER", "其他"],
].map(([value, label]) => ({ value: value as SimulationLossReasonDto, label }));

interface SubjectDraft {
  subjectId: string; expectedRevision?: number; paperFullScore: number; targetScore: number; actualScore: number;
  durationMinutes: number; blankQuestionCount: number; summary: string;
  lossItems: Array<{ reason: SimulationLossReasonDto; syllabusNodeId: string | null; lostScore: number; note: string }>;
}

export function SimulationDetailClient(props: { exam: SimulationExamDto; subjects: Array<{ id: string; name: string }>; syllabus: SyllabusOptionNodeDto[]; remediations: SimulationRemediationDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedSubjectId, setSelectedSubjectId] = useState(props.subjects[0]?.id ?? "");
  const [summary, setSummary] = useState(props.exam.summary ?? "");
  const [mindset, setMindset] = useState(props.exam.mindset ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [examRevision, setExamRevision] = useState(props.exam.revision);
  const [selectedOriginKeys, setSelectedOriginKeys] = useState<string[]>(props.remediations.map((item) => item.originKey));
  const [drafts, setDrafts] = useState<SubjectDraft[]>(() => props.subjects.map((subject) => {
    const existing = props.exam.subjectResults.find((result) => result.subjectId === subject.id);
    return {
      subjectId: subject.id, expectedRevision: existing?.revision, paperFullScore: existing?.paperFullScore ?? 100,
      targetScore: existing?.targetScore ?? 0, actualScore: existing?.actualScore ?? 0,
      durationMinutes: existing?.durationMinutes ?? 0, blankQuestionCount: existing?.blankQuestionCount ?? 0,
      summary: existing?.summary ?? "", lossItems: existing?.lossItems.filter((item) => !item.archivedAt).map((item) => ({
        reason: item.reason, syllabusNodeId: item.syllabusNodeId, lostScore: item.lostScore, note: item.note ?? "",
      })) ?? [],
    };
  }));
  const active = drafts.find((draft) => draft.subjectId === selectedSubjectId) ?? drafts[0];
  const nodes = useMemo(() => flattenNodes(props.syllabus).filter((node) => node.subjectId === active?.subjectId), [props.syllabus, active?.subjectId]);

  function updateActive(patch: Partial<SubjectDraft>) {
    if (!active) return;
    setDrafts((items) => items.map((item) => item.subjectId === active.subjectId ? { ...item, ...patch } : item));
  }

  async function save() {
    setError(null); setNotice(null);
    const response = await fetch(`/api/simulation/exams/${props.exam.id}/results`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: examRevision, mindset, summary: summary || "已保存分科结果", lossReasons: [],
        subjectResults: drafts,
      }),
    });
    const body = (await response.json().catch(() => null)) as { exam?: SimulationExamDto; error?: string } | null;
    if (!response.ok) { setError(labelSaveError(body?.error)); return; }
    if (body?.exam) {
      setExamRevision(body.exam.revision);
      setDrafts((items) => items.map((item) => {
        const saved = body.exam?.subjectResults.find((result) => result.subjectId === item.subjectId);
        return saved ? { ...item, expectedRevision: saved.revision } : item;
      }));
    }
    setNotice(body?.exam?.warnings.length ? body.exam.warnings.join("；") : "模拟结果已保存，补救不会自动入箱。");
    startTransition(() => router.refresh());
  }

  async function addRemediations() {
    setError(null); setNotice(null);
    if (selectedOriginKeys.length === 0) { setError("请至少选择一项补救建议"); return; }
    const response = await fetch(`/api/simulation/exams/${props.exam.id}/remediations`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selections: props.remediations
          .filter((item) => selectedOriginKeys.includes(item.originKey))
          .map((item) => ({ originKey: item.originKey, originVersion: item.originVersion })),
      }),
    });
    const body = (await response.json().catch(() => null)) as { created?: number; reused?: number; error?: string } | null;
    if (!response.ok) { setError(body?.error ?? "加入收件箱失败"); return; }
    setNotice(`已加入 ${body?.created ?? 0} 项，复用 ${body?.reused ?? 0} 项。`);
  }

  if (!active) return <p className="text-sm text-amber-200">当前工作区没有可用科目。</p>;
  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="模拟科目">
        {props.subjects.map((subject) => <button key={subject.id} role="tab" aria-selected={active.subjectId === subject.id} onClick={() => setSelectedSubjectId(subject.id)} className={`shrink-0 rounded-md border px-3 py-2 text-sm ${active.subjectId === subject.id ? "border-teal-400 text-teal-200" : "border-white/10 text-zinc-400"}`}>{subject.name}</button>)}
      </div>
      <section className="rounded-md border border-white/10 bg-[#101419] p-4">
        <h2 className="font-medium text-white">{props.subjects.find((item) => item.id === active.subjectId)?.name}分科结果</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(["paperFullScore", "targetScore", "actualScore", "durationMinutes", "blankQuestionCount"] as const).map((key) => <label key={key} className="text-sm text-zinc-400">{{ paperFullScore: "卷面满分", targetScore: "目标分", actualScore: "实际分", durationMinutes: "用时（分）", blankQuestionCount: "未作答数" }[key]}<input type="number" step={key.includes("Score") ? 0.5 : 1} min={0} value={active[key]} onChange={(event) => updateActive({ [key]: Number(event.target.value) })} className="mt-1 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white" /></label>)}
        </div>
        <label className="mt-3 block text-sm text-zinc-400">分科总结<textarea value={active.summary} onChange={(event) => updateActive({ summary: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] p-3 text-white" /></label>
      </section>
      <section className="rounded-md border border-white/10 bg-[#101419] p-4">
        <div className="flex items-center justify-between"><h2 className="font-medium text-white">结构化失分</h2><button onClick={() => updateActive({ lossItems: [...active.lossItems, { reason: "CONCEPT_GAP", syllabusNodeId: null, lostScore: 0.5, note: "" }] })} className="text-sm text-teal-300">新增失分</button></div>
        <div className="mt-3 space-y-3">{active.lossItems.map((item, index) => <div key={index} className="grid gap-2 rounded-md border border-white/10 p-3 sm:grid-cols-[1fr_1fr_7rem_auto]">
          <select aria-label="失分原因" value={item.reason} onChange={(event) => updateActive({ lossItems: active.lossItems.map((value, itemIndex) => itemIndex === index ? { ...value, reason: event.target.value as SimulationLossReasonDto } : value) })} className="h-11 rounded-md bg-[#151a20] px-2">{reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select>
          <select aria-label="考纲节点" value={item.syllabusNodeId ?? ""} onChange={(event) => updateActive({ lossItems: active.lossItems.map((value, itemIndex) => itemIndex === index ? { ...value, syllabusNodeId: event.target.value || null } : value) })} className="h-11 rounded-md bg-[#151a20] px-2"><option value="">不关联节点</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
          <input aria-label="失分值" type="number" min={0.5} step={0.5} value={item.lostScore} onChange={(event) => updateActive({ lossItems: active.lossItems.map((value, itemIndex) => itemIndex === index ? { ...value, lostScore: Number(event.target.value) } : value) })} className="h-11 rounded-md bg-[#151a20] px-2" />
          <button aria-label="移除失分" onClick={() => updateActive({ lossItems: active.lossItems.filter((_, itemIndex) => itemIndex !== index) })} className="h-11 px-3 text-sm text-red-300">移除</button>
        </div>)}</div>
      </section>
      <section className="rounded-md border border-white/10 bg-[#101419] p-4"><label className="block text-sm text-zinc-400">心态<textarea value={mindset} onChange={(event) => setMindset(event.target.value)} className="mt-1 min-h-16 w-full rounded-md bg-[#151a20] p-3 text-white" /></label><label className="mt-3 block text-sm text-zinc-400">整场总结<textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="mt-1 min-h-20 w-full rounded-md bg-[#151a20] p-3 text-white" /></label></section>
      {props.remediations.length > 0 ? <section className="rounded-md border border-white/10 bg-[#101419] p-4"><h2 className="font-medium text-white">补救候选</h2><div className="mt-3 space-y-2">{props.remediations.map((item) => <label key={item.originKey} className="flex items-start gap-3 rounded-md border border-white/10 p-3 text-sm"><input type="checkbox" className="mt-1" checked={selectedOriginKeys.includes(item.originKey)} onChange={(event) => setSelectedOriginKeys((keys) => event.target.checked ? [...keys, item.originKey] : keys.filter((key) => key !== item.originKey))}/><span><span className="text-white">{item.subjectName} · {reasons.find((reason) => reason.value === item.reason)?.label}</span><span className="mt-1 block text-xs text-zinc-500">{item.lostScore} 分{item.syllabusNodeTitle ? ` · ${item.syllabusNodeTitle}` : ""}</span></span></label>)}</div></section> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}{notice ? <p role="status" className="text-sm text-teal-200">{notice}</p> : null}
      <div className="flex flex-wrap gap-3"><button disabled={pending} onClick={() => void save()} className="h-11 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-60">保存模拟结果</button><button disabled={pending || props.remediations.length === 0} onClick={() => void addRemediations()} className="h-11 rounded-md border border-white/10 px-4 text-sm disabled:opacity-50">将选中补救加入收件箱</button><Link href="/today/inbox" className="h-11 px-3 text-sm leading-[2.75rem] text-teal-300">查看收件箱</Link></div>
    </div>
  );
}

function flattenNodes(nodes: SyllabusOptionNodeDto[]): SyllabusOptionNodeDto[] { return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]); }

function labelSaveError(error?: string): string {
  if (error === "SIMULATION_EXAM_REVISION_CONFLICT" || error === "SIMULATION_SUBJECT_REVISION_CONFLICT") {
    return "其他页面已更新这场模拟；当前输入已保留，请刷新对比最新版本后再提交。";
  }
  return error ?? "保存失败；当前输入已保留，请稍后重试。";
}
