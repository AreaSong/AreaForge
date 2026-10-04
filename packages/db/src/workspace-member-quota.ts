import { WorkspaceMemberQuotaError, readWorkspaceMemberQuotaPolicy, workspaceMemberQuotaRejection,
  type DataJobQuotaEnvironment } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";

type MemberQuotaTransaction = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

/** 只能在邀请/身份校验后调用；席位占用不采用会隐藏冻结对象的普通 count。 */
export async function checkWorkspaceMemberQuotaAdmission(tx: MemberQuotaTransaction,
  input: { workspaceId: string; userId: string }, env: DataJobQuotaEnvironment = process.env): Promise<void> {
  if (env.WORKSPACE_MEMBER_QUOTA_ENABLED === undefined || env.WORKSPACE_MEMBER_QUOTA_ENABLED === "false") return;
  await assertMemberQuotaIsolation(tx);
  const [existing] = await tx.$queryRaw<Array<{ occupied: boolean }>>`SELECT
    EXISTS(SELECT 1 FROM "WorkspaceMembership" WHERE "workspaceId"=${input.workspaceId} AND "userId"=${input.userId} AND status='ACTIVE')
    OR EXISTS(SELECT 1 FROM "ExamWorkspace" WHERE id=${input.workspaceId} AND "userId"=${input.userId}) AS occupied`;
  if (existing?.occupied === true) return;
  if (existing?.occupied !== false) throw new WorkspaceMemberQuotaError("WORKSPACE_MEMBER_QUOTA_USAGE_UNAVAILABLE");
  const policy = readWorkspaceMemberQuotaPolicy(env);
  if (!policy) return;
  await lockMemberAdmission(tx, input.workspaceId);
  const [workspace] = await tx.$queryRaw<Array<{ userId: string; status: string }>>`
    SELECT "userId",status FROM "ExamWorkspace" WHERE id=${input.workspaceId} FOR SHARE NOWAIT`;
  if (!workspace || workspace.status !== "ACTIVE") throw new WorkspaceMemberQuotaError("WORKSPACE_MEMBER_QUOTA_SCOPE_INVALID");
  const [usage] = await tx.$queryRaw<Array<{ occupiedSeats: bigint }>>`SELECT 1+COUNT(*) AS "occupiedSeats"
    FROM "WorkspaceMembership" WHERE "workspaceId"=${input.workspaceId} AND status='ACTIVE' AND "userId"<>${workspace.userId}`;
  if (!usage) throw new WorkspaceMemberQuotaError("WORKSPACE_MEMBER_QUOTA_USAGE_UNAVAILABLE");
  const rejected = workspaceMemberQuotaRejection(policy, Number(usage.occupiedSeats));
  if (rejected) throw new WorkspaceMemberQuotaError(rejected);
}

async function lockMemberAdmission(tx: MemberQuotaTransaction, workspaceId: string): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
  await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
  const key = `areaforge:workspace-member-quota:v1:${workspaceId}`;
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
  if (lock?.acquired !== true) throw new WorkspaceMemberQuotaError("WORKSPACE_MEMBER_QUOTA_BUSY");
}

async function assertMemberQuotaIsolation(tx: MemberQuotaTransaction): Promise<void> {
  const [transaction] = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
  if (transaction?.isolation !== "serializable") throw new WorkspaceMemberQuotaError("WORKSPACE_MEMBER_QUOTA_ISOLATION_UNSUPPORTED");
}
