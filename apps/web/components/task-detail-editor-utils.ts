import { savePrivateBusinessDraft } from "@/lib/client/private-business-drafts";
import type { SyllabusOptionNodeDto, TaskUpdateSnapshotDto } from "@/lib/contracts";
import { isoToShanghaiDateInput, shanghaiDateInputToIso } from "@/lib/formatters";

export interface TaskEditValues {
  subjectId: string;
  syllabusNodeId: string;
  relatedSyllabusNodeIds: string[];
  knowledgePointIds: string[];
  stagePlanIds: string[];
  planMilestoneId: string;
  title: string;
  type: string;
  priority: TaskUpdateSnapshotDto["priority"];
  plannedDate: string;
  estimatedMinutes: number;
  reviewText: string;
}

export interface TaskEditConflict {
  baseline: TaskUpdateSnapshotDto;
  latest: TaskUpdateSnapshotDto;
  conflictFields: string[];
}

interface TaskEditDraft {
  expectedStatus: TaskUpdateSnapshotDto["status"];
  expectedUpdatedAt: string;
  values: TaskEditValues;
}

export function valuesFromSnapshot(snapshot: TaskUpdateSnapshotDto): TaskEditValues {
  return {
    subjectId: snapshot.subjectId,
    syllabusNodeId: snapshot.syllabusNodeId ?? "",
    relatedSyllabusNodeIds: snapshot.relatedSyllabusNodeIds,
    knowledgePointIds: snapshot.knowledgePointIds,
    stagePlanIds: snapshot.stagePlanIds,
    planMilestoneId: snapshot.planMilestoneId ?? "",
    title: snapshot.title,
    type: snapshot.type,
    priority: snapshot.priority,
    plannedDate: isoToShanghaiDateInput(snapshot.plannedDate),
    estimatedMinutes: snapshot.estimatedMinutes,
    reviewText: snapshot.reviewText ?? "",
  };
}

export function taskConflictComparisons(conflict: TaskEditConflict, local: TaskEditValues) {
  const server = valuesFromSnapshot(conflict.latest);
  const baseline = valuesFromSnapshot(conflict.baseline);
  return (Object.keys(local) as Array<keyof TaskEditValues>).map((field) => ({
    field,
    label: taskFieldLabel(field),
    baseline: baseline[field],
    local: local[field],
    server: server[field],
  }));
}

function taskFieldLabel(field: keyof TaskEditValues): string {
  return ({
    subjectId: "科目",
    syllabusNodeId: "主考纲节点",
    relatedSyllabusNodeIds: "相关考纲节点",
    knowledgePointIds: "关联知识点",
    stagePlanIds: "所属阶段",
    planMilestoneId: "里程碑",
    title: "标题",
    type: "类型",
    priority: "优先级",
    plannedDate: "计划日期",
    estimatedMinutes: "预计分钟",
    reviewText: "任务复盘",
  })[field];
}

export function flattenNodes(
  nodes: SyllabusOptionNodeDto[],
  depth = 0,
): Array<SyllabusOptionNodeDto & { depth: number }> {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenNodes(node.children, depth + 1),
  ]);
}

export function studyDateToIso(value: string): string {
  return shanghaiDateInputToIso(value);
}

export function editValuesEqual(left: TaskEditValues, right: TaskEditValues): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isTaskEditDraft(value: unknown): value is TaskEditDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<TaskEditDraft>;
  return ["todo", "in_progress", "done", "skipped", "deferred"].includes(record.expectedStatus ?? "")
    && typeof record.expectedUpdatedAt === "string"
    && isTaskEditValues(record.values);
}

function isTaskEditValues(value: unknown): value is TaskEditValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<TaskEditValues>;
  return typeof record.subjectId === "string"
    && typeof record.syllabusNodeId === "string"
    && Array.isArray(record.relatedSyllabusNodeIds)
    && record.relatedSyllabusNodeIds.every((id) => typeof id === "string")
    && Array.isArray(record.knowledgePointIds)
    && record.knowledgePointIds.every((id) => typeof id === "string")
    && Array.isArray(record.stagePlanIds)
    && record.stagePlanIds.every((id) => typeof id === "string")
    && typeof record.planMilestoneId === "string"
    && typeof record.title === "string"
    && typeof record.type === "string"
    && ["low", "medium", "high", "critical"].includes(record.priority ?? "")
    && typeof record.plannedDate === "string"
    && typeof record.estimatedMinutes === "number"
    && typeof record.reviewText === "string";
}

export function saveTaskDraft(
  key: string,
  baseline: TaskUpdateSnapshotDto,
  values: TaskEditValues,
): void {
  savePrivateBusinessDraft<TaskEditDraft>(key, {
    expectedStatus: baseline.status,
    expectedUpdatedAt: baseline.updatedAt,
    values,
  });
}

export function isTaskUpdateSnapshot(value: unknown): value is TaskUpdateSnapshotDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<TaskUpdateSnapshotDto>;
  return typeof record.id === "string"
    && typeof record.subjectId === "string"
    && (record.syllabusNodeId === null || typeof record.syllabusNodeId === "string")
    && Array.isArray(record.relatedSyllabusNodeIds)
    && Array.isArray(record.knowledgePointIds)
    && Array.isArray(record.stagePlanIds)
    && (record.planMilestoneId === null || typeof record.planMilestoneId === "string")
    && typeof record.title === "string"
    && typeof record.updatedAt === "string";
}
