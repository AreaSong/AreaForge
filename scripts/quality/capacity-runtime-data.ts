import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hashWorkspaceInvitationToken } from "../../packages/auth/src/index";
import type { PrismaClient, DataJobQueueControl } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { seedAdmissionCase } from "./admission-runtime-fixture";
import { controlQuotaCase } from "./quota-runtime-data";
import type { CapacityFixture } from "./capacity-fixture";

export { createAdmissionActor } from "./admission-runtime-fixture";
export { quotaKinds as capacityKinds, requestQuotaCase as requestCapacityCase, quotaClient as capacityClient,
  withQuotaPolicy as withCapacityPolicy, type QuotaKind as CapacityKind } from "./quota-runtime-data";
export { capacityRuntimeCode, retryCapacityFixture } from "./capacity-runtime-support";

export async function createCapacityCase(client: PrismaClient, fixture: CapacityFixture, label: string, passwordHash = "synthetic-not-login") {
  assert.match(fixture.databaseName, /^areaforge_v20_capacity_[a-f0-9]{12}$/);
  return seedAdmissionCase(client, { namespace: "capacity", databaseName: fixture.databaseName, label, passwordHash });
}
export type CapacityCase = Awaited<ReturnType<typeof createCapacityCase>>;

export async function controlCapacityCase(client: PrismaClient, data: CapacityCase, jobId: string, action: DataJobQueueControl) {
  const row = await client.dataJob.findUniqueOrThrow({ where: { id: jobId } });
  const target = row.workspaceId === data.secondary.workspace.id ? { ...data, ...data.secondary } : data;
  return controlQuotaCase(client, target, jobId, action);
}

/** 只结算本次用例已登记的合成队列；保留全部行与历史，不清理其他测试资源。 */
export async function settleCapacityCase(client: PrismaClient, data: CapacityCase): Promise<void> {
  await client.dataJob.updateMany({ where: { requestedByUserId: { in: [data.owner.id, data.member.id, data.stranger.id] } },
    data: { status: "SUCCEEDED", expiresAt: new Date(0), leaseOwner: null, leaseExpiresAt: null } });
}

export async function seedCapacityInvitation(client: PrismaClient, fixture: CapacityFixture,
  data: { workspaceId: string; owner: CurrentUser; email: string }, options: { expired?: boolean; revoked?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const invitation = await client.workspaceInvitation.create({ data: { workspaceId: data.workspaceId,
    emailNormalized: data.email, tokenHash: hashWorkspaceInvitationToken(token, fixture.actionSecret), invitedByUserId: data.owner.id,
    expiresAt: new Date(Date.now() + (options.expired ? -60_000 : 3_600_000)), status: options.revoked ? "REVOKED" : "PENDING" } });
  return { token, invitation };
}

export function capacityQueueInput(data: CapacityCase, options: { actor?: CurrentUser; secondary?: boolean; account?: boolean; key?: string } = {}) {
  return { kind: "EXPORT" as const, scope: options.account ? "ACCOUNT" as const : "WORKSPACE" as const,
    workspaceId: options.account ? null : (options.secondary ? data.secondary.workspace.id : data.workspace.id),
    requestedByUserId: (options.actor ?? data.owner).id, idempotencyKey: options.key ?? randomUUID(),
    requestFingerprint: `sha256:${"a".repeat(64)}`, expiresAt: new Date(Date.now() + 3_600_000) };
}
