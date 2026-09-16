import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";

export async function createAdmissionActor(client: PrismaClient, email: string, passwordHash: string): Promise<CurrentUser> {
  const user = await client.user.create({ data: { email, passwordHash, emailVerifiedAt: new Date() } });
  const session = await client.authSession.create({ data: { userId: user.id, authRevision: user.authRevision,
    tokenHash: randomBytes(32).toString("hex"), reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
  return { id: user.id, email: user.email, status: user.status, emailVerifiedAt: user.emailVerifiedAt,
    sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
}

/** 两个明确准入域共用合成数据结构；调用方仍必须通过各自私有marker校验。 */
export async function seedAdmissionCase(client: PrismaClient,
  input: { namespace: "quota" | "capacity"; databaseName: string; label: string; passwordHash: string }) {
  assert.match(input.databaseName, new RegExp(`^areaforge_v20_${input.namespace}_[a-f0-9]{12}$`));
  const [actual] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(actual?.name, input.databaseName);
  const prefix = `${input.namespace}-${input.label}-${randomUUID().slice(0, 8)}`;
  const actor = (kind: string) => createAdmissionActor(client, `${prefix}-${kind}@example.test`, input.passwordHash);
  const owner = await actor("owner"); const member = await actor("member"); const stranger = await actor("stranger");
  const main = await workspace(client, owner, [member], prefix, "配额合成空间");
  const secondary = await workspace(client, owner, [], `${prefix}-second`, "另一个配额空间");
  for (const user of [owner, member]) await client.workspaceSelection.create({ data: { userId: user.id, workspaceId: main.workspace.id } });
  return { prefix, owner, member, stranger, ...main, secondary };
}

async function workspace(client: PrismaClient, owner: CurrentUser, members: CurrentUser[], key: string, name: string) {
  const users = [owner, ...members];
  const workspace = await client.examWorkspace.create({ data: { userId: owner.id, stableKey: key, name,
    memberships: { create: users.map(user => ({ userId: user.id, role: user.id === owner.id ? "OWNER" as const : "MEMBER" as const })) } } });
  const subject = await client.subject.create({ data: { workspaceId: workspace.id, stableKey: key, name: "配额合成科目", color: "#0f766e" } });
  for (const user of users) await client.rankingPreference.create({ data: { workspaceId: workspace.id, userId: user.id, enabled: true,
    timezone: "UTC", authorizedFields: ["score"] } });
  const challenge = await client.privateChallenge.create({ data: { workspaceId: workspace.id, ownerUserId: owner.id, name: "配额合成挑战",
    status: "ACTIVE", timezone: "UTC", startDate: "2026-09-01", endDate: "2026-10-01", targetEffectiveMinutesPerDay: 60,
    publishedFields: ["score"], participants: { create: users.map(user => ({ userId: user.id, status: "ACTIVE", nickname: "合成参与者", authorizedFields: ["score"] })) } } });
  return { workspace, subject, challenge };
}
