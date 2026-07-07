import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";

type TaskDebtEventDbClient = PrismaClient | Prisma.TransactionClient;
type TaskDebtEventStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type TaskDebtEventMetadata = Record<string, string | number | boolean | null>;

export type TaskDebtEventAction =
  | "complete"
  | "defer"
  | "drop"
  | "recover"
  | "split"
  | "convert_review";

export interface TaskDebtEventTaskState {
  status: TaskDebtEventStatus;
  debtStatus: string;
}

export interface CreateTaskDebtEventInput {
  taskId: string;
  actorId: string;
  action: TaskDebtEventAction;
  from: TaskDebtEventTaskState;
  to: TaskDebtEventTaskState;
  relatedTaskId?: string | null;
  reason?: string | null;
  metadata?: TaskDebtEventMetadata;
}

export async function createTaskDebtEvent(
  input: CreateTaskDebtEventInput,
  client: TaskDebtEventDbClient = prisma,
): Promise<void> {
  await client.taskDebtEvent.create({
    data: {
      taskId: input.taskId,
      actorId: input.actorId,
      action: input.action,
      fromStatus: input.from.status,
      toStatus: input.to.status,
      fromDebtStatus: input.from.debtStatus,
      toDebtStatus: input.to.debtStatus,
      relatedTaskId: input.relatedTaskId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}
