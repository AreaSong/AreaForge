import type { ReviewResult, ReviewTargetType } from "@areaforge/core";
import type { TaskStatusDto } from "./task";

export interface ReviewScheduleDto {
  id: string;
  workspaceId: string;
  targetType: ReviewTargetType;
  noteId: string | null;
  mistakeId: string | null;
  studyResourceId: string | null;
  syllabusNodeId: string | null;
  status: "ACTIVE" | "PAUSED";
  dueDate: string | null;
  pausedReason: string | null;
  consecutivePassCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewEventDto {
  id: string;
  reviewScheduleId: string;
  result: ReviewResult;
  durationSeconds: number;
  confirmedAt: string;
  learningDate: string;
  nextDueDate: string;
  consecutivePassDelta: number;
  correctedEventId: string | null;
  note: string | null;
  appliedRevision: number;
}

export interface ReviewQueueTargetDto {
  title: string;
  subtitle: string;
  canonicalHref: string;
  latestResult?: ReviewResult | null;
  latestAttemptAt?: string | null;
}

export interface BridgedReviewScheduleDto {
  schedule: ReviewScheduleDto;
  target: ReviewQueueTargetDto;
  canonicalTask: {
    id: string;
    title: string;
    status: Extract<TaskStatusDto, "todo" | "in_progress" | "deferred">;
    href: string;
  };
}

export interface RecentReviewEventDto extends ReviewEventDto {
  schedule: Pick<ReviewScheduleDto, "id" | "targetType">;
  target: ReviewQueueTargetDto;
}

export interface ReviewQueueItemDto {
  schedule: ReviewScheduleDto;
  target: ReviewQueueTargetDto;
}

export interface ReviewWorkbenchSummaryDto {
  overdueCount: number;
  dueTodayCount: number;
  completedTodayCount: number;
  completedTodaySeconds: number;
}
