import type { ExamWorkspaceDto } from "@/lib/contracts";
import { isoToShanghaiDateInput } from "@/lib/formatters";

export interface WorkspaceSetupDraft {
  step: "goal" | "takeover";
  name: string;
  stableKey: string;
  targetExamDate: string;
  subjectName: string;
  subjectKey: string;
  include408: boolean;
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
  return (draft.step === "goal" || draft.step === "takeover")
    && typeof draft.name === "string"
    && typeof draft.stableKey === "string"
    && typeof draft.targetExamDate === "string"
    && typeof draft.subjectName === "string"
    && typeof draft.subjectKey === "string"
    && typeof draft.include408 === "boolean";
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
