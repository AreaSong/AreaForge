import type { LearningTreeDiffItem, LearningTreeScope } from "@areaforge/core";

export interface LearningTreePreviewDto {
  operationId: string;
  workspaceId: string;
  scope: LearningTreeScope;
  protocolVersion: string;
  parserVersion: string;
  sourceSha256: string;
  canonicalPlanHash: string;
  diffSnapshotHash: string;
  canonicalMarkdown: string;
  rootRevision: number;
  previewToken: string;
  previewExpiresAt: string;
  items: LearningTreeDiffItem[];
  errors: Array<{ code: string; message: string; sourceLine?: number; stableKey?: string }>;
  warnings: Array<{ code: string; message: string; sourceLine?: number }>;
  blocking: boolean;
  objectCount: number;
}

export interface LearningTreeExportOptionsDto {
  workspaceKey: string;
  subjects: Array<{
    id: string;
    stableKey: string;
    name: string;
    nodes: Array<{ stableKey: string; title: string }>;
  }>;
}

export interface LearningTreeConfirmResultDto {
  batchId: string;
  workspaceId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  reused: boolean;
  appliedCount: number;
  skippedCount: number;
  confirmedAt: string;
}

export interface LearningTreeImportBatchSummaryDto {
  id: string;
  workspaceId: string;
  workspaceStatus: "ACTIVE" | "ARCHIVED";
  workspaceRevision: number;
  scope: string;
  protocolVersion: string;
  parserVersion: string;
  sourceSha256: string;
  canonicalPlanHash: string;
  rootRevision: number;
  idempotencyKey: string;
  stats: unknown;
  archivedAt: string | null;
  confirmedAt: string;
  itemCount: number;
}

export interface LearningTreeImportBatchDetailDto extends LearningTreeImportBatchSummaryDto {
  canonicalMarkdown: string;
  result: unknown;
  items: Array<{
    id: string;
    stableRef: string;
    objectType: string;
    diffType: string;
    sourceLine: number | null;
    userChoice: string;
    applyResult: string;
    mappedTargetId: string | null;
    mappedTargetKey: string | null;
    redactedErrorCode: string | null;
  }>;
}
