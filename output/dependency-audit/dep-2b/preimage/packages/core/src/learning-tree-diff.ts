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
  semanticSignature?: string;
  revision?: number;
  updatedAt?: string;
  sortOrder?: number;
  status?: string;
  originVersion?: number;
}

export interface LearningTreeDiffItem {
  objectType: LearningTreeObjectType;
  diffType: LearningTreeDiffType;
  stableKey: string;
  title: string;
  subjectKey: string | null;
  sourceLine?: number;
  candidateMatches: Array<{
    entityId?: string;
    stableKey: string | null;
    title: string;
    revision?: number;
    updatedAt?: string;
  }>;
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
            stableIdentitySharesSubject(object.type, row.subjectKey, subjectKey) &&
            (row.stableKey === object.stableKey ||
              (!row.stableKey && row.entityId === legacyEntityIdForKey(object.type, object.stableKey))),
        )
      : -1;

    if (byStable >= 0) {
      usedExisting.add(byStable);
      const existing = input.existing[byStable]!;
      const archivedIncoming = object.type === "node" && object.archived;
      const moved =
        object.type === "node" &&
        (existing.parentStableKey ?? null) !== (object.parentStableKey ?? null);
      const semanticChanged =
        (existing.semanticSignature === undefined
          ? existing.title !== object.title
          : existing.semanticSignature !== learningTreeObjectSemanticSignature(object)) ||
        (object.type === "node" &&
          ((object.sortOrder !== undefined && existing.sortOrder !== object.sortOrder) ||
            (object.status !== undefined && existing.status !== object.status)));
      let diffType: LearningTreeDiffType = "UNCHANGED";
      if (moved) diffType = "MOVE";
      else if (archivedIncoming && !existing.archived) diffType = "ARCHIVE";
      else if (semanticChanged) diffType = "UPDATE";
      items.push({
        objectType: object.type,
        diffType,
        stableKey: object.stableKey,
        title: object.title,
        subjectKey,
        sourceLine: object.sourceLine,
        candidateMatches: [
          candidateMatch(existing),
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
          candidateMatch(existing),
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
        candidateMatches: candidates.map(({ row }) => candidateMatch(row)),
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

export function learningTreeObjectSemanticSignature(object: LearningTreeObject): string {
  switch (object.type) {
    case "group":
      return JSON.stringify(["group", object.title]);
    case "subject":
      return JSON.stringify(["subject", object.title, object.groupKey ?? null]);
    case "node":
      return JSON.stringify([
        "node",
        object.title,
        object.subjectKey,
        object.parentStableKey ?? null,
        object.archived,
      ]);
    case "card":
      return JSON.stringify([
        "card",
        object.title,
        object.subjectKey,
        object.kind,
        object.primaryNode ?? null,
        [...object.relatedNodes].sort(),
        object.bodyMarkdown,
      ]);
    case "resource":
      return JSON.stringify(["resource", object.title, object.subjectKey, object.kind, object.url]);
    case "plan":
      return JSON.stringify([
        "plan",
        object.title,
        object.subjectKey,
        object.milestoneKey ?? null,
        object.durationMinutes ?? null,
        object.dependsOn ?? null,
        object.dependencyType ?? "SOFT",
      ]);
  }
}

function stableIdentitySharesSubject(
  objectType: LearningTreeObjectType,
  existingSubjectKey: string | null,
  incomingSubjectKey: string | null,
): boolean {
  return objectType !== "node" && objectType !== "card"
    ? true
    : existingSubjectKey === incomingSubjectKey;
}

function candidateMatch(row: LearningTreeExistingRef): LearningTreeDiffItem["candidateMatches"][number] {
  return {
    entityId: row.entityId,
    stableKey: row.stableKey,
    title: row.title,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

function legacyEntityIdForKey(objectType: LearningTreeObjectType, stableKey: string): string | null {
  const prefix = `legacy_${objectType}_`;
  return stableKey.startsWith(prefix) ? stableKey.slice(prefix.length) : null;
}
