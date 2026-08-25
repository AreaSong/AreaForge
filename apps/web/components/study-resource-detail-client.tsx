"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import { createReviewSchedule } from "@/lib/api/review-schedule";
import {
  setStudyResourceArchiveState,
  updateStudyResource,
} from "@/lib/api/study-resource";
import { Archive, ArrowRight, CalendarCheck, Download, ExternalLink, Eye, Pencil, RotateCcw, Save, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { KnowledgeObjectDetailHeader } from "@/components/knowledge-object-detail-header";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Alert, PersistenceStatus } from "@/components/ui/feedback";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { useUnsavedChangesWarning } from "@/lib/client/use-unsaved-changes-warning";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { StudyResourceDto, StudyResourceEditorOptionsDto } from "@/lib/contracts";
import { shanghaiDateInputToIso } from "@/lib/formatters";
import {
  categories,
  Field,
  isStudyResourceDto,
  MultiSelect,
  organizeStatusLabel,
  resourceConflictComparisons,
  ResourceFacts,
  sourceTypeLabel,
  splitTags,
} from "@/components/study-resource-detail-client-parts";
import {
  isStoredResourceDetailDraft,
  resourceDetailDraftsEqual,
  restoreResourceDetailDraft,
  toResourceDetailDraft,
  type ResourceDetailDraft,
  type ResourceDetailValues,
} from "@/components/study-resource-detail-draft";

const previewableTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/markdown"]);

export function StudyResourceDetailClient(props: {
  userId: string;
  resource: StudyResourceDto;
  options: StudyResourceEditorOptionsDto;
  returnTo?: string;
}) {
  const [resource, setResource] = useState(props.resource);
  const router = useRouter();
  const formDraftKey = `areaforge.resource.draft.detail.${props.userId}.${resource.id}`;
  const [savedBaseline, setSavedBaseline] = useState(() => toResourceDetailDraft(resource));
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
  const [baseRevision, setBaseRevision] = useState<number | null>(resource.revision);
  const [conflict, setConflict] = useState<{
    latest: StudyResourceDto;
    conflictFields: string[];
    action: "edit" | "archive" | "restore";
  } | null>(null);
  const [lifecycleRetry, setLifecycleRetry] = useState<"archive" | "restore" | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<"archive" | "discard" | null>(null);
  const archived = Boolean(resource.archivedAt);
  const currentDraft: ResourceDetailValues = { title, category, subjectId, tags, taskIds, noteIds, mistakeIds, syllabusNodeIds };
  const dirty = !resourceDetailDraftsEqual(currentDraft, savedBaseline);
  const objectHref = props.returnTo
    ? withReturnTo(`/knowledge/resources/${resource.id}`, props.returnTo)
    : `/knowledge/resources/${resource.id}`;

  useUnsavedChangesWarning(editing && dirty);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isStoredResourceDetailDraft);
      if (stored) {
        const draft = restoreResourceDetailDraft(stored, props.resource.revision);
        setTitle(draft.values.title);
        setCategory(draft.values.category);
        setSubjectId(draft.values.subjectId);
        setTags(draft.values.tags);
        setTaskIds(draft.values.taskIds);
        setNoteIds(draft.values.noteIds);
        setMistakeIds(draft.values.mistakeIds);
        setSyllabusNodeIds(draft.values.syllabusNodeIds);
        setBaseRevision(draft.baseRevision);
        setEditing(true);
        if (draft.status !== "current") {
          setConflict({ latest: props.resource, conflictFields: ["revision"], action: "edit" });
          setConflictOpen(true);
          setError(draft.status === "legacy"
            ? "已恢复旧版本机草稿，但其服务端基线未知；请人工比较后再保存。"
            : `本机草稿基于 r${draft.baseRevision}，服务端当前为 r${props.resource.revision}；请人工比较后再保存。`);
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey, props.resource]);

  useEffect(() => {
    if (!draftReady || archived) return;
    const currentDraft: ResourceDetailValues = {
      title,
      category,
      subjectId,
      tags,
      taskIds,
      noteIds,
      mistakeIds,
      syllabusNodeIds,
    };
    if (!conflict && resourceDetailDraftsEqual(currentDraft, savedBaseline)) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<ResourceDetailDraft>(formDraftKey, {
      schemaVersion: 1,
      baseRevision,
      values: currentDraft,
    });
  }, [archived, baseRevision, category, conflict, draftReady, formDraftKey, mistakeIds, noteIds, savedBaseline, subjectId, syllabusNodeIds, tags, taskIds, title]);

  async function save() {
    if (pending || archived) return;
    if (baseRevision === null || conflict) {
      setError("本机草稿尚未与服务端版本对齐，请先在冲突窗口选择服务端版本或人工合并。");
      if (conflict) setConflictOpen(true);
      return;
    }
    setPending(true); setError(null);
    try {
      const metadata = await updateStudyResource(resource.id, {
        title,
        category,
        subjectId: subjectId || null,
        tags: splitTags(tags),
        taskIds,
        noteIds,
        mistakeIds,
        syllabusNodeIds,
        expectedRevision: baseRevision,
      });
      const body = metadata.body;
      if (isUnauthorized(metadata)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!metadata.ok) {
        if (isConflict(metadata) && isStudyResourceDto(body?.latest)) {
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
      setSavedBaseline({ title, category, subjectId, tags, taskIds, noteIds, mistakeIds, syllabusNodeIds });
      removePrivateBusinessDraft(formDraftKey);
      setEditing(false);
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
    setSavedBaseline(draft);
    removePrivateBusinessDraft(formDraftKey);
    setConflict(null);
    setConflictOpen(false);
    setLifecycleRetry(null);
    setEditing(false);
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
      setEditing(true);
      setError(`本地整理输入已保留，并改为基于服务端 r${conflict.latest.revision}；请检查后显式保存。`);
    } else {
      setLifecycleRetry(action);
      setError(`已加载服务端 r${conflict.latest.revision} 并保留${action === "archive" ? "归档" : "恢复"}意图；请显式再次提交。`);
    }
  }

  async function toggleArchive(requestedAction?: "archive" | "restore") {
    if (pending) return;
    if (baseRevision === null || conflict) {
      setError("本机草稿尚未与服务端版本对齐，请先处理版本冲突再改变资料状态。");
      if (conflict) setConflictOpen(true);
      return;
    }
    const action = requestedAction ?? (archived ? "restore" : "archive");
    setPending(true); setError(null);
    try {
      const response = await setStudyResourceArchiveState(resource.id, action, baseRevision);
      const body = response.body;
      if (isUnauthorized(response)) return redirectToLoginWithCurrentLocation();
      if (!response.ok || !body?.resource) {
        if (isConflict(response) && isStudyResourceDto(body?.latest)) {
          setConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["revision", "archivedAt"], action });
          setConflictOpen(true);
        }
        setError(body?.error ?? `${action === "restore" ? "恢复" : "归档"}失败，当前状态没有改变；请显式重试。`);
        return;
      }
      setResource(body.resource);
      setBaseRevision(body.resource.revision);
      setLifecycleRetry(null);
      setEditing(false);
      router.refresh();
    } catch {
      setError(`网络不可用，资料${action === "restore" ? "恢复" : "归档"}状态没有改变；恢复网络后请显式重试。`);
    } finally {
      setPending(false);
    }
  }

  function cancelEditing() {
    const draft = savedBaseline;
    setTitle(draft.title);
    setCategory(draft.category);
    setSubjectId(draft.subjectId);
    setTags(draft.tags);
    setTaskIds(draft.taskIds);
    setNoteIds(draft.noteIds);
    setMistakeIds(draft.mistakeIds);
    setSyllabusNodeIds(draft.syllabusNodeIds);
    setBaseRevision(resource.revision);
    setConflict(null);
    setConflictOpen(false);
    removePrivateBusinessDraft(formDraftKey);
    setError(null);
    setEditing(false);
  }

  function requestCancelEditing() {
    if (dirty) setConfirmation("discard");
    else cancelEditing();
  }

  async function scheduleReview() {
    if (!reviewDate || archived || pending) return;
    setPending(true); setError(null);
    try {
      const response = await createReviewSchedule({
        targetType: "STUDY_RESOURCE",
        studyResourceId: resource.id,
        dueDate: shanghaiDateInputToIso(reviewDate),
      });
      if (isUnauthorized(response)) return redirectToLoginWithCurrentLocation();
      if (!response.ok) {
        const body = response.body;
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
      <KnowledgeObjectDetailHeader
        fallbackHref="/knowledge/resources"
        fallbackLabel="返回资料列表"
        returnTo={props.returnTo}
        eyebrow={`${sourceTypeLabel(resource.sourceType)} · ${organizeStatusLabel(resource.organizeStatus)}`}
        title={resource.title}
        description={resource.sourceType === "FILE" ? resource.originalName ?? "私有文件" : resource.displayHost ?? "外部链接"}
        actions={(
          <>
            {resource.sourceType === "FILE" && resource.mimeType && previewableTypes.has(resource.mimeType) ? (
              <Link href={withReturnTo(`/knowledge/resources/${resource.id}/preview`, objectHref)} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black">
                <Eye size={16} aria-hidden />私有预览
              </Link>
            ) : resource.sourceType === "FILE" ? (
              <a href={`/api/study-resources/${resource.id}/download?disposition=attachment`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black">
                <Download size={16} aria-hidden />下载资料
              </a>
            ) : resource.externalUrl ? (
              <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black">
                <ExternalLink size={16} aria-hidden />打开 {resource.displayHost ?? "链接"}
              </a>
            ) : null}
            {!archived && !editing ? (
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={16} aria-hidden />整理资料
              </Button>
            ) : null}
            {!editing ? <Button type="button" variant="secondary" disabled={pending} onClick={() => archived ? void toggleArchive() : setConfirmation("archive")}>
              {archived ? <RotateCcw size={16} aria-hidden /> : <Archive size={16} aria-hidden />}{archived ? "恢复资料" : "归档资料"}
            </Button> : null}
          </>
        )}
      />

      {archived ? <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">资料已归档，当前只读；相关复习排期已暂停。恢复资料后仍需重新选择复习日期。</div> : null}

      <KnowledgeNextAction
        title={archived ? "恢复资料后再安排学习" : "把资料转成一次真实学习"}
        description={archived ? "资料已归档，当前只保留查看、预览和历史，不会继续进入学习计划。" : resource.taskIds[0] ? "打开关联任务继续学习，资料会保留为本次学习的上下文。" : "关联一个已有任务，或先创建一条最小学习任务。"}
        status={archived ? <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-400">已归档 · 只读</span> : null}
        action={!archived && resource.taskIds[0] ? (
          <Link href={withReturnTo(`/roadmap/allocation/tasks/${resource.taskIds[0]}`, objectHref)} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 hover:bg-teal-300/10"><CalendarCheck size={16} aria-hidden />开始关联任务<ArrowRight size={16} aria-hidden /></Link>
        ) : !archived ? (
          <Link href={`/roadmap/allocation?subjectId=${encodeURIComponent(resource.subjectId ?? "")}&resourceId=${encodeURIComponent(resource.id)}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] hover:bg-teal-300"><CalendarCheck size={16} aria-hidden />创建学习任务<ArrowRight size={16} aria-hidden /></Link>
        ) : null}
      />

      {!editing ? (
        <ResourceFacts resource={resource} options={props.options} objectHref={objectHref} />
      ) : (
        <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="resource-organize-heading">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="resource-organize-heading" className="text-lg font-medium text-white">整理与关联</h2>
            <PersistenceStatus state={conflict ? "conflict" : pending ? "saving" : dirty ? "local-draft" : "clean"} />
          </div>
          <div className="af-content-grid-two grid gap-3">
            <Field label="标题"><Input disabled={archived} className="bg-[#151a20] px-2" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="资料类型"><Select disabled={archived} className="bg-[#151a20] px-2" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
            <Field label="主科目"><Select disabled={archived} className="bg-[#151a20] px-2" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">未选择</option>{props.options.subjects.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select></Field>
            <Field label="标签"><Input disabled={archived} className="bg-[#151a20] px-2" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="逗号分隔" /></Field>
          </div>
          <div className="af-content-grid-two grid gap-3">
            <MultiSelect label="关联任务" values={taskIds} options={props.options.tasks} disabled={archived} onChange={setTaskIds} />
            <MultiSelect label="关联卡片" values={noteIds} options={props.options.notes} disabled={archived} onChange={setNoteIds} />
            <MultiSelect label="关联错题" values={mistakeIds} options={props.options.mistakes} disabled={archived} onChange={setMistakeIds} />
            <MultiSelect label="关联考纲" values={syllabusNodeIds} options={props.options.syllabusNodes} disabled={archived} onChange={setSyllabusNodeIds} />
          </div>
          {!archived ? <EditorActionBar
            primaryLabel="保存资料整理"
            primaryIcon={<Save size={16} aria-hidden />}
            primaryDisabled={Boolean(conflict) || !title.trim()}
            loading={pending}
            onPrimary={() => void save()}
            secondaryLabel="放弃编辑"
            secondaryIcon={<X size={16} aria-hidden />}
            secondaryDisabled={pending}
            onSecondary={requestCancelEditing}
            hint="保存后更新资料元数据与关联；放弃编辑会清除本机草稿。"
          /> : null}
        </section>
      )}

      <section className="space-y-3 border-t border-white/10 pt-5"><h2 className="text-lg font-medium text-white">统一复习</h2><div className="flex flex-wrap gap-2"><Input aria-label="首次复习日期" disabled={archived} type="date" className="!w-auto bg-[#151a20] px-2" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /><Button type="button" variant="secondary" disabled={archived || pending || !reviewDate} onClick={() => void scheduleReview()}>设置首次复习日期</Button></div></section>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {lifecycleRetry ? <Button type="button" variant="secondary" className="border-amber-300/30 text-amber-200" disabled={pending} onClick={() => void toggleArchive(lifecycleRetry)}>再次提交{lifecycleRetry === "archive" ? "归档" : "恢复"}</Button> : null}
      {conflict && !conflictOpen ? <Button type="button" variant="ghost" size="sm" className="h-auto px-0 text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理资料版本冲突</Button> : null}
      <ConfirmationDialog
        open={confirmation !== null}
        title={confirmation === "archive" ? "归档这份资料？" : "放弃本机编辑？"}
        description={confirmation === "archive"
          ? "归档后资料变为只读，活动复习排期会暂停。恢复资料不会自动恢复排期。"
          : "当前未提交的资料元数据和关联会被清除，服务端已保存内容不会改变。"}
        confirmLabel={confirmation === "archive" ? "确认归档" : "放弃并清除草稿"}
        pending={pending && confirmation === "archive"}
        pendingLabel="正在归档"
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation === "archive") {
            setConfirmation(null);
            void toggleArchive("archive");
          } else {
            cancelEditing();
            setConfirmation(null);
          }
        }}
      />
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
