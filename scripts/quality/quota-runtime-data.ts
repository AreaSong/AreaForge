import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createPrismaClient, enqueueRankingRebuild, enqueueWorkspaceSearchIndex, type PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { createDurableDataExport, controlDurableDataExport } from "../../apps/web/lib/system/data-export-runtime-service";
import { controlWorkspaceSearchIndex, controlRankingRebuild, type DataJobQueueControl } from "../../packages/db/src/index";
import type { QuotaFixture } from "./quota-fixture";

export type QuotaKind = "EXPORT" | "SEARCH_INDEX_REBUILD" | "RANKING_REBUILD";
export const quotaKinds: QuotaKind[] = ["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"];

export async function createQuotaCase(client: PrismaClient, fixture: QuotaFixture, label: string, passwordHash = "synthetic-not-login") {
  assert.match(fixture.databaseName, /^areaforge_v20_quota_[a-f0-9]{12}$/);
  const prefix = `quota-${label}-${randomUUID().slice(0, 8)}`;
  async function actor(kind: string): Promise<CurrentUser> {
    const user = await client.user.create({ data: { email: `${prefix}-${kind}@example.test`, passwordHash, emailVerifiedAt: new Date() } });
    const session = await client.authSession.create({ data: { userId: user.id, authRevision: user.authRevision,
      tokenHash: randomBytes(32).toString("hex"), reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
    return { id: user.id, email: user.email, status: user.status, emailVerifiedAt: user.emailVerifiedAt,
      sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
  }
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
  const subject = await client.subject.create({ data: { workspaceId: workspace.id, stableKey: key, name: "QUOTA 合成科目", color: "#0f766e" } });
  for (const user of users) await client.rankingPreference.create({ data: { workspaceId: workspace.id, userId: user.id, enabled: true,
    timezone: "UTC", authorizedFields: ["score"] } });
  const challenge = await client.privateChallenge.create({ data: { workspaceId: workspace.id, ownerUserId: owner.id, name: "QUOTA 合成挑战",
    status: "ACTIVE", timezone: "UTC", startDate: "2026-09-01", endDate: "2026-10-01", targetEffectiveMinutesPerDay: 60,
    publishedFields: ["score"], participants: { create: users.map(user => ({ userId: user.id, status: "ACTIVE", nickname: "合成参与者", authorizedFields: ["score"] })) } } });
  return { workspace, subject, challenge };
}

export type QuotaCase = Awaited<ReturnType<typeof createQuotaCase>>;
export function quotaClient(url: string) { return createPrismaClient(url, { max: 16, connectionTimeoutMillis: 3_000 }); }

export async function requestQuotaCase(client: PrismaClient, data: QuotaCase, kind: QuotaKind,
  options: { actor?: CurrentUser; key?: string; secondary?: boolean; account?: boolean; generation?: number } = {}) {
  const actor = options.actor ?? data.owner; const target = options.secondary ? data.secondary : data;
  const idempotencyKey = options.key ?? randomUUID();
  let id: string;
  if (kind === "EXPORT") id = (await createDurableDataExport(actor, { scope: options.account ? "ACCOUNT" : "WORKSPACE",
    workspaceId: options.account ? undefined : target.workspace.id, idempotencyKey })).id;
  else if (kind === "SEARCH_INDEX_REBUILD") {
    const partition = await client.workspaceSearchPartition.findUnique({ where: { userId_workspaceId: { userId: actor.id, workspaceId: target.workspace.id } } });
    id = (await enqueueWorkspaceSearchIndex(client, { actorId: actor.id, sessionId: actor.sessionId, workspaceId: target.workspace.id,
      expectedGeneration: options.generation ?? partition?.generation ?? 0, idempotencyKey })).id;
  } else id = (await enqueueRankingRebuild(client, { actorId: actor.id, sessionId: actor.sessionId, challengeId: target.challenge.id,
    expectedRevision: target.challenge.revision, idempotencyKey })).id;
  return client.dataJob.findUniqueOrThrow({ where: { id } });
}

export async function controlQuotaCase(client: PrismaClient, data: QuotaCase, jobId: string, action: DataJobQueueControl) {
  const row = await client.dataJob.findUniqueOrThrow({ where: { id: jobId } });
  const base = { jobId, actorId: data.owner.id, sessionId: data.owner.sessionId, expectedRevision: row.updatedAt.getTime(), action };
  if (row.kind === "EXPORT") return controlDurableDataExport(data.owner, jobId, base.expectedRevision, action);
  if (row.kind === "SEARCH_INDEX_REBUILD") return controlWorkspaceSearchIndex(client, { ...base, workspaceId: data.workspace.id });
  return controlRankingRebuild(client, { ...base, challengeId: data.challenge.id });
}

export async function withQuotaPolicy<T>(patch: NodeJS.ProcessEnv, run: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(patch).map(key => [key, process.env[key]])); Object.assign(process.env, patch);
  try { return await run(); }
  finally { for (const key of Object.keys(patch)) if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
}
