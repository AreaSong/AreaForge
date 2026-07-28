"use client";

import { Archive, Download, ExternalLink, Eye, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { BackToListLink } from "@/components/list-return-context";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { StudyResourceDto, StudyResourceEditorOptionsDto } from "@/lib/study/study-resource-service";

const previewableTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/markdown"]);
const categories = [
  ["TEXTBOOK", "教材/讲义"], ["COURSE", "课程资料"], ["EXERCISE", "习题/题集"],
  ["PAST_PAPER", "真题/模拟"], ["SOLUTION", "题解/解析"], ["SUMMARY", "总结/速查"],
  ["IMAGE", "截图/图片"], ["OTHER", "其他"],
] as const;

interface ResourceDetailDraft {
  title: string;
  category: string;
  subjectId: string;
  tags: string;
  taskIds: string[];
  noteIds: string[];
  mistakeIds: string[];
  syllabusNodeIds: string[];
}

export function StudyResourceDetailClient(props: { userId: string; resource: StudyResourceDto; options: StudyResourceEditorOptionsDto }) {
  const [resource, setResource] = useState(props.resource);
  const router = useRouter();
  const formDraftKey = `areaforge.resource.draft.detail.${props.userId}.${resource.id}`;
  const savedBaseline = useRef(toResourceDetailDraft(resource));
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
  const [baseRevision, setBaseRevision] = useState(resource.revision);
  const [conflict, setConflict] = useState<{
    latest: StudyResourceDto;
    conflictFields: string[];
    action: "edit" | "archive" | "restore";
  } | null>(null);
  const [lifecycleRetry, setLifecycleRetry] = useState<"archive" | "restore" | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const archived = Boolean(resource.archivedAt);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isResourceDetailDraft);
      if (draft) {
        setTitle(draft.title);
        setCategory(draft.category);
        setSubjectId(draft.subjectId);
        setTags(draft.tags);
        setTaskIds(draft.taskIds);
        setNoteIds(draft.noteIds);
        setMistakeIds(draft.mistakeIds);
        setSyllabusNodeIds(draft.syllabusNodeIds);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey]);

  useEffect(() => {
    if (!draftReady || archived) return;
    const currentDraft = {
      title,
      category,
      subjectId,
      tags,
      taskIds,
      noteIds,
      mistakeIds,
      syllabusNodeIds,
    };
    if (resourceDetailDraftsEqual(currentDraft, savedBaseline.current)) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<ResourceDetailDraft>(formDraftKey, currentDraft);
  }, [archived, category, draftReady, formDraftKey, mistakeIds, noteIds, subjectId, syllabusNodeIds, tags, taskIds, title]);

  async function save() {
    if (pending || archived) return;
    setPending(true); setError(null);
    try {
      const metadata = await fetch(`/api/study-resources/${resource.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, subjectId: subjectId || null, tags: splitTags(tags), taskIds, noteIds, mistakeIds, syllabusNodeIds, expectedRevision: baseRevision }),
      });
      const body = await metadata.json().catch(() => null) as { resource?: StudyResourceDto; error?: string; latest?: StudyResourceDto; conflictFields?: string[] } | null;
      if (metadata.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!metadata.ok) {
        if (metadata.status === 409 && isStudyResourceDto(body?.latest)) {
          setConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["revision"], action: "edit" });
          setConflictOpen(true);
        }
        setError(body?.error ?? "资料整理保存失败，本地输入仍保留");
        return;
      }
      if (!body?.resource) {
        setError("服务端未返回最新资料版本，本地输入仍保留");
        return;
      }
      setResource(body.resource);
      setBaseRevision(body.resource.revision);
      savedBaseline.current = { title, category, subjectId, tags, taskIds, noteIds, mistakeIds, syllabusNodeIds };
      removePrivateBusinessDraft(formDraftKey);
      router.refresh();
    } catch {
      setError("网络不可用，资料整理草稿已保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  function adoptLatestResource() {
    if (!conflict) return;
    const draft = toResourceDetailDraft(conflict.latest);
    setTitle(draft.title);
    setCategory(draft.category);
    setSubjectId(draft.subjectId);
    setTags(draft.tags);
    setTaskIds(draft.taskIds);
    setNoteIds(draft.noteIds);
    setMistakeIds(draft.mistakeIds);
    setSyllabusNodeIds(draft.syllabusNodeIds);
    setBaseRevision(conflict.latest.revision);
    setResource(conflict.latest);
    savedBaseline.current = draft;
    removePrivateBusinessDraft(formDraftKey);
    setConflict(null);
    setConflictOpen(false);
    setLifecycleRetry(null);
    setError(`已采用服务端最新资料版本 r${conflict.latest.revision}。`);
  }

  function mergeResourceOntoLatest() {
    if (!conflict) return;
    const action = conflict.action;
    setBaseRevision(conflict.latest.revision);
    setResource(conflict.latest);
    setConflict(null);
    setConflictOpen(false);
    if (action === "edit") {
      setError(`本地整理输入已保留，并改为基于服务端 r${conflict.latest.revision}；请检查后显式保存。`);
    } else {
      setLifecycleRetry(action);
      setError(`已加载服务端 r${conflict.latest.revision} 并保留${action === "archive" ? "归档" : "恢复"}意图；请显式再次提交。`);
    }
  }

  async function toggleArchive(requestedAction?: "archive" | "restore") {
    if (pending) return;
    const action = requestedAction ?? (archived ? "restore" : "archive");
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/study-resources/${resource.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: baseRevision }),
      });
      const body = await response.json().catch(() => null) as {
        resource?: StudyResourceDto;
        latest?: StudyResourceDto;
        conflictFields?: string[];
        error?: string;
      } | null;
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok || !body?.resource) {
        if (response.status === 409 && isStudyResourceDto(body?.latest)) {
          setConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["revision", "archivedAt"], action });
          setConflictOpen(true);
        }
        setError(body?.error ?? `${action === "restore" ? "恢复" : "归档"}失败，当前状态没有改变；请显式重试。`);
        return;
      }
      setResource(body.resource);
      setBaseRevision(body.resource.revision);
      setLifecycleRetry(null);
      router.refresh();
    } catch {
      setError(`网络不可用，资料${action === "restore" ? "恢复" : "归档"}状态没有改变；恢复网络后请显式重试。`);
    } finally {
      setPending(false);
    }
  }

  async function scheduleReview() {
    if (!reviewDate || archived || pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/review-schedules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "STUDY_RESOURCE", studyResourceId: resource.id, dueDate: new Date(`${reviewDate}T00:00:00+08:00`).toISOString() }),
      });
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "设置复习日期失败，当前排期没有改变；请显式重试。");
        return;
      }
      router.refresh();
    } catch {
      setError("网络不可用，当前排期没有改变；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="space-y-6">
      <BackToListLink className="text-sm text-teal-300 hover:underline" fallbackHref="/knowledge/resources">返回资料列表</BackToListLink>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs text-zinc-500">{resource.sourceType} · {resource.organizeStatus}</p><DetailHeading className="mt-1 text-2xl font-semibold text-white">{resource.title}</DetailHeading></div>
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
      {lifecycleRetry ? <button type="button" className="h-10 rounded-md border border-amber-300/30 px-3 text-sm text-amber-200" disabled={pending} onClick={() => void toggleArchive(lifecycleRetry)}>再次提交{lifecycleRetry === "archive" ? "归档" : "恢复"}</button> : null}
      {conflict && !conflictOpen ? <button type="button" className="text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理资料版本冲突</button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并资料版本冲突"
        description="资料已在其他页面或设备更新。本地输入或生命周期操作仍保留，系统不会强制覆盖或自动重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={resourceConflictComparisons({ title, category, subjectId, tags, taskIds, noteIds, mistakeIds, syllabusNodeIds }, conflict?.latest)}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptLatestResource}
        onManualMerge={mergeResourceOntoLatest}
      />
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm text-zinc-400"><span>{label}</span><span className="mt-1 block">{children}</span></label>; }

function MultiSelect(props: { label: string; values: string[]; options: Array<{ id: string; title: string }>; disabled: boolean; onChange: (values: string[]) => void }) {
  return <label className="text-sm text-zinc-400"><span>{props.label}</span><select multiple disabled={props.disabled} className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-[#151a20] p-2 text-zinc-200" value={props.values} onChange={(event) => props.onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{props.options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>;
}

function splitTags(value: string) { return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20); }

function toResourceDetailDraft(resource: StudyResourceDto): ResourceDetailDraft {
  return {
    title: resource.title,
    category: resource.category,
    subjectId: resource.subjectId ?? "",
    tags: resource.tags.join("，"),
    taskIds: resource.taskIds,
    noteIds: resource.noteIds,
    mistakeIds: resource.mistakeIds,
    syllabusNodeIds: resource.syllabusNodeIds,
  };
}

function resourceDetailDraftsEqual(left: ResourceDetailDraft, right: ResourceDetailDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isResourceDetailDraft(value: unknown): value is ResourceDetailDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ResourceDetailDraft>;
  return [draft.title, draft.category, draft.subjectId, draft.tags].every((field) => typeof field === "string")
    && [draft.taskIds, draft.noteIds, draft.mistakeIds, draft.syllabusNodeIds]
      .every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"));
}

function isStudyResourceDto(value: unknown): value is StudyResourceDto {
  if (!value || typeof value !== "object") return false;
  const resource = value as Partial<StudyResourceDto>;
  return typeof resource.id === "string" && typeof resource.revision === "number" && typeof resource.title === "string"
    && Array.isArray(resource.tags) && Array.isArray(resource.taskIds) && Array.isArray(resource.noteIds)
    && Array.isArray(resource.mistakeIds) && Array.isArray(resource.syllabusNodeIds);
}

function resourceConflictComparisons(local: ResourceDetailDraft, latest?: StudyResourceDto) {
  return [
    { field: "revision", label: "revision", local: "本地基线", server: latest?.revision },
    { field: "title", label: "标题", local: local.title, server: latest?.title },
    { field: "category", label: "资料类型", local: local.category, server: latest?.category },
    { field: "subjectId", label: "主科目", local: local.subjectId || null, server: latest?.subjectId },
    { field: "tags", label: "标签", local: splitTags(local.tags), server: latest?.tags },
    { field: "taskIds", label: "关联任务", local: local.taskIds, server: latest?.taskIds },
    { field: "noteIds", label: "关联卡片", local: local.noteIds, server: latest?.noteIds },
    { field: "mistakeIds", label: "关联错题", local: local.mistakeIds, server: latest?.mistakeIds },
    { field: "syllabusNodeIds", label: "关联考纲", local: local.syllabusNodeIds, server: latest?.syllabusNodeIds },
  ];
}
