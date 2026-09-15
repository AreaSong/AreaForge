import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createPrismaClient, enqueueRankingRebuild, type PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { runDataJobWorker } from "../workers/data-job-runner";
import { createRankingRebuildHandler } from "../workers/ranking-rebuild-handler";
import type { RankingRebuildFixture } from "./ranking-rebuild-fixture";

export async function createRankingCase(client: PrismaClient, fixture: RankingRebuildFixture, label: string, passwordHash = "synthetic-not-login", solo = false) {
  const prefix = `rank-${label}-${randomUUID().slice(0, 8)}`;
  async function actor(kind: string): Promise<CurrentUser> {
    const user = await client.user.create({ data: { email: `${prefix}-${kind}@example.test`, passwordHash, emailVerifiedAt: new Date() } });
    const session = await client.authSession.create({ data: { userId: user.id, authRevision: user.authRevision,
      tokenHash: randomBytes(32).toString("hex"), reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
    return { id: user.id, email: user.email, status: user.status, emailVerifiedAt: user.emailVerifiedAt,
      sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
  }
  const owner = await actor("owner"); const member = await actor("member"); const stranger = await actor("stranger");
  const users = solo ? [owner] : [owner, member];
  const workspace = await client.examWorkspace.create({ data: { userId: owner.id, stableKey: prefix, name: `合成排名空间 ${label}`,
    memberships: { create: users.map(user => ({ userId: user.id, role: user.id === owner.id ? "OWNER" as const : "MEMBER" as const })) } } });
  for (const user of users) {
    await client.workspaceSelection.create({ data: { userId: user.id, workspaceId: workspace.id } });
    await client.rankingPreference.create({ data: { workspaceId: workspace.id, userId: user.id, enabled: true,
      timezone: "UTC", authorizedFields: user.id === owner.id ? ["score", "active_days"] : ["score"] } });
  }
  const subject = await client.subject.create({ data: { workspaceId: workspace.id, stableKey: prefix, name: "合成科目", color: "#0f766e" } });
  const challenge = await client.privateChallenge.create({ data: { workspaceId: workspace.id, ownerUserId: owner.id,
    name: `持久重建验收 ${label}`, description: "private-challenge-description-sentinel", status: "ACTIVE", timezone: "UTC",
    startDate: "2026-09-01", endDate: "2026-10-01", targetEffectiveMinutesPerDay: 60,
    publishedFields: ["score", "active_days"], participants: { create: users.map(user => ({ userId: user.id,
      status: "ACTIVE", nickname: user.id === owner.id ? "合成 Owner" : "合成 Member", authorizedFields: ["score", "active_days"] })) } } });
  const sessions = await Promise.all(users.map(user => client.studySession.create({ data: {
    userId: user.id, workspaceId: workspace.id, subjectId: subject.id, status: "COMPLETED", startedAt: new Date("2026-09-14T08:00:00Z"),
    endedAt: new Date("2026-09-14T09:00:00Z"), effectiveMinutes: user.id === owner.id ? 50 : 40, isEffective: true,
    note: "private-session-body-sentinel", minimalOutput: "private-output-sentinel" } })));
  assert.equal(fixture.databaseName.startsWith("areaforge_v20_ranking_"), true);
  return { prefix, owner, member, stranger, workspace, subject, challenge, sessions };
}
export type RankingCase = Awaited<ReturnType<typeof createRankingCase>>;

export function requestRankingCase(client: PrismaClient, data: RankingCase, key = randomUUID()) {
  return enqueueRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
    challengeId: data.challenge.id, expectedRevision: data.challenge.revision, idempotencyKey: key });
}

export async function consumeRankingCase(client: PrismaClient, data: RankingCase, env: NodeJS.ProcessEnv = process.env) {
  const results: string[] = [];
  await runDataJobWorker({ enabled: true, client, workerId: `ranking-${randomUUID()}`, handlers: [createRankingRebuildHandler(client, env)],
    signal: new AbortController().signal, once: true, partition: { workspaceId: data.workspace.id }, onResult: result => results.push(result) });
  return results;
}

export async function rankingSideEffects(client: PrismaClient, data: RankingCase) {
  return { sessions: await client.studySession.findMany({ where: { workspaceId: data.workspace.id }, orderBy: { id: "asc" } }),
    effects: await client.auditEvent.count({ where: { entityId: data.challenge.id, action: "RANKING_PROJECTION_REBUILT" } }),
    projections: await client.rankingProjection.count({ where: { challengeId: data.challenge.id } }) };
}

export function rankingFixtureClient(databaseUrl: string) { return createPrismaClient(databaseUrl, { max: 10, connectionTimeoutMillis: 3_000 }); }
