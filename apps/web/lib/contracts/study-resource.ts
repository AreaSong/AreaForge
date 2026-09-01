import type { AttachmentDto } from "./note";

export type StudyResourceOrganizeStatus = "UNSORTED" | "READY_FOR_USE" | "ARCHIVED";

export interface StudyResourceDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  title: string;
  category: string;
  sourceType: "FILE" | "LINK";
  subjectId: string | null;
  attachmentId: string | null;
  externalUrl: string | null;
  displayHost: string | null;
  duplicateOfResourceId: string | null;
  revision: number;
  archivedAt: string | null;
  organizeStatus: StudyResourceOrganizeStatus;
  tags: string[];
  taskIds: string[];
  noteIds: string[];
  mistakeIds: string[];
  syllabusNodeIds: string[];
  mimeType: string | null;
  originalName: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StagingUploadResult {
  attachment: AttachmentDto;
  duplicates: Array<{
    resourceId: string;
    stableKey: string;
    title: string;
  }>;
}

export interface StudyResourceEditorOptionsDto {
  subjects: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; title: string }>;
  notes: Array<{ id: string; title: string }>;
  mistakes: Array<{ id: string; title: string }>;
  syllabusNodes: Array<{ id: string; title: string }>;
}
