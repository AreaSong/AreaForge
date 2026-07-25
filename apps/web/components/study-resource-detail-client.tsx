"use client";

import { Archive, Download, ExternalLink, Eye, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BackToListLink } from "@/components/list-return-context";
import type { StudyResourceDto, StudyResourceEditorOptionsDto } from "@/lib/study/study-resource-service";

const previewableTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/markdown"]);
const categories = [
  ["TEXTBOOK", "教材/讲义"], ["COURSE", "课程资料"], ["EXERCISE", "习题/题集"],
  ["PAST_PAPER", "真题/模拟"], ["SOLUTION", "题解/解析"], ["SUMMARY", "总结/速查"],
  ["IMAGE", "截图/图片"], ["OTHER", "其他"],
] as const;

export function StudyResourceDetailClient(props: { resource: StudyResourceDto; options: StudyResourceEditorOptionsDto }) {
  const { resource } = props;
  const router = useRouter();
  const [title, setTitle] = useState(resource.title);
  const [category, setCategory] = useState(resource.category);
  const [subjectId, setSubjectId] = useState(resource.subjectId ?? "");
  const [tags, setTags] = useState(resource.tags.join("，"));
  const [taskIds, setTaskIds] = useState(resource.taskIds);
  const [noteIds, setNoteIds] = useState(resource.noteIds);
  const [mistakeIds, setMistakeIds] = useState(resource.mistakeIds);
  const [syllabusNodeIds, setSyllabusNodeIds] = useState(resource.syllabusNodeIds);
  const [reviewDate, setReviewDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = Boolean(resource.archivedAt);

  async function save() {
    if (pending || archived) return;
    setPending(true); setError(null);
    const metadata = await fetch(`/api/study-resources/${resource.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, subjectId: subjectId || null, tags: splitTags(tags), taskIds, noteIds, mistakeIds, syllabusNodeIds, expectedRevision: resource.revision }),
    });
    if (!metadata.ok) {
      const body = await metadata.json().catch(() => null) as { error?: string } | null;
      setPending(false); setError(body?.error ?? "资料整理保存失败"); return;
    }
    setPending(false);
    router.refresh();
  }

  async function toggleArchive() {
    if (pending) return;
    setPending(true); setError(null);
    const response = await fetch(`/api/study-resources/${resource.id}/${archived ? "restore" : "archive"}`, { method: "POST" });
    setPending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? (archived ? "恢复失败" : "归档失败")); return;
    }
    router.refresh();
  }

  async function scheduleReview() {
    if (!reviewDate || archived || pending) return;
    setPending(true); setError(null);
    const response = await fetch("/api/review-schedules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "STUDY_RESOURCE", studyResourceId: resource.id, dueDate: new Date(`${reviewDate}T00:00:00+08:00`).toISOString() }),
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "设置复习日期失败"); return;
    }
    router.refresh();
  }

  return (
    <article className="space-y-6">
      <BackToListLink className="text-sm text-teal-300 hover:underline" fallbackHref="/knowledge/resources">返回资料列表</BackToListLink>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs text-zinc-500">{resource.sourceType} · {resource.organizeStatus}</p><h1 className="mt-1 text-2xl font-semibold text-white">{resource.title}</h1></div>
        <button type="button" disabled={pending} onClick={() => void toggleArchive()} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm">{archived ? <RotateCcw size={16} aria-hidden /> : <Archive size={16} aria-hidden />}{archived ? "恢复资料" : "归档资料"}</button>
      </header>

      {archived ? <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">资料已归档，当前只读；相关复习排期已暂停。恢复资料后仍需重新选择复习日期。</div> : null}

      <div className="flex flex-wrap gap-2">
        {resource.sourceType === "FILE" && resource.mimeType && previewableTypes.has(resource.mimeType) ? <Link href={`/knowledge/resources/${resource.id}/preview`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black"><Eye size={16} aria-hidden />私有预览</Link> : null}
        {resource.sourceType === "FILE" ? <a href={`/api/study-resources/${resource.id}/download?disposition=attachment`} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm"><Download size={16} aria-hidden />下载</a> : null}
        {resource.externalUrl ? <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm"><ExternalLink size={16} aria-hidden />打开 {resource.displayHost}</a> : null}
        {resource.taskIds[0] ? <Link href={`/today/tasks/${resource.taskIds[0]}`} className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10">开始关联任务</Link> : <Link href={`/today/plan?subjectId=${encodeURIComponent(resource.subjectId ?? "")}&resourceId=${encodeURIComponent(resource.id)}`} className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10">创建学习任务</Link>}
      </div>

      <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="resource-organize-heading">
        <h2 id="resource-organize-heading" className="text-lg font-medium text-white">整理与关联</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="标题"><input disabled={archived} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="资料类型"><select disabled={archived} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="主科目"><select disabled={archived} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">未选择</option>{props.options.subjects.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
          <Field label="标签"><input disabled={archived} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="逗号分隔" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MultiSelect label="关联任务" values={taskIds} options={props.options.tasks} disabled={archived} onChange={setTaskIds} />
          <MultiSelect label="关联卡片" values={noteIds} options={props.options.notes} disabled={archived} onChange={setNoteIds} />
          <MultiSelect label="关联错题" values={mistakeIds} options={props.options.mistakes} disabled={archived} onChange={setMistakeIds} />
          <MultiSelect label="关联考纲" values={syllabusNodeIds} options={props.options.syllabusNodes} disabled={archived} onChange={setSyllabusNodeIds} />
        </div>
        {!archived ? <button type="button" disabled={pending || !title.trim()} onClick={() => void save()} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-50"><Save size={16} aria-hidden />保存整理</button> : null}
      </section>

      <section className="space-y-3 border-t border-white/10 pt-5"><h2 className="text-lg font-medium text-white">统一复习</h2><div className="flex flex-wrap gap-2"><input aria-label="首次复习日期" disabled={archived} type="date" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /><button type="button" disabled={archived || pending || !reviewDate} onClick={() => void scheduleReview()} className="h-10 rounded-md border border-white/10 px-3 text-sm disabled:opacity-50">设置首次复习日期</button></div></section>
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm text-zinc-400"><span>{label}</span><span className="mt-1 block">{children}</span></label>; }

function MultiSelect(props: { label: string; values: string[]; options: Array<{ id: string; title: string }>; disabled: boolean; onChange: (values: string[]) => void }) {
  return <label className="text-sm text-zinc-400"><span>{props.label}</span><select multiple disabled={props.disabled} className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#151a20] p-2 text-zinc-200" value={props.values} onChange={(event) => props.onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{props.options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>;
}

function splitTags(value: string) { return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20); }
