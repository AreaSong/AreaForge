import { Prisma } from "../generated/prisma/client";
import { DELETE_FENCE_LOCK } from "./data-delete-intents";
import { DataJobQueueError, type DataQueueTransaction } from "./data-job-queue-types";

const derivedKinds = ["RANKING_REBUILD", "SEARCH_INDEX_REBUILD"] as const;
export function isDerivedQueueKind(kind: string): boolean { return derivedKinds.includes(kind as typeof derivedKinds[number]); }

/** 派生副本事务先进入删除屏障；有限锁等待也覆盖 effect 之前的队列 scope 锁。 */
export async function guardDerivedQueueTransaction(tx: DataQueueTransaction, kinds: readonly string[], jobId?: string): Promise<void> {
  if (!kinds.some(isDerivedQueueKind)) return;
  await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock_shared(${DELETE_FENCE_LOCK}) AS acquired`;
  if (lock?.acquired !== true) throw new DataJobQueueError("DATA_JOB_SCOPE_BUSY");
  if (jobId && await tx.dataDeletionFence.count({ where: { model: "DataJob", keyJson: { path: ["id"], equals: jobId } } })) {
    throw new DataJobQueueError("DATA_JOB_SCOPE_BUSY");
  }
}

export function derivedQueueVisibleSql(kinds: readonly string[]): Prisma.Sql {
  return kinds.some(isDerivedQueueKind) ? Prisma.sql`AND (kind::text NOT IN (${Prisma.join([...derivedKinds])}) OR NOT EXISTS (
    SELECT 1 FROM "DataDeletionFence" fence WHERE fence.model='DataJob' AND fence."keyJson"->>'id'="DataJob".id))` : Prisma.empty;
}

export function isDataJobScopeBusy(error: unknown): boolean {
  if (error instanceof DataJobQueueError) return error.code === "DATA_JOB_SCOPE_BUSY";
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapter = error.meta?.driverAdapterError;
  const cause = field(adapter, "cause");
  return error.code === "P2034" || [error.meta?.code, field(cause, "originalCode"), field(cause, "code")]
    .some(code => ["55P03", "40P01", "40001", "57014"].includes(String(code)));
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined;
}
