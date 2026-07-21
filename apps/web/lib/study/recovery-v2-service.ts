import {
  RECOVERY_WINDOW_DAYS,
  assertExpectedRevision,
  evaluateRecoveryDayProgress,
  recoveryWindowDayIndex,
  stageTargetMinutes,
  type RecoveryV2Status,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";
import { resolveActiveWorkspace } from "./exam-workspace-service";

export interface RecoveryV2Dto {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  status: RecoveryV2Status;
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

function serialize(row: {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  status: string;
  triggerType: string;
  currentStage: number;
  targetMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  windowStartDate: Date | null;
  windowEndDate: Date | null;
  lastProgressDate: Date | null;
  progressionVersion: number;
  revision: number;
  startedAt: Date;
  endedAt: Date | null;
}): RecoveryV2Dto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    status: normalizeStatus(row.status),
    triggerType: row.triggerType,
    currentStage: row.currentStage,
    targetMinutes: row.targetMinutes,
    visibleTaskLimit: row.visibleTaskLimit,
    reason: row.reason,
    windowStartDate: row.windowStartDate?.toISOString() ?? null,
    windowEndDate: row.windowEndDate?.toISOString() ?? null,
    lastProgressDate: row.lastProgressDate?.toISOString() ?? null,
    progressionVersion: row.progressionVersion,
    revision: row.revision,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

function normalizeStatus(status: string): RecoveryV2Status {
  const upper = status.toUpperCase();
  if (upper === "ACTIVE" || upper === "COMPLETED" || upper === "EXPIRED" || upper === "CANCELED") {
    return upper;
  }
  if (status === "active") return "ACTIVE";
  if (status === "completed") return "COMPLETED";
  if (status === "canceled" || status === "cancelled") return "CANCELED";
  if (status === "expired") return "EXPIRED";
  return "ACTIVE";
}

export async function getActiveRecoveryV2(actorId: string): Promise<RecoveryV2Dto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const row = await prisma.recoveryState.findFirst({
    where: {
      userId: actorId,
      workspaceId: workspace.id,
      status: { in: ["ACTIVE", "active"] },
    },
    orderBy: { startedAt: "desc" },
  });
  return row ? serialize(row) : null;
}

export async function startRecoveryV2(
  actorId: string,
  input?: { reason?: string },
): Promise<RecoveryV2Dto> {
  const workspace = await resolveActiveWorkspace(actorId);
  if (workspace.status !== "ACTIVE") {
    throw new ApiError("RECOVERY_WORKSPACE_NOT_ACTIVE", 409);
  }

  const today = getStudyDayRange();
  const windowEnd = new Date(today.start.getTime() + RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const created = await prisma.recoveryState.create({
      data: {
        userId: actorId,
        actorId,
        workspaceId: workspace.id,
        status: "ACTIVE",
        triggerType: "manual",
        currentStage: 1,
        targetMinutes: stageTargetMinutes(1),
        visibleTaskLimit: 1,
        reason: input?.reason?.trim() || "手动进入恢复：先完成三阶最小有效学习。",
        windowStartDate: today.start,
        windowEndDate: windowEnd,
        progressionVersion: 1,
        revision: 1,
      },
    });
    return serialize(created);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const existing = await getActiveRecoveryV2(actorId);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function cancelRecoveryV2(
  actorId: string,
  recoveryId: string,
  input: { expectedRevision: number },
): Promise<RecoveryV2Dto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.recoveryState.findFirst({
    where: { id: recoveryId, userId: actorId, workspaceId: workspace.id },
  });
  if (!existing) throw new ApiError("RECOVERY_NOT_FOUND", 404);
  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
    throw new ApiError("RECOVERY_REVISION_CONFLICT", 409, {
      latest: serialize(existing),
      conflictFields: ["revision"],
    });
  }
  if (normalizeStatus(existing.status) !== "ACTIVE") {
    throw new ApiError("RECOVERY_NOT_ACTIVE", 409, {
      latest: serialize(existing),
      conflictFields: ["status"],
    });
  }

  const updated = await prisma.recoveryState.update({
    where: { id: existing.id },
    data: {
      status: "CANCELED",
      endedAt: new Date(),
      exitCondition: "user_cancel",
      revision: { increment: 1 },
    },
  });
  return serialize(updated);
}

export async function restartRecoveryV2(
  actorId: string,
  recoveryId: string,
  input: { expectedRevision: number },
): Promise<RecoveryV2Dto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.recoveryState.findFirst({
    where: { id: recoveryId, userId: actorId, workspaceId: workspace.id },
  });
  if (!existing) throw new ApiError("RECOVERY_NOT_FOUND", 404);
  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
    throw new ApiError("RECOVERY_REVISION_CONFLICT", 409, {
      latest: serialize(existing),
      conflictFields: ["revision"],
    });
  }

  const status = normalizeStatus(existing.status);
  if (status === "ACTIVE") {
    throw new ApiError("RECOVERY_ALREADY_ACTIVE", 409, {
      latest: serialize(existing),
      conflictFields: ["status"],
    });
  }

  await prisma.recoveryState.update({
    where: { id: existing.id },
    data: {
      status: status === "EXPIRED" || status === "COMPLETED" || status === "CANCELED" ? status : "CANCELED",
      endedAt: existing.endedAt ?? new Date(),
      revision: { increment: 1 },
    },
  });

  return startRecoveryV2(actorId, { reason: "重新开始恢复三阶。" });
}

export async function applyRecoveryDayProgress(
  actorId: string,
  input: { progressMinutesToday: number },
): Promise<RecoveryV2Dto | null> {
  const active = await getActiveRecoveryV2(actorId);
  if (!active) return null;

  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.recoveryState.findFirst({
    where: { id: active.id, workspaceId: workspace.id },
  });
  if (!existing || !existing.windowStartDate) return active;

  const today = getStudyDayRange();
  const dayIndex = recoveryWindowDayIndex({
    windowStartDate: existing.windowStartDate,
    todayStart: today.start,
  });
  const alreadyAdvancedToday =
    existing.lastProgressDate !== null &&
    getStudyDayRange(existing.lastProgressDate).key === today.key;

  const result = evaluateRecoveryDayProgress({
    currentStage: existing.currentStage,
    status: normalizeStatus(existing.status),
    progressMinutesToday: input.progressMinutesToday,
    windowDayIndex: dayIndex,
    alreadyAdvancedToday,
  });

  if (!result.advanced && result.nextStatus === normalizeStatus(existing.status)) {
    if (result.nextStatus === "EXPIRED" && normalizeStatus(existing.status) === "ACTIVE") {
      const expired = await prisma.recoveryState.update({
        where: { id: existing.id },
        data: {
          status: "EXPIRED",
          endedAt: new Date(),
          exitCondition: "window_expired",
          revision: { increment: 1 },
        },
      });
      return serialize(expired);
    }
    return serialize(existing);
  }

  const updated = await prisma.recoveryState.update({
    where: { id: existing.id },
    data: {
      currentStage: result.nextStage,
      status: result.nextStatus,
      targetMinutes: stageTargetMinutes(result.nextStage),
      lastProgressDate: result.advanced ? today.start : existing.lastProgressDate,
      endedAt: result.nextStatus === "ACTIVE" ? null : new Date(),
      exitCondition:
        result.nextStatus === "COMPLETED"
          ? "stages_complete"
          : result.nextStatus === "EXPIRED"
            ? "window_expired"
            : existing.exitCondition,
      progressionVersion: result.advanced
        ? { increment: 1 }
        : existing.progressionVersion,
      revision: { increment: 1 },
    },
  });
  return serialize(updated);
}
