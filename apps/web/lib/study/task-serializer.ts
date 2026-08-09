import type { StudyTaskDto } from "./types";

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** StudyTask 序列化所需的最小数据库行形状（任务服务与模拟服务共用）。 */
export interface SerializableTaskRecord {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  parentTaskId: string | null;
  title: string;
  type: string;
  status: DbTaskStatus;
  priority: DbTaskPriority;
  debtStatus: string;
  plannedDate: Date;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
  completedAt: Date | null;
  subject: {
    name: string;
    color: string;
  };
  syllabusNode?: {
    title: string;
  } | null;
  stageLinks?: Array<{ stagePlanId: string; stagePlan?: { name: string } | null }>;
  knowledgePointLinks?: Array<{ knowledgePointId: string; knowledgePoint?: { title: string } | null }>;
}

export function serializeTask(task: SerializableTaskRecord): StudyTaskDto {
  return {
    id: task.id,
    subjectId: task.subjectId,
    parentTaskId: task.parentTaskId,
    subjectName: task.subject.name,
    subjectColor: task.subject.color,
    syllabusNodeId: task.syllabusNodeId,
    syllabusNodeTitle: task.syllabusNode?.title ?? null,
    title: task.title,
    type: task.type,
    status: fromDbTaskStatus(task.status),
    priority: fromDbPriority(task.priority),
    debtStatus: task.debtStatus,
    plannedDate: task.plannedDate.toISOString(),
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    reviewText: task.reviewText,
    completedAt: task.completedAt?.toISOString() ?? null,
    stagePlanIds: task.stageLinks?.map((link) => link.stagePlanId) ?? [],
    stagePlanNames: task.stageLinks?.flatMap((link) => link.stagePlan?.name ? [link.stagePlan.name] : []) ?? [],
    knowledgePointIds: task.knowledgePointLinks?.map((link) => link.knowledgePointId) ?? [],
    knowledgePointTitles: task.knowledgePointLinks?.flatMap((link) => link.knowledgePoint?.title ? [link.knowledgePoint.title] : []) ?? [],
  };
}

export function toDbPriority(priority: StudyTaskDto["priority"]): DbTaskPriority {
  return priority.toUpperCase() as DbTaskPriority;
}

export function fromDbPriority(priority: DbTaskPriority): StudyTaskDto["priority"] {
  return priority.toLowerCase() as StudyTaskDto["priority"];
}

export function fromDbTaskStatus(status: DbTaskStatus): StudyTaskDto["status"] {
  switch (status) {
    case "TODO":
      return "todo";
    case "IN_PROGRESS":
      return "in_progress";
    case "DONE":
      return "done";
    case "SKIPPED":
      return "skipped";
    case "DEFERRED":
      return "deferred";
  }
}
