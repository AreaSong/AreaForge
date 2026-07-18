import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";

export type TaskStatusValue = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
export type TaskDebtStatusValue = "NONE" | "ACCEPTABLE" | "NEEDS_RECOVERY" | "STAGE_IMPACT" | "PLAN_BREAKING";
export type SessionStatusValue = "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELED";

export interface TaskCasPreimage {
  id: string;
  status: TaskStatusValue;
  debtStatus: TaskDebtStatusValue;
  type: string;
  plannedDate: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface SessionCasPreimage {
  id: string;
  status: SessionStatusValue;
  updatedAt: Date;
}

export async function applyTaskCas(
  tx: Prisma.TransactionClient,
  expected: TaskCasPreimage,
  data: Prisma.StudyTaskUncheckedUpdateManyInput,
): Promise<void> {
  const result = await tx.studyTask.updateMany({
    where: {
      id: expected.id,
      status: expected.status,
      debtStatus: expected.debtStatus,
      type: expected.type,
      plannedDate: expected.plannedDate,
      updatedAt: expected.updatedAt,
      completedAt: expected.completedAt,
    },
    data,
  });

  if (result.count !== 1) {
    throw new ApiError("TASK_STATE_CONFLICT", 409);
  }
}

export async function applySessionCas(
  tx: Prisma.TransactionClient,
  expected: SessionCasPreimage,
  data: Prisma.StudySessionUpdateManyMutationInput,
): Promise<void> {
  const result = await tx.studySession.updateMany({
    where: {
      id: expected.id,
      status: expected.status,
      updatedAt: expected.updatedAt,
    },
    data,
  });

  if (result.count !== 1) {
    throw new ApiError("SESSION_STATE_CONFLICT", 409);
  }
}

export function isUniqueConstraintViolation(error: unknown, depth = 0): boolean {
  if (depth > 5 || typeof error !== "object" || error === null) return false;

  const record = error as Record<string, unknown>;
  if (record.code === "P2002" || record.code === "23505" || record.originalCode === "23505") {
    return true;
  }

  return [record.cause, record.meta, record.driverAdapterError]
    .some((value) => isUniqueConstraintViolation(value, depth + 1));
}
