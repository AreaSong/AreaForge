import { ArrowRight, Download, FileText, Upload } from "lucide-react";
import { ListDetailLink } from "@/components/list-return-context";
import { Badge } from "@/components/ui/feedback";
import { labelMastery } from "@/components/note-library-support";
import type { NoteDto } from "@/lib/contracts";
import { formatBytes, formatDate, formatDateTime } from "@/lib/formatters";

export function NoteLibraryItem(props: {
  note: NoteDto;
  uploading: boolean;
  uploadError: string | null;
  onUpload: (file: File | undefined) => void;
}) {
  const { note } = props;
  return (
    <article className="min-w-0 py-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-zinc-500">{note.subjectName}</p>
            <Badge tone="info">{labelMastery(note.masteryStatus)}</Badge>
            {note.nextReviewAt ? <Badge tone="warning">复习 {formatDate(note.nextReviewAt)}</Badge> : null}
          </div>
          <h3 className="mt-2 break-words font-medium text-white">{note.title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{note.syllabusNodeTitle ?? "未关联考纲"}</p>
        </div>
        <ListDetailLink
          href={`/knowledge/cards/${note.id}`}
          focusId={`note-${note.id}`}
          className="inline-flex h-10 shrink-0 items-center gap-1 self-end rounded-md px-2 text-sm text-teal-300 hover:bg-white/[0.05] sm:self-auto"
        >
          打开详情
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </ListDetailLink>
      </div>
      <p className="mt-3 max-h-12 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-zinc-300">{note.content}</p>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {note.taskTitle ? <span>任务：{note.taskTitle}</span> : null}
        <span>更新：{formatDateTime(note.updatedAt)}</span>
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
              {props.uploading ? "上传中" : "上传"}
              <input
                className="sr-only"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                disabled={props.uploading}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  props.onUpload(file);
                }}
              />
            </label>
          </div>
          {note.attachments.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {note.attachments.map((attachment) => (
                <div key={attachment.id} className="flex flex-col gap-2 rounded-md border border-white/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-100">{attachment.originalName}</p>
                    <p className="mt-1 text-xs text-zinc-500">{attachment.mimeType} / {formatBytes(attachment.sizeBytes)}</p>
                  </div>
                  <a className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-xs text-zinc-100 hover:bg-white/10" href={attachment.downloadApiPath}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    下载
                  </a>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-xs text-zinc-500">还没有附件。</p>}
          {props.uploadError ? <p className="mt-3 text-xs text-red-200" role="alert">{props.uploadError}</p> : null}
        </div>
      </details>
    </article>
  );
}
