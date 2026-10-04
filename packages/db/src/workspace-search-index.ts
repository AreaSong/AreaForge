import { WORKSPACE_SEARCH_KINDS, WorkspaceSearchError, workspaceSearchIndexEnabled, type WorkspaceSearchJob } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { captureSearchScope, assertSearchScopeTime, type SearchEnvironment, type SearchScope } from "./workspace-search-scope";
import { captureSearchSources, searchResult, searchSourceRows, searchSources, searchSourceRevision, sortSearchResults, type SearchSnapshot, type SearchResult } from "./workspace-search-source";
import { queueClock } from "./data-job-queue-store";

export async function searchSchemaAvailable(tx: Prisma.TransactionClient): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('"WorkspaceSearchPartition"') IS NOT NULL
    AND to_regclass('"WorkspaceSearchDocument"') IS NOT NULL AS ready`;
  return row?.ready === true;
}

export async function lockSearchPartitionScope(tx: Prisma.TransactionClient, actorId: string, workspaceId: string): Promise<void> {
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT
    pg_try_advisory_xact_lock(hashtextextended(${`areaforge:search-index:v1:${actorId}:${workspaceId}`}, 0)) AS acquired`;
  if (!lock?.acquired) throw new WorkspaceSearchError("SEARCH_INDEX_SCOPE_BUSY", true);
}

export async function readSearchPartition(tx: Prisma.TransactionClient, scope: SearchScope) {
  await tx.$queryRaw`SELECT id FROM "WorkspaceSearchPartition" WHERE "userId"=${scope.actorId} AND "workspaceId"=${scope.workspaceId} FOR SHARE NOWAIT`;
  const row = await tx.workspaceSearchPartition.findUnique({ where: { userId_workspaceId: { userId: scope.actorId, workspaceId: scope.workspaceId } } });
  if (row && scope.visibility.hidden("WorkspaceSearchPartition").includes(row.id)) throw new WorkspaceSearchError("SEARCH_INDEX_FROZEN");
  return row;
}

export async function assertSearchJobSnapshot(tx: Prisma.TransactionClient, job: WorkspaceSearchJob, snapshot: SearchSnapshot) {
  const partition = await readSearchPartition(tx, snapshot.scope);
  if (!partition || partition.id !== job.partitionId || partition.generation !== job.generation) throw new WorkspaceSearchError("SEARCH_INDEX_SUPERSEDED");
  if (snapshot.scope.actorId !== job.actorUserId || snapshot.scope.workspaceId !== job.workspaceId || snapshot.fingerprint !== job.sourceFingerprint) {
    throw new WorkspaceSearchError("SEARCH_INDEX_SNAPSHOT_CHANGED");
  }
  await assertSearchScopeTime(tx, snapshot.scope);
  return partition;
}

/** 新代次仅来自提交事务重新读取的白名单源；冻结旧副本留给原删除计划。 */
export async function publishWorkspaceSearchIndex(tx: Prisma.TransactionClient, job: WorkspaceSearchJob, preparedFingerprint: string,
  options: { env: SearchEnvironment; jobId: string }) {
  await lockSearchPartitionScope(tx, job.actorUserId, job.workspaceId);
  const scope = await captureSearchScope(tx, job.actorUserId, job.workspaceId, options);
  const current = await captureSearchSources(tx, scope, true);
  await assertSearchJobSnapshot(tx, job, current);
  if (preparedFingerprint !== current.fingerprint) throw new WorkspaceSearchError("SEARCH_INDEX_SNAPSHOT_CHANGED");
  const frozen = scope.visibility.hidden("WorkspaceSearchDocument");
  if (await tx.workspaceSearchDocument.count({ where: { partitionId: job.partitionId } }) > 50000) throw new WorkspaceSearchError("SEARCH_INDEX_RETAINED_LIMIT");
  await tx.workspaceSearchDocument.deleteMany({ where: { partitionId: job.partitionId, id: { notIn: frozen } } });
  for (let offset = 0; offset < current.rows.length; offset += 250) {
    await tx.workspaceSearchDocument.createMany({ data: current.rows.slice(offset, offset + 250).map(row => ({
      partitionId: job.partitionId, workspaceId: job.workspaceId, generation: job.generation, kind: row.kind, sourceId: row.id,
      title: row.title!, sourceRevision: searchSourceRevision(row), sourceUpdatedAt: row.updatedAt, sortOrder: row.sortOrder,
      [searchSources[row.kind].field]: row.id,
    })) });
  }
  await assertSearchScopeTime(tx, scope);
  const indexedAt = await queueClock(tx);
  await tx.workspaceSearchPartition.update({ where: { id: job.partitionId }, data: {
    publishedGeneration: job.generation, sourceFingerprint: current.fingerprint, documentCount: current.rows.length, indexedAt,
  } });
  await tx.auditEvent.create({ data: { actorId: job.actorUserId, action: "SEARCH_INDEX_REBUILT", entityType: "DataJob", entityId: options.jobId,
    metadata: { workspaceId: job.workspaceId, partitionId: job.partitionId, generation: job.generation, documentCount: current.rows.length } } });
}

export interface SearchQueryResult {
  results: SearchResult[]; truncated: boolean; indexed: boolean;
  indexState: "DISABLED" | "MISSING" | "STALE" | "CURRENT"; indexedAt: string | null;
}

export async function queryWorkspaceSearch(tx: Prisma.TransactionClient, scope: SearchScope, query: string, limit: number, env: SearchEnvironment): Promise<SearchQueryResult> {
  let indexState: SearchQueryResult["indexState"] = "DISABLED";
  if (!scope.sourceOnly && workspaceSearchIndexEnabled(env) && await searchSchemaAvailable(tx)) {
    const partition = await readSearchPartition(tx, scope); indexState = partition?.publishedGeneration ? "STALE" : "MISSING";
    if (partition?.publishedGeneration) {
      let snapshot: SearchSnapshot | null = null;
      try { snapshot = await captureSearchSources(tx, scope); }
      catch (error) { if (!(error instanceof WorkspaceSearchError) || error.code !== "SEARCH_INDEX_DOCUMENT_LIMIT") throw error; }
      if (snapshot && snapshot.fingerprint === partition.sourceFingerprint && snapshot.rows.length === partition.documentCount) {
        const result = await queryPublishedSearch(tx, snapshot, partition, query, limit);
        if (result) return { ...result, indexed: true, indexState: "CURRENT", indexedAt: partition.indexedAt!.toISOString() };
      }
    }
  }
  const candidates: SearchResult[] = []; let truncated = false;
  for (const kind of WORKSPACE_SEARCH_KINDS) {
    const rows = await searchSourceRows(tx, scope, kind, { take: limit + 1, titles: true, query });
    truncated ||= rows.length > limit; candidates.push(...rows.map(row => searchResult(row, scope.actorId)));
  }
  await assertSearchScopeTime(tx, scope);
  return { results: sortSearchResults(candidates, query).slice(0, limit), truncated: truncated || candidates.length > limit, indexed: false, indexState, indexedAt: null };
}

async function queryPublishedSearch(tx: Prisma.TransactionClient, snapshot: SearchSnapshot,
  partition: { id: string; publishedGeneration: number | null }, query: string, limit: number) {
  const scope = snapshot.scope; const where = { partitionId: partition.id, generation: partition.publishedGeneration!, id: { notIn: scope.visibility.hidden("WorkspaceSearchDocument") } };
  if (await tx.workspaceSearchDocument.count({ where }) !== snapshot.rows.length) return null;
  const candidates: SearchResult[] = []; let truncated = false;
  for (const kind of WORKSPACE_SEARCH_KINDS) {
    const allowed = new Map(snapshot.rows.filter(row => row.kind === kind).map(row => [row.id, row]));
    if (!allowed.size) continue;
    const rows = await tx.workspaceSearchDocument.findMany({ where: { ...where, kind, sourceId: { in: [...allowed.keys()] }, title: { contains: query, mode: "insensitive" } },
      orderBy: kind === "SUBJECT" ? [{ sortOrder: "asc" }, { sourceId: "asc" }] : [{ sourceUpdatedAt: "desc" }, { sourceId: "asc" }], take: limit + 1,
      select: { sourceId: true, title: true, sourceRevision: true } });
    if (rows.some(row => row.sourceRevision !== searchSourceRevision(allowed.get(row.sourceId)!))) return null;
    truncated ||= rows.length > limit;
    candidates.push(...rows.map(row => searchResult({ ...allowed.get(row.sourceId)!, title: row.title }, scope.actorId)));
  }
  await assertSearchScopeTime(tx, scope);
  return { results: sortSearchResults(candidates, query).slice(0, limit), truncated: truncated || candidates.length > limit };
}
