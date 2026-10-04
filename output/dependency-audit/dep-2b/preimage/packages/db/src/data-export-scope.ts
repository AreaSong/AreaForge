import { assertDataExportJobBinding, DataExportError, exportIdentifier, stableStringify, type DataExportAuthorization, type DataExportJobPayload } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { DataJobQueueError, type QueuedDataJob } from "./data-job-queue-types";

type Scope = Pick<DataExportJobPayload, "requesterId" | "scope" | "workspaceId">;

export async function readDataExportAuthorization(tx: Prisma.TransactionClient, input: Scope, lock = false): Promise<{ authorization: DataExportAuthorization; email: string }> {
  exportIdentifier(input.requesterId);
  if (input.workspaceId !== null) exportIdentifier(input.workspaceId);
  if (lock) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.requesterId} FOR SHARE NOWAIT`;
  const account = await tx.user.findUnique({ where: { id: input.requesterId }, select: { status: true, authRevision: true, email: true } });
  if (account?.status !== "ACTIVE") revoked();
  const where: Prisma.ExamWorkspaceWhereInput = input.scope === "WORKSPACE" ? { id: input.workspaceId ?? "" }
    : { OR: [{ userId: input.requesterId }, { memberships: { some: { userId: input.requesterId } } }] };
  const query = () => tx.examWorkspace.findMany({ where, take: 10_001, orderBy: { id: "asc" }, select: {
    id: true, userId: true, status: true, revision: true,
    memberships: { where: { userId: input.requesterId }, select: { id: true, role: true, status: true, revision: true } },
  } });
  let workspaces = await query();
  if (workspaces.length > 10_000) throw new DataExportError("DATA_EXPORT_SCOPE_LIMIT");
  if (lock && workspaces.length) {
    const ids = workspaces.map(row => row.id);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "ExamWorkspace" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE NOWAIT`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WorkspaceMembership" WHERE "userId" = ${input.requesterId} AND "workspaceId" IN (${Prisma.join(ids)}) ORDER BY "workspaceId" FOR SHARE NOWAIT`);
    workspaces = await query();
    if (stableStringify(ids) !== stableStringify(workspaces.map(row => row.id))) revoked();
  }
  const bindings = workspaces.map(row => ({ id: row.id, ownerId: row.userId, status: row.status, revision: row.revision, membership: row.memberships[0] ?? null }));
  bindings.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (input.scope === "WORKSPACE") {
    const target = bindings[0];
    if (bindings.length !== 1 || target?.id !== input.workspaceId || target.ownerId !== input.requesterId || target.status !== "ACTIVE"
      || target.membership?.status !== "ACTIVE" || target.membership.role !== "OWNER") revoked();
  }
  return { authorization: { authRevision: account.authRevision, workspaces: bindings }, email: account.email };
}

export async function assertDataExportAuthorization(tx: Prisma.TransactionClient, job: QueuedDataJob, lock = false) {
  const payload = assertDataExportJobBinding(job);
  const current = await readDataExportAuthorization(tx, payload, lock);
  if (stableStringify(current.authorization) !== stableStringify(payload.authorization)) revoked();
  return { payload, email: current.email };
}

function revoked(): never { throw new DataExportError("DATA_EXPORT_AUTHORIZATION_CHANGED"); }

export function exportDatabaseError(error: unknown): never {
  if (error instanceof DataExportError || error instanceof DataJobQueueError) throw error;
  const adapter = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError : undefined;
  const cause = field(adapter, "cause");
  const code = field(cause, "originalCode") ?? field(cause, "code");
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034"
    || ["55P03", "40P01", "40001"].includes(String(error.meta?.code)) || ["55P03", "40P01", "40001"].includes(String(code)))) {
    throw new DataExportError("DATA_EXPORT_SCOPE_BUSY", true);
  }
  throw new DataExportError("DATA_EXPORT_DATABASE_UNAVAILABLE", true);
}
function field(value: unknown, key: string): unknown { return value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined; }
