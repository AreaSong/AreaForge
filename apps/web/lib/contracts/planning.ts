import type { StagePlanDto } from "./stage";
import type { StudyTaskDto } from "./task";

export interface PlanMilestoneDto {
  id: string;
  workspaceId: string;
  stagePlanId: string;
  subjectId: string | null;
  stableKey: string;
  title: string;
  targetDate: string | null;
  sortOrder: number;
  status: string;
  revision: number;
  archivedAt: string | null;
}

export interface PlanMilestoneConflictLatest {
  kind: "plan-milestone";
  milestone: PlanMilestoneDto | null;
  stagePlan?: StagePlanDto | null;
  commandState?: "conflict" | "result_unavailable";
  sourceConflict?: unknown;
}

export interface PlanRollingDayDto {
  date: string;
  tasks: StudyTaskDto[];
}

export interface PlanRollingDto {
  days: PlanRollingDayDto[];
  tasks: StudyTaskDto[];
  debt: StudyTaskDto[];
  openInboxCount: number;
  inboxEntryPath: string;
  setupRequired: boolean;
  workspaceId: string | null;
}
