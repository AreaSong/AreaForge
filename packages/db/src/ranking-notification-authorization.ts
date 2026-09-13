import { RankingNotificationError, type NotificationAuthorizationBinding, type RankingNotificationEvent } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";

/** NOWAIT 避免与已有成员/账户事务产生反向锁等待；冲突由业务重试或 worker 退避处理。 */
export async function lockNotificationAuthorization(tx: Prisma.TransactionClient, event: RankingNotificationEvent, mode: "admission" | "delivery") {
  const ids = [...new Set([event.actorUserId, event.recipientUserId])].sort();
  const accounts = await tx.$queryRaw<Array<{ id: string; status: string; authRevision: number }>>(Prisma.sql`
    SELECT id, status, "authRevision" FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE NOWAIT
  `);
  const workspaces = await tx.$queryRaw<Array<{ status: string; revision: number; name: string }>>`
    SELECT status, revision, name FROM "ExamWorkspace" WHERE id = ${event.workspaceId} FOR SHARE NOWAIT
  `;
  const members = await tx.$queryRaw<Array<{ id: string; userId: string; status: string; revision: number }>>(Prisma.sql`
    SELECT id, "userId", status, revision FROM "WorkspaceMembership"
    WHERE "workspaceId" = ${event.workspaceId} AND "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR SHARE NOWAIT
  `);
  const actor = accounts.find(row => row.id === event.actorUserId);
  const recipient = accounts.find(row => row.id === event.recipientUserId);
  const actorMember = members.find(row => row.userId === event.actorUserId);
  const recipientMember = members.find(row => row.userId === event.recipientUserId);
  const workspace = workspaces[0];
  if ([actor, actorMember, workspace].some(row => row?.status !== "ACTIVE")) throw new RankingNotificationError("USER_NOTIFICATION_AUTHORIZATION_REVOKED");
  if ([recipient, recipientMember].some(row => row?.status !== "ACTIVE")) {
    // 收件人退出后不再产生通知，但不能因此回滚挑战结束、移除或申诉处理；已排队事件仍须拒绝。
    if (mode === "admission") return null;
    throw new RankingNotificationError("USER_NOTIFICATION_AUTHORIZATION_REVOKED");
  }
  const binding: NotificationAuthorizationBinding = {
    actorAuthRevision: actor!.authRevision, recipientAuthRevision: recipient!.authRevision, workspaceRevision: workspace!.revision,
    actorMembershipId: actorMember!.id, actorMembershipRevision: actorMember!.revision,
    recipientMembershipId: recipientMember!.id, recipientMembershipRevision: recipientMember!.revision,
  };
  return { binding, workspaceLabel: workspace!.name.trim().slice(0, 120) };
}

export function mapNotificationDatabaseError(error: unknown): never {
  if (error instanceof RankingNotificationError) throw error;
  const adapter = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError : undefined;
  const cause = readField(adapter, "cause");
  const databaseCode = readField(cause, "originalCode") ?? readField(cause, "code");
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034"
    || ["55P03", "40P01", "40001"].includes(String(error.meta?.code))
    || ["55P03", "40P01", "40001"].includes(String(databaseCode)))) {
    throw new RankingNotificationError("USER_NOTIFICATION_SCOPE_BUSY", true);
  }
  throw error;
}

function readField(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined;
}
