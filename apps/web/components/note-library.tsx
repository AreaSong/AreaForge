"use client";

import { ArrowRight, BookOpenCheck, Download, FileText, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import { Toolbar } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import { withReturnTo } from "@/lib/navigation/batch7";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { NoteDto, NoteMasteryStatusDto, StudyTaskDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";

interface NoteLibraryProps {
  userId: string;
  subjects: SubjectDto[];
  tasks: StudyTaskDto[];
  nodes: SyllabusOptionNodeDto[];
  notes: NoteDto[];
  initialSubjectId?: string;
  initialSyllabusNodeId?: string;
  initialTaskId?: string;
  initialMasteryStatus?: string;
  initialReviewFilter?: string;
  initialQuery?: string;
  initialCreate?: boolean;
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

interface NoteFormDraft {
  subjectId: string;
  syllabusNodeId: string;
  taskId: string;
  title: string;
  content: string;
  kind: "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY";
  masteryStatus: NoteMasteryStatusDto;
  nextReviewAt: string;
}

export function NoteLibrary({ userId, subjects, tasks, nodes, notes, initialSubjectId, initialSyllabusNodeId, initialTaskId, initialMasteryStatus, initialReviewFilter, initialQuery, initialCreate }: NoteLibraryProps) {
  const router = useRouter();
  const createTitleRef = useRef<HTMLInputElement>(null);
  const formDraftKey = `areaforge.note.draft.${userId}.create`;
  useRestoreListReturn();
  const initialSubject = subjects.some((subject) => subject.id === initialSubjectId) ? initialSubjectId as string : subjects[0]?.id ?? "";
  const initialNode = flattenNodes(nodes).some((node) => node.id === initialSyllabusNodeId && node.subjectId === initialSubject) ? initialSyllabusNodeId as string : "";
  const initialTask = tasks.some((task) => task.id === initialTaskId && task.subjectId === initialSubject) ? initialTaskId as string : "";
  const [subjectId, setSubjectId] = useState(initialSubject);
  const [syllabusNodeId, setSyllabusNodeId] = useState(initialNode);
  const [taskId, setTaskId] = useState(initialTask);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<"GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY">("GENERAL");
  const [masteryStatus, setMasteryStatus] = useState<NoteMasteryStatusDto>("partial");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [noteSubjectFilter, setNoteSubjectFilter] = useState(initialSubjectId && subjects.some((subject) => subject.id === initialSubjectId) ? initialSubjectId : "all");
  const [noteNodeFilter, setNoteNodeFilter] = useState(initialNode || "all");
  const [noteMasteryFilter, setNoteMasteryFilter] = useState<"all" | NoteMasteryStatusDto>(() => isNoteMasteryFilter(initialMasteryStatus) ? initialMasteryStatus : "all");
  const [noteReviewFilter, setNoteReviewFilter] = useState<"all" | "due" | "scheduled" | "none">(() => isNoteReviewFilter(initialReviewFilter) ? initialReviewFilter : "all");
  const [uploadingNoteId, setUploadingNoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createdNotes, setCreatedNotes] = useState<NoteDto[]>([]);
  const [createOpen, setCreateOpen] = useState(Boolean(initialCreate));
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(() => {
      createTitleRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [createOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const raw = window.localStorage.getItem(aiKnowledgeCardDraftKey(userId));
      if (!raw) return;
      try {
        const envelope = JSON.parse(raw) as { version?: number; userId?: string; updatedAt?: number; value?: { title?: string; body?: string; kindHint?: string } };
        if (envelope.version !== 1 || envelope.userId !== userId || typeof envelope.updatedAt !== "number" || Date.now() - envelope.updatedAt > 7 * 24 * 60 * 60 * 1000) {
          window.localStorage.removeItem(aiKnowledgeCardDraftKey(userId));
          return;
        }
        if (typeof envelope.value?.title === "string") setTitle(envelope.value.title);
        if (typeof envelope.value?.body === "string") setContent(envelope.value.body);
        if (isNoteKind(envelope.value?.kindHint)) setKind(envelope.value.kindHint);
      } catch {
        window.localStorage.removeItem(aiKnowledgeCardDraftKey(userId));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isNoteFormDraft);
      if (draft) {
        setSubjectId(draft.subjectId);
        setSyllabusNodeId(draft.syllabusNodeId);
        setTaskId(draft.taskId);
        setTitle(draft.title);
        setContent(draft.content);
        setKind(draft.kind);
        setMasteryStatus(draft.masteryStatus);
        setNextReviewAt(draft.nextReviewAt);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (!title && !content) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<NoteFormDraft>(formDraftKey, {
      subjectId,
      syllabusNodeId,
      taskId,
      title,
      content,
      kind,
      masteryStatus,
      nextReviewAt,
    });
  }, [content, draftReady, formDraftKey, kind, masteryStatus, nextReviewAt, subjectId, syllabusNodeId, taskId, title]);

  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const taskOptions = tasks.filter((task) => task.subjectId === subjectId);
  const filterNodeOptions = useMemo(
    () => flatNodes.filter((node) => noteSubjectFilter === "all" || node.subjectId === noteSubjectFilter),
    [flatNodes, noteSubjectFilter],
  );
  const visibleNotes = useMemo(
    () => [...createdNotes.filter((created) => !notes.some((note) => note.id === created.id)), ...notes],
    [createdNotes, notes],
  );
  const filteredNotes = useMemo(
    () => visibleNotes.filter((note) =>
      matchesSubject(note, noteSubjectFilter) &&
      matchesNode(note, noteNodeFilter) &&
      matchesMastery(note, noteMasteryFilter) &&
      matchesReview(note, noteReviewFilter),
    ),
    [visibleNotes, noteSubjectFilter, noteNodeFilter, noteMasteryFilter, noteReviewFilter],
  );
  const hasListFilters = noteSubjectFilter !== "all" || noteNodeFilter !== "all" || noteMasteryFilter !== "all" || noteReviewFilter !== "all";
  const currentListHref = buildNoteListHref({
    query: initialQuery,
    subject: noteSubjectFilter,
    node: noteNodeFilter,
    mastery: noteMasteryFilter,
    review: noteReviewFilter,
  });

  function applyListFilters(next: Partial<{
    subject: string;
    node: string;
    mastery: "all" | NoteMasteryStatusDto;
    review: "all" | "due" | "scheduled" | "none";
  }>) {
    const subject = next.subject ?? noteSubjectFilter;
    const node = next.node ?? noteNodeFilter;
    const mastery = next.mastery ?? noteMasteryFilter;
    const review = next.review ?? noteReviewFilter;
    setNoteSubjectFilter(subject);
    setNoteNodeFilter(node);
    setNoteMasteryFilter(mastery);
    setNoteReviewFilter(review);
    updateKnowledgeContext({
      subjectId: subject === "all" ? null : subject,
      syllabusNodeId: node === "all" || node === "none" ? null : node,
    });
    startTransition(() => router.replace(buildNoteListHref({ query: initialQuery, subject, node, mastery, review })));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const payload = {
      subjectId,
      syllabusNodeId: syllabusNodeId || null,
      taskId: taskId || null,
      kind,
      title,
      content,
      masteryStatus,
      nextReviewAt: nextReviewAt ? new Date(nextReviewAt).toISOString() : null,
    };
    const commandScope = `note:create:${userId}`;
    let createdNote: NoteDto | null = null;
    setSaving(true);

    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "note-create", payload),
          ...payload,
        }),
      });

      if (response.status === 401) {
        setError("登录已过期，卡片草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "保存卡片失败，草稿已保留");
        return;
      }
      const body = (await response.json().catch(() => null)) as { note?: NoteDto } | null;
      if (!body?.note) {
        setError("服务端未返回已创建卡片，当前草稿与重试标识仍保留");
        return;
      }
      createdNote = body.note;
    } catch {
      setError("网络不可用，卡片草稿已保留；恢复网络后请显式重试。");
      return;
    } finally {
      setSaving(false);
    }

    if (!createdNote) return;
    completeIdempotentCommand(commandScope);
    setCreatedNotes((current) => current.some((note) => note.id === createdNote.id)
      ? current
      : [createdNote, ...current]);
    setTitle("");
    setContent("");
    setKind("GENERAL");
    window.localStorage.removeItem(aiKnowledgeCardDraftKey(userId));
    removePrivateBusinessDraft(formDraftKey);
    setSyllabusNodeId("");
    setTaskId("");
    setNextReviewAt("");
    setCreateOpen(false);
    startTransition(() => router.push(withReturnTo(`/knowledge/cards/${createdNote.id}`, currentListHref)));
  }

  async function uploadAttachment(noteId: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploadingNoteId(noteId);
    const commandScope = `note-attachment:upload:${userId}:${noteId}`;
    const idempotencyKey = getOrCreateIdempotencyKey(commandScope, "note-attachment", {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });

    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(`/api/notes/${noteId}/attachments`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: formData,
      });
      if (response.status === 401) {
        setError("登录已过期；上传命令身份已保留。重新登录并选择同一文件后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(labelAttachmentError(body?.error));
        return;
      }
      completeIdempotentCommand(commandScope);
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，附件未上传；请恢复网络后重新选择文件。");
    } finally {
      setUploadingNoteId(null);
    }
  }

  return (
    <>
      <Drawer open={createOpen} title="新增卡片" onClose={() => setCreateOpen(false)}>
        <form className="grid min-w-0 gap-3" onSubmit={submit}>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <select
              className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={subjectId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setSyllabusNodeId("");
                setTaskId("");
              }}
              required
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
            <select aria-label="卡片类型" className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="GENERAL">通用</option><option value="CONCEPT">概念</option><option value="METHOD">方法</option><option value="EXAMPLE">例题</option><option value="JOURNAL">学习记录</option><option value="SUMMARY">总结</option>
            </select>
            <select
              className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={masteryStatus}
              onChange={(event) => setMasteryStatus(event.target.value as NoteMasteryStatusDto)}
            >
              <option value="understood">理解了</option>
              <option value="partial">似懂非懂</option>
              <option value="unknown">不会</option>
              <option value="relearn">需要重学</option>
              <option value="before_exam">考前再看</option>
            </select>
          </div>

          <select
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={syllabusNodeId}
            onChange={(event) => setSyllabusNodeId(event.target.value)}
          >
            <option value="">不关联考纲节点</option>
            {nodeOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {"  ".repeat(node.depth)}
                {node.title}
              </option>
            ))}
          </select>

          <select
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
          >
            <option value="">不关联任务</option>
            {taskOptions.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>

          <input
            ref={createTitleRef}
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="卡片标题"
            required
          />
          <textarea
            className="min-h-44 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="写下自己的理解、题解或复盘产出"
            required
          />
          <input
            className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            type="datetime-local"
            value={nextReviewAt}
            onChange={(event) => setNextReviewAt(event.target.value)}
            aria-label="下次复习时间"
          />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || saving || !subjectId}
          >
            <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
            保存卡片
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      </Drawer>

      {!createOpen && error ? <p className="text-sm text-red-200">{error}</p> : null}
      <section className="min-w-0 border-y border-white/10 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">我的卡片</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
              {filteredNotes.length} / {visibleNotes.length} 条
            </span>
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              新增卡片
            </Button>
          </div>
        </div>

        <Toolbar className="mt-5" label="卡片筛选">
          <select
            aria-label="筛选卡片科目"
            className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteSubjectFilter}
            onChange={(event) => {
              applyListFilters({ subject: event.target.value, node: "all" });
            }}
          >
            <option value="all">全部科目</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选卡片考纲节点"
            className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteNodeFilter}
            onChange={(event) => applyListFilters({ node: event.target.value })}
          >
            <option value="all">全部节点</option>
            <option value="none">未关联节点</option>
            {filterNodeOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {"  ".repeat(node.depth)}
                {node.title}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选卡片掌握状态"
            className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteMasteryFilter}
            onChange={(event) => applyListFilters({ mastery: event.target.value as "all" | NoteMasteryStatusDto })}
          >
            <option value="all">全部掌握状态</option>
            <option value="understood">理解了</option>
            <option value="partial">似懂非懂</option>
            <option value="unknown">不会</option>
            <option value="relearn">需要重学</option>
            <option value="before_exam">考前再看</option>
          </select>
          <select
            aria-label="筛选卡片复习状态"
            className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteReviewFilter}
            onChange={(event) => applyListFilters({ review: event.target.value as "all" | "due" | "scheduled" | "none" })}
          >
            <option value="all">全部复习提醒</option>
            <option value="due">已到期</option>
            <option value="scheduled">已设置</option>
            <option value="none">未设置</option>
          </select>
          {initialQuery ? <Badge tone="info">搜索：{initialQuery}</Badge> : null}
          {hasListFilters ? <Button type="button" size="sm" variant="ghost" onClick={() => applyListFilters({ subject: "all", node: "all", mastery: "all", review: "all" })}>清除筛选</Button> : null}
        </Toolbar>

        <div className="mt-5">
          {visibleNotes.length === 0 ? (
            <EmptyState title={initialQuery ? "没有匹配的卡片" : "还没有卡片"} description={initialQuery ? "尝试修改搜索词或清除筛选。" : "计时结束后的最小产出可以在这里沉淀下来。"} />
          ) : null}
          {visibleNotes.length > 0 && filteredNotes.length === 0 ? (
            <EmptyState title="当前筛选没有结果" description="调整筛选条件，或清除筛选查看全部卡片。" action={<Button type="button" size="sm" onClick={() => applyListFilters({ subject: "all", node: "all", mastery: "all", review: "all" })}>清除筛选</Button>} />
          ) : null}
          {filteredNotes.length > 0 ? <div className="divide-y divide-white/10 border-y border-white/10">{filteredNotes.map((note) => (
            <article key={note.id} className="min-w-0 py-4">
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-zinc-500">{note.subjectName}</p>
                    <Badge tone="info">{labelMastery(note.masteryStatus)}</Badge>
                    {note.nextReviewAt ? <Badge tone="warning">复习 {new Date(note.nextReviewAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</Badge> : null}
                  </div>
                  <h3 className="mt-2 break-words font-medium text-white">{note.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">{note.syllabusNodeTitle ?? "未关联考纲"}</p>
                </div>
                <ListDetailLink
                  href={`/knowledge/cards/${note.id}`}
                  focusId={`note-${note.id}`}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-teal-300 hover:bg-white/[0.05]"
                >
                  打开详情
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ListDetailLink>
              </div>
              <p className="mt-3 max-h-12 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-zinc-300">{note.content}</p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                {note.taskTitle ? <span>任务：{note.taskTitle}</span> : null}
                <span>更新：{new Date(note.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</span>
              </div>
              <details className="mt-3 border-t border-white/10 pt-3">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  附件 {note.attachments.length}
                </summary>
                <div className="mt-3 rounded-md border border-white/10 bg-[#0d1117] p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">附件管理</p>
                    <p className="mt-1 text-xs text-zinc-500">PDF、PNG、JPEG、WebP</p>
                  </div>
                  <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 hover:bg-teal-300/10">
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    {uploadingNoteId === note.id ? "上传中" : "上传"}
                    <input
                      className="sr-only"
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      disabled={uploadingNoteId === note.id}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        void uploadAttachment(note.id, file);
                      }}
                    />
                  </label>
                </div>
                {note.attachments.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {note.attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex flex-col gap-2 rounded-md border border-white/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-zinc-100">{attachment.originalName}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {attachment.mimeType} / {formatBytes(attachment.sizeBytes)}
                          </p>
                        </div>
                        <a
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-xs text-zinc-100 hover:bg-white/10"
                          href={attachment.downloadApiPath}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          下载
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-zinc-500">还没有附件。</p>
                )}
                </div>
              </details>
            </article>
          ))}</div> : null}
        </div>
      </section>
    </>
  );
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function labelAttachmentError(error?: string): string {
  switch (error) {
    case "ATTACHMENT_TOO_LARGE":
      return "附件超过大小限制";
    case "ATTACHMENT_UNSUPPORTED_TYPE":
      return "只支持 PDF、PNG、JPEG、WebP";
    case "ATTACHMENT_MIME_MISMATCH":
      return "文件类型与内容不一致";
    case "ATTACHMENT_EMPTY_FILE":
    case "ATTACHMENT_FILE_REQUIRED":
      return "请选择一个有效文件";
    case "NOTE_NOT_FOUND":
      return "笔记不存在";
    default:
      return "附件上传失败";
  }
}

function isNoteFormDraft(value: unknown): value is NoteFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NoteFormDraft>;
  return [draft.subjectId, draft.syllabusNodeId, draft.taskId, draft.title, draft.content, draft.nextReviewAt]
    .every((field) => typeof field === "string")
    && isNoteKind(draft.kind)
    && ["understood", "partial", "unknown", "relearn", "before_exam"].includes(String(draft.masteryStatus));
}

function aiKnowledgeCardDraftKey(userId: string): string {
  return `areaforge.ai-draft.knowledge-card.${userId}`;
}

function isNoteKind(value: unknown): value is "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY" {
  return typeof value === "string" && ["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"].includes(value);
}

function flattenNodes(nodes: SyllabusOptionNodeDto[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      subjectId: node.subjectId,
      title: node.title,
      depth,
    },
    ...flattenNodes(node.children, depth + 1),
  ]);
}

function labelMastery(status: NoteMasteryStatusDto | null): string {
  switch (status) {
    case "understood":
      return "理解了";
    case "partial":
      return "似懂非懂";
    case "unknown":
      return "不会";
    case "relearn":
      return "需要重学";
    case "before_exam":
      return "考前再看";
    default:
      return "未标记掌握状态";
  }
}

function matchesSubject(note: NoteDto, subjectFilter: string): boolean {
  return subjectFilter === "all" || note.subjectId === subjectFilter;
}

function matchesNode(note: NoteDto, nodeFilter: string): boolean {
  if (nodeFilter === "all") return true;
  if (nodeFilter === "none") return note.syllabusNodeId === null;
  return note.syllabusNodeId === nodeFilter;
}

function matchesMastery(note: NoteDto, masteryFilter: "all" | NoteMasteryStatusDto): boolean {
  return masteryFilter === "all" || note.masteryStatus === masteryFilter;
}

function matchesReview(note: NoteDto, reviewFilter: "all" | "due" | "scheduled" | "none"): boolean {
  if (reviewFilter === "all") return true;
  if (reviewFilter === "none") return note.nextReviewAt === null;
  if (!note.nextReviewAt) return false;
  if (reviewFilter === "scheduled") return true;
  return new Date(note.nextReviewAt).getTime() <= Date.now();
}

function isNoteMasteryFilter(value: string | undefined): value is "all" | NoteMasteryStatusDto {
  return value === "all" || value === "understood" || value === "partial" || value === "unknown" || value === "relearn" || value === "before_exam";
}

function isNoteReviewFilter(value: string | undefined): value is "all" | "due" | "scheduled" | "none" {
  return value === "all" || value === "due" || value === "scheduled" || value === "none";
}

function buildNoteListHref(input: {
  query?: string;
  subject: string;
  node: string;
  mastery: "all" | NoteMasteryStatusDto;
  review: "all" | "due" | "scheduled" | "none";
}): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.subject !== "all") params.set("subjectId", input.subject);
  if (input.node !== "all") params.set("syllabusNodeId", input.node);
  if (input.mastery !== "all") params.set("mastery", input.mastery);
  if (input.review !== "all") params.set("review", input.review);
  return `/knowledge/cards${params.size ? `?${params}` : ""}`;
}
