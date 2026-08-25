import type { RecoveryV2Status } from "@areaforge/core";

export type RecoveryStateStatusDto = "active" | "completed" | "canceled";
export type RecoveryTriggerTypeDto = "rule" | "manual";
export type RecoverySourceDto = "state" | "realtime_rule";

export interface RecoveryStateDto {
  id: string;
  status: RecoveryStateStatusDto;
  triggerType: RecoveryTriggerTypeDto;
  startedAt: string;
  endedAt: string | null;
  targetMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  exitCondition: string | null;
  actorId: string | null;
}

export interface RecoveryV2Dto {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  status: RecoveryV2Status;
  effectiveStatus: RecoveryV2Status;
  effectiveReason: string;
  restartAvailable: boolean;
  triggerType: string;
  currentStage: number;
  targetMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  windowStartDate: string | null;
  windowEndDate: string | null;
  lastProgressDate: string | null;
  progressionVersion: number;
  revision: number;
  startedAt: string;
  endedAt: string | null;
}
