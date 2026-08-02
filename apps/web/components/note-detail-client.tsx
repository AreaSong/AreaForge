"use client";

import type { SafeMarkdownNode } from "@areaforge/core";
import {
  Archive,
  ArrowRight,
  BookOpenCheck,
  CalendarCheck,
  Download,
  FileText,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConflictResolutionModal, type ConflictComparison } from "@/components/conflict-resolution-modal";
import { KnowledgeObjectDetailHeader } from "@/components/knowledge-object-detail-header";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { SafeMarkdownView } from "@/components/safe-markdown-view";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { PersistenceStatus } from "@/components/ui/feedback";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { useUnsavedChangesWarning } from "@/lib/client/use-unsaved-changes-warning";
import { withReturnTo } from "@/lib/navigation/batch7";
import type { NoteEditorOptionsDto } from "@/lib/study/notes-service";
import type { NoteDto, NoteMasteryStatusDto } from "@/lib/study/types";

type NoteKind = "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY";
type ConflictIntent = "save" | "archive" | "restore";

interface NoteDetailDraft {
  baseRevision: number;
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  taskId: string;
  resourceIds: string[];
  kind: NoteKind;
  studyDate: string;
  title: string;
  content: string;
  masteryStatus: NoteMasteryStatusDto | "";
}

interface NoteConflict {
  intent: ConflictIntent;
  latest: NoteDto;
  conflictFields: string[];
}

export function NoteDetailClient(props: {
  userId: string;
  note: NoteDto;
  options: NoteEditorOptionsDto;
  readOnly: boolean;
  subjectArchived: boolean;
  workspaceName: string;
  markdownNodes: SafeMarkdownNode[];
  renderedAt: string;
  returnTo?: string;
}) {
  const { note } = props;
  const router = useRouter();
  const draftKey = `areaforge.note.draft.detail.${props.userId}.${note.id}`;
  const initialDraft = toNoteDraft(note);
  const [baseline, setBaseline] = useState(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  const [editing, setEditing] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [storedDraftOnArchivedNote, setStoredDraftOnArchivedNote] = useState(false);
  const [pending, setPending] = useState<"save" | "archive" | "restore" | "schedule" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState("");
  const [conflict, setConflict] = useState<NoteConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<"archive" | "discard" | null>(null);
  const archived = Boolean(note.archivedAt);
  const dirty = !draftsEqual(draft, baseline);
  const reviewDue = note.reviewSchedule?.status === "ACTIVE"
    && Boolean(note.reviewSchedule.dueDate)
    && Date.parse(note.reviewSchedule.dueDate as string) <= Date.parse(props.renderedAt);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isNoteDetailDraft);
      if (saved) {
        if (props.readOnly || note.archivedAt) {
          setStoredDraftOnArchivedNote(true);
        } else {
          setDraft(saved);
          setEditing(true);
          if (saved.baseRevision !== note.revision) {
            setConflict({ intent: "save", latest: note, conflictFields: ["revision"] });
            setConflictOpen(true);
            setMessage(`本机草稿基于 r${saved.baseRevision}，服务端已是 r${note.revision}；请先比较并人工合并。`);
          } else {
            setMessage("已恢复本机保存的卡片草稿。");
          }
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, note, props.readOnly]);

  useEffect(() => {
    if (!draftReady || archived || props.readOnly) return;
    if (draftsEqual(draft, baseline)) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft(draftKey, draft);
  }, [archived, baseline, draft, draftKey, draftReady, props.readOnly]);

  useUnsavedChangesWarning(editing && dirty);

  function updateDraft<K extends keyof NoteDetailDraft>(field: K, value: NoteDetailDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function changeSubject(subjectId: string) {
    setDraft((current) => ({
      ...current,
      subjectId,
      syllabusNodeId: "",
      relatedSyllabusNodeIds: [],
      taskId: "",
    }));
  }

  async function save() {
    if (pending || archived || props.readOnly) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      setMessage("标题和正文不能为空。");
      return;
    }
    setPending("save");
    setMessage(null);
    savePrivateBusinessDraft(draftKey, draft);
    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: draft.baseRevision,
          subjectId: draft.subjectId,
          syllabusNodeId: draft.syllabusNodeId || null,
          relatedSyllabusNodeIds: draft.relatedSyllabusNodeIds,
          taskId: draft.taskId || null,
          resourceIds: draft.resourceIds,
          kind: draft.kind,
          studyDate: draft.studyDate ? shanghaiDateToIso(draft.studyDate) : null,
          title: draft.title,
          content: draft.content,
          masteryStatus: draft.masteryStatus || null,
        }),
      });
      const body = await readNoteResponse(response);
      if (response.status === 401) {
        setMessage("登录已过期，卡片草稿仍保留在本机。重新登录后请显式保存。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        router.replace("/knowledge/notes");
        return;
      }
      if (!response.ok) {
        if (response.status === 409 && body?.latest && isNoteDto(body.latest)) {
          openConflict("save", body.latest, body.conflictFields);
        }
        setMessage(body?.error ?? "卡片保存失败，本地草稿仍保留。");
        return;
      }
      if (!body?.note || !isNoteDto(body.note)) {
        setMessage("卡片已提交，但响应无法确认；请刷新后核对，系统不会自动重放。");
        return;
      }
      const savedDraft = toNoteDraft(body.note);
      setBaseline(savedDraft);
      setDraft(savedDraft);
      removePrivateBusinessDraft(draftKey);
      setEditing(false);
      setMessage("卡片已保存。");
      router.refresh();
    } catch {
      setMessage("网络不可用，卡片草稿已保留；恢复网络后请显式重试。");
    } finally {
      setPending(null);
    }
  }

  async function changeArchiveState(intent: "archive" | "restore") {
    if (pending || props.readOnly) return;
    if (!draftsEqual(draft, baseline)) savePrivateBusinessDraft(draftKey, draft);
    setPending(intent);
    setMessage(null);
    try {
      const response = await fetch(`/api/notes/${note.id}/${intent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: draft.baseRevision }),
      });
      const body = await readNoteResponse(response);
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        router.replace("/knowledge/notes");
        return;
      }
      if (!response.ok) {
        if (response.status === 409 && body?.latest && isNoteDto(body.latest)) {
          openConflict(intent, body.latest, body.conflictFields);
        }
        setMessage(body?.error ?? `${intent === "archive" ? "归档" : "恢复"}失败，当前状态没有改变。`);
        return;
      }
      setEditing(false);
      setMessage(intent === "archive" ? "卡片已归档，活动复习排期已暂停。" : "卡片已恢复；复习排期仍保持暂停。" );
      router.refresh();
    } catch {
      setMessage(`网络不可用，卡片${intent === "archive" ? "归档" : "恢复"}状态没有改变；请显式重试。`);
    } finally {
      setPending(null);
    }
  }

  async function scheduleReview() {
    if (pending || archived || props.readOnly || !reviewDate) return;
    setPending("schedule");
    setMessage(null);
    try {
      const response = await fetch("/api/review-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "NOTE",
          noteId: note.id,
          dueDate: shanghaiDateToIso(reviewDate),
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setMessage(body?.error ?? "复习排期保存失败，当前排期没有改变。");
        return;
      }
      setReviewDate("");
      setMessage("复习排期已保存。");
      router.refresh();
    } catch {
      setMessage("网络不可用，复习排期没有改变；恢复网络后请显式重试。");
    } finally {
      setPending(null);
    }
  }

  function openConflict(intent: ConflictIntent, latest: NoteDto, conflictFields?: string[]) {
    setConflict({ intent, latest, conflictFields: conflictFields ?? ["revision"] });
    setConflictOpen(true);
  }

  function adoptServerVersion() {
    if (!conflict) return;
    const next = toNoteDraft(conflict.latest);
    setBaseline(next);
    setDraft(next);
    removePrivateBusinessDraft(draftKey);
    setEditing(false);
    setConflict(null);
    setConflictOpen(false);
    setMessage(`已采用服务端最新版本 r${conflict.latest.revision}。`);
    router.refresh();
  }

  function mergeOntoLatest() {
    if (!conflict) return;
    setBaseline(toNoteDraft(conflict.latest));
    setDraft((current) => ({ ...current, baseRevision: conflict.latest.revision }));
    setConflictOpen(false);
    setConflict(null);
    if (conflict.latest.archivedAt) {
      setEditing(false);
      setMessage("服务端最新卡片已归档；本地草稿保留 7 天，但归档状态下不能保存。" );
      router.refresh();
      return;
    }
    setMessage(conflict.intent === "save"
      ? `本地输入已保留，并改为基于服务端 r${conflict.latest.revision}；请检查后显式保存。`
      : `已更新到服务端 r${conflict.latest.revision}；请再次显式执行${conflict.intent === "archive" ? "归档" : "恢复"}。`);
  }

  function discardDraft() {
    setDraft(baseline);
    removePrivateBusinessDraft(draftKey);
    setEditing(false);
    setMessage(null);
  }

  function requestDiscardDraft() {
    if (dirty) setConfirmation("discard");
    else discardDraft();
  }

  const subjectNodes = props.options.syllabusNodes.filter((node) => node.subjectId === draft.subjectId);
  const subjectTasks = props.options.tasks.filter((task) => task.subjectId === draft.subjectId);
  const scheduleCanBeCreated = !note.reviewSchedule || (
    note.reviewSchedule.status === "PAUSED" && note.reviewSchedule.pausedReason === "TARGET_ARCHIVED"
  );
  const objectHref = props.returnTo
    ? withReturnTo(`/knowledge/notes/${note.id}`, props.returnTo)
    : `/knowledge/notes/${note.id}`;
  const scheduleHref = note.reviewSchedule
    ? `/knowledge/reviews/${note.reviewSchedule.id}?returnTo=${encodeURIComponent(objectHref)}`
    : null;
  const readOnly = archived || props.readOnly;

  return (
    <article className="space-y-6" aria-busy={Boolean(pending)}>
      <KnowledgeObjectDetailHeader
        fallbackHref="/knowledge/notes"
        fallbackLabel="返回卡片列表"
        returnTo={props.returnTo}
        eyebrow={`${kindLabel(note.kind)} · ${note.subjectName} · r${note.revision}`}
        title={note.title}
        description={note.masteryStatus ? `掌握状态：${masteryStatusLabel(note.masteryStatus)}` : "掌握状态尚未记录"}
        actions={<>
          {props.readOnly ? null : archived ? (
            <button type="button" disabled={Boolean(pending)} onClick={() => void changeArchiveState("restore")} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black disabled:opacity-50">
              <RotateCcw size={16} aria-hidden />恢复卡片
            </button>
          ) : editing ? null : reviewDue && note.reviewSchedule ? (
            <Link href={`/quick-review/${note.reviewSchedule.id}?returnTo=${encodeURIComponent(objectHref)}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black">
              <BookOpenCheck size={16} aria-hidden />开始复习
            </Link>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black">
              <Pencil size={16} aria-hidden />编辑卡片
            </button>
          )}
          {!props.readOnly && !archived && !editing && reviewDue ? (
            <button type="button" title="编辑卡片" aria-label="编辑卡片" onClick={() => setEditing(true)} className="grid size-10 place-items-center rounded-md border border-white/10 text-zinc-200">
              <Pencil size={16} aria-hidden />
            </button>
          ) : null}
          {!props.readOnly && !archived && !editing ? (
            <button type="button" title="归档卡片" aria-label="归档卡片" disabled={Boolean(pending)} onClick={() => setConfirmation("archive")} className="grid size-10 place-items-center rounded-md border border-white/10 text-zinc-300 disabled:opacity-50">
              <Archive size={16} aria-hidden />
            </button>
          ) : null}
        </>}
      />

      {props.readOnly ? (
        <p role="status" className="border-l-2 border-zinc-500 pl-3 text-sm leading-6 text-zinc-300">
          {props.subjectArchived
            ? `“${note.subjectName}”科目已归档，本页只读保留卡片、附件与复习历史；不会进入当前排期或写事务。`
            : `“${props.workspaceName}”工作区已归档，本页只读保留卡片、附件与复习历史；不会进入当前排期或写事务。`}
          {storedDraftOnArchivedNote ? " 本机仍保留一份 7 天编辑草稿，但不会在当前只读范围应用。" : ""}
        </p>
      ) : archived ? (
        <p role="status" className="border-l-2 border-amber-400/60 pl-3 text-sm leading-6 text-amber-100">
          卡片已归档，当前只读；复习排期不会随卡片恢复而自动恢复。
          {storedDraftOnArchivedNote ? " 本机仍保留一份 7 天编辑草稿。" : ""}
        </p>
      ) : null}
      {message ? <p role="status" className="text-sm text-amber-100">{message}</p> : null}

      <KnowledgeNextAction
        title={readOnly ? "保留卡片内容与复习历史" : reviewDue ? "完成这张卡片的到期复习" : note.reviewSchedule?.status === "ACTIVE" ? "按排期继续复习这张卡片" : "安排这张卡片的首次复习"}
        description={readOnly
          ? "当前对象只读，仍可查看正文、关联和历史。"
          : reviewDue
            ? "到期复习由页头主操作承接，完成后会更新连续通过次数和下次日期。"
            : note.reviewSchedule?.status === "ACTIVE"
              ? `下一次复习：${note.reviewSchedule.dueDate ? formatDate(note.reviewSchedule.dueDate) : "未设置日期"}。`
              : "先选择一个日期建立统一复习排期，之后会出现在复习队列中。"}
        status={readOnly ? <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-400">{props.readOnly ? "只读" : "已归档"}</span> : reviewDue ? <span className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">已到期 · 从页头开始</span> : null}
        action={!readOnly && !reviewDue && scheduleHref ? (
          <Link href={scheduleHref} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 hover:bg-teal-300/10">
            <CalendarCheck size={16} aria-hidden />查看复习排期<ArrowRight size={16} aria-hidden />
          </Link>
        ) : !readOnly && !reviewDue ? (
          <a href="#note-review-section" className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] hover:bg-teal-300">
            <CalendarCheck size={16} aria-hidden />设置首次复习<ArrowRight size={16} aria-hidden />
          </a>
        ) : null}
      />

      {editing && !archived && !props.readOnly ? (
        <div className="space-y-3">
          <PersistenceStatus state={conflict ? "conflict" : pending === "save" ? "saving" : dirty ? "local-draft" : "clean"} />
          <NoteEditor
            draft={draft}
            options={props.options}
            subjectNodes={subjectNodes}
            subjectTasks={subjectTasks}
            disabled={Boolean(pending)}
            onSubjectChange={changeSubject}
            onChange={updateDraft}
          />
          <EditorActionBar
            primaryLabel="保存卡片"
            primaryIcon={<Save size={16} aria-hidden />}
            primaryDisabled={Boolean(conflict) || !draft.title.trim() || !draft.content.trim()}
            loading={pending === "save"}
            onPrimary={() => void save()}
            secondaryLabel="放弃编辑"
            secondaryIcon={<X size={16} aria-hidden />}
            secondaryDisabled={Boolean(pending)}
            onSecondary={requestDiscardDraft}
            hint="保存后更新卡片内容；放弃编辑会清除本机草稿。"
          />
        </div>
      ) : (
        <section aria-labelledby="note-content-heading" className="min-w-0">
          <h2 id="note-content-heading" className="sr-only">卡片正文</h2>
          <SafeMarkdownView nodes={props.markdownNodes} />
        </section>
      )}

      <section className="grid gap-6 border-t border-white/10 pt-5 lg:grid-cols-2" aria-labelledby="note-relations-heading">
        <div>
          <h2 id="note-relations-heading" className="text-lg font-medium text-white">学习关联</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <RelationRow label="主考纲">
              {note.syllabusNodeId
                ? props.readOnly
                  ? note.syllabusNodeTitle
                  : <Link className="text-teal-300 hover:underline" href={`/knowledge/syllabus/${note.syllabusNodeId}`}>{note.syllabusNodeTitle}</Link>
                : "未关联"}
            </RelationRow>
            <RelationRow label="相关考纲">
              {note.relatedSyllabusNodes.length > 0 ? note.relatedSyllabusNodes.map((node) => (
                props.readOnly
                  ? <span key={node.id} className="mr-3 inline-block">{node.title}{node.archivedAt ? "（已归档）" : ""}</span>
                  : <Link key={node.id} className="mr-3 inline-block text-teal-300 hover:underline" href={`/knowledge/syllabus/${node.id}`}>{node.title}{node.archivedAt ? "（已归档）" : ""}</Link>
              )) : "未关联"}
            </RelationRow>
            <RelationRow label="任务">
              {note.taskId ? <Link className="text-teal-300 hover:underline" href={`/today/tasks/${note.taskId}`}>{note.taskTitle}</Link> : "未关联"}
            </RelationRow>
            <RelationRow label="资料">
              {note.linkedResources.length > 0 ? note.linkedResources.map((resource) => (
                props.readOnly
                  ? <span key={resource.id} className="mr-3 inline-block">{resource.title}{resource.archivedAt ? "（已归档）" : ""}</span>
                  : <Link key={resource.id} className="mr-3 inline-block text-teal-300 hover:underline" href={`/knowledge/resources/${resource.id}`}>{resource.title}{resource.archivedAt ? "（已归档）" : ""}</Link>
              )) : "未关联"}
            </RelationRow>
          </dl>
        </div>

        <div>
          <h2 className="text-lg font-medium text-white">附件</h2>
          <ul className="mt-3 space-y-2">
            {note.attachments.map((attachment) => (
              <li key={attachment.id} className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 pb-2 text-sm">
                <span className="min-w-0"><span className="flex items-center gap-2 truncate text-zinc-200"><FileText size={15} aria-hidden />{attachment.originalName}</span><span className="text-xs text-zinc-500">{formatBytes(attachment.sizeBytes)}</span></span>
                <a href={attachment.downloadApiPath} aria-label={`下载 ${attachment.originalName}`} title="下载附件" className="grid size-9 shrink-0 place-items-center rounded-md border border-white/10 text-teal-300"><Download size={15} aria-hidden /></a>
              </li>
            ))}
            {note.attachments.length === 0 ? <li className="text-sm text-zinc-500">暂无附件。</li> : null}
          </ul>
        </div>
      </section>

      <ReviewHistory
        note={note}
        archived={archived || props.readOnly}
        readOnly={props.readOnly}
        pending={Boolean(pending)}
        reviewDate={reviewDate}
        scheduleCanBeCreated={scheduleCanBeCreated}
        returnHref={objectHref}
        onReviewDateChange={setReviewDate}
        onSchedule={() => void scheduleReview()}
      />

      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理卡片版本冲突"
        description="服务端卡片已变化。本地草稿仍保留，系统不会强制覆盖或自动重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={buildConflictComparisons(baseline, draft, conflict?.latest)}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={mergeOntoLatest}
        mergeLabel={conflict?.intent === "save" ? "保留本地并基于最新版本" : "更新基线后手动重试"}
      />
      <ConfirmationDialog
        open={confirmation !== null}
        title={confirmation === "archive" ? "归档这张卡片？" : "放弃本机编辑？"}
        description={confirmation === "archive"
          ? "归档后卡片变为只读，活动复习排期会暂停。恢复卡片不会自动恢复排期。"
          : "当前未提交内容和本机草稿会被清除，服务端已保存内容不会改变。"}
        confirmLabel={confirmation === "archive" ? "确认归档" : "放弃并清除草稿"}
        pending={pending === "archive"}
        pendingLabel="正在归档"
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation === "archive") {
            setConfirmation(null);
            void changeArchiveState("archive");
          } else {
            discardDraft();
            setConfirmation(null);
          }
        }}
      />
    </article>
  );
}

function NoteEditor(props: {
  draft: NoteDetailDraft;
  options: NoteEditorOptionsDto;
  subjectNodes: NoteEditorOptionsDto["syllabusNodes"];
  subjectTasks: NoteEditorOptionsDto["tasks"];
  disabled: boolean;
  onSubjectChange: (subjectId: string) => void;
  onChange: <K extends keyof NoteDetailDraft>(field: K, value: NoteDetailDraft[K]) => void;
}) {
  return (
    <section className="space-y-4" aria-labelledby="note-editor-heading">
      <h2 id="note-editor-heading" className="text-lg font-medium text-white">编辑卡片</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="标题"><input disabled={props.disabled} value={props.draft.title} onChange={(event) => props.onChange("title", event.target.value)} className={inputClass} /></Field>
        <Field label="卡片类型"><select disabled={props.disabled} value={props.draft.kind} onChange={(event) => props.onChange("kind", event.target.value as NoteKind)} className={inputClass}>{noteKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="科目"><select disabled={props.disabled} value={props.draft.subjectId} onChange={(event) => props.onSubjectChange(event.target.value)} className={inputClass}>{props.options.subjects.map((subject) => <option key={subject.id} value={subject.id} disabled={Boolean(subject.archivedAt)}>{subject.name}{subject.archivedAt ? "（已归档）" : ""}</option>)}</select></Field>
        <Field label="学习日期"><input type="date" disabled={props.disabled} value={props.draft.studyDate} onChange={(event) => props.onChange("studyDate", event.target.value)} className={inputClass} /></Field>
        <Field label="掌握状态"><select disabled={props.disabled} value={props.draft.masteryStatus} onChange={(event) => props.onChange("masteryStatus", event.target.value as NoteDetailDraft["masteryStatus"])} className={inputClass}><option value="">未记录</option><option value="understood">理解了</option><option value="partial">似懂非懂</option><option value="unknown">不会</option><option value="relearn">需要重学</option><option value="before_exam">考前再看</option></select></Field>
        <Field label="关联任务"><select disabled={props.disabled} value={props.draft.taskId} onChange={(event) => props.onChange("taskId", event.target.value)} className={inputClass}><option value="">未关联</option>{props.subjectTasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {task.status}</option>)}</select></Field>
        <Field label="主考纲"><select disabled={props.disabled} value={props.draft.syllabusNodeId} onChange={(event) => { const id = event.target.value; props.onChange("syllabusNodeId", id); props.onChange("relatedSyllabusNodeIds", props.draft.relatedSyllabusNodeIds.filter((relatedId) => relatedId !== id)); }} className={inputClass}><option value="">未关联</option>{props.subjectNodes.map((node) => <option key={node.id} value={node.id} disabled={Boolean(node.archivedAt)}>{node.title}{node.archivedAt ? "（已归档）" : ""}</option>)}</select></Field>
        <MultiSelect label="相关考纲" values={props.draft.relatedSyllabusNodeIds} options={props.subjectNodes.filter((node) => node.id !== props.draft.syllabusNodeId).map((node) => ({ id: node.id, title: node.title, disabled: Boolean(node.archivedAt) }))} disabled={props.disabled} onChange={(values) => props.onChange("relatedSyllabusNodeIds", values)} />
        <MultiSelect label="关联资料" values={props.draft.resourceIds} options={props.options.resources.map((resource) => ({ id: resource.id, title: resource.title, disabled: Boolean(resource.archivedAt) }))} disabled={props.disabled} onChange={(values) => props.onChange("resourceIds", values)} />
      </div>
      <Field label="Markdown 正文"><textarea disabled={props.disabled} value={props.draft.content} onChange={(event) => props.onChange("content", event.target.value)} className="min-h-72 w-full rounded-md border border-white/10 bg-[#151a20] px-3 py-2 font-mono text-sm leading-6 text-zinc-100" /></Field>
    </section>
  );
}

function ReviewHistory(props: { note: NoteDto; archived: boolean; readOnly: boolean; pending: boolean; reviewDate: string; scheduleCanBeCreated: boolean; returnHref: string; onReviewDateChange: (value: string) => void; onSchedule: () => void }) {
  const schedule = props.note.reviewSchedule;
  return (
    <section id="note-review-section" className="scroll-mt-6 border-t border-white/10 pt-5" aria-labelledby="note-review-heading">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="note-review-heading" className="text-lg font-medium text-white">复习排期与历史</h2>{schedule && !props.readOnly ? <Link className="text-sm text-teal-300 hover:underline" href={`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(props.returnHref)}`}>打开排期详情</Link> : null}</div>
      {schedule ? <p className="mt-2 text-sm text-zinc-400">{schedule.status === "ACTIVE" ? "进行中" : "已暂停"} · {schedule.dueDate ? `到期 ${formatDate(schedule.dueDate)}` : "未设置日期"} · 连续通过 {schedule.consecutivePassCount}</p> : <p className="mt-2 text-sm text-zinc-500">尚未建立复习排期。</p>}
      {!props.archived && props.scheduleCanBeCreated ? <div className="mt-3 flex flex-wrap gap-2"><input aria-label="复习日期" type="date" disabled={props.pending} value={props.reviewDate} onChange={(event) => props.onReviewDateChange(event.target.value)} className={inputClass} /><button type="button" disabled={props.pending || !props.reviewDate} onClick={props.onSchedule} className="h-10 rounded-md border border-white/10 px-3 text-sm text-teal-200 disabled:opacity-50">{schedule ? "重新排期" : "设置首次复习"}</button></div> : null}
      <ol className="mt-4 space-y-3">
        {schedule?.events.map((event) => <li key={event.id} className="border-l border-white/10 pl-3 text-sm text-zinc-300"><span className="text-zinc-100">{reviewResultLabel(event.result)}</span> · {event.durationSeconds} 秒 · {formatDateTime(event.confirmedAt)}{event.correctedEventId ? <span className="ml-2 text-xs text-amber-300">更正事件</span> : null}{event.note ? <p className="mt-1 text-zinc-500">{event.note}</p> : null}</li>)}
        {schedule && schedule.events.length === 0 ? <li className="text-sm text-zinc-500">尚无复习事件。</li> : null}
      </ol>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm text-zinc-400"><span>{label}</span><span className="mt-1 block">{children}</span></label>;
}

function MultiSelect(props: { label: string; values: string[]; options: Array<{ id: string; title: string; disabled?: boolean }>; disabled: boolean; onChange: (values: string[]) => void }) {
  return <Field label={props.label}><select multiple disabled={props.disabled} value={props.values} onChange={(event) => props.onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value).sort())} className="min-h-28 w-full rounded-md border border-white/10 bg-[#151a20] p-2 text-zinc-100">{props.options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.title}{option.disabled ? "（已归档）" : ""}</option>)}</select></Field>;
}

function RelationRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[5rem_1fr] gap-3"><dt className="text-zinc-500">{label}</dt><dd className="min-w-0 text-zinc-300">{children}</dd></div>;
}

function buildConflictComparisons(baseline: NoteDetailDraft, local: NoteDetailDraft, latest?: NoteDto): ConflictComparison[] {
  const server = latest ? toNoteDraft(latest) : null;
  const fields: Array<[keyof NoteDetailDraft, string]> = [["title", "标题"], ["content", "正文"], ["kind", "类型"], ["studyDate", "学习日期"], ["subjectId", "科目"], ["syllabusNodeId", "主考纲"], ["relatedSyllabusNodeIds", "相关考纲"], ["taskId", "任务"], ["resourceIds", "资料"], ["masteryStatus", "掌握状态"]];
  return [{ field: "revision", label: "revision", baseline: baseline.baseRevision, local: local.baseRevision, server: latest?.revision }, ...fields.map(([field, label]) => ({ field, label, baseline: baseline[field], local: local[field], server: server?.[field] }))];
}

async function readNoteResponse(response: Response): Promise<{ error?: string; note?: unknown; latest?: unknown; conflictFields?: string[] } | null> {
  return response.json().catch(() => null) as Promise<{ error?: string; note?: unknown; latest?: unknown; conflictFields?: string[] } | null>;
}

function toNoteDraft(note: NoteDto): NoteDetailDraft {
  return { baseRevision: note.revision, subjectId: note.subjectId, syllabusNodeId: note.syllabusNodeId ?? "", relatedSyllabusNodeIds: [...note.relatedSyllabusNodeIds].sort(), taskId: note.taskId ?? "", resourceIds: note.linkedResources.map((resource) => resource.id).sort(), kind: note.kind as NoteKind, studyDate: note.studyDate?.slice(0, 10) ?? "", title: note.title, content: note.content, masteryStatus: note.masteryStatus ?? "" };
}

function isNoteDetailDraft(value: unknown): value is NoteDetailDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NoteDetailDraft>;
  return Number.isInteger(draft.baseRevision) && (draft.baseRevision ?? 0) > 0 && [draft.subjectId, draft.syllabusNodeId, draft.taskId, draft.kind, draft.studyDate, draft.title, draft.content, draft.masteryStatus].every((item) => typeof item === "string") && Array.isArray(draft.relatedSyllabusNodeIds) && draft.relatedSyllabusNodeIds.every((id) => typeof id === "string") && Array.isArray(draft.resourceIds) && draft.resourceIds.every((id) => typeof id === "string");
}

function isNoteDto(value: unknown): value is NoteDto {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<NoteDto>;
  return typeof note.id === "string" && typeof note.revision === "number" && typeof note.title === "string" && typeof note.content === "string" && Array.isArray(note.relatedSyllabusNodeIds) && Array.isArray(note.linkedResources) && Array.isArray(note.attachments);
}

function draftsEqual(left: NoteDetailDraft, right: NoteDetailDraft): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function shanghaiDateToIso(value: string): string { return new Date(`${value}T00:00:00+08:00`).toISOString(); }
function formatDate(value: string): string { return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }); }
function formatDateTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }); }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function reviewResultLabel(value: string): string { return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过"; }
function masteryStatusLabel(value: NoteMasteryStatusDto): string {
  return ({ understood: "理解了", partial: "似懂非懂", unknown: "不会", relearn: "需要重学", before_exam: "考前再看" } as Record<NoteMasteryStatusDto, string>)[value];
}
function kindLabel(value: string): string { return noteKinds.find(([kind]) => kind === value)?.[1] ?? value; }

const inputClass = "h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100";
const noteKinds: ReadonlyArray<readonly [NoteKind, string]> = [["GENERAL", "通用"], ["CONCEPT", "概念"], ["METHOD", "方法"], ["EXAMPLE", "例题"], ["JOURNAL", "学习记录"], ["SUMMARY", "总结"]];
