import type { ExamWorkspaceDto } from "@/lib/contracts";
import { isoToShanghaiDateInput } from "@/lib/formatters";
import type { FirstUseGroupDraft, FirstUseSubjectDraft } from "@/lib/workspace/first-use";

export interface WorkspaceSetupDraft {
  step: "goal" | "takeover";
  name: string;
  stableKey: string;
  targetExamDate: string;
  subjectName: string;
  subjectKey: string;
  include408: boolean;
  subjects?: FirstUseSubjectDraft[];
  groups?: FirstUseGroupDraft[];
  templateIds?: string[];
}

export interface WorkspaceEditDraft {
  name: string;
  targetExamDate: string;
  stageSummary: string;
  baseRevision: number;
}

export interface WorkspaceConflict {
  latest: ExamWorkspaceDto;
  conflictFields: string[];
}

export function isWorkspaceSetupDraft(value: unknown): value is WorkspaceSetupDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<WorkspaceSetupDraft>;
  const subjectsValid = draft.subjects === undefined || (
    Array.isArray(draft.subjects)
    && draft.subjects.every((subject) => Boolean(subject)
      && typeof subject.id === "string"
      && typeof subject.stableKey === "string"
      && typeof subject.name === "string"
      && typeof subject.color === "string"
      && (subject.groupStableKey === null || typeof subject.groupStableKey === "string"))
  );
  const groupsValid = draft.groups === undefined || (
    Array.isArray(draft.groups)
    && draft.groups.every((group) => Boolean(group)
      && typeof group.id === "string"
      && typeof group.stableKey === "string"
      && typeof group.name === "string")
  );
  const templatesValid = draft.templateIds === undefined
    || (Array.isArray(draft.templateIds) && draft.templateIds.every((id) => typeof id === "string"));
  return (draft.step === "goal" || draft.step === "takeover")
    && typeof draft.name === "string"
    && typeof draft.stableKey === "string"
    && typeof draft.targetExamDate === "string"
    && typeof draft.subjectName === "string"
    && typeof draft.subjectKey === "string"
    && typeof draft.include408 === "boolean"
    && subjectsValid
    && groupsValid
    && templatesValid;
}

export function toWorkspaceEditDraft(workspace: ExamWorkspaceDto): WorkspaceEditDraft {
  return {
    name: workspace.name,
    targetExamDate: workspace.targetExamDate ? isoToShanghaiDateInput(workspace.targetExamDate) : "",
    stageSummary: workspace.stageSummary ?? "",
    baseRevision: workspace.revision,
  };
}

export function workspaceEditDraftsEqual(left: WorkspaceEditDraft, right: WorkspaceEditDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isWorkspaceEditDraft(value: unknown): value is WorkspaceEditDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<WorkspaceEditDraft>;
  return typeof draft.name === "string"
    && typeof draft.targetExamDate === "string"
    && typeof draft.stageSummary === "string"
    && Number.isInteger(draft.baseRevision)
    && (draft.baseRevision ?? 0) > 0;
}

export function isExamWorkspaceDto(value: unknown): value is ExamWorkspaceDto {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<ExamWorkspaceDto>;
  return typeof workspace.id === "string"
    && typeof workspace.name === "string"
    && (workspace.targetExamDate === null || typeof workspace.targetExamDate === "string")
    && (workspace.stageSummary === null || typeof workspace.stageSummary === "string")
    && (workspace.status === "ACTIVE" || workspace.status === "ARCHIVED")
    && Number.isInteger(workspace.revision)
    && (workspace.revision ?? 0) > 0;
}
