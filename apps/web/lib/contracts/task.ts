import type {
  TaskDebtReorderAction,
  TaskDebtReorderPressure,
  TaskDependencyType,
} from "@areaforge/core";

export type TaskStatusDto = "todo" | "in_progress" | "done" | "skipped" | "deferred";
export type TaskPriorityDto = "low" | "medium" | "high" | "critical";

export interface StudyTaskDto {
  id: string;
  subjectId: string;
  parentTaskId: string | null;
  subjectName: string;
  subjectColor: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  title: string;
  type: string;
  status: TaskStatusDto;
  priority: TaskPriorityDto;
  debtStatus: string;
  plannedDate: string;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
  completedAt: string | null;
  /** 一个任务可以同时服务多个阶段；planMilestoneId 仍表示主要计划里程碑。 */
  stagePlanIds: string[];
  stagePlanNames: string[];
  knowledgePointIds: string[];
  knowledgePointTitles: string[];
}

export interface TaskDebtReorderSuggestionDto {
  taskId: string;
  taskTitle: string;
  subjectName: string;
  action: TaskDebtReorderAction;
  reason: string;
  estimatedMinutes: number;
  rank: number;
}

export interface TaskDebtReorderDto {
  pressure: TaskDebtReorderPressure;
  availableMinutes: number;
  summary: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
  suggestions: TaskDebtReorderSuggestionDto[];
}

export interface TaskDependencyDto {
  id: string;
  predecessorId: string;
  successorId: string;
  type: TaskDependencyType;
  revision: number;
  predecessorTitle: string | null;
  predecessorStatus: TaskStatusDto | null;
  successorTitle: string | null;
  successorStatus: TaskStatusDto | null;
}

export interface TaskUpdateSnapshotDto {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  relatedSyllabusNodeIds: string[];
  stagePlanIds: string[];
  knowledgePointIds: string[];
  planMilestoneId: string | null;
  title: string;
  type: string;
  status: TaskStatusDto;
  priority: TaskPriorityDto;
  plannedDate: string;
  estimatedMinutes: number;
  reviewText: string | null;
  updatedAt: string;
}

export interface StudyTaskDetailDto {
  task: StudyTaskDto;
  workspaceId: string;
  workspaceName: string;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
  subjectArchived: boolean;
  updateSnapshot: TaskUpdateSnapshotDto;
  planMilestone: {
    id: string;
    title: string;
    status: string;
    archivedAt: string | null;
  } | null;
  reviewSchedule: {
    id: string;
    status: string;
    dueDate: string | null;
    revision: number;
  } | null;
  relatedSyllabusNodes: Array<{
    id: string;
    title: string;
    archivedAt: string | null;
  }>;
  knowledgePoints: Array<{ id: string; title: string; masteryState: string }>;
  parentTask: TaskRelationSummaryDto | null;
  childTasks: TaskRelationSummaryDto[];
  sessions: Array<{
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    effectiveMinutes: number;
    isEffective: boolean | null;
    minimalOutput: string | null;
  }>;
  debtEvents: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    relatedTask: { id: string; title: string } | null;
    createdAt: string;
  }>;
  auditEvents: Array<{
    id: string;
    action: string;
    createdAt: string;
  }>;
}

export interface TaskRelationSummaryDto {
  id: string;
  title: string;
  status: TaskStatusDto;
}

export interface TaskDependencyCandidateDto extends TaskRelationSummaryDto {
  subjectName: string;
}
