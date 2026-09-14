import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { operationExpectedBeforeHash, type OperationExecutionContext, type OperationParameters, type PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { createControlledOperationRequest, confirmControlledOperationRequest, approveControlledOperationRequest } from "../../apps/web/lib/system/controlled-operation-request-service";
import type { ControlledOperationFixture } from "./controlled-operation-fixture";

export async function seedOperationActors(client: PrismaClient, fixture: ControlledOperationFixture, passwordHash = "synthetic-not-login") {
  const [identity] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(identity.name, fixture.databaseName);
  async function actor(email: string): Promise<CurrentUser> {
    const user = await client.user.upsert({ where: { email }, create: { email, passwordHash, emailVerifiedAt: new Date() }, update: { passwordHash } });
    const session = await client.authSession.create({ data: { userId: user.id, authRevision: user.authRevision, tokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 86_400_000), reauthenticatedAt: new Date() } });
    const key = `ops-${user.id}`;
    let workspace = await client.examWorkspace.findFirst({ where: { userId: user.id, stableKey: key } });
    if (!workspace) workspace = await client.examWorkspace.create({ data: { userId: user.id, stableKey: key, name: "合成 OPS 验收空间", memberships: { create: { userId: user.id, role: "OWNER" } } } });
    await client.workspaceSelection.upsert({ where: { userId: user.id }, create: { userId: user.id, workspaceId: workspace.id }, update: { workspaceId: workspace.id } });
    return { id: user.id, email, status: user.status, emailVerifiedAt: user.emailVerifiedAt, sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
  }
  return { operator: await actor(fixture.operatorEmail), member: await actor(`member-${fixture.operatorEmail}`) };
}
export async function createOperationFixtureRequest(actor: CurrentUser, context: OperationExecutionContext, parameters: OperationParameters = { operation: "APPLY_RELEASE", tag: "v9.9.1" }) {
  let request = await createControlledOperationRequest(actor, { operation: parameters, expectedBeforeHash: operationExpectedBeforeHash(context.expectedBefore),
    executionSnapshotHash: context.snapshotHash, idempotencyKey: randomUUID(), requestedReason: "OPS 独立本地合成验证" });
  request = await confirmControlledOperationRequest(actor, request.id, operationRequestBinding(request));
  if (request.requiresApproval) request = await approveControlledOperationRequest(actor, request.id, operationRequestBinding(request));
  assert.equal(request.status, "QUEUED");
  return request;
}
export function operationRequestBinding(request: { revision: number; requestHash: string; nonce: string }) {
  return { expectedRevision: request.revision, requestHash: request.requestHash, nonce: request.nonce };
}
