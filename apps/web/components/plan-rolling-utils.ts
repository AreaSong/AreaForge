import type { SyllabusOptionNodeDto, TaskPriorityDto } from "@/lib/contracts";

export interface TaskCreateDraft {
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  stagePlanIds: string[];
  knowledgePointIds: string[];
  planMilestoneId: string;
  title: string;
  type: string;
  priority: TaskPriorityDto;
  estimatedMinutes: number;
}

export function flattenSyllabusNodes(
  nodes: SyllabusOptionNodeDto[],
  depth = 0,
): Array<SyllabusOptionNodeDto & { depth: number }> {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenSyllabusNodes(node.children, depth + 1),
  ]);
}

export function createDraftSnapshot(input: {
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  stagePlanIds: string[];
  knowledgePointIds: string[];
  planMilestoneId: string;
  title: string;
  taskType: string;
  priority: TaskPriorityDto;
  estimatedMinutes: number;
}): TaskCreateDraft {
  return {
    subjectId: input.subjectId,
    syllabusNodeId: input.syllabusNodeId,
    relatedSyllabusNodeIds: input.relatedSyllabusNodeIds,
    stagePlanIds: input.stagePlanIds,
    knowledgePointIds: input.knowledgePointIds,
    planMilestoneId: input.planMilestoneId,
    title: input.title,
    type: input.taskType,
    priority: input.priority,
    estimatedMinutes: input.estimatedMinutes,
  };
}

export function isTaskCreateDraft(value: unknown): value is TaskCreateDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<TaskCreateDraft>;
  return typeof draft.subjectId === "string"
    && typeof draft.syllabusNodeId === "string"
    && Array.isArray(draft.relatedSyllabusNodeIds)
    && draft.relatedSyllabusNodeIds.every((id) => typeof id === "string")
    && Array.isArray(draft.stagePlanIds)
    && draft.stagePlanIds.every((id) => typeof id === "string")
    && Array.isArray(draft.knowledgePointIds)
    && draft.knowledgePointIds.every((id) => typeof id === "string")
    && typeof draft.planMilestoneId === "string"
    && typeof draft.title === "string"
    && typeof draft.type === "string"
    && ["low", "medium", "high", "critical"].includes(draft.priority ?? "")
    && typeof draft.estimatedMinutes === "number";
}
