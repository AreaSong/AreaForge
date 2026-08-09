import {
  type LearningTreeImportSelection,
  type LearningTreeImportSelectionSnapshot,
} from "@areaforge/core";
import { getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import type { LearningTreePreviewDto } from "@/lib/study/learning-tree-service";
import type { LearningTreeScopeView } from "@/components/learning-tree-import-workbench-view";

type Selection = LearningTreeImportSelection;
export const learningTreeImportsWorkbench = "/knowledge/imports";

interface LearningTreeConfirmPayload {
  markdown: string;
  previewToken: string;
  previewOperationId: string;
  idempotencyKey: string;
  selections: Array<{ stableKey: string; choice: Selection["choice"]; mappedTargetId?: string }>;
}

export interface LearningTreeConfirmSnapshot {
  payload: LearningTreeConfirmPayload;
  baseline: {
    workspaceId: string;
    rootRevision: number;
    sourceSha256: string;
    canonicalPlanHash: string;
    diffSnapshotHash: string;
  };
}

export interface LearningTreeConfirmConflict {
  submission: LearningTreeConfirmSnapshot;
  latest: unknown;
  conflictFields: string[];
  workbench: string;
}

export function aiLearningTreeDraftKey(userId: string): string {
  return `areaforge.ai-draft.learning-tree.${userId}`;
}

export function learningTreeImportDraftKey(userId: string): string {
  return `areaforge.learning-tree-import.${userId}`;
}

export function persistLearningTreeImportDraft(userId: string, value: {
  markdown: string;
  scope: LearningTreeScopeView;
  subjectKey: string;
  rootNodeKey: string;
  selectionSnapshot: LearningTreeImportSelectionSnapshot | null;
}): void {
  try {
    window.localStorage.setItem(learningTreeImportDraftKey(userId), JSON.stringify({
      version: 2,
      userId,
      updatedAt: Date.now(),
      value,
    }));
  } catch {
    // The in-memory editor remains usable when browser storage is unavailable or full.
  }
}

export function isLearningTreeSelectionSnapshot(value: unknown): value is LearningTreeImportSelectionSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.sourceFingerprint !== "string" || !snapshot.selections || typeof snapshot.selections !== "object") return false;
  return Object.values(snapshot.selections).every((selection) => {
    if (!selection || typeof selection !== "object") return false;
    const row = selection as Record<string, unknown>;
    return (row.choice === "apply" || row.choice === "skip") &&
      (row.mappedTargetId === undefined || typeof row.mappedTargetId === "string");
  });
}

export function createLearningTreeConfirmSnapshot(
  userId: string,
  preview: LearningTreePreviewDto,
  selections: Record<string, Selection>,
): LearningTreeConfirmSnapshot {
  const selectionRows = preview.items.map((item) => {
    const selection = selections[item.stableKey] ?? {
      choice: item.diffType === "UNCHANGED" || item.diffType === "SKIP" ? "skip" as const : "apply" as const,
    };
    return {
      stableKey: item.stableKey,
      choice: selection.choice,
      ...(selection.mappedTargetId ? { mappedTargetId: selection.mappedTargetId } : {}),
    };
  });
  const commandScope = learningTreeConfirmCommandScope(userId);
  const idempotencyKey = getOrCreateIdempotencyKey(commandScope, "learning-tree-confirm", {
    previewOperationId: preview.operationId,
    workspaceId: preview.workspaceId,
    rootRevision: preview.rootRevision,
    sourceSha256: preview.sourceSha256,
    canonicalPlanHash: preview.canonicalPlanHash,
    diffSnapshotHash: preview.diffSnapshotHash,
    selections: selectionRows,
  });
  return {
    payload: {
      markdown: preview.canonicalMarkdown,
      previewToken: preview.previewToken,
      previewOperationId: preview.operationId,
      idempotencyKey,
      selections: selectionRows,
    },
    baseline: {
      workspaceId: preview.workspaceId,
      rootRevision: preview.rootRevision,
      sourceSha256: preview.sourceSha256,
      canonicalPlanHash: preview.canonicalPlanHash,
      diffSnapshotHash: preview.diffSnapshotHash,
    },
  };
}

export function learningTreeConflictComparisons(
  conflict: LearningTreeConfirmConflict,
  preview: LearningTreePreviewDto | null,
  selections: Record<string, Selection>,
) {
  const latest = asRecord(conflict.latest);
  const baseline = conflict.submission.baseline;
  return [
    { field: "state", label: "导入状态", baseline: "READY_TO_CONFIRM", local: preview ? "READY_TO_CONFIRM" : "NEEDS_PREVIEW", server: latest.state },
    { field: "workspaceId", label: "考试工作区", baseline: baseline.workspaceId, local: preview?.workspaceId ?? baseline.workspaceId, server: latest.workspaceId },
    { field: "rootRevision", label: "学习树根 revision", baseline: baseline.rootRevision, local: preview?.rootRevision ?? baseline.rootRevision, server: latest.rootRevision ?? latest.revision },
    { field: "diffSnapshotHash", label: "差异快照", baseline: baseline.diffSnapshotHash, local: preview?.diffSnapshotHash ?? baseline.diffSnapshotHash, server: latest.diffSnapshotHash },
    { field: "sourceSha256", label: "Markdown 源摘要", baseline: baseline.sourceSha256, local: preview?.sourceSha256 ?? baseline.sourceSha256, server: latest.sourceSha256 },
    { field: "canonicalPlanHash", label: "规范化计划摘要", baseline: baseline.canonicalPlanHash, local: preview?.canonicalPlanHash ?? baseline.canonicalPlanHash, server: latest.canonicalPlanHash },
    {
      field: "selections",
      label: "映射与跳过选择",
      baseline: summarizeSelections(conflict.submission.payload.selections),
      local: summarizeSelections(Object.values(selections)),
      server: latest.blockingStableKeys ?? latest.missingMilestoneKeys ?? latest.selections,
    },
  ];
}

export function learningTreeConfirmCommandScope(userId: string): string {
  return `learning-tree-confirm:${userId}`;
}

export function safeLearningTreeWorkbench(value: string | undefined): string {
  return value === learningTreeImportsWorkbench ? value : learningTreeImportsWorkbench;
}

function summarizeSelections(selections: Array<{ choice: Selection["choice"]; mappedTargetId?: string }>) {
  return {
    total: selections.length,
    apply: selections.filter((selection) => selection.choice === "apply").length,
    skip: selections.filter((selection) => selection.choice === "skip").length,
    mapped: selections.filter((selection) => Boolean(selection.mappedTargetId)).length,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
