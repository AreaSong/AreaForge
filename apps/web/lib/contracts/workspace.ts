/** Web workspace DTOs. This module intentionally contains no persistence imports. */
export interface ExamWorkspaceDto {
  id: string;
  stableKey: string;
  name: string;
  targetExamDate: string | null;
  stageSummary: string | null;
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectGroupDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
}

export interface WorkspaceSubjectDto {
  id: string;
  workspaceId: string | null;
  groupId: string | null;
  stableKey: string;
  legacyCode: string | null;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: string | null;
  legacyScope: boolean;
}

export interface TakeoverPreviewDto {
  eligibleCount: number;
  unresolvedCount: number;
  crossOwnerBlockedCount: number;
  affectedDateCount: number;
  affectedPeriodCount: number;
  eligibleSubjectIds: string[];
  unresolvedSubjectIds: string[];
  eligibleSubjects: Array<{
    id: string;
    stableKey: string;
    legacyCode: WorkspaceSubjectDto["legacyCode"];
    name: string;
  }>;
}
