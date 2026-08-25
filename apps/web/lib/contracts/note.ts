export type NoteMasteryStatusDto = "understood" | "partial" | "unknown" | "relearn" | "before_exam";

export interface AttachmentDto {
  id: string;
  noteId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadApiPath: string;
  createdAt: string;
}

export interface NoteDto {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  relatedSyllabusNodeIds: string[];
  taskId: string | null;
  taskTitle: string | null;
  kind: string;
  studyDate: string | null;
  stableKey: string | null;
  revision: number;
  archivedAt: string | null;
  title: string;
  content: string;
  masteryStatus: NoteMasteryStatusDto | null;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentDto[];
  relatedSyllabusNodes: Array<{
    id: string;
    title: string;
    archivedAt: string | null;
  }>;
  linkedResources: Array<{
    id: string;
    title: string;
    sourceType: "FILE" | "LINK";
    archivedAt: string | null;
  }>;
  reviewSchedule: {
    id: string;
    status: "ACTIVE" | "PAUSED";
    dueDate: string | null;
    pausedReason: string | null;
    consecutivePassCount: number;
    revision: number;
    events: Array<{
      id: string;
      result: "PASSED" | "PARTIAL" | "FAILED";
      durationSeconds: number;
      confirmedAt: string;
      nextDueDate: string;
      correctedEventId: string | null;
      note: string | null;
    }>;
  } | null;
}
