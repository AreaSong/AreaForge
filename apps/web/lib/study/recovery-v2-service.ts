import {
  RECOVERY_WINDOW_DAYS,
  assertExpectedRevision,
  computeRecoveryProgressMinutes,
  evaluateRecoveryDayProgress,
  recoveryWindowDayIndex,
  stageTargetMinutes,
  type RecoveryV2Status,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import type { RecoveryV2Dto } from "@/lib/contracts/recovery";

const recoveryV2LockNamespace = 2026072122;
type Tx = Prisma.TransactionClient;

export type { RecoveryV2Dto } from "@/lib/contracts/recovery";

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
  const status = normalizeStatus(row.status);
  const expiredOnRead = status === "ACTIVE" && isRecoveryV2Expired(row, new Date());
  const effectiveStatus = expiredOnRead ? "EXPIRED" : status;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    status,
    effectiveStatus,
    effectiveReason: expiredOnRead ? "恢复窗口已到期，可重新开始恢复三阶。" : row.reason,
    restartAvailable: effectiveStatus === "EXPIRED",
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
    where: { userId: actorId, workspaceId: workspace.id, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  });
  if (!row) return null;
  return serialize(row);
}

export async function startRecoveryV2(
  actorId: string,
  input?: { reason?: string; triggerType?: "manual" | "rule" },
): Promise<RecoveryV2Dto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await resolveActiveWorkspace(actorId, tx);
    await lockRecoveryV2Scope(tx, actorId, workspace.id);

    const active = await findActiveRecoveryV2InTx(tx, actorId, workspace.id);
    if (active) {
      const current = await expireRecoveryV2IfNeeded(tx, active, new Date());
      if (normalizeStatus(current.status) === "ACTIVE") return serialize(current);
    }

    return serialize(await createRecoveryV2InTx(tx, actorId, workspace.id, input?.reason, input?.triggerType ?? "manual"));
  });
}

export async function cancelRecoveryV2(
  actorId: string,
  recoveryId: string,
  input: { expectedRevision: number },
): Promise<RecoveryV2Dto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await resolveActiveWorkspace(actorId, tx);
    await lockRecoveryV2Scope(tx, actorId, workspace.id);
    const existing = await findRecoveryV2ByIdInTx(tx, actorId, workspace.id, recoveryId);
    if (!existing) throw new ApiError("RECOVERY_NOT_FOUND", 404);
    assertRecoveryRevision(existing, input.expectedRevision);
    const current = normalizeStatus(existing.status) === "ACTIVE"
      ? await expireRecoveryV2IfNeeded(tx, existing, new Date())
      : existing;
    if (normalizeStatus(current.status) !== "ACTIVE") {
      throw new ApiError("RECOVERY_NOT_ACTIVE", 409, {
        latest: serialize(current),
        conflictFields: ["status"],
      });
    }

    const updated = await tx.recoveryState.update({
      where: { id: current.id },
      data: {
        status: "CANCELED",
        endedAt: new Date(),
        exitCondition: "user_cancel",
        revision: { increment: 1 },
      },
    });
    return serialize(updated);
  });
}

export async function restartRecoveryV2(
  actorId: string,
  recoveryId: string,
  input: { expectedRevision: number },
): Promise<RecoveryV2Dto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await resolveActiveWorkspace(actorId, tx);
    await lockRecoveryV2Scope(tx, actorId, workspace.id);
    const existing = await findRecoveryV2ByIdInTx(tx, actorId, workspace.id, recoveryId);
    if (!existing) throw new ApiError("RECOVERY_NOT_FOUND", 404);
    assertRecoveryRevision(existing, input.expectedRevision);

    const current = normalizeStatus(existing.status) === "ACTIVE"
      ? await expireRecoveryV2IfNeeded(tx, existing, new Date())
      : existing;
    if (normalizeStatus(current.status) === "ACTIVE") {
      throw new ApiError("RECOVERY_ALREADY_ACTIVE", 409, {
        latest: serialize(current),
        conflictFields: ["status"],
      });
    }

    return serialize(await createRecoveryV2InTx(
      tx,
      actorId,
      workspace.id,
      "重新开始恢复三阶。",
    ));
  });
}

export async function applyRecoveryDayProgress(
  actorId: string,
  input: { progressMinutesToday: number },
): Promise<RecoveryV2Dto | null> {
  return prisma.$transaction(async (tx) => {
    const workspace = await resolveActiveWorkspace(actorId, tx);
    await lockRecoveryV2Scope(tx, actorId, workspace.id);
    const existing = await findActiveRecoveryV2InTx(tx, actorId, workspace.id);
    if (!existing) return null;
    return serialize(await applyRecoveryV2ProgressInTx(tx, existing, input.progressMinutesToday, new Date()));
  });
}

export async function applyRecoveryV2CheckInProgressInTx(
  tx: Tx,
  actorId: string,
  workspaceId: string,
  input: {
    studyDate: Date;
    effectiveSessionMinutes: number;
    confirmedReviewSeconds: number;
    now: Date;
  },
): Promise<RecoveryV2Dto | null> {
  await lockRecoveryV2Scope(tx, actorId, workspaceId);
  const existing = await findActiveRecoveryV2InTx(tx, actorId, workspaceId);
  if (!existing) return null;

  const today = getStudyDayRange(input.now);
  if (getStudyDayRange(input.studyDate).key !== today.key) {
    return serialize(await expireRecoveryV2IfNeeded(tx, existing, input.now));
  }

  const progressMinutesToday = computeRecoveryProgressMinutes({
    effectiveSessionMinutes: input.effectiveSessionMinutes,
    confirmedReviewSeconds: input.confirmedReviewSeconds,
  });
  return serialize(await applyRecoveryV2ProgressInTx(tx, existing, progressMinutesToday, input.now));
}

type RecoveryV2Record = Prisma.RecoveryStateGetPayload<Record<string, never>>;

async function lockRecoveryV2Scope(tx: Tx, actorId: string, workspaceId: string): Promise<void> {
  const scope = `${actorId}:${workspaceId}`;
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${recoveryV2LockNamespace}, hashtext(${scope}))`;
}

async function findActiveRecoveryV2InTx(
  tx: Tx,
  actorId: string,
  workspaceId: string,
): Promise<RecoveryV2Record | null> {
  return tx.recoveryState.findFirst({
    where: { userId: actorId, workspaceId, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  });
}

async function findRecoveryV2ByIdInTx(
  tx: Tx,
  actorId: string,
  workspaceId: string,
  recoveryId: string,
): Promise<RecoveryV2Record | null> {
  return tx.recoveryState.findFirst({
    where: { id: recoveryId, userId: actorId, workspaceId },
  });
}

async function createRecoveryV2InTx(
  tx: Tx,
  actorId: string,
  workspaceId: string,
  reason?: string,
  triggerType: "manual" | "rule" = "manual",
): Promise<RecoveryV2Record> {
  const today = getStudyDayRange();
  return tx.recoveryState.create({
    data: {
      userId: actorId,
      actorId,
      workspaceId,
      status: "ACTIVE",
      triggerType,
      currentStage: 1,
      targetMinutes: stageTargetMinutes(1),
      visibleTaskLimit: 1,
      reason: reason?.trim() || (triggerType === "rule" ? "规则触发恢复：先完成三阶最小有效学习。" : "手动进入恢复：先完成三阶最小有效学习。"),
      windowStartDate: today.start,
      windowEndDate: new Date(today.start.getTime() + RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      progressionVersion: 1,
      revision: 1,
    },
  });
}

async function expireRecoveryV2IfNeeded(
  tx: Tx,
  existing: RecoveryV2Record,
  now: Date,
): Promise<RecoveryV2Record> {
  if (normalizeStatus(existing.status) !== "ACTIVE" || !isRecoveryV2Expired(existing, now)) return existing;
  return tx.recoveryState.update({
    where: { id: existing.id },
    data: {
      status: "EXPIRED",
      endedAt: new Date(),
      exitCondition: "window_expired",
      revision: { increment: 1 },
    },
  });
}

async function applyRecoveryV2ProgressInTx(
  tx: Tx,
  existing: RecoveryV2Record,
  progressMinutesToday: number,
  now: Date,
): Promise<RecoveryV2Record> {
  if (!existing.windowStartDate) return existing;
  const today = getStudyDayRange(now);
  const status = normalizeStatus(existing.status);
  const result = evaluateRecoveryDayProgress({
    currentStage: existing.currentStage,
    status,
    progressMinutesToday,
    windowDayIndex: recoveryWindowDayIndex({
      windowStartDate: existing.windowStartDate,
      todayStart: today.start,
    }),
    alreadyAdvancedToday:
      existing.lastProgressDate !== null &&
      getStudyDayRange(existing.lastProgressDate).key === today.key,
  });

  if (!result.advanced && result.nextStatus === status) return existing;
  return tx.recoveryState.update({
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
      progressionVersion: result.advanced ? { increment: 1 } : existing.progressionVersion,
      revision: { increment: 1 },
    },
  });
}

function isRecoveryV2Expired(
  existing: Pick<RecoveryV2Record, "status" | "windowStartDate">,
  now: Date,
): boolean {
  if (!existing.windowStartDate || normalizeStatus(existing.status) !== "ACTIVE") return false;
  return recoveryWindowDayIndex({
    windowStartDate: existing.windowStartDate,
    todayStart: getStudyDayRange(now).start,
  }) >= RECOVERY_WINDOW_DAYS;
}

function assertRecoveryRevision(existing: RecoveryV2Record, expectedRevision: number): void {
  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision }) === "revision_conflict") {
    throw new ApiError("RECOVERY_REVISION_CONFLICT", 409, {
      latest: serialize(existing),
      conflictFields: ["revision"],
    });
  }
}
