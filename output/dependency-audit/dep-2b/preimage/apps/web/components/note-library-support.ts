import type {
  NoteDto,
  NoteMasteryStatusDto,
  StudyTaskDto,
  SubjectDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";

export interface NoteLibraryProps {
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

export interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export interface NoteFormDraft {
  subjectId: string;
  syllabusNodeId: string;
  taskId: string;
  title: string;
  content: string;
  kind: "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY";
  masteryStatus: NoteMasteryStatusDto;
  nextReviewAt: string;
}

export function labelAttachmentError(error?: string): string {
  switch (error) {
    case "ATTACHMENT_TOO_LARGE": return "附件超过大小限制";
    case "ATTACHMENT_UNSUPPORTED_TYPE": return "只支持 PDF、PNG、JPEG、WebP";
    case "ATTACHMENT_MIME_MISMATCH": return "文件类型与内容不一致";
    case "ATTACHMENT_EMPTY_FILE":
    case "ATTACHMENT_FILE_REQUIRED": return "请选择一个有效文件";
    case "NOTE_NOT_FOUND": return "笔记不存在";
    default: return "附件上传失败";
  }
}

export function isNoteFormDraft(value: unknown): value is NoteFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<NoteFormDraft>;
  return [draft.subjectId, draft.syllabusNodeId, draft.taskId, draft.title, draft.content, draft.nextReviewAt]
    .every((field) => typeof field === "string")
    && isNoteKind(draft.kind)
    && ["understood", "partial", "unknown", "relearn", "before_exam"].includes(String(draft.masteryStatus));
}

export function isNoteKind(value: unknown): value is NoteFormDraft["kind"] {
  return typeof value === "string" && ["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"].includes(value);
}

export function flattenNodes(nodes: SyllabusOptionNodeDto[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [
    { id: node.id, subjectId: node.subjectId, title: node.title, depth },
    ...flattenNodes(node.children, depth + 1),
  ]);
}

export function labelMastery(status: NoteMasteryStatusDto | null): string {
  switch (status) {
    case "understood": return "理解了";
    case "partial": return "似懂非懂";
    case "unknown": return "不会";
    case "relearn": return "需要重学";
    case "before_exam": return "考前再看";
    default: return "未标记掌握状态";
  }
}

export function matchesSubject(note: NoteDto, subjectFilter: string): boolean {
  return subjectFilter === "all" || note.subjectId === subjectFilter;
}

export function matchesNode(note: NoteDto, nodeFilter: string): boolean {
  if (nodeFilter === "all") return true;
  if (nodeFilter === "none") return note.syllabusNodeId === null;
  return note.syllabusNodeId === nodeFilter;
}

export function matchesMastery(note: NoteDto, masteryFilter: "all" | NoteMasteryStatusDto): boolean {
  return masteryFilter === "all" || note.masteryStatus === masteryFilter;
}

export function matchesReview(note: NoteDto, reviewFilter: "all" | "due" | "scheduled" | "none"): boolean {
  if (reviewFilter === "all") return true;
  if (reviewFilter === "none") return note.nextReviewAt === null;
  if (!note.nextReviewAt) return false;
  if (reviewFilter === "scheduled") return true;
  return new Date(note.nextReviewAt).getTime() <= Date.now();
}

export function isNoteMasteryFilter(value: string | undefined): value is "all" | NoteMasteryStatusDto {
  return value === "all" || value === "understood" || value === "partial" || value === "unknown" || value === "relearn" || value === "before_exam";
}

export function isNoteReviewFilter(value: string | undefined): value is "all" | "due" | "scheduled" | "none" {
  return value === "all" || value === "due" || value === "scheduled" || value === "none";
}

export function buildNoteListHref(input: {
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
