import { RankingRebuildError, RANKING_REBUILD_PROTOCOL, parseRankingRebuildJob, rankingRebuildJobFingerprint,
  rankingRebuildQueueEnabled, rankingIdentifier, rankingRevision, type RankingRebuildJobView, type RankingRebuildJob } from "@areaforge/core";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { DataJobQueueError, type DataQueueClient, type QueuedDataJob } from "./data-job-queue-types";
import { enqueueDataJobInTransaction } from "./data-job-queue";
import { controlQueuedDataJobInTransaction, type DataJobQueueControl } from "./data-job-queue-control";
import { queueClock } from "./data-job-queue-store";
import { guardDerivedQueueTransaction } from "./data-job-derived-guard";
import { captureRankingSnapshot, rankingDatabaseError, type RankingRebuildSnapshot } from "./ranking-rebuild-snapshot";
import { assertRankingRebuildSnapshot, publishRankingRebuild, readRankingProjection } from "./ranking-rebuild-projection";
import { latestRankingGeneration, assertLatestRankingGeneration } from "./ranking-rebuild-generation";

export type RankingRebuildClient = DataQueueClient;
export interface RankingRebuildRequest { actorId: string; sessionId: string; challengeId: string; expectedRevision: number; idempotencyKey: string }

export function requireRankingRebuildEnabled(env: Readonly<Record<string, string | undefined>>) {
  if (!rankingRebuildQueueEnabled(env)) throw new RankingRebuildError("RANKING_REBUILD_DISABLED");
}

export async function enqueueRankingRebuild(client: RankingRebuildClient, input: RankingRebuildRequest,
  env: Readonly<Record<string, string | undefined>> = process.env): Promise<RankingRebuildJobView> {
  requireRankingRebuildEnabled(env);
  rankingIdentifier(input.actorId); rankingIdentifier(input.challengeId); rankingIdentifier(input.idempotencyKey); rankingRevision(input.expectedRevision);
  try {
    return await client.$transaction(async tx => {
      await guardDerivedQueueTransaction(tx, ["RANKING_REBUILD"]);
      await requireRankingSession(tx, input.actorId, input.sessionId);
      await requireRankingJobOwner(tx, input.actorId, input.challengeId);
      const existing = await tx.dataJob.findUnique({ where: { requestedByUserId_idempotencyKey: { requestedByUserId: input.actorId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return replayExisting(existing, input);
      const dataCutoff = await queueClock(tx);
      const snapshot = await captureRankingSnapshot(tx, input.actorId, input.challengeId);
      if (snapshot.challenge.revision !== input.expectedRevision) throw new RankingRebuildError("RANKING_REBUILD_REVISION_CONFLICT");
      const generation = rankingRevision((await latestRankingGeneration(tx, input.challengeId)) + 1);
      const payload = makePayload(snapshot, input.actorId, dataCutoff, generation);
      const row = await enqueueDataJobInTransaction(tx, { kind: "RANKING_REBUILD", scope: "WORKSPACE", requestedByUserId: input.actorId,
        workspaceId: snapshot.challenge.workspaceId, idempotencyKey: input.idempotencyKey, requestFingerprint: rankingRebuildJobFingerprint(payload),
        expiresAt: new Date(dataCutoff.getTime() + 3_600_000), payloadJson: payload as unknown as Prisma.InputJsonValue });
      return rankingRebuildJobView(row);
    }, { isolationLevel: "Serializable", timeout: 15_000 });
  } catch (error) { return rankingDatabaseError(error); }
}

export async function listRankingRebuildJobs(client: RankingRebuildClient, actorId: string, challengeId: string): Promise<RankingRebuildJobView[]> {
  try {
    return await client.$transaction(async tx => {
      await guardDerivedQueueTransaction(tx, ["RANKING_REBUILD"]);
      await requireRankingJobOwner(tx, actorId, challengeId);
      const rows = await tx.dataJob.findMany({ where: { queueVersion: 1, kind: "RANKING_REBUILD", requestedByUserId: actorId,
        resultJson: { path: ["challengeId"], equals: challengeId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 });
      return rows.map(row => rankingRebuildJobView(row));
    }, { isolationLevel: "Serializable", timeout: 15_000 });
  } catch (error) { return rankingDatabaseError(error); }
}

export async function controlRankingRebuild(client: RankingRebuildClient, input: { actorId: string; sessionId: string; challengeId: string; jobId: string;
  expectedRevision: number; action: DataJobQueueControl }, env: Readonly<Record<string, string | undefined>> = process.env): Promise<RankingRebuildJobView> {
  // 关闭消费后仍允许本人取消；恢复/重放必须重新通过域开关和原绑定。
  if (input.action !== "CANCEL") requireRankingRebuildEnabled(env);
  try {
    return await client.$transaction(async tx => {
      await guardDerivedQueueTransaction(tx, ["RANKING_REBUILD"]);
      await requireRankingSession(tx, input.actorId, input.sessionId);
      await requireRankingJobOwner(tx, input.actorId, input.challengeId);
      const row = await tx.dataJob.findUnique({ where: { id: rankingIdentifier(input.jobId) } });
      if (!row || row.requestedByUserId !== input.actorId) throw new RankingRebuildError("RANKING_REBUILD_NOT_FOUND");
      const payload = validatedRankingJob(row);
      if (payload.challengeId !== input.challengeId) throw new RankingRebuildError("RANKING_REBUILD_NOT_FOUND");
      if (input.action === "RESUME" || input.action === "REPLAY") {
        assertRankingRebuildSnapshot(payload, await captureRankingSnapshot(tx, input.actorId, input.challengeId));
        await assertLatestRankingGeneration(tx, payload.challengeId, payload.generation);
      }
      const updated = await controlQueuedDataJobInTransaction(tx, input);
      return rankingRebuildJobView(updated);
    }, { isolationLevel: "Serializable", timeout: 15_000 });
  } catch (error) { return rankingDatabaseError(error); }
}

export async function prepareRankingRebuild(client: RankingRebuildClient, lease: { jobId: string; kind: string; requestedByUserId: string;
  workspaceId: string | null; payloadJson: unknown }, env: Readonly<Record<string, string | undefined>>) {
  requireRankingRebuildEnabled(env);
  const payload = parseRankingRebuildJob(lease.payloadJson);
  if (lease.kind !== "RANKING_REBUILD" || payload.actorUserId !== lease.requestedByUserId || payload.workspaceId !== lease.workspaceId) {
    throw new RankingRebuildError("RANKING_REBUILD_SCOPE_MISMATCH");
  }
  try {
    return await client.$transaction(async tx => {
      const snapshot = await captureRankingSnapshot(tx, payload.actorUserId, payload.challengeId);
      assertRankingRebuildSnapshot(payload, snapshot);
      await assertLatestRankingGeneration(tx, payload.challengeId, payload.generation);
      return snapshot;
    }, { isolationLevel: "Serializable", timeout: 15_000 });
  } catch (error) { return rankingDatabaseError(error); }
}

export async function commitRankingRebuild(tx: Prisma.TransactionClient, row: Readonly<QueuedDataJob>, prepared: RankingRebuildSnapshot,
  env: Readonly<Record<string, string | undefined>>) {
  requireRankingRebuildEnabled(env);
  const payload = validatedRankingJob(row);
  try { await publishRankingRebuild(tx, payload, prepared, row.id); }
  catch (error) { rankingDatabaseError(error); }
}

export async function getSafeRankingProjection(client: Pick<PrismaClient, "$transaction">, actorId: string, challengeId: string) {
  try { return await client.$transaction(tx => readRankingProjection(tx, actorId, challengeId), { isolationLevel: "Serializable", timeout: 15_000 }); }
  catch (error) { return rankingDatabaseError(error); }
}

export function validatedRankingJob(row: Readonly<QueuedDataJob>): RankingRebuildJob {
  const payload = parseRankingRebuildJob(row.resultJson);
  if (row.kind !== "RANKING_REBUILD" || row.queueVersion !== 1 || row.scope !== "WORKSPACE"
    || row.requestedByUserId !== payload.actorUserId || row.workspaceId !== payload.workspaceId
    || row.requestFingerprint !== rankingRebuildJobFingerprint(payload)
    || Date.parse(payload.dataCutoff) > row.createdAt.getTime() + 15_000 || Date.parse(payload.dataCutoff) > row.expiresAt.getTime()) {
    throw new RankingRebuildError("RANKING_REBUILD_SCOPE_MISMATCH");
  }
  return payload;
}

export function rankingRebuildJobView(row: QueuedDataJob): RankingRebuildJobView {
  const payload = validatedRankingJob(row);
  const controls: RankingRebuildJobView["controls"] = [];
  if (row.expiresAt.getTime() > Date.now()) {
    if (["QUEUED", "RUNNING", "FAILED", "PAUSED", "CANCEL_REQUESTED"].includes(row.status)) controls.push("CANCEL");
    if (["QUEUED", "RUNNING", "FAILED"].includes(row.status) && !row.deadLetteredAt) controls.push("PAUSE");
    if (row.status === "PAUSED" && row.attempt < row.maxAttempts) controls.push("RESUME");
    if (row.status === "FAILED") controls.push("REPLAY");
  }
  return { id: row.id, status: row.status, revision: row.updatedAt.getTime(), progress: row.progress, attempt: row.attempt,
    maxAttempts: row.maxAttempts, errorCode: row.errorCode, retryable: row.retryable, pauseRequested: row.pauseRequested,
    deadLettered: !!row.deadLetteredAt, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), dataCutoff: payload.dataCutoff, controls };
}

async function requireRankingJobOwner(tx: Prisma.TransactionClient, actorId: string, challengeId: string) {
  rankingIdentifier(actorId); rankingIdentifier(challengeId);
  const row = await tx.privateChallenge.findFirst({ where: { id: challengeId, ownerUserId: actorId,
    owner: { status: "ACTIVE" }, workspace: { status: "ACTIVE", memberships: { some: { userId: actorId, status: "ACTIVE" } } } },
  select: { id: true, workspaceId: true } });
  if (!row) throw new RankingRebuildError("RANKING_REBUILD_NOT_FOUND");
  const frozen = await tx.dataDeletionFence.count({ where: { OR: [
    { model: "User", keyJson: { path: ["id"], equals: actorId } }, { model: "PrivateChallenge", keyJson: { path: ["id"], equals: challengeId } },
    { model: "ExamWorkspace", keyJson: { path: ["id"], equals: row.workspaceId } },
  ] } });
  if (frozen) throw new RankingRebuildError("RANKING_REBUILD_NOT_FOUND");
}

function makePayload(snapshot: RankingRebuildSnapshot, actorUserId: string, cutoff: Date, generation: number): RankingRebuildJob {
  return parseRankingRebuildJob({ protocol: RANKING_REBUILD_PROTOCOL, actorUserId, workspaceId: snapshot.challenge.workspaceId,
    challengeId: snapshot.challenge.id, challengeRevision: snapshot.challenge.revision, generation, scoreVersion: snapshot.challenge.scoreVersion,
    rulesVersion: snapshot.challenge.rulesVersion, dataCutoff: cutoff.toISOString(), ruleFingerprint: snapshot.ruleFingerprint,
    sourceFingerprint: snapshot.sourceFingerprint, authorization: snapshot.authorization });
}

function replayExisting(row: QueuedDataJob, input: RankingRebuildRequest) {
  let payload: RankingRebuildJob;
  try { payload = validatedRankingJob(row); }
  catch { throw new DataJobQueueError("DATA_JOB_IDEMPOTENCY_CONFLICT"); }
  if (payload.challengeId !== input.challengeId || payload.challengeRevision !== input.expectedRevision) throw new DataJobQueueError("DATA_JOB_IDEMPOTENCY_CONFLICT");
  return rankingRebuildJobView(row);
}

async function requireRankingSession(tx: Prisma.TransactionClient, actorId: string, sessionId: string) {
  rankingIdentifier(actorId); rankingIdentifier(sessionId);
  const [user] = await tx.$queryRaw<Array<{ status: string; authRevision: number }>>`
    SELECT status,"authRevision" FROM "User" WHERE id=${actorId} FOR SHARE NOWAIT`;
  const [session] = await tx.$queryRaw<Array<{ userId: string; authRevision: number; revokedAt: Date | null; expiresAt: Date }>>`
    SELECT "userId","authRevision","revokedAt","expiresAt" FROM "AuthSession" WHERE id=${sessionId} FOR SHARE NOWAIT`;
  if (!user || user.status !== "ACTIVE" || !session || session.userId !== actorId || session.revokedAt
    || session.authRevision !== user.authRevision || session.expiresAt <= await queueClock(tx)) {
    throw new RankingRebuildError("RANKING_REBUILD_SESSION_REVOKED");
  }
}
