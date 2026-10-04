import type { LearningTreeDiffType } from "./learning-tree-protocol";

export interface LearningTreeImportSelection {
  choice: "apply" | "skip";
  mappedTargetId?: string;
}

export interface LearningTreeImportSelectionSnapshot {
  sourceFingerprint: string;
  selections: Record<string, LearningTreeImportSelection>;
}

export interface LearningTreeImportSelectionItem {
  stableKey: string;
  diffType: LearningTreeDiffType;
  candidateMatches: Array<{ entityId?: string }>;
}

export function createLearningTreeSelectionSourceFingerprint(input: {
  sourceSha256: string;
  canonicalPlanHash: string;
}): string {
  return `learning-tree-selection:v1:${input.sourceSha256}:${input.canonicalPlanHash}`;
}

export function createLearningTreeImportSelectionSnapshot(input: {
  sourceSha256: string;
  canonicalPlanHash: string;
  selections: Record<string, LearningTreeImportSelection>;
}): LearningTreeImportSelectionSnapshot {
  return {
    sourceFingerprint: createLearningTreeSelectionSourceFingerprint(input),
    selections: input.selections,
  };
}

export function restoreLearningTreeImportSelections(input: {
  sourceSha256: string;
  canonicalPlanHash: string;
  items: LearningTreeImportSelectionItem[];
  snapshot?: LearningTreeImportSelectionSnapshot | null;
}): Record<string, LearningTreeImportSelection> {
  const sourceMatches = input.snapshot?.sourceFingerprint ===
    createLearningTreeSelectionSourceFingerprint(input);
  const restored: Record<string, LearningTreeImportSelection> = {};

  for (const item of input.items) {
    if (item.diffType === "UNCHANGED" || item.diffType === "SKIP") {
      restored[item.stableKey] = { choice: "skip" };
      continue;
    }

    const previous = sourceMatches ? input.snapshot?.selections[item.stableKey] : undefined;
    const choice = previous?.choice === "skip" ? "skip" : "apply";
    const mappedTargetId =
      item.diffType === "CONFLICT" &&
      previous?.mappedTargetId &&
      item.candidateMatches.some((candidate) => candidate.entityId === previous.mappedTargetId)
        ? previous.mappedTargetId
        : undefined;
    restored[item.stableKey] = mappedTargetId ? { choice, mappedTargetId } : { choice };
  }

  return restored;
}
