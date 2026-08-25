import {
  type RecoveryPlan,
  type RiskState,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import {
  normalizeRecoveryTargetMinutes,
  normalizeRecoveryVisibleTaskLimit,
  serializeRecoveryState,
  toRecoveryStateStatus,
  toRecoveryTriggerType,
  type RecoveryStateRecord,
  type RecoveryStateStatus,
} from "./recovery-state-contract";
import type { FinishRecoveryStateInput, StartManualRecoveryStateInput } from "./study-service-contracts";
import { normalizeOptionalText } from "./study-text";
import type { RecoveryStateDto, StudyTaskDto, TodayDashboardDto } from "@/lib/contracts";

const recoveryStateLockKey = 2026070703;

export async function startManualRecoveryState(
  input: StartManualRecoveryStateInput,
  actorId: string,
): Promise<RecoveryStateDto> {
  const state = await prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const activeState = await findActiveRecoveryState(tx);
    if (activeState) return activeState;
    return tx.recoveryState.create({
      data: {
        status: "active",
        triggerType: "manual",
        targetMinutes: normalizeRecoveryTargetMinutes(input.targetMinutes, 30),
        visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(input.visibleTaskLimit, 1),
        reason: normalizeOptionalText(input.reason)
          ?? "手动进入恢复：今天先把任务面缩到最小，恢复有效学习连续性。",
        actorId,
        metadata: { source: "manual_recovery_api" },
      },
    });
  });
  return serializeRecoveryState(state);
}

export async function completeRecoveryState(id: string, input: FinishRecoveryStateInput): Promise<RecoveryStateDto> {
  return finishRecoveryState(id, "completed", input.exitCondition, "用户标记恢复完成");
}

export async function cancelRecoveryState(id: string, input: FinishRecoveryStateInput): Promise<RecoveryStateDto> {
  return finishRecoveryState(id, "canceled", input.exitCondition, "用户取消恢复状态");
}

export async function createRuleRecoveryState(input: {
  plan: RecoveryPlan;
  actorId: string | null;
  topTask: StudyTaskDto | null;
  riskState: RiskState;
  debtCount: number;
  missedDays: number;
  effectiveMinutes: number;
  studyDayKey: string;
}): Promise<RecoveryStateRecord> {
  return prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const activeState = await findActiveRecoveryState(tx);
    if (activeState) return activeState;
    return tx.recoveryState.create({
      data: {
        status: "active",
        triggerType: "rule",
        targetMinutes: normalizeRecoveryTargetMinutes(input.plan.minimumMinutes, 30),
        visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(input.plan.visibleTaskLimit, 1),
        reason: input.plan.reason,
        actorId: input.actorId,
        metadata: {
          source: "dashboard_rule",
          action: input.plan.action,
          riskState: input.riskState,
          debtCount: input.debtCount,
          missedDays: input.missedDays,
          effectiveMinutes: input.effectiveMinutes,
          studyDayKey: input.studyDayKey,
          topTaskId: input.topTask?.id ?? null,
          topTaskTitle: input.topTask?.title ?? null,
        },
      },
    });
  });
}

export async function findActiveRecoveryState(client: PrismaClientLike = prisma): Promise<RecoveryStateRecord | null> {
  return client.recoveryState.findFirst({ where: { status: "active" }, orderBy: { startedAt: "desc" } });
}

export async function lockRecoveryState(client: Prisma.TransactionClient): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${recoveryStateLockKey})`;
}

export function createDashboardRecoveryFromRealtimePlan(plan: RecoveryPlan): TodayDashboardDto["recovery"] {
  return {
    stateId: null,
    source: "realtime_rule",
    active: plan.active,
    status: null,
    triggerType: null,
    minimumMinutes: plan.minimumMinutes,
    targetMinutes: plan.minimumMinutes,
    visibleTaskLimit: plan.visibleTaskLimit,
    reason: plan.reason,
    action: plan.action,
    startedAt: null,
    endedAt: null,
    exitCondition: null,
  };
}

export function createDashboardRecoveryFromState(
  state: RecoveryStateRecord,
  topTask: StudyTaskDto | null,
): TodayDashboardDto["recovery"] {
  const status = toRecoveryStateStatus(state.status);
  const targetMinutes = normalizeRecoveryTargetMinutes(state.targetMinutes, 30);
  return {
    stateId: state.id,
    source: "state",
    active: status === "active",
    status,
    triggerType: toRecoveryTriggerType(state.triggerType),
    minimumMinutes: targetMinutes,
    targetMinutes,
    visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(state.visibleTaskLimit, 1),
    reason: state.reason,
    action: createRecoveryStateAction(targetMinutes, topTask),
    startedAt: state.startedAt.toISOString(),
    endedAt: state.endedAt?.toISOString() ?? null,
    exitCondition: state.exitCondition,
  };
}

async function finishRecoveryState(
  id: string,
  status: Exclude<RecoveryStateStatus, "active">,
  exitCondition: string | undefined,
  fallbackExitCondition: string,
): Promise<RecoveryStateDto> {
  const state = await prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const existing = await tx.recoveryState.findUnique({ where: { id } });
    if (!existing) throw new ApiError("RECOVERY_STATE_NOT_FOUND", 404);
    if (existing.status !== "active") {
      if (existing.status === status) return existing;
      throw new ApiError("RECOVERY_STATE_ALREADY_FINISHED", 409);
    }
    return tx.recoveryState.update({
      where: { id },
      data: {
        status,
        endedAt: new Date(),
        exitCondition: normalizeOptionalText(exitCondition) ?? fallbackExitCondition,
      },
    });
  });
  return serializeRecoveryState(state);
}

function createRecoveryStateAction(targetMinutes: number, topTask: StudyTaskDto | null): string {
  return topTask
    ? `今天只压「${topTask.title}」这个最小任务，先完成 ${targetMinutes} 分钟。`
    : `今天不补过去，先完成 ${targetMinutes} 分钟有效学习。`;
}

type PrismaClientLike = Pick<Prisma.TransactionClient, "recoveryState">;
