"use client";

import { BookOpenCheck, Download, FileText, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { NoteDto, NoteMasteryStatusDto, StudyTaskDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";

interface NoteLibraryProps {
  subjects: SubjectDto[];
  tasks: StudyTaskDto[];
  nodes: SyllabusOptionNodeDto[];
  notes: NoteDto[];
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function NoteLibrary({ subjects, tasks, nodes, notes }: NoteLibraryProps) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [syllabusNodeId, setSyllabusNodeId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [masteryStatus, setMasteryStatus] = useState<NoteMasteryStatusDto>("partial");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [noteSubjectFilter, setNoteSubjectFilter] = useState("all");
  const [noteNodeFilter, setNoteNodeFilter] = useState("all");
  const [noteMasteryFilter, setNoteMasteryFilter] = useState<"all" | NoteMasteryStatusDto>("all");
  const [noteReviewFilter, setNoteReviewFilter] = useState<"all" | "due" | "scheduled" | "none">("all");
  const [uploadingNoteId, setUploadingNoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const taskOptions = tasks.filter((task) => task.subjectId === subjectId);
  const filterNodeOptions = useMemo(
    () => flatNodes.filter((node) => noteSubjectFilter === "all" || node.subjectId === noteSubjectFilter),
    [flatNodes, noteSubjectFilter],
  );
  const filteredNotes = useMemo(
    () => notes.filter((note) =>
      matchesSubject(note, noteSubjectFilter) &&
      matchesNode(note, noteNodeFilter) &&
      matchesMastery(note, noteMasteryFilter) &&
      matchesReview(note, noteReviewFilter),
    ),
    [notes, noteSubjectFilter, noteNodeFilter, noteMasteryFilter, noteReviewFilter],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        syllabusNodeId: syllabusNodeId || null,
        taskId: taskId || null,
        title,
        content,
        masteryStatus,
        nextReviewAt: nextReviewAt ? new Date(nextReviewAt).toISOString() : null,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "保存笔记失败");
      return;
    }

    setTitle("");
    setContent("");
    setSyllabusNodeId("");
    setTaskId("");
    setNextReviewAt("");
    startTransition(() => router.refresh());
  }

  async function uploadAttachment(noteId: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploadingNoteId(noteId);

    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/notes/${noteId}/attachments`, {
      method: "POST",
      body: formData,
    });

    setUploadingNoteId(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(labelAttachmentError(body?.error));
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-white">新增笔记</h2>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
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
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
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
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
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
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
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
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="笔记标题"
            required
          />
          <textarea
            className="min-h-44 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="写下自己的理解、题解或复盘产出"
            required
          />
          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            type="datetime-local"
            value={nextReviewAt}
            onChange={(event) => setNextReviewAt(event.target.value)}
            aria-label="下次复习时间"
          />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || !subjectId}
          >
            <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
            保存笔记
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      </section>

      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-400">资料库</p>
            <h2 className="mt-1 text-xl font-semibold text-white">笔记与最小产出</h2>
          </div>
          <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
            {filteredNotes.length} / {notes.length} 条
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteSubjectFilter}
            onChange={(event) => {
              setNoteSubjectFilter(event.target.value);
              setNoteNodeFilter("all");
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
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteNodeFilter}
            onChange={(event) => setNoteNodeFilter(event.target.value)}
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
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteMasteryFilter}
            onChange={(event) => setNoteMasteryFilter(event.target.value as "all" | NoteMasteryStatusDto)}
          >
            <option value="all">全部掌握状态</option>
            <option value="understood">理解了</option>
            <option value="partial">似懂非懂</option>
            <option value="unknown">不会</option>
            <option value="relearn">需要重学</option>
            <option value="before_exam">考前再看</option>
          </select>
          <select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={noteReviewFilter}
            onChange={(event) => setNoteReviewFilter(event.target.value as "all" | "due" | "scheduled" | "none")}
          >
            <option value="all">全部复习提醒</option>
            <option value="due">已到期</option>
            <option value="scheduled">已设置</option>
            <option value="none">未设置</option>
          </select>
        </div>

        <div className="mt-5 grid gap-3">
          {notes.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
              还没有笔记。计时结束后的最小产出可以在这里沉淀下来。
            </p>
          ) : null}
          {notes.length > 0 && filteredNotes.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
              当前筛选下没有笔记。
            </p>
          ) : null}
          {filteredNotes.map((note) => (
            <article key={note.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm text-zinc-400">{note.subjectName}</p>
                  <h3 className="mt-1 font-medium text-white">{note.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    {note.syllabusNodeTitle ?? "未关联考纲"} / {labelMastery(note.masteryStatus)}
                  </p>
                </div>
                {note.nextReviewAt ? (
                  <span className="rounded-md border border-amber-300/25 px-2 py-1 text-xs text-amber-100">
                    {new Date(note.nextReviewAt).toLocaleDateString("zh-CN")}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{note.content}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
                {note.taskTitle ? <span>任务：{note.taskTitle}</span> : null}
                <span>更新：{new Date(note.updatedAt).toLocaleString("zh-CN")}</span>
                {note.attachments.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    {note.attachments.length} 个附件
                  </span>
                ) : null}
              </div>
              <div className="mt-4 rounded-md border border-white/10 bg-[#0d1117] p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-zinc-100">附件</p>
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
            </article>
          ))}
        </div>
      </section>
    </div>
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
