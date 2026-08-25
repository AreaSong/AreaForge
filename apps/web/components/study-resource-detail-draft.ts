import type { StudyResourceDto } from "@/lib/contracts";

export interface ResourceDetailValues {
  title: string;
  category: string;
  subjectId: string;
  tags: string;
  taskIds: string[];
  noteIds: string[];
  mistakeIds: string[];
  syllabusNodeIds: string[];
}

export interface ResourceDetailDraft {
  schemaVersion: 1;
  baseRevision: number | null;
  values: ResourceDetailValues;
}

export type ResourceDetailDraftRestore = {
  status: "current" | "stale" | "legacy";
  baseRevision: number | null;
  values: ResourceDetailValues;
};

export function toResourceDetailDraft(resource: StudyResourceDto): ResourceDetailValues {
  return {
    title: resource.title,
    category: resource.category,
    subjectId: resource.subjectId ?? "",
    tags: resource.tags.join("，"),
    taskIds: resource.taskIds,
    noteIds: resource.noteIds,
    mistakeIds: resource.mistakeIds,
    syllabusNodeIds: resource.syllabusNodeIds,
  };
}

export function resourceDetailDraftsEqual(
  left: ResourceDetailValues,
  right: ResourceDetailValues,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isResourceDetailDraft(value: unknown): value is ResourceDetailDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ResourceDetailDraft>;
  return draft.schemaVersion === 1
    && (draft.baseRevision === null || isRevision(draft.baseRevision))
    && isResourceDetailValues(draft.values);
}

export function isStoredResourceDetailDraft(
  value: unknown,
): value is ResourceDetailDraft | ResourceDetailValues {
  return isResourceDetailDraft(value) || isResourceDetailValues(value);
}

export function restoreResourceDetailDraft(
  stored: ResourceDetailDraft | ResourceDetailValues,
  currentRevision: number,
): ResourceDetailDraftRestore {
  if (!isResourceDetailDraft(stored)) {
    return { status: "legacy", baseRevision: null, values: stored };
  }
  return {
    status: stored.baseRevision === currentRevision ? "current" : "stale",
    baseRevision: stored.baseRevision,
    values: stored.values,
  };
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isResourceDetailValues(value: unknown): value is ResourceDetailValues {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ResourceDetailValues>;
  return [draft.title, draft.category, draft.subjectId, draft.tags]
    .every((field) => typeof field === "string")
    && [draft.taskIds, draft.noteIds, draft.mistakeIds, draft.syllabusNodeIds]
      .every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"));
}
