"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import { archiveNote, restoreNote, updateNote } from "@/lib/api/notes";
import { createReviewSchedule } from "@/lib/api/review-schedule";
import type { SafeMarkdownNode } from "@areaforge/core";
import {
  Archive,
  ArrowRight,
  BookOpenCheck,
  CalendarCheck,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KnowledgeObjectDetailHeader } from "@/components/knowledge-object-detail-header";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { NoteDetailDialogs } from "@/components/note-detail-dialogs";
import { SafeMarkdownView } from "@/components/safe-markdown-view";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { Button, IconButton } from "@/components/ui/button";
import { PersistenceStatus } from "@/components/ui/feedback";
import { NoteEditor, NoteRelations, ReviewHistory } from "@/components/note-detail-sections";
import {
  draftsEqual,
  isNoteDetailDraft,
  isNoteDto,
  kindLabel,
  masteryStatusLabel,
  toNoteDraft,
  type NoteConflict,
  type NoteConflictIntent,
  type NoteDetailDraft,
} from "@/components/note-detail-support";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { useUnsavedChangesWarning } from "@/lib/client/use-unsaved-changes-warning";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { NoteEditorOptionsDto } from "@/lib/contracts";
import type { NoteDto } from "@/lib/contracts";
import { formatDate, shanghaiDateInputToIso } from "@/lib/formatters";

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
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreEditFocusRef = useRef(false);
  const editorTitleId = `note-editor-title-${note.id}`;
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (editing) {
        document.getElementById(editorTitleId)?.focus({ preventScroll: true });
        return;
      }
      if (!restoreEditFocusRef.current) return;
      restoreEditFocusRef.current = false;
      editTriggerRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing, editorTitleId]);

  useUnsavedChangesWarning(editing && dirty);

  function updateDraft<K extends keyof NoteDetailDraft>(field: K, value: NoteDetailDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function beginEditing() {
    restoreEditFocusRef.current = false;
    setEditing(true);
  }

  function exitEditingWithFocus() {
    restoreEditFocusRef.current = true;
    setEditing(false);
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
      const response = await updateNote(note.id, {
        expectedRevision: draft.baseRevision,
        subjectId: draft.subjectId,
        syllabusNodeId: draft.syllabusNodeId || null,
        relatedSyllabusNodeIds: draft.relatedSyllabusNodeIds,
        taskId: draft.taskId || null,
        resourceIds: draft.resourceIds,
        kind: draft.kind,
        studyDate: draft.studyDate ? shanghaiDateInputToIso(draft.studyDate) : null,
        title: draft.title,
        content: draft.content,
        masteryStatus: draft.masteryStatus || null,
      });
      const body = response.body;
      if (isUnauthorized(response)) {
        setMessage("登录已过期，卡片草稿仍保留在本机。重新登录后请显式保存。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        router.replace("/knowledge/cards");
        return;
      }
      if (!response.ok) {
        if (isConflict(response) && body?.latest && isNoteDto(body.latest)) {
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
      exitEditingWithFocus();
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
      const response = intent === "archive"
        ? await archiveNote(note.id, { expectedRevision: draft.baseRevision })
        : await restoreNote(note.id, { expectedRevision: draft.baseRevision });
      const body = response.body;
      if (isUnauthorized(response)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        router.replace("/knowledge/cards");
        return;
      }
      if (!response.ok) {
        if (isConflict(response) && body?.latest && isNoteDto(body.latest)) {
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
      const response = await createReviewSchedule({
        targetType: "NOTE",
        noteId: note.id,
        dueDate: shanghaiDateInputToIso(reviewDate),
      });
      const body = response.body;
      if (isUnauthorized(response)) {
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

  function openConflict(intent: NoteConflictIntent, latest: NoteDto, conflictFields?: string[]) {
    setConflict({ intent, latest, conflictFields: conflictFields ?? ["revision"] });
    setConflictOpen(true);
  }

  function adoptServerVersion() {
    if (!conflict) return;
    const next = toNoteDraft(conflict.latest);
    setBaseline(next);
    setDraft(next);
    removePrivateBusinessDraft(draftKey);
    exitEditingWithFocus();
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
    exitEditingWithFocus();
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
    ? withReturnTo(`/knowledge/cards/${note.id}`, props.returnTo)
    : `/knowledge/cards/${note.id}`;
  const scheduleHref = note.reviewSchedule
    ? `/knowledge/reviews/${note.reviewSchedule.id}?returnTo=${encodeURIComponent(objectHref)}`
    : null;
  const readOnly = archived || props.readOnly;

  return (
    <article className="space-y-6" aria-busy={Boolean(pending)}>
      <KnowledgeObjectDetailHeader
        fallbackHref="/knowledge/cards"
        fallbackLabel="返回卡片列表"
        returnTo={props.returnTo}
        eyebrow={`${kindLabel(note.kind)} · ${note.subjectName} · r${note.revision}`}
        title={note.title}
        description={note.masteryStatus ? `掌握状态：${masteryStatusLabel(note.masteryStatus)}` : "掌握状态尚未记录"}
        actions={<>
          {props.readOnly ? null : archived ? (
            <Button type="button" variant="primary" disabled={Boolean(pending)} onClick={() => void changeArchiveState("restore")}>
              <RotateCcw size={16} aria-hidden />恢复卡片
            </Button>
          ) : editing ? null : reviewDue && note.reviewSchedule ? (
            <Link href={`/knowledge/reviews/${note.reviewSchedule.id}/run?returnTo=${encodeURIComponent(objectHref)}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black">
              <BookOpenCheck size={16} aria-hidden />开始复习
            </Link>
          ) : (
            <Button ref={editTriggerRef} type="button" variant="primary" onClick={beginEditing}>
              <Pencil size={16} aria-hidden />编辑卡片
            </Button>
          )}
          {!props.readOnly && !archived && !editing && reviewDue ? (
            <IconButton ref={editTriggerRef} label="编辑卡片" type="button" variant="ghost" size="sm" title="编辑卡片" aria-label="编辑卡片" onClick={beginEditing} className="h-10 w-10 border border-white/10 p-0 text-zinc-200">
              <Pencil size={16} aria-hidden />
            </IconButton>
          ) : null}
          {!props.readOnly && !archived && !editing ? (
            <IconButton label="归档卡片" type="button" variant="ghost" size="sm" title="归档卡片" aria-label="归档卡片" disabled={Boolean(pending)} onClick={() => setConfirmation("archive")} className="h-10 w-10 border border-white/10 p-0 text-zinc-300">
              <Archive size={16} aria-hidden />
            </IconButton>
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
            titleInputId={editorTitleId}
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

      <NoteRelations note={note} readOnly={props.readOnly} />

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

      <NoteDetailDialogs
        state={{
          conflict,
          conflictOpen,
          confirmation,
          archivePending: pending === "archive",
        }}
        baseline={baseline}
        draft={draft}
        actions={{
          closeConflict: () => setConflictOpen(false),
          adoptServerVersion,
          mergeOntoLatest,
          closeConfirmation: () => setConfirmation(null),
          archive: () => void changeArchiveState("archive"),
          discardDraft,
        }}
      />
    </article>
  );
}
