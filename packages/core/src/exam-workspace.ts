export type ExamWorkspaceStatus = "ACTIVE" | "ARCHIVED";

export interface ExamWorkspaceRevisionInput {
  currentRevision: number;
  expectedRevision: number;
}

export function assertExpectedRevision(input: ExamWorkspaceRevisionInput): "ok" | "revision_conflict" {
  if (input.expectedRevision !== input.currentRevision) {
    return "revision_conflict";
  }
  return "ok";
}

export function canActivateWorkspace(input: {
  targetStatus: ExamWorkspaceStatus;
  hasActiveSession: boolean;
}): "ok" | "already_active" | "active_session_blocks_switch" {
  if (input.targetStatus === "ACTIVE") {
    return "already_active";
  }
  if (input.hasActiveSession) {
    return "active_session_blocks_switch";
  }
  return "ok";
}

export function buildActiveSwitchPlan(input: {
  currentActiveId: string | null;
  targetId: string;
}): { archiveIds: string[]; activateId: string } {
  const archiveIds = input.currentActiveId && input.currentActiveId !== input.targetId ? [input.currentActiveId] : [];
  return { archiveIds, activateId: input.targetId };
}
