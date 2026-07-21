import type { LearningTreeDiffType, LearningTreeObjectType } from "./learning-tree-protocol";
import type { LearningTreeObject } from "./learning-tree-parse";

export interface LearningTreeExistingRef {
  objectType: LearningTreeObjectType;
  stableKey: string | null;
  title: string;
  subjectKey: string | null;
  parentStableKey?: string | null;
  pathTitles?: string[];
  archived?: boolean;
  entityId?: string;
}

export interface LearningTreeDiffItem {
  objectType: LearningTreeObjectType;
  diffType: LearningTreeDiffType;
  stableKey: string;
  title: string;
  subjectKey: string | null;
  sourceLine?: number;
  candidateMatches: Array<{ entityId?: string; stableKey: string | null; title: string }>;
  blocking: boolean;
  reason?: string;
}

export function buildLearningTreeDiff(input: {
  incoming: LearningTreeObject[];
  existing: LearningTreeExistingRef[];
}): LearningTreeDiffItem[] {
  const items: LearningTreeDiffItem[] = [];
  const usedExisting = new Set<number>();

  for (const object of input.incoming) {
    const subjectKey = "subjectKey" in object ? object.subjectKey : null;
    const byStable = object.stableKey
      ? input.existing.findIndex(
          (row, index) =>
            !usedExisting.has(index) &&
            row.objectType === object.type &&
            row.stableKey === object.stableKey,
        )
      : -1;

    if (byStable >= 0) {
      usedExisting.add(byStable);
      const existing = input.existing[byStable]!;
      const archivedIncoming = object.type === "node" && object.archived;
      const moved =
        object.type === "node" &&
        (existing.parentStableKey ?? null) !== (object.parentStableKey ?? null);
      let diffType: LearningTreeDiffType = "UNCHANGED";
      if (archivedIncoming && !existing.archived) diffType = "ARCHIVE";
      else if (moved) diffType = "MOVE";
      else if (existing.title !== object.title) diffType = "UPDATE";
      items.push({
        objectType: object.type,
        diffType,
        stableKey: object.stableKey,
        title: object.title,
        subjectKey,
        sourceLine: object.sourceLine,
        candidateMatches: [
          { entityId: existing.entityId, stableKey: existing.stableKey, title: existing.title },
        ],
        blocking: false,
      });
      continue;
    }

    const candidates = input.existing
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row, index }) =>
          !usedExisting.has(index) &&
          row.objectType === object.type &&
          !row.stableKey &&
          row.title === object.title &&
          (row.subjectKey ?? null) === (subjectKey ?? null) &&
          (object.type !== "node" ||
            JSON.stringify(row.pathTitles ?? []) ===
              JSON.stringify(object.type === "node" ? object.pathTitles : [])),
      );

    if (candidates.length === 1) {
      usedExisting.add(candidates[0]!.index);
      const existing = candidates[0]!.row;
      items.push({
        objectType: object.type,
        diffType: "UPDATE",
        stableKey: object.stableKey,
        title: object.title,
        subjectKey,
        sourceLine: object.sourceLine,
        candidateMatches: [
          { entityId: existing.entityId, stableKey: existing.stableKey, title: existing.title },
        ],
        blocking: false,
        reason: "matched_by_path_title",
      });
      continue;
    }

    if (candidates.length > 1) {
      items.push({
        objectType: object.type,
        diffType: "CONFLICT",
        stableKey: object.stableKey,
        title: object.title,
        subjectKey,
        sourceLine: object.sourceLine,
        candidateMatches: candidates.map(({ row }) => ({
          entityId: row.entityId,
          stableKey: row.stableKey,
          title: row.title,
        })),
        blocking: true,
        reason: "ambiguous_title_match",
      });
      continue;
    }

    items.push({
      objectType: object.type,
      diffType: "ADD",
      stableKey: object.stableKey,
      title: object.title,
      subjectKey,
      sourceLine: object.sourceLine,
      candidateMatches: [],
      blocking: false,
    });
  }

  // Missing existing objects stay unchanged; only explicit archived=true archives.
  return items;
}
