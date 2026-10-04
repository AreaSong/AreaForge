export type TaskDependencyType = "SOFT" | "HARD";
export type TaskStatusForDependency = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";

export interface TaskDependencyEdge {
  predecessorId: string;
  successorId: string;
  type: TaskDependencyType;
}

export function validateDependencyEdge(input: {
  predecessorId: string;
  successorId: string;
  existing: TaskDependencyEdge[];
}): "ok" | "self_loop" | "duplicate_edge" {
  if (input.predecessorId === input.successorId) {
    return "self_loop";
  }
  if (
    input.existing.some(
      (edge) => edge.predecessorId === input.predecessorId && edge.successorId === input.successorId,
    )
  ) {
    return "duplicate_edge";
  }
  return "ok";
}

export function wouldCreateDependencyCycle(input: {
  edges: TaskDependencyEdge[];
  predecessorId: string;
  successorId: string;
}): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of input.edges) {
    const list = adjacency.get(edge.predecessorId) ?? [];
    list.push(edge.successorId);
    adjacency.set(edge.predecessorId, list);
  }
  const next = adjacency.get(input.predecessorId) ?? [];
  next.push(input.successorId);
  adjacency.set(input.predecessorId, next);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const child of adjacency.get(nodeId) ?? []) {
      if (dfs(child)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }

  return dfs(input.predecessorId);
}

export function isHardBlocked(input: {
  predecessorStatus: TaskStatusForDependency;
  dependencyType: TaskDependencyType;
}): boolean {
  if (input.dependencyType !== "HARD") return false;
  return input.predecessorStatus !== "DONE";
}
