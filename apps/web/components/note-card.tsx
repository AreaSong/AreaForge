import { ArrowRight, Download, FileText, Upload } from "lucide-react";
import { ListDetailLink } from "@/components/list-return-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { labelMastery } from "@/components/note-library-support";
import type { NoteDto } from "@/lib/contracts";
import { formatBytes, formatDate, formatDateTime } from "@/lib/formatters";

export interface NoteCardProps {
  note: NoteDto;
  uploading: boolean;
  uploadError: string | null;
  onUpload: (file: File | undefined) => void;
}

export function NoteCard({
  note,
  uploading,
  uploadError,
  onUpload,
}: NoteCardProps) {
  return (
    <Card variant="master" className="flex flex-col justify-between p-5 transition-all hover:border-white/20">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-400">{note.subjectName}</span>
          <Badge tone="info">{labelMastery(note.masteryStatus)}</Badge>
          {note.nextReviewAt ? <Badge tone="warning">复习 {formatDate(note.nextReviewAt)}</Badge> : null}
        </div>
        <h3 className="mt-2.5 break-words text-base font-semibold text-white">{note.title}</h3>
        <p className="mt-1 text-xs text-zinc-400">{note.syllabusNodeTitle ?? "未关联考纲"}</p>
        <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
          {note.content}
        </p>
      </div>

      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <div className="flex min-w-0 flex-wrap gap-x-2">
            {note.taskTitle ? <span className="truncate max-w-[12rem]">任务：{note.taskTitle}</span> : null}
            <span>更新：{formatDateTime(note.updatedAt)}</span>
          </div>
          <ListDetailLink
            href={`/knowledge/cards/${note.id}`}
            focusId={`note-${note.id}`}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-teal-300 transition-colors hover:bg-white/[0.05] hover:text-teal-200"
          >
            打开详情
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </ListDetailLink>
        </div>

        <details className="mt-3 border-t border-white/5 pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>附件 ({note.attachments.length})</span>
          </summary>
          <div className="mt-2 rounded-xl border border-white/10 bg-[#0d1117]/80 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-200">附件管理</p>
                <p className="text-[11px] text-zinc-500">PDF、PNG、JPEG、WebP</p>
              </div>
              <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-teal-300/30 px-2.5 text-xs text-teal-100 transition-colors hover:bg-teal-300/10">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {uploading ? "上传中" : "上传"}
                <input
                  className="sr-only"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    onUpload(file);
                  }}
                />
              </label>
            </div>
            {note.attachments.length > 0 ? (
              <div className="mt-2 grid gap-1.5">
                {note.attachments.map((attachment) => (
                  <div key={attachment.id} className="flex flex-col gap-1 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-zinc-200">{attachment.originalName}</p>
                      <p className="text-[10px] text-zinc-500">{attachment.mimeType} / {formatBytes(attachment.sizeBytes)}</p>
                    </div>
                    <a className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-white/10 px-2 text-[11px] text-zinc-200 hover:bg-white/10" href={attachment.downloadApiPath}>
                      <Download className="h-3 w-3" aria-hidden="true" />
                      下载
                    </a>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-xs text-zinc-500">还没有附件。</p>}
            {uploadError ? <p className="mt-2 text-xs text-red-300" role="alert">{uploadError}</p> : null}
          </div>
        </details>
      </div>
    </Card>
  );
}
