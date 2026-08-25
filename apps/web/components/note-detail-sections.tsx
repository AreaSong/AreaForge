import Link from "next/link";
import { Download, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import type { NoteDto, NoteEditorOptionsDto } from "@/lib/contracts";
import { formatBytes, formatDate, formatDateTime, formatTaskStatus } from "@/lib/formatters";
import {
  noteEditorInputClass,
  noteKinds,
  type NoteDetailDraft,
  type NoteKind,
} from "@/components/note-detail-support";

export function NoteEditor(props: {
  draft: NoteDetailDraft;
  options: NoteEditorOptionsDto;
  subjectNodes: NoteEditorOptionsDto["syllabusNodes"];
  subjectTasks: NoteEditorOptionsDto["tasks"];
  disabled: boolean;
  titleInputId: string;
  onSubjectChange: (subjectId: string) => void;
  onChange: <K extends keyof NoteDetailDraft>(field: K, value: NoteDetailDraft[K]) => void;
}) {
  return (
    <section className="space-y-4" aria-labelledby="note-editor-heading">
      <h2 id="note-editor-heading" className="text-lg font-medium text-white">编辑卡片</h2>
      <div className="af-content-grid-two grid gap-3">
        <Field label="标题">
          <Input id={props.titleInputId} disabled={props.disabled} value={props.draft.title} onChange={(event) => props.onChange("title", event.target.value)} className={noteEditorInputClass} />
        </Field>
        <Field label="卡片类型">
          <Select disabled={props.disabled} value={props.draft.kind} onChange={(event) => props.onChange("kind", event.target.value as NoteKind)} className={noteEditorInputClass}>
            {noteKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="科目">
          <Select disabled={props.disabled} value={props.draft.subjectId} onChange={(event) => props.onSubjectChange(event.target.value)} className={noteEditorInputClass}>
            {props.options.subjects.map((subject) => <option key={subject.id} value={subject.id} disabled={Boolean(subject.archivedAt)}>{subject.name}{subject.archivedAt ? "（已归档）" : ""}</option>)}
          </Select>
        </Field>
        <Field label="学习日期">
          <Input type="date" disabled={props.disabled} value={props.draft.studyDate} onChange={(event) => props.onChange("studyDate", event.target.value)} className={noteEditorInputClass} />
        </Field>
        <Field label="掌握状态">
          <Select disabled={props.disabled} value={props.draft.masteryStatus} onChange={(event) => props.onChange("masteryStatus", event.target.value as NoteDetailDraft["masteryStatus"])} className={noteEditorInputClass}>
            <option value="">未记录</option><option value="understood">理解了</option><option value="partial">似懂非懂</option><option value="unknown">不会</option><option value="relearn">需要重学</option><option value="before_exam">考前再看</option>
          </Select>
        </Field>
        <Field label="关联任务">
          <Select disabled={props.disabled} value={props.draft.taskId} onChange={(event) => props.onChange("taskId", event.target.value)} className={noteEditorInputClass}>
            <option value="">未关联</option>{props.subjectTasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {formatTaskStatus(task.status)}</option>)}
          </Select>
        </Field>
        <Field label="主考纲">
          <Select disabled={props.disabled} value={props.draft.syllabusNodeId} onChange={(event) => {
            const id = event.target.value;
            props.onChange("syllabusNodeId", id);
            props.onChange("relatedSyllabusNodeIds", props.draft.relatedSyllabusNodeIds.filter((relatedId) => relatedId !== id));
          }} className={noteEditorInputClass}>
            <option value="">未关联</option>{props.subjectNodes.map((node) => <option key={node.id} value={node.id} disabled={Boolean(node.archivedAt)}>{node.title}{node.archivedAt ? "（已归档）" : ""}</option>)}
          </Select>
        </Field>
        <MultiSelect label="相关考纲" values={props.draft.relatedSyllabusNodeIds} options={props.subjectNodes.filter((node) => node.id !== props.draft.syllabusNodeId).map((node) => ({ id: node.id, title: node.title, disabled: Boolean(node.archivedAt) }))} disabled={props.disabled} onChange={(values) => props.onChange("relatedSyllabusNodeIds", values)} />
        <MultiSelect label="关联资料" values={props.draft.resourceIds} options={props.options.resources.map((resource) => ({ id: resource.id, title: resource.title, disabled: Boolean(resource.archivedAt) }))} disabled={props.disabled} onChange={(values) => props.onChange("resourceIds", values)} />
      </div>
      <Field label="Markdown 正文">
        <Textarea disabled={props.disabled} value={props.draft.content} onChange={(event) => props.onChange("content", event.target.value)} className="min-h-72 w-full bg-[#151a20] px-3 py-2 font-mono text-sm leading-6 text-zinc-100" />
      </Field>
    </section>
  );
}

export function ReviewHistory(props: {
  note: NoteDto;
  archived: boolean;
  readOnly: boolean;
  pending: boolean;
  reviewDate: string;
  scheduleCanBeCreated: boolean;
  returnHref: string;
  onReviewDateChange: (value: string) => void;
  onSchedule: () => void;
}) {
  const schedule = props.note.reviewSchedule;
  return (
    <section id="note-review-section" className="scroll-mt-6 border-t border-white/10 pt-5" aria-labelledby="note-review-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="note-review-heading" className="text-lg font-medium text-white">复习排期与历史</h2>
        {schedule && !props.readOnly ? <Link className="text-sm text-teal-300 hover:underline" href={`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(props.returnHref)}`}>打开排期详情</Link> : null}
      </div>
      {schedule ? <p className="mt-2 text-sm text-zinc-400">{schedule.status === "ACTIVE" ? "进行中" : "已暂停"} · {schedule.dueDate ? `到期 ${formatDate(schedule.dueDate)}` : "未设置日期"} · 连续通过 {schedule.consecutivePassCount}</p> : <p className="mt-2 text-sm text-zinc-500">尚未建立复习排期。</p>}
      {!props.archived && props.scheduleCanBeCreated ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input aria-label="复习日期" type="date" disabled={props.pending} value={props.reviewDate} onChange={(event) => props.onReviewDateChange(event.target.value)} className={`${noteEditorInputClass} !w-auto`} />
          <Button type="button" variant="secondary" disabled={props.pending || !props.reviewDate} onClick={props.onSchedule} className="text-teal-200">{schedule ? "重新排期" : "设置首次复习"}</Button>
        </div>
      ) : null}
      <ol className="mt-4 space-y-3">
        {schedule?.events.map((event) => <li key={event.id} className="border-l border-white/10 pl-3 text-sm text-zinc-300"><span className="text-zinc-100">{reviewResultLabel(event.result)}</span> · {event.durationSeconds} 秒 · {formatDateTime(event.confirmedAt)}{event.correctedEventId ? <span className="ml-2 text-xs text-amber-300">更正事件</span> : null}{event.note ? <p className="mt-1 text-zinc-500">{event.note}</p> : null}</li>)}
        {schedule && schedule.events.length === 0 ? <li className="text-sm text-zinc-500">尚无复习事件。</li> : null}
      </ol>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-sm text-zinc-400"><span>{label}</span><span className="mt-1 block">{children}</span></label>;
}

function MultiSelect(props: {
  label: string;
  values: string[];
  options: Array<{ id: string; title: string; disabled?: boolean }>;
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  return (
    <Field label={props.label}>
      <Select multiple disabled={props.disabled} value={props.values} onChange={(event) => props.onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value).sort())} className="min-h-28 bg-[#151a20] p-2 text-zinc-100">
        {props.options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.title}{option.disabled ? "（已归档）" : ""}</option>)}
      </Select>
    </Field>
  );
}

export function RelationRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[5rem_1fr] gap-3"><dt className="text-zinc-500">{label}</dt><dd className="min-w-0 text-zinc-300">{children}</dd></div>;
}

export function NoteRelations(props: { note: NoteDto; readOnly: boolean }) {
  const { note } = props;
  return (
    <section className="af-content-grid-two grid min-w-0 gap-6 border-t border-white/10 pt-5" aria-labelledby="note-relations-heading">
      <div>
        <h2 id="note-relations-heading" className="text-lg font-medium text-white">学习关联</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <RelationRow label="主考纲">
            {note.syllabusNodeId ? props.readOnly ? note.syllabusNodeTitle : <Link className="text-teal-300 hover:underline" href={`/knowledge/syllabi/${note.syllabusNodeId}`}>{note.syllabusNodeTitle}</Link> : "未关联"}
          </RelationRow>
          <RelationRow label="相关考纲">
            {note.relatedSyllabusNodes.length > 0 ? note.relatedSyllabusNodes.map((node) => (
              props.readOnly
                ? <span key={node.id} className="mr-3 inline-block">{node.title}{node.archivedAt ? "（已归档）" : ""}</span>
                : <Link key={node.id} className="mr-3 inline-block text-teal-300 hover:underline" href={`/knowledge/syllabi/${node.id}`}>{node.title}{node.archivedAt ? "（已归档）" : ""}</Link>
            )) : "未关联"}
          </RelationRow>
          <RelationRow label="任务">
            {note.taskId ? <Link className="text-teal-300 hover:underline" href={`/roadmap/allocation/tasks/${note.taskId}`}>{note.taskTitle}</Link> : "未关联"}
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
  );
}

function reviewResultLabel(value: string): string {
  return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过";
}
