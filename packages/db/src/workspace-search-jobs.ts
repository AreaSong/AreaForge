import { WORKSPACE_SEARCH_PROTOCOL, WorkspaceSearchError, parseWorkspaceSearchJob, searchGeneration, searchIdentifier,
  workspaceSearchJobFingerprint, workspaceSearchQueueEnabled, type WorkspaceSearchJob, type WorkspaceSearchJobView } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { DataJobQueueError, type DataQueueClient, type QueuedDataJob } from "./data-job-queue-types";
import { enqueueDataJobInTransaction } from "./data-job-queue";
import { controlQueuedDataJobInTransaction, type DataJobQueueControl } from "./data-job-queue-control";
import { queueClock } from "./data-job-queue-store";
import { captureSearchScope, assertSearchScopeTime, searchDatabaseError, searchVisibleSql, type SearchEnvironment } from "./workspace-search-scope";
import { captureSearchSources } from "./workspace-search-source";
import { assertSearchJobSnapshot, lockSearchPartitionScope, publishWorkspaceSearchIndex, readSearchPartition, searchSchemaAvailable } from "./workspace-search-index";

export interface SearchIndexRequest { actorId: string; sessionId: string; workspaceId: string; expectedGeneration: number; idempotencyKey: string }
export function requireSearchQueue(env: SearchEnvironment) {
  if (!workspaceSearchQueueEnabled(env)) throw new WorkspaceSearchError("SEARCH_INDEX_DISABLED");
}

export async function enqueueWorkspaceSearchIndex(client: DataQueueClient, input: SearchIndexRequest, env: SearchEnvironment = process.env) {
  requireSearchQueue(env); searchIdentifier(input.idempotencyKey); searchGeneration(input.expectedGeneration, true);
  try { return await client.$transaction(async tx => {
    const scope = await captureSearchScope(tx, input.actorId, input.workspaceId, { env, sessionId: input.sessionId });
    await lockSearchPartitionScope(tx, input.actorId, input.workspaceId);
    const existing = await tx.dataJob.findUnique({ where: { requestedByUserId_idempotencyKey: { requestedByUserId: input.actorId, idempotencyKey: input.idempotencyKey } } });
    if (existing) { await assertSearchScopeTime(tx, scope); return replaySearchRequest(existing, input); }
    const partition = await tx.workspaceSearchPartition.upsert({ where: { userId_workspaceId: { userId: input.actorId, workspaceId: input.workspaceId } },
      create: { userId: input.actorId, workspaceId: input.workspaceId }, update: {} });
    if (scope.visibility.hidden("WorkspaceSearchPartition").includes(partition.id)) throw new WorkspaceSearchError("SEARCH_INDEX_FROZEN");
    if (partition.generation !== input.expectedGeneration) throw new WorkspaceSearchError("SEARCH_INDEX_GENERATION_CONFLICT");
    const snapshot = await captureSearchSources(tx, scope); const requestedAt = await queueClock(tx);
    const generation = searchGeneration(partition.generation + 1);
    await tx.workspaceSearchPartition.update({ where: { id: partition.id }, data: { generation } });
    const payload = parseWorkspaceSearchJob({ protocol: WORKSPACE_SEARCH_PROTOCOL, actorUserId: input.actorId, workspaceId: input.workspaceId,
      partitionId: partition.id, generation, sourceFingerprint: snapshot.fingerprint, requestedAt: requestedAt.toISOString() });
    const row = await enqueueDataJobInTransaction(tx, { kind: "SEARCH_INDEX_REBUILD", scope: "WORKSPACE", requestedByUserId: input.actorId,
      workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestFingerprint: workspaceSearchJobFingerprint(payload),
      expiresAt: new Date(requestedAt.getTime() + 3_600_000), payloadJson: payload as unknown as Prisma.InputJsonValue });
    await assertSearchScopeTime(tx, scope);
    return workspaceSearchJobView(row);
  }, { isolationLevel: "Serializable", timeout: 15_000 }); } catch (error) { return searchDatabaseError(error); }
}

export async function getWorkspaceSearchIndexStatus(client: DataQueueClient, input: { actorId: string; workspaceId: string; sessionId?: string }, env: SearchEnvironment = process.env) {
  try { return await client.$transaction(async tx => {
    const scope = await captureSearchScope(tx, input.actorId, input.workspaceId, { env, sessionId: input.sessionId });
    if (!await searchSchemaAvailable(tx)) { await assertSearchScopeTime(tx, scope); return { enabled: false, generation: 0, index: null, jobs: [] as WorkspaceSearchJobView[] }; }
    const partition = await readSearchPartition(tx, scope);
    let current = false;
    if (partition?.publishedGeneration) {
      try {
        const snapshot = await captureSearchSources(tx, scope);
        current = snapshot.fingerprint === partition.sourceFingerprint && snapshot.rows.length === partition.documentCount
          && await tx.workspaceSearchDocument.count({ where: { partitionId: partition.id, generation: partition.publishedGeneration,
            id: { notIn: scope.visibility.hidden("WorkspaceSearchDocument") } } }) === snapshot.rows.length;
      }
      catch (error) { if (!(error instanceof WorkspaceSearchError) || error.code !== "SEARCH_INDEX_DOCUMENT_LIMIT") throw error; }
    }
    const rows = await tx.dataJob.findMany({ where: { kind: "SEARCH_INDEX_REBUILD", queueVersion: 1, workspaceId: input.workspaceId,
      requestedByUserId: input.actorId, id: { notIn: scope.visibility.hidden("DataJob") } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 });
    await assertSearchScopeTime(tx, scope);
    return { enabled: workspaceSearchQueueEnabled(env), generation: partition?.generation ?? 0,
      index: partition?.publishedGeneration ? { state: current ? "CURRENT" as const : "STALE" as const,
        indexedAt: current ? partition.indexedAt!.toISOString() : null, documentCount: current ? partition.documentCount : 0 } : null,
      jobs: rows.map(workspaceSearchJobView) };
  }, { isolationLevel: "Serializable", timeout: 15_000 }); } catch (error) { return searchDatabaseError(error); }
}

export async function controlWorkspaceSearchIndex(client: DataQueueClient, input: { actorId: string; sessionId: string; workspaceId: string;
  jobId: string; expectedRevision: number; action: DataJobQueueControl }, env: SearchEnvironment = process.env) {
  if (input.action !== "CANCEL") requireSearchQueue(env);
  try { return await client.$transaction(async tx => {
    const scope = await captureSearchScope(tx, input.actorId, input.workspaceId, { env, sessionId: input.sessionId, sourceOnly: input.action === "CANCEL" });
    await lockSearchPartitionScope(tx, input.actorId, input.workspaceId);
    const [visible] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "DataJob" WHERE id=${searchIdentifier(input.jobId)}
      AND ${searchVisibleSql(scope.visibility, "DataJob", Prisma.sql`"DataJob".id`)}`;
    const row = visible ? await tx.dataJob.findUnique({ where: { id: visible.id } }) : null;
    if (!row || row.requestedByUserId !== input.actorId || row.workspaceId !== input.workspaceId || row.kind !== "SEARCH_INDEX_REBUILD"
      || scope.visibility.hidden("DataJob").includes(row.id)) throw new WorkspaceSearchError("SEARCH_INDEX_NOT_FOUND");
    const payload = validatedWorkspaceSearchJob(row);
    if (input.action === "RESUME" || input.action === "REPLAY") await assertSearchJobSnapshot(tx, payload, await captureSearchSources(tx, scope));
    const updated = await controlQueuedDataJobInTransaction(tx, input); await assertSearchScopeTime(tx, scope);
    return workspaceSearchJobView(updated);
  }, { isolationLevel: "Serializable", timeout: 15_000 }); } catch (error) { return searchDatabaseError(error); }
}

export async function prepareWorkspaceSearchIndex(client: DataQueueClient, lease: { kind: string; requestedByUserId: string; workspaceId: string | null; payloadJson: unknown }, env: SearchEnvironment) {
  requireSearchQueue(env); const job = parseWorkspaceSearchJob(lease.payloadJson);
  if (lease.kind !== "SEARCH_INDEX_REBUILD" || lease.requestedByUserId !== job.actorUserId || lease.workspaceId !== job.workspaceId) throw new WorkspaceSearchError("SEARCH_INDEX_SCOPE_MISMATCH");
  try { return await client.$transaction(async tx => {
    const scope = await captureSearchScope(tx, job.actorUserId, job.workspaceId, { env });
    const snapshot = await captureSearchSources(tx, scope, true); await assertSearchJobSnapshot(tx, job, snapshot);
    return snapshot.fingerprint;
  }, { isolationLevel: "Serializable", timeout: 15_000 }); } catch (error) { return searchDatabaseError(error); }
}

export async function commitWorkspaceSearchIndex(tx: Prisma.TransactionClient, row: Readonly<QueuedDataJob>, preparedFingerprint: string, env: SearchEnvironment) {
  requireSearchQueue(env); const job = validatedWorkspaceSearchJob(row);
  await publishWorkspaceSearchIndex(tx, job, preparedFingerprint, { env, jobId: row.id });
}

export function validatedWorkspaceSearchJob(row: Readonly<QueuedDataJob>): WorkspaceSearchJob {
  const payload = parseWorkspaceSearchJob(row.resultJson);
  if (row.kind !== "SEARCH_INDEX_REBUILD" || row.scope !== "WORKSPACE" || row.queueVersion !== 1
    || row.requestedByUserId !== payload.actorUserId || row.workspaceId !== payload.workspaceId
    || row.requestFingerprint !== workspaceSearchJobFingerprint(payload) || Date.parse(payload.requestedAt) > row.createdAt.getTime() + 15000
    || Date.parse(payload.requestedAt) >= row.expiresAt.getTime()) throw new WorkspaceSearchError("SEARCH_INDEX_SCOPE_MISMATCH");
  return payload;
}

export function workspaceSearchJobView(row: QueuedDataJob): WorkspaceSearchJobView {
  const payload = validatedWorkspaceSearchJob(row); const controls: WorkspaceSearchJobView["controls"] = [];
  if (row.expiresAt.getTime() > Date.now()) {
    if (["QUEUED", "RUNNING", "FAILED", "PAUSED", "CANCEL_REQUESTED"].includes(row.status)) controls.push("CANCEL");
    if (["QUEUED", "RUNNING", "FAILED"].includes(row.status) && !row.deadLetteredAt) controls.push("PAUSE");
    if (row.status === "PAUSED" && row.attempt < row.maxAttempts) controls.push("RESUME");
    if (row.status === "FAILED") controls.push("REPLAY");
  }
  return { id: row.id, status: row.status, revision: row.updatedAt.getTime(), generation: payload.generation, progress: row.progress, attempt: row.attempt,
    maxAttempts: row.maxAttempts, retryable: row.retryable, pauseRequested: row.pauseRequested, deadLettered: !!row.deadLetteredAt, errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, controls };
}

function replaySearchRequest(row: QueuedDataJob, input: SearchIndexRequest) {
  try {
    const payload = validatedWorkspaceSearchJob(row);
    if (payload.workspaceId !== input.workspaceId || payload.generation !== input.expectedGeneration + 1) throw new Error();
    return workspaceSearchJobView(row);
  } catch { throw new DataJobQueueError("DATA_JOB_IDEMPOTENCY_CONFLICT"); }
}
