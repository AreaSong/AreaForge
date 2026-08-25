import type { MinimumActionSource } from "@areaforge/core";

export interface CheckInV2Dto {
  id: string;
  workspaceId: string | null;
  studyDate: string;
  completedMinimumAction: boolean;
  totalMinutes: number;
  effectiveMinutes: number;
  effectiveSessionCount: number;
  taskCompletionRate: number;
  reviewSubmitted: boolean;
  lowEfficiency: boolean;
  lowConversionCount: number;
  sourceVersion: number;
  reviewCount: number;
  reviewSeconds: number;
  passedCount: number;
  partialCount: number;
  failedCount: number;
  minimumActionSource: MinimumActionSource;
}
