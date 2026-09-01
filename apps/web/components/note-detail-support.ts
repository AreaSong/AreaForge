import type { ConflictComparison } from "@/components/conflict-resolution-modal";
import type { NoteDto, NoteMasteryStatusDto } from "@/lib/contracts";
import { isoToShanghaiDateInput } from "@/lib/formatters";

export type NoteKind = "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY";
export type NoteConflictIntent = "save" | "archive" | "restore";

export interface NoteConflict {
  intent: NoteConflictIntent;
  latest: NoteDto;
  conflictFields: string[];
}

export interface NoteDetailDraft {
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

export const noteEditorInputClass = "h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100";
export const noteKinds: ReadonlyArray<readonly [NoteKind, string]> = [
  ["GENERAL", "通用"],
  ["CONCEPT", "概念"],
  ["METHOD", "方法"],
  ["EXAMPLE", "例题"],
  ["JOURNAL", "学习记录"],
  ["SUMMARY", "总结"],
];

export function buildConflictComparisons(
  baseline: NoteDetailDraft,
  local: NoteDetailDraft,
  latest?: NoteDto,
): ConflictComparison[] {
  const server = latest ? toNoteDraft(latest) : null;
  const fields: Array<[keyof NoteDetailDraft, string]> = [
    ["title", "标题"],
    ["content", "正文"],
    ["kind", "类型"],
    ["studyDate", "学习日期"],
    ["subjectId", "科目"],
    ["syllabusNodeId", "主考纲"],
    ["relatedSyllabusNodeIds", "相关考纲"],
    ["taskId", "任务"],
    ["resourceIds", "资料"],
    ["masteryStatus", "掌握状态"],
  ];
  return [
    { field: "revision", label: "revision", baseline: baseline.baseRevision, local: local.baseRevision, server: latest?.revision },
    ...fields.map(([field, label]) => ({
      field,
      label,
      baseline: baseline[field],
      local: local[field],
      server: server?.[field],
    })),
  ];
}

export function toNoteDraft(note: NoteDto): NoteDetailDraft {
  return {
    baseRevision: note.revision,
    subjectId: note.subjectId,
    syllabusNodeId: note.syllabusNodeId ?? "",
    relatedSyllabusNodeIds: [...note.relatedSyllabusNodeIds].sort(),
    taskId: note.taskId ?? "",
    resourceIds: note.linkedResources.map((resource) => resource.id).sort(),
    kind: note.kind as NoteKind,
    studyDate: note.studyDate ? isoToShanghaiDateInput(note.studyDate) : "",
    title: note.title,
    content: note.content,
    masteryStatus: note.masteryStatus ?? "",
  };
}

export function isNoteDetailDraft(value: unknown): value is NoteDetailDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NoteDetailDraft>;
  return Number.isInteger(draft.baseRevision)
    && (draft.baseRevision ?? 0) > 0
    && [draft.subjectId, draft.syllabusNodeId, draft.taskId, draft.kind, draft.studyDate, draft.title, draft.content, draft.masteryStatus]
      .every((item) => typeof item === "string")
    && Array.isArray(draft.relatedSyllabusNodeIds)
    && draft.relatedSyllabusNodeIds.every((id) => typeof id === "string")
    && Array.isArray(draft.resourceIds)
    && draft.resourceIds.every((id) => typeof id === "string");
}

export function isNoteDto(value: unknown): value is NoteDto {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<NoteDto>;
  return typeof note.id === "string"
    && typeof note.revision === "number"
    && typeof note.title === "string"
    && typeof note.content === "string"
    && Array.isArray(note.relatedSyllabusNodeIds)
    && Array.isArray(note.linkedResources)
    && Array.isArray(note.attachments);
}

export function draftsEqual(left: NoteDetailDraft, right: NoteDetailDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function masteryStatusLabel(value: NoteMasteryStatusDto): string {
  return ({
    understood: "理解了",
    partial: "似懂非懂",
    unknown: "不会",
    relearn: "需要重学",
    before_exam: "考前再看",
  } as Record<NoteMasteryStatusDto, string>)[value];
}

export function kindLabel(value: string): string {
  return noteKinds.find(([kind]) => kind === value)?.[1] ?? value;
}
