import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrismaClient, enqueueRankingRebuild, enqueueWorkspaceSearchIndex, type PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { createDurableDataExport, controlDurableDataExport } from "../../apps/web/lib/system/data-export-runtime-service";
import { controlWorkspaceSearchIndex, controlRankingRebuild, type DataJobQueueControl } from "../../packages/db/src/index";
import type { QuotaFixture } from "./quota-fixture";
import { seedAdmissionCase } from "./admission-runtime-fixture";

export type QuotaKind = "EXPORT" | "SEARCH_INDEX_REBUILD" | "RANKING_REBUILD";
export const quotaKinds: QuotaKind[] = ["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"];

export async function createQuotaCase(client: PrismaClient, fixture: QuotaFixture, label: string, passwordHash = "synthetic-not-login") {
  assert.match(fixture.databaseName, /^areaforge_v20_quota_[a-f0-9]{12}$/);
  return seedAdmissionCase(client, { namespace: "quota", databaseName: fixture.databaseName, label, passwordHash });
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
