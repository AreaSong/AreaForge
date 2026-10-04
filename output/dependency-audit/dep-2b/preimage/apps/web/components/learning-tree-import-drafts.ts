import type { LearningTreeImportSelectionSnapshot } from "@areaforge/core";
import { aiLearningTreeDraftKey, isLearningTreeSelectionSnapshot, learningTreeImportDraftKey } from "@/components/learning-tree-import-workbench-support";
import { getBrowserStoragePort } from "@/lib/client/storage-port";
import { readAiDraftHandoffEnvelope } from "@/lib/client/ai-draft-handoff";
import type { LearningTreeScopeView } from "@/components/learning-tree-import-workbench-view";

const aiDraftTtlMs = 7 * 24 * 60 * 60 * 1000;
const importDraftTtlMs = 24 * 60 * 60 * 1000;

export interface RestoredAiLearningTreeDraft {
  updatedAt: number;
  markdownDraft?: string;
  scope?: LearningTreeScopeView;
}

export interface RestoredLearningTreeImportDraft {
  updatedAt: number;
  markdown?: string;
  scope?: LearningTreeScopeView;
  subjectKey?: string;
  rootNodeKey?: string;
  selectionSnapshot?: LearningTreeImportSelectionSnapshot;
}

function isScope(value: unknown): value is LearningTreeScopeView {
  return value === "global" || value === "subject" || value === "branch";
}

export function restoreAiLearningTreeDraft(userId: string): RestoredAiLearningTreeDraft | null {
  const storage = getBrowserStoragePort("local");
  if (!storage) return null;
  const envelope = readAiDraftHandoffEnvelope(storage, {
    endpoint: "learning-tree",
    userId,
    isValue: isAiLearningTreeHandoff,
    ttlMs: aiDraftTtlMs,
  });
  return envelope ? { updatedAt: envelope.updatedAt, ...envelope.value } : null;
}

export function restoreLearningTreeImportDraft(
  userId: string,
): RestoredLearningTreeImportDraft | null {
  const storage = getBrowserStoragePort("local");
  if (!storage) return null;
  const key = learningTreeImportDraftKey(userId);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const envelope = JSON.parse(raw) as {
      version?: number;
      userId?: string;
      updatedAt?: number;
      value?: {
        markdown?: unknown;
        scope?: unknown;
        subjectKey?: unknown;
        rootNodeKey?: unknown;
        selectionSnapshot?: unknown;
      };
    };
    if (
      (envelope.version !== 1 && envelope.version !== 2)
      || envelope.userId !== userId
      || typeof envelope.updatedAt !== "number"
      || Date.now() - envelope.updatedAt > importDraftTtlMs
    ) {
      storage.removeItem(key);
      return null;
    }
    return {
      updatedAt: envelope.updatedAt,
      ...(typeof envelope.value?.markdown === "string" ? { markdown: envelope.value.markdown } : {}),
      ...(isScope(envelope.value?.scope) ? { scope: envelope.value.scope } : {}),
      ...(typeof envelope.value?.subjectKey === "string" ? { subjectKey: envelope.value.subjectKey } : {}),
      ...(typeof envelope.value?.rootNodeKey === "string" ? { rootNodeKey: envelope.value.rootNodeKey } : {}),
      ...(isLearningTreeSelectionSnapshot(envelope.value?.selectionSnapshot)
        ? { selectionSnapshot: envelope.value.selectionSnapshot }
        : {}),
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function removeAiLearningTreeDraft(userId: string): void {
  getBrowserStoragePort("local")?.removeItem(aiLearningTreeDraftKey(userId));
}

export function removeLearningTreeImportDraft(userId: string): void {
  getBrowserStoragePort("local")?.removeItem(learningTreeImportDraftKey(userId));
}

export function isAiLearningTreeHandoff(
  value: unknown,
): value is Omit<RestoredAiLearningTreeDraft, "updatedAt"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as { markdownDraft?: unknown; scope?: unknown };
  return typeof draft.markdownDraft === "string" && isScope(draft.scope);
}
