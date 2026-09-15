import { Prisma } from "../generated/prisma/client";
import { DELETE_FENCE_LOCK } from "./data-delete-intents";
import { DataJobQueueError, type DataQueueTransaction } from "./data-job-queue-types";

/** 排名事务必须先进入删除屏障；有限锁等待也覆盖 effect 之前的队列 scope 锁。 */
export async function guardRankingQueueTransaction(tx: DataQueueTransaction, kinds: readonly string[], jobId?: string): Promise<void> {
  if (!kinds.includes("RANKING_REBUILD")) return;
  await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock_shared(${DELETE_FENCE_LOCK}) AS acquired`;
  if (lock?.acquired !== true) throw new DataJobQueueError("DATA_JOB_SCOPE_BUSY");
  if (jobId && await tx.dataDeletionFence.count({ where: { model: "DataJob", keyJson: { path: ["id"], equals: jobId } } })) {
    throw new DataJobQueueError("DATA_JOB_SCOPE_BUSY");
  }
}

export function rankingQueueVisibleSql(kinds: readonly string[]): Prisma.Sql {
  return kinds.includes("RANKING_REBUILD") ? Prisma.sql`AND (kind <> 'RANKING_REBUILD' OR NOT EXISTS (
    SELECT 1 FROM "DataDeletionFence" fence WHERE fence.model='DataJob' AND fence."keyJson"->>'id'="DataJob".id))` : Prisma.empty;
}

export function isDataJobScopeBusy(error: unknown): boolean {
  if (error instanceof DataJobQueueError) return error.code === "DATA_JOB_SCOPE_BUSY";
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapter = error.meta?.driverAdapterError;
  const cause = field(adapter, "cause");
  return error.code === "P2034" || [error.meta?.code, field(cause, "originalCode"), field(cause, "code")]
    .some(code => ["55P03", "40P01", "40001"].includes(String(code)));
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined;
}
