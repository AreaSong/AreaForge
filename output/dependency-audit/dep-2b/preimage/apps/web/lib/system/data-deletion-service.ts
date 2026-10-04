import { DataDeleteError, dataDeleteSummary, type DataDeleteTarget } from "@areaforge/core";
import { getDeletionControlClient, prisma, previewDatabaseDeletion, createDatabaseDeletion, controlDatabaseDeletion,
  listDatabaseDeletions, readDeletionReceipt, listDeletionCandidates } from "@areaforge/db";
import type { CurrentUser } from "@/lib/auth/session";
import type { DeletionTargetInput, TrashResourceType } from "@/lib/contracts/data-deletion";

const target = (user: CurrentUser, input: DeletionTargetInput): DataDeleteTarget => ({ requesterId: user.id, scope: input.scope,
  workspaceId: input.workspaceId ?? null, resourceType: input.resourceType ?? null, resourceId: input.resourceId ?? null });

export async function listUserDeletions(user: CurrentUser) {
  const client = getDeletionControlClient();
  const [state] = await client.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass('"DataDeletionIntent"') IS NOT NULL AS exists`;
  return state?.exists ? listDatabaseDeletions(client, user.id) : [];
}
export async function previewUserDeletion(user: CurrentUser, input: DeletionTargetInput) {
  const plan = await previewDatabaseDeletion(getDeletionControlClient(), user, target(user, input));
  return { ...dataDeleteSummary(plan), targetLabel: plan.targetLabel };
}
export async function createUserDeletion(user: CurrentUser, input: DeletionTargetInput & { fingerprint: string; idempotencyKey: string; receiptToken: string; confirmation: string }) {
  const confirmation = input.scope === "ACCOUNT" ? "删除我的账户" : input.scope === "WORKSPACE" ? "删除此工作区" : "放入回收站";
  if (input.confirmation !== confirmation) throw new DataDeleteError("DATA_DELETE_CONFIRMATION_REQUIRED");
  return createDatabaseDeletion(getDeletionControlClient(), { actor: user, target: target(user, input), fingerprint: input.fingerprint,
    idempotencyKey: input.idempotencyKey, receiptToken: input.receiptToken });
}
export const controlUserDeletion = (user: CurrentUser, id: string, input: { action: "cancel" | "restore" | "retry"; expectedRevision: number }) =>
  controlDatabaseDeletion(getDeletionControlClient(), { actor: user, intentId: id, ...input });
export const getDeletionReceipt = (id: string, token: string) => readDeletionReceipt(getDeletionControlClient(), id, token);
export function getUserDeletionCandidates(user: CurrentUser, workspaceId: string, resourceType: TrashResourceType, query?: string) {
  if (process.env.DATA_DELETE_ENABLED !== "true" || process.env.DATA_LIFECYCLE_ENABLED !== "true") throw new DataDeleteError("DATA_DELETE_DISABLED");
  return listDeletionCandidates(prisma, { userId: user.id, workspaceId, resourceType, query });
}
