export interface LearningTreeArchiveCapabilitySource {
  batchId: string;
  archived: boolean;
  workspaceStatus?: "ACTIVE" | "ARCHIVED";
  workspaceRevision?: number;
}

export interface LearningTreeArchiveCapabilityState {
  sourceKey: string;
  allowed: boolean | null;
}

export function createLearningTreeArchiveCapability(
  source: LearningTreeArchiveCapabilitySource,
): LearningTreeArchiveCapabilityState {
  return {
    sourceKey: learningTreeArchiveCapabilitySourceKey(source),
    allowed: source.workspaceStatus === "ARCHIVED" ? false : null,
  };
}

export function reconcileLearningTreeArchiveCapability(
  state: LearningTreeArchiveCapabilityState,
  source: LearningTreeArchiveCapabilitySource,
): LearningTreeArchiveCapabilityState {
  const sourceKey = learningTreeArchiveCapabilitySourceKey(source);
  return state.sourceKey === sourceKey ? state : createLearningTreeArchiveCapability(source);
}

export function resolveLearningTreeArchiveCapability(
  state: LearningTreeArchiveCapabilityState,
  allowed: boolean,
): LearningTreeArchiveCapabilityState {
  return { ...state, allowed };
}

export function learningTreeArchiveCapabilitySourceKey(
  source: LearningTreeArchiveCapabilitySource,
): string {
  return [
    source.batchId,
    source.archived ? "archived" : "active",
    source.workspaceStatus ?? "unknown",
    source.workspaceRevision ?? "unknown",
  ].join(":");
}
