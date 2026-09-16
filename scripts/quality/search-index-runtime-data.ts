import { randomBytes, randomUUID } from "node:crypto";
import { createPrismaClient, enqueueWorkspaceSearchIndex, type PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { searchWorkspace } from "../../apps/web/lib/system/workspace-search-service";
import { runDataJobWorker } from "../workers/data-job-runner";
import { createWorkspaceSearchHandler } from "../workers/workspace-search-handler";
import type { SearchIndexFixture } from "./search-index-fixture";

export async function createSearchCase(client: PrismaClient, fixture: SearchIndexFixture, label: string, passwordHash = "synthetic-not-login") {
  if (!fixture.databaseName.startsWith("areaforge_v20_search_")) throw new Error("SEARCH_FIXTURE_REQUIRED");
  const prefix = `search-${label}-${randomUUID().slice(0, 8)}`;
  async function actor(kind: string): Promise<CurrentUser> {
    const user = await client.user.create({ data: { email: `${prefix}-${kind}@example.test`, passwordHash, emailVerifiedAt: new Date() } });
    const session = await client.authSession.create({ data: { userId: user.id, authRevision: user.authRevision,
      tokenHash: randomBytes(32).toString("hex"), reauthenticatedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
    return { id: user.id, email: user.email, status: user.status, emailVerifiedAt: user.emailVerifiedAt,
      sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
  }
  const owner = await actor("owner"); const member = await actor("member"); const viewer = await actor("viewer"); const stranger = await actor("stranger");
  const workspace = await client.examWorkspace.create({ data: { userId: owner.id, stableKey: prefix, name: `检索合成空间 ${label}`,
    memberships: { create: [{ userId: owner.id, role: "OWNER" }, { userId: member.id, role: "MEMBER" }, { userId: viewer.id, role: "VIEWER" }] } } });
  const secondary = await client.examWorkspace.create({ data: { userId: owner.id, stableKey: `${prefix}-secondary`, name: "另一个检索空间",
    memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  for (const user of [owner, member, viewer]) await client.workspaceSelection.create({ data: { userId: user.id, workspaceId: workspace.id } });
  const subject = await client.subject.create({ data: { workspaceId: workspace.id, stableKey: prefix, name: "SEARCH 合成科目", color: "#0f766e" } });
  const secondarySubject = await client.subject.create({ data: { workspaceId: secondary.id, stableKey: prefix, name: "SECONDARY 另一空间", color: "#0f766e" } });
  const own = await createSearchSources(client, owner.id, workspace.id, subject.id, "本人");
  const foreign = await createSearchSources(client, member.id, workspace.id, subject.id, "他人");
  const grants = [];
  for (const [resourceType, resourceId] of [["NOTE", foreign.note.id], ["MISTAKE", foreign.mistake.id]] as const) {
    grants.push(await client.workspaceShareGrant.create({ data: { workspaceId: workspace.id, resourceType, resourceId,
      resourceOwnerUserId: member.id, grantedByUserId: member.id, scope: "WORKSPACE", access: "VIEW" } }));
  }
  return { prefix, owner, member, viewer, stranger, workspace, secondary, subject, secondarySubject, own, foreign, grants };
}

async function createSearchSources(client: PrismaClient, userId: string, workspaceId: string, subjectId: string, label: string) {
  const task = await client.studyTask.create({ data: { ownerUserId: userId, subjectId, title: `SEARCH ${label}任务`, type: "learn", plannedDate: new Date(), reviewText: "private-review-sentinel" } });
  const point = await client.knowledgePoint.create({ data: { userId, workspaceId, primarySubjectId: subjectId, stableKey: randomUUID(), title: `SEARCH ${label}知识点`, boundary: "private-boundary-sentinel" } });
  const note = await client.note.create({ data: { ownerUserId: userId, subjectId, title: `SEARCH ${label}笔记`, content: "private-note-body-sentinel" } });
  const mistake = await client.mistake.create({ data: { ownerUserId: userId, subjectId, title: `SEARCH ${label}错题`, questionText: "private-question-sentinel" } });
  const resource = await client.studyResource.create({ data: { ownerUserId: userId, workspaceId, subjectId, stableKey: randomUUID(),
    title: `SEARCH ${label}资料`, sourceType: "LINK", externalUrl: "https://example.test/private-resource-sentinel" } });
  return { task, point, note, mistake, resource };
}

export type SearchCase = Awaited<ReturnType<typeof createSearchCase>>;
export function searchFixtureClient(url: string) { return createPrismaClient(url, { max: 12, connectionTimeoutMillis: 3_000 }); }

export async function requestSearchCase(client: PrismaClient, data: SearchCase, actor = data.owner, options: { key?: string; generation?: number; workspaceId?: string } = {}) {
  const workspaceId = options.workspaceId ?? data.workspace.id;
  const partition = await client.workspaceSearchPartition.findUnique({ where: { userId_workspaceId: { userId: actor.id, workspaceId } } });
  return enqueueWorkspaceSearchIndex(client, { actorId: actor.id, sessionId: actor.sessionId, workspaceId,
    expectedGeneration: options.generation ?? partition?.generation ?? 0, idempotencyKey: options.key ?? randomUUID() });
}

export async function consumeSearchCase(client: PrismaClient, data: SearchCase, env: NodeJS.ProcessEnv = process.env) {
  const results: string[] = [];
  await runDataJobWorker({ enabled: true, client, workerId: `search-${randomUUID()}`, handlers: [createWorkspaceSearchHandler(client, env)],
    signal: new AbortController().signal, once: true, partition: { workspaceId: data.workspace.id }, onResult: result => results.push(result) });
  return results;
}

export function querySearchCase(data: SearchCase, actor = data.owner, query = "SEARCH", workspaceId = data.workspace.id) {
  return searchWorkspace(actor.id, workspaceId, query, 30, actor.sessionId);
}

export async function searchSourceState(client: PrismaClient, data: SearchCase) {
  return { subject: await client.subject.findMany({ where: { workspaceId: data.workspace.id }, orderBy: { id: "asc" } }),
    tasks: await client.studyTask.findMany({ where: { subjectId: data.subject.id }, orderBy: { id: "asc" } }),
    notes: await client.note.findMany({ where: { subjectId: data.subject.id }, orderBy: { id: "asc" } }),
    mistakes: await client.mistake.findMany({ where: { subjectId: data.subject.id }, orderBy: { id: "asc" } }),
    points: await client.knowledgePoint.findMany({ where: { workspaceId: data.workspace.id }, orderBy: { id: "asc" } }),
    resources: await client.studyResource.findMany({ where: { workspaceId: data.workspace.id }, orderBy: { id: "asc" } }) };
}

export async function searchSideEffects(client: PrismaClient, data: SearchCase) {
  return { documents: await client.workspaceSearchDocument.count({ where: { workspaceId: data.workspace.id } }),
    effects: await client.auditEvent.count({ where: { action: "SEARCH_INDEX_REBUILT", metadata: { path: ["workspaceId"], equals: data.workspace.id } } }) };
}
