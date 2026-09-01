import type { Prisma } from "@areaforge/db";
import type { RecoveryStateDto } from "@/lib/contracts";

export type RecoveryStateStatus = "active" | "completed" | "canceled";
export type RecoveryTriggerType = "rule" | "manual";

export interface RecoveryStateRecord {
  id: string;
  status: string;
  triggerType: string;
  startedAt: Date;
  endedAt: Date | null;
  targetMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  exitCondition: string | null;
  metadata: Prisma.JsonValue | null;
  actorId: string | null;
}

export function serializeRecoveryState(state: RecoveryStateRecord): RecoveryStateDto {
  return {
    id: state.id,
    status: toRecoveryStateStatus(state.status),
    triggerType: toRecoveryTriggerType(state.triggerType),
    startedAt: state.startedAt.toISOString(),
    endedAt: state.endedAt?.toISOString() ?? null,
    targetMinutes: normalizeRecoveryTargetMinutes(state.targetMinutes, 30),
    visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(state.visibleTaskLimit, 1),
    reason: state.reason,
    exitCondition: state.exitCondition,
    actorId: state.actorId,
  };
}

export function toRecoveryStateStatus(status: string): RecoveryStateStatus {
  if (status === "completed" || status === "canceled") return status;
  return "active";
}

export function toRecoveryTriggerType(triggerType: string): RecoveryTriggerType {
  return triggerType === "manual" ? "manual" : "rule";
}

export function normalizeRecoveryTargetMinutes(value: number | undefined, fallback: number): number {
  return normalizeBoundedInt(value, fallback, 5, 240);
}

export function normalizeRecoveryVisibleTaskLimit(value: number | undefined, fallback: number): number {
  return normalizeBoundedInt(value, fallback, 1, 8);
}

function normalizeBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
