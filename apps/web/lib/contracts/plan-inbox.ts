import type { PlanInboxItemStatus, TaskDependencyType } from "@areaforge/core";

export interface PlanInboxDependencyRefDto {
  id: string;
  targetType: "TASK" | "INBOX_STABLE_REF";
  dependencyType: TaskDependencyType;
  taskId: string | null;
  importBatchId: string | null;
  planStableKey: string | null;
  planOriginVersion: number | null;
}

export interface PlanInboxItemDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  sourceStableKey: string;
  originKey: string;
  originVersion: number;
  originType: string;
  originSnapshot: unknown;
  status: PlanInboxItemStatus;
  title: string;
  subjectId: string | null;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  priority: string | null;
  type: string | null;
  planMilestoneId: string | null;
  primaryNodeId: string | null;
  relatedNodeIds: string[];
  dependencyRefs: PlanInboxDependencyRefDto[];
  missingFields: string[];
  requiredMilestoneKey: string | null;
  revision: number;
  convertedTaskId: string | null;
  supersededByItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanInboxWriteResult {
  item: PlanInboxItemDto;
  created: boolean;
  reused: boolean;
  superseded: PlanInboxItemDto[];
}

export interface PlanInboxWriteSummaryDto {
  created: string[];
  reused: string[];
  superseded: string[];
  createdCount: number;
  reusedCount: number;
  supersededCount: number;
}

export interface PlanInboxFormOptions {
  subjects: Array<{ id: string; name: string }>;
  nodes: Array<{ id: string; subjectId: string; title: string }>;
  milestones: Array<{ id: string; subjectId: string | null; title: string }>;
  tasks: Array<{ id: string; subjectId: string; subjectName: string; title: string }>;
  stagePlans: Array<{ id: string; name: string }>;
}
