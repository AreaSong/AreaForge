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

export interface SubjectReferenceCountDto {
  tasks: number;
  sessions: number;
  activeSessions: number;
  syllabusNodes: number;
  notes: number;
  mistakes: number;
  simulationSubjectResults: number;
  planMilestones: number;
  planInboxItems: number;
  studyResources: number;
  primaryKnowledgePoints: number;
  relatedKnowledgePoints: number;
  knowledgeGroups: number;
  learningArrangements: number;
  total: number;
}

export interface SubjectDuplicateSetDto {
  id: string;
  workspaceRevision: number;
  /** 绑定只读预览；后续经确认的合并写入必须先重新校验该快照。 */
  snapshotHash: string;
  reasons: Array<{
    code: "NORMALIZED_NAME" | "NORMALIZED_STABLE_KEY" | "LEGACY_CODE";
    normalizedValue: string;
    subjectIds: string[];
  }>;
  recommendedTargetId: string;
  subjects: Array<{
    subject: WorkspaceSubjectDto;
    references: SubjectReferenceCountDto;
  }>;
  conflictCounts: {
    syllabusStableKeys: number;
    simulationExams: number;
    simulationInboxOrigins: number;
    invalidSimulationInboxOrigins: number;
    relatedKnowledgePoints: number;
  };
  requiredReassignments: {
    primaryKnowledgePoints: number;
    simulationOriginInboxItems: number;
  };
  totalReferenceCount: number;
  canAutoApply: false;
  requiresUserConfirmation: true;
}

export interface SubjectMergeResultDto {
  operationId: string;
  undoUntil: string;
  workspace: ExamWorkspaceDto;
  targetSubject: WorkspaceSubjectDto;
  archivedSubjectIds: string[];
  migratedReferenceCounts: Record<string, number>;
  deduplicatedRelatedKnowledgePointLinks: number;
  scopeHash: string;
  snapshotHash: string;
}

export interface SubjectMergeOperationDto {
  id: string;
  targetSubjectId: string;
  targetSubjectName: string;
  sourceSubjects: Array<{ id: string; name: string }>;
  mergedAt: string;
  undoUntil: string;
  status: "AVAILABLE" | "EXPIRED" | "UNDONE" | "BLOCKED";
  workspaceRevision: number;
  undoSnapshotHash: string;
  blockingFields: string[];
}

export interface SubjectMergeUndoResultDto {
  operationId: string;
  workspace: ExamWorkspaceDto;
  restoredSubjectIds: string[];
  restoredReferenceCounts: Record<string, number>;
  recreatedRelatedKnowledgePointLinks: number;
  scopeHash: string;
  undoneAt: string;
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

export interface WorkspaceCapacityMetrics {
  activeSubjectCount: number;
  syllabusNodeCount: number;
  knowledgePointCount: number;
  noteCount: number;
  mistakeCount: number;
  sessionCount: number;
  totalSessionMinutes: number;
  totalEffectiveMinutes: number;
  totalSessionHoursFormatted: string;
  attachmentCount: number;
  totalAttachmentBytes: number;
  totalAttachmentBytesFormatted: string;
}
