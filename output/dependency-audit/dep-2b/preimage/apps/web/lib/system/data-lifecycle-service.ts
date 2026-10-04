import { createHash } from "node:crypto";
import {
  createDataExportManifest,
  hashDataExportManifest,
  hashDataExportValue,
  transitionDataJob,
  type DataExportManifest,
  type DataExportRecordInput,
  type DataJobCommand,
  type DataJobState,
} from "@areaforge/core";
import { collectDataExportRecords, prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { requireFreshAccountSession } from "@/lib/auth/account-service";
import type { CurrentUser } from "@/lib/auth/session";
import { requireWorkspacePolicy } from "@/lib/workspace/policy-service";
import { previewRankingDeletion } from "@/lib/ranking/deletion-preview-service";
import { controlDurableDataExport, createDurableDataExport, dataExportAvailability, downloadDurableDataExport, issueDurableExportGrant, revokeDurableExportGrants, type DataExportAvailability } from "./data-export-runtime-service";

/**
 * v1.6 is intentionally a local candidate.  The flag is read directly here
 * so a future config change cannot accidentally turn the feature on in a
 * production runtime before its migration, worker and retention packets are
 * independently approved.
 */
const DATA_LIFECYCLE_FLAG = "DATA_LIFECYCLE_ENABLED";
const DELETE_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DELETE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TOKEN_PURPOSE = "areaforge:data-export-download:v1:";
const PREVIEW_VERSION = "data-lifecycle-preview-v1" as const;
/** Worker leases are deliberately short in the local candidate. */
export const DATA_JOB_MAX_LEASE_MS = 15 * 60 * 1000;

export type DataJobKind = "EXPORT" | "DELETE";
export type DataJobScope = "ACCOUNT" | "WORKSPACE";
export type DataJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "CANCEL_REQUESTED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface DataLifecycleRequest {
  kind: DataJobKind;
  scope: DataJobScope;
  workspaceId?: string;
  idempotencyKey: string;
}

export interface DataExportPreviewEntry {
  kind: string;
  id: string;
  sha256: string;
  omittedFieldCount: number;
}

export interface DataExportPreview {
  previewVersion: typeof PREVIEW_VERSION;
  scope: DataJobScope;
  generatedAt: string;
  manifestSha256: string;
  entries: readonly DataExportPreviewEntry[];
  recordCount: number;
  attachmentCount: number;
  omittedFieldCount: number;
  packageStatus: "NOT_CREATED";
  archiveStatus: "NOT_WRITTEN";
}

export interface DataDeletePreview {
  previewVersion: typeof PREVIEW_VERSION;
  scope: DataJobScope;
  workspaceIds: readonly string[];
  counts: Readonly<Record<string, number>>;
  totalObjects: number;
  scopeHash: string;
  generatedAt: string;
  cooldownUntil: string;
  physicalDeletionSupported: false;
  executionState: "PREVIEW_ONLY";
  blockers: readonly [
    "DELETE_EXECUTION_NOT_IMPLEMENTED",
    "BACKUP_DELETION_LEDGER_NOT_CONFIRMED",
    "ATTACHMENT_PHYSICAL_DELETE_NOT_AUTHORIZED",
  ];
  rankingBlockerCount: number;
  rankingParticipationCount: number;
  rankingProjectionCount: number;
}

export interface DataJobDto extends DataExportAvailability {
  id: string;
  kind: DataJobKind;
  scope: DataJobScope;
  status: DataJobStatus;
  progress: number;
  attempt: number;
  queueVersion: number;
  nextAttemptAt: string | null;
  deadLetteredAt: string | null;
  pauseRequested: boolean;
  /** Optimistic concurrency token derived from the durable updatedAt value. */
  revision: number;
  errorCode: string | null;
  retryable: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  preview: DataExportPreview | DataDeletePreview | null;
}

export interface DataDownloadGrantDto {
  id: string;
  jobId: string;
  token: string;
  expiresAt: string;
}

export interface DataJobWorkerLeaseDto {
  job: DataJobDto;
  workerId: string;
  leaseExpiresAt: string;
}

type DbClient = typeof prisma | Prisma.TransactionClient;
type JsonRecord = Record<string, unknown>;

export function isDataLifecycleEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[DATA_LIFECYCLE_FLAG] === "true";
}

export function requireDataLifecycleCandidate(): void {
  if (!isDataLifecycleEnabled()) throw new ApiError("DATA_LIFECYCLE_DISABLED", 404);
}

export function normalizeDataJobWorkerId(value: string): string {
  const workerId = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(workerId)) {
    throw new ApiError("DATA_JOB_WORKER_INVALID", 400);
  }
  return workerId;
}

function validateWorkerLease(now: Date, leaseExpiresAt: Date): void {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(leaseExpiresAt.getTime()) || leaseExpiresAt <= now) {
    throw new ApiError("DATA_JOB_LEASE_INVALID", 409);
  }
  if (leaseExpiresAt.getTime() - now.getTime() > DATA_JOB_MAX_LEASE_MS) {
    throw new ApiError("DATA_JOB_LEASE_TOO_LONG", 409);
  }
}

function validateWorkerRevision(expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError("DATA_JOB_REVISION_INVALID", 400);
  }
}

/** Hash only the random bearer token.  The raw token is never persisted. */
export function hashDataDownloadToken(token: string): string {
  return createHash("sha256").update(DOWNLOAD_TOKEN_PURPOSE).update(token).digest("hex");
}

export function createDataRequestFingerprint(input: Pick<DataLifecycleRequest, "kind" | "scope" | "workspaceId">): string {
  return hashDataExportValue({
    protocol: PREVIEW_VERSION,
    kind: input.kind,
    scope: input.scope,
    workspaceId: input.workspaceId ?? null,
  });
}

export function normalizeDataLifecycleRequest(input: DataLifecycleRequest): DataLifecycleRequest {
  if (input.kind !== "EXPORT" && input.kind !== "DELETE") throw new ApiError("DATA_JOB_KIND_INVALID", 400);
  if (input.scope !== "ACCOUNT" && input.scope !== "WORKSPACE") throw new ApiError("DATA_JOB_SCOPE_INVALID", 400);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(idempotencyKey)) {
    throw new ApiError("DATA_JOB_IDEMPOTENCY_KEY_INVALID", 400);
  }
  const workspaceId = input.workspaceId?.trim() || undefined;
  if (input.scope === "ACCOUNT" && workspaceId) throw new ApiError("DATA_WORKSPACE_NOT_ALLOWED", 400);
  if (input.scope === "WORKSPACE" && !workspaceId) throw new ApiError("DATA_WORKSPACE_REQUIRED", 400);
  return { kind: input.kind, scope: input.scope, workspaceId, idempotencyKey };
}

export function buildDataExportPreview(
  scope: DataJobScope,
  records: readonly DataExportRecordInput[],
  generatedAt = new Date().toISOString(),
): DataExportPreview {
  const manifest = createDataExportManifest({
    scope: scope === "ACCOUNT" ? "account" : "workspace",
    generatedAt,
    records,
  });
  return previewFromManifest(scope, manifest);
}

export function buildDataDeletePreview(
  scope: DataJobScope,
  workspaceIds: readonly string[],
  records: readonly DataExportRecordInput[],
  now = new Date(),
): DataDeletePreview {
  let counts: Record<string, number> = {};
  for (const record of records) counts[record.kind] = (counts[record.kind] ?? 0) + 1;
  if (scope === "ACCOUNT") {
    const accountCount = counts.account ?? 0;
    counts = Object.fromEntries(Object.entries(counts).filter(([kind]) => kind !== "account"));
    counts.User = (counts.User ?? 0) + Math.max(1, accountCount);
  }
  const totalObjects = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const generatedAt = now.toISOString();
  const scopeHash = hashDataExportValue({
    previewVersion: PREVIEW_VERSION,
    scope,
    workspaceIds: [...workspaceIds].sort(),
    counts,
    physicalDeletionSupported: false,
  });
  return {
    previewVersion: PREVIEW_VERSION,
    scope,
    workspaceIds: [...workspaceIds],
    counts,
    totalObjects,
    scopeHash,
    generatedAt,
    cooldownUntil: new Date(now.getTime() + DELETE_COOLDOWN_MS).toISOString(),
    physicalDeletionSupported: false,
    executionState: "PREVIEW_ONLY",
    blockers: [
      "DELETE_EXECUTION_NOT_IMPLEMENTED",
      "BACKUP_DELETION_LEDGER_NOT_CONFIRMED",
      "ATTACHMENT_PHYSICAL_DELETE_NOT_AUTHORIZED",
    ],
    rankingBlockerCount: 0,
    rankingParticipationCount: 0,
    rankingProjectionCount: 0,
  };
}

export async function previewDataLifecycle(
  actor: CurrentUser,
  input: Omit<DataLifecycleRequest, "idempotencyKey">,
): Promise<DataExportPreview | DataDeletePreview> {
  requireDataLifecycleCandidate();
  const request = normalizeDataLifecycleRequest({ ...input, idempotencyKey: "preview-only" });
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    const scope = await resolveScope(tx, actor, request.scope, request.workspaceId);
    const records = await collectExportRecords(tx, actor, scope.workspaceIds, request.scope, false);
    if (request.kind === "EXPORT") return buildDataExportPreview(request.scope, records);
    const ranking = await previewRankingDeletion({ userId: actor.id, workspaceId: request.workspaceId });
    return {
      ...buildDataDeletePreview(request.scope, scope.workspaceIds, records),
      rankingBlockerCount: ranking.blockers.length,
      rankingParticipationCount: ranking.participationCount,
      rankingProjectionCount: ranking.projectionCount,
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function requestDataLifecycleJob(actor: CurrentUser, raw: DataLifecycleRequest): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  const request = normalizeDataLifecycleRequest(raw);
  if (request.kind === "EXPORT") return serializeForActor(actor, await createDurableDataExport(actor, request));
  const requestFingerprint = createDataRequestFingerprint(request);
  const now = new Date();
  try {
    return await prisma.$transaction(async tx => {
      await requireFreshAccountSession(tx, actor);
      const existing = await tx.dataJob.findUnique({ where: { requestedByUserId_idempotencyKey: { requestedByUserId: actor.id, idempotencyKey: request.idempotencyKey } } });
      if (existing) {
        if (existing.queueVersion !== 0 || existing.requestFingerprint !== requestFingerprint) throw new ApiError("DATA_JOB_IDEMPOTENCY_CONFLICT", 409);
        return serializeDataJob(existing);
      }
      const scope = await resolveScope(tx, actor, request.scope, request.workspaceId);
      const records = await collectExportRecords(tx, actor, scope.workspaceIds, request.scope, false);
      const ranking = await previewRankingDeletion({ userId: actor.id, workspaceId: request.workspaceId });
      const preview = { ...buildDataDeletePreview(request.scope, scope.workspaceIds, records, now), rankingBlockerCount: ranking.blockers.length,
        rankingParticipationCount: ranking.participationCount, rankingProjectionCount: ranking.projectionCount };
      // DELETE 仍只保存影响预览，独立 EXPORT 确认不能打开删除执行器。
      const created = await tx.dataJob.create({ data: { kind: "DELETE", scope: request.scope, requestedByUserId: actor.id,
        workspaceId: request.workspaceId ?? null, status: "PAUSED", progress: 0, attempt: 0, idempotencyKey: request.idempotencyKey,
        requestFingerprint, resultJson: preview as unknown as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + DELETE_PREVIEW_TTL_MS) } });
      await writeDataAudit(tx, actor.id, "DATA_JOB_REQUESTED", created.id, { kind: "DELETE", scope: request.scope, previewVersion: PREVIEW_VERSION });
      return serializeDataJob(created);
    }, { isolationLevel: "RepeatableRead" });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.dataJob.findUnique({ where: { requestedByUserId_idempotencyKey: { requestedByUserId: actor.id, idempotencyKey: request.idempotencyKey } } });
      if (existing && existing.queueVersion === 0 && existing.requestFingerprint === requestFingerprint) return serializeDataJob(existing);
      if (existing) throw new ApiError("DATA_JOB_IDEMPOTENCY_CONFLICT", 409);
    }
    throw error;
  }
}

export async function listDataLifecycleJobs(actor: CurrentUser): Promise<DataJobDto[]> {
  requireDataLifecycleCandidate();
  const rows = await prisma.dataJob.findMany({
    where: { requestedByUserId: actor.id, OR: [{ queueVersion: 0, kind: { in: ["EXPORT", "DELETE"] } }, { queueVersion: 1, kind: "EXPORT" }] },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Promise.all(rows.map(row => serializeForActor(actor, row)));
}

export async function getDataLifecycleJob(actor: CurrentUser, jobId: string): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  const job = await prisma.dataJob.findFirst({ where: { id: normalizeJobId(jobId), requestedByUserId: actor.id,
    OR: [{ queueVersion: 0, kind: { in: ["EXPORT", "DELETE"] } }, { queueVersion: 1, kind: "EXPORT" }] } });
  if (!job) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
  return serializeForActor(actor, job);
}

export async function cancelDataLifecycleJob(actor: CurrentUser, jobId: string, expectedRevision: number): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  if (await isDurableExport(actor, jobId)) return serializeForActor(actor, await controlDurableDataExport(actor, normalizeJobId(jobId), expectedRevision, "CANCEL"));
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ApiError("DATA_JOB_REVISION_INVALID", 400);
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    const job = await tx.dataJob.findFirst({ where: { id: normalizeJobId(jobId), requestedByUserId: actor.id, queueVersion: 0 } });
    if (!job) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
    if (expectedRevision !== job.updatedAt.getTime()) throw new ApiError("DATA_JOB_CONFLICT", 409);
    if (job.kind === "DELETE" && job.status === "PAUSED") {
      const changed = await tx.dataJob.updateMany({
        where: { id: job.id, requestedByUserId: actor.id, status: "PAUSED", updatedAt: job.updatedAt },
        data: { status: "CANCELLED", errorCode: null, retryable: false },
      });
      if (changed.count !== 1) throw new ApiError("DATA_JOB_CONFLICT", 409);
      await revokeJobDownloadGrants(tx, job.id, new Date());
      await writeDataAudit(tx, actor.id, "DATA_JOB_CANCELLED", job.id, { kind: job.kind, expectedRevision });
      return serializeDataJob(await tx.dataJob.findUniqueOrThrow({ where: { id: job.id } }));
    }
    if (!["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED"].includes(job.status)) {
      throw new ApiError("DATA_JOB_NOT_CANCELLABLE", 409);
    }
    const nextStatus = job.status === "RUNNING" ? "CANCEL_REQUESTED" : "CANCELLED";
    const changed = await tx.dataJob.updateMany({
      where: { id: job.id, requestedByUserId: actor.id, status: job.status, updatedAt: job.updatedAt },
      data: { status: nextStatus },
    });
    if (changed.count !== 1) throw new ApiError("DATA_JOB_CONFLICT", 409);
    await revokeJobDownloadGrants(tx, job.id, new Date());
    await writeDataAudit(tx, actor.id, "DATA_JOB_CANCELLED", job.id, { kind: job.kind, expectedRevision });
    return serializeDataJob(await tx.dataJob.findUniqueOrThrow({ where: { id: job.id } }));
  });
}

export async function retryDataLifecycleJob(actor: CurrentUser, jobId: string, expectedRevision: number): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  if (await isDurableExport(actor, jobId)) return serializeForActor(actor, await controlDurableDataExport(actor, normalizeJobId(jobId), expectedRevision, "REPLAY"));
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ApiError("DATA_JOB_REVISION_INVALID", 400);
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    const job = await tx.dataJob.findFirst({ where: { id: normalizeJobId(jobId), requestedByUserId: actor.id, queueVersion: 0 } });
    if (!job) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
    if (job.kind !== "EXPORT" || job.status !== "FAILED" || !job.retryable) {
      throw new ApiError("DATA_JOB_RETRY_NOT_ALLOWED", 409);
    }
    if (expectedRevision !== job.updatedAt.getTime()) throw new ApiError("DATA_JOB_CONFLICT", 409);
    const changed = await tx.dataJob.updateMany({
      where: { id: job.id, requestedByUserId: actor.id, status: "FAILED", retryable: true, updatedAt: job.updatedAt },
      data: { status: "QUEUED", progress: 0, errorCode: null, retryable: false },
    });
    if (changed.count !== 1) throw new ApiError("DATA_JOB_CONFLICT", 409);
    await writeDataAudit(tx, actor.id, "DATA_JOB_RETRY_REQUESTED", job.id, { expectedRevision });
    return serializeDataJob(await tx.dataJob.findUniqueOrThrow({ where: { id: job.id } }));
  });
}

/**
 * Claim an EXPORT job for a durable worker.  DELETE jobs intentionally remain
 * PAUSED preview-only and can never enter the worker state machine.
 *
 * The row lock prevents two workers from selecting the same row while the
 * updatedAt predicate gives the write an explicit optimistic-CAS guard.
 */
export async function claimDataLifecycleJob(input: {
  jobId?: string;
  workerId: string;
  leaseExpiresAt: Date;
  now?: Date;
}): Promise<DataJobWorkerLeaseDto> {
  requireDataLifecycleCandidate();
  const workerId = normalizeDataJobWorkerId(input.workerId);
  const now = input.now ?? new Date();
  validateWorkerLease(now, input.leaseExpiresAt);
  return prisma.$transaction(async (tx) => {
    const row = input.jobId
      ? await lockDataJob(tx, normalizeJobId(input.jobId))
      : await lockNextDataJob(tx, now);
    if (!row) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
    if (row.queueVersion !== 0) throw new ApiError("DATA_JOB_WORKER_PROTOCOL_MISMATCH", 409);
    if (row.expiresAt <= now) throw new ApiError("DATA_JOB_EXPIRED", 409);
    if (row.kind !== "EXPORT") throw new ApiError("DATA_JOB_KIND_NOT_WORKER_ELIGIBLE", 409);

    // A stale RUNNING lease is first converted to EXPIRED under the same row
    // lock.  It is then eligible for a retry only when its state says so.
    let current = row;
    if (row.status === "RUNNING" && row.leaseExpiresAt && row.leaseExpiresAt <= now) {
      current = await persistDataJobState(tx, row, transitionOrThrow(rowToDataJobState(row), { type: "EXPIRE", now: now.toISOString() }));
      await writeDataAudit(tx, null, "DATA_JOB_EXPIRED", row.id, { reason: "LEASE_EXPIRED" });
    }
    const state = transitionOrThrow(
      rowToDataJobState(current),
      { type: "CLAIM", workerId, now: now.toISOString(), leaseExpiresAt: input.leaseExpiresAt.toISOString() },
    );
    const updated = await persistDataJobState(tx, current, state);
    await writeDataAudit(tx, null, "DATA_JOB_CLAIMED", updated.id, {
      workerId,
      attempt: updated.attempt,
      leaseExpiresAt: input.leaseExpiresAt.toISOString(),
    });
    return {
      job: serializeDataJob(updated),
      workerId,
      leaseExpiresAt: updated.leaseExpiresAt?.toISOString() ?? input.leaseExpiresAt.toISOString(),
    };
  }, { isolationLevel: "Serializable" });
}

export async function heartbeatDataLifecycleJob(input: {
  jobId: string;
  workerId: string;
  expectedRevision: number;
  leaseExpiresAt: Date;
  progress: number;
  now?: Date;
}): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  const workerId = normalizeDataJobWorkerId(input.workerId);
  validateWorkerRevision(input.expectedRevision);
  if (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 1) {
    throw new ApiError("DATA_JOB_PROGRESS_INVALID", 400);
  }
  const now = input.now ?? new Date();
  validateWorkerLease(now, input.leaseExpiresAt);
  return workerTransitionDataLifecycleJob(input.jobId, workerId, input.expectedRevision, {
    type: "HEARTBEAT",
    workerId,
    now: now.toISOString(),
    leaseExpiresAt: input.leaseExpiresAt.toISOString(),
    progress: input.progress,
  });
}

export async function completeDataLifecycleJob(input: {
  jobId: string;
  workerId: string;
  expectedRevision: number;
  outcome: "SUCCEEDED" | "FAILED" | "CANCELLED" | "PAUSED";
  errorCode?: string;
  retryable?: boolean;
  now?: Date;
}): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  const workerId = normalizeDataJobWorkerId(input.workerId);
  validateWorkerRevision(input.expectedRevision);
  if (input.errorCode && !/^[A-Z0-9_.:-]{1,80}$/.test(input.errorCode)) {
    throw new ApiError("DATA_JOB_ERROR_CODE_INVALID", 400);
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ApiError("DATA_JOB_TIME_INVALID", 400);
  const command: DataJobCommand = input.outcome === "SUCCEEDED"
    ? { type: "SUCCEED", workerId, now: now.toISOString() }
    : input.outcome === "FAILED"
      ? { type: "FAIL", workerId, errorCode: input.errorCode ?? "WORKER_FAILED", retryable: input.retryable === true, now: now.toISOString() }
      : input.outcome === "CANCELLED"
        ? { type: "CANCEL", workerId, now: now.toISOString() }
        : { type: "PAUSE", workerId, now: now.toISOString() };
  return workerTransitionDataLifecycleJob(input.jobId, workerId, input.expectedRevision, command);
}

export async function expireDataLifecycleJob(jobId: string, now = new Date()): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  if (!Number.isFinite(now.getTime())) throw new ApiError("DATA_JOB_TIME_INVALID", 400);
  return prisma.$transaction(async (tx) => {
    const row = await lockDataJob(tx, normalizeJobId(jobId));
    if (!row) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
    if (row.queueVersion !== 0) throw new ApiError("DATA_JOB_WORKER_PROTOCOL_MISMATCH", 409);
    const state = transitionOrThrow(rowToDataJobState(row), { type: "EXPIRE", now: now.toISOString() });
    const updated = await persistDataJobState(tx, row, state);
    await writeDataAudit(tx, null, "DATA_JOB_EXPIRED", row.id, { reason: "LEASE_EXPIRED" });
    return serializeDataJob(updated);
  }, { isolationLevel: "Serializable" });
}

export async function createExportDownloadGrant(actor: CurrentUser, jobId: string): Promise<DataDownloadGrantDto> {
  requireDataLifecycleCandidate();
  return issueDurableExportGrant(actor, normalizeJobId(jobId));
}

export async function revokeExportDownloadGrants(actor: CurrentUser, jobId: string): Promise<{ revokedCount: number }> {
  requireDataLifecycleCandidate();
  const job = await prisma.dataJob.findFirst({ where: { id: normalizeJobId(jobId), requestedByUserId: actor.id } });
  if (job?.queueVersion === 1 && job.kind === "EXPORT") return revokeDurableExportGrants(actor, jobId);
  return prisma.$transaction(async tx => {
    await requireFreshAccountSession(tx, actor);
    if (!job || job.queueVersion !== 0 || job.kind !== "EXPORT") throw new ApiError("DATA_JOB_NOT_FOUND", 404);
    return { revokedCount: await revokeJobDownloadGrants(tx, job.id, new Date()) };
  });
}

export async function redeemExportDownloadGrant(actor: CurrentUser, token: string, signal?: AbortSignal) {
  requireDataLifecycleCandidate();
  return downloadDurableDataExport(actor, token, signal);
}

export async function pauseDataLifecycleJob(actor: CurrentUser, jobId: string, revision: number): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  return serializeDataJob(await controlDurableDataExport(actor, normalizeJobId(jobId), revision, "PAUSE"));
}

export async function resumeDataLifecycleJob(actor: CurrentUser, jobId: string, revision: number): Promise<DataJobDto> {
  requireDataLifecycleCandidate();
  return serializeDataJob(await controlDurableDataExport(actor, normalizeJobId(jobId), revision, "RESUME"));
}

export function serializeDataJob(row: {
  id: string;
  kind: string;
  scope: string;
  status: string;
  progress: number;
  attempt: number;
  queueVersion?: number;
  nextAttemptAt?: Date | null;
  deadLetteredAt?: Date | null;
  pauseRequested?: boolean;
  revision?: number;
  errorCode: string | null;
  retryable: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  resultJson: unknown;
}): DataJobDto {
  return {
    id: row.id,
    kind: row.kind as DataJobKind,
    scope: row.scope as DataJobScope,
    status: row.status as DataJobStatus,
    progress: row.progress,
    attempt: row.attempt,
    queueVersion: row.queueVersion ?? 0,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deadLetteredAt: row.deadLetteredAt?.toISOString() ?? null,
    pauseRequested: row.pauseRequested ?? false,
    exportState: row.queueVersion === 1 ? "NOT_READY" : "PREVIEW_ONLY",
    downloadable: false,
    exportSummary: null,
    revision: row.revision ?? row.updatedAt.getTime(),
    errorCode: row.errorCode,
    retryable: row.retryable,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    preview: (row.queueVersion ?? 0) === 0 ? parseStoredPreview(row.resultJson) : null,
  };
}

async function serializeForActor(actor: CurrentUser, row: Awaited<ReturnType<typeof prisma.dataJob.findUniqueOrThrow>>): Promise<DataJobDto> {
  return { ...serializeDataJob(row), ...await dataExportAvailability(actor, row) };
}

async function isDurableExport(actor: CurrentUser, jobId: string): Promise<boolean> {
  return !!await prisma.dataJob.findFirst({ where: { id: normalizeJobId(jobId), requestedByUserId: actor.id, queueVersion: 1, kind: "EXPORT" }, select: { id: true } });
}

function previewFromManifest(scope: DataJobScope, manifest: DataExportManifest): DataExportPreview {
  const entries = manifest.entries.map(({ kind, id, sha256, omittedFieldCount }) => ({ kind, id, sha256, omittedFieldCount }));
  return {
    previewVersion: PREVIEW_VERSION,
    scope,
    generatedAt: manifest.generatedAt,
    manifestSha256: hashDataExportManifest(manifest),
    entries,
    recordCount: entries.length,
    attachmentCount: entries.filter((entry) => entry.kind.toLowerCase() === "attachment").length,
    omittedFieldCount: entries.reduce((sum, entry) => sum + entry.omittedFieldCount, 0),
    packageStatus: "NOT_CREATED",
    archiveStatus: "NOT_WRITTEN",
  };
}

async function resolveScope(
  tx: Prisma.TransactionClient,
  actor: CurrentUser,
  scope: DataJobScope,
  workspaceId?: string,
): Promise<{ workspaceIds: string[] }> {
  if (scope === "ACCOUNT") {
    const workspaces = await tx.examWorkspace.findMany({
      where: {
        OR: [
          { userId: actor.id },
          { memberships: { some: { userId: actor.id } } },
        ],
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return { workspaceIds: workspaces.map((workspace) => workspace.id) };
  }
  if (!workspaceId) throw new ApiError("DATA_WORKSPACE_REQUIRED", 400);
  const policy = await requireWorkspacePolicy(tx, actor.id, workspaceId, "workspace:read");
  if (policy.role !== "OWNER" || policy.ownerUserId !== actor.id) throw new ApiError("DATA_WORKSPACE_NOT_FOUND", 404);
  return { workspaceIds: [workspaceId] };
}


async function collectExportRecords(client: DbClient, actor: CurrentUser, workspaceIds: readonly string[], scope: DataJobScope, includeData: boolean): Promise<DataExportRecordInput[]> {
  return collectDataExportRecords(client, { actor, workspaceIds, scope, includeData });
}

function parseStoredPreview(value: unknown): DataExportPreview | DataDeletePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as JsonRecord;
  if (candidate.previewVersion !== PREVIEW_VERSION) return null;
  if (candidate.executionState === "PREVIEW_ONLY" && candidate.physicalDeletionSupported === false) {
    return candidate as unknown as DataDeletePreview;
  }
  if (candidate.packageStatus === "NOT_CREATED" && candidate.archiveStatus === "NOT_WRITTEN") {
    return candidate as unknown as DataExportPreview;
  }
  return null;
}

async function revokeJobDownloadGrants(tx: Prisma.TransactionClient, jobId: string, revokedAt: Date): Promise<number> {
  const result = await tx.dataExportDownloadGrant.updateMany({
    where: { exportPackage: { jobId }, consumedAt: null, revokedAt: null },
    data: { revokedAt },
  });
  return result.count;
}

async function writeDataAudit(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  action: string,
  entityId: string,
  metadata: JsonRecord = {},
): Promise<void> {
  await tx.auditEvent.create({
    data: { actorId, action, entityType: "DataJob", entityId, metadata: metadata as unknown as Prisma.InputJsonValue },
  });
}

type DataJobRow = Awaited<ReturnType<typeof prisma.dataJob.findUniqueOrThrow>>;

async function lockDataJob(tx: Prisma.TransactionClient, jobId: string): Promise<DataJobRow | null> {
  await tx.$queryRaw`SELECT "id" FROM "DataJob" WHERE "id" = ${jobId} FOR UPDATE`;
  return tx.dataJob.findUnique({ where: { id: jobId } });
}

async function lockNextDataJob(tx: Prisma.TransactionClient, now: Date): Promise<DataJobRow | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "DataJob"
    WHERE "kind" = 'EXPORT' AND "queueVersion" = 0
      AND "expiresAt" > ${now}
      AND (
        "status" = 'QUEUED'
        OR ("status" = 'FAILED' AND "retryable" = true)
        OR ("status" = 'EXPIRED' AND "retryable" = true)
        OR ("status" = 'RUNNING' AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" <= ${now})
      )
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;
  const id = rows[0]?.id;
  return id ? tx.dataJob.findUnique({ where: { id } }) : null;
}

function rowToDataJobState(row: DataJobRow): DataJobState {
  return {
    status: row.status as DataJobState["status"],
    attempt: row.attempt,
    progress: row.progress,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    lastErrorCode: row.errorCode,
    retryable: row.retryable,
  };
}

function transitionOrThrow(state: DataJobState, command: DataJobCommand): DataJobState {
  const result = transitionDataJob(state, command);
  if (!result.error) return result.state;
  const errorCodes: Record<string, string> = {
    INVALID_STATUS: "DATA_JOB_INVALID_STATUS",
    LEASE_REQUIRED: "DATA_JOB_LEASE_REQUIRED",
    LEASE_OWNER_MISMATCH: "DATA_JOB_LEASE_OWNER_MISMATCH",
    LEASE_EXPIRED: "DATA_JOB_LEASE_EXPIRED",
    INVALID_PROGRESS: "DATA_JOB_PROGRESS_INVALID",
    RETRY_NOT_ALLOWED: "DATA_JOB_RETRY_NOT_ALLOWED",
  };
  throw new ApiError(errorCodes[result.error] ?? "DATA_JOB_TRANSITION_REJECTED", 409);
}

async function persistDataJobState(
  tx: Prisma.TransactionClient,
  row: DataJobRow,
  state: DataJobState,
): Promise<DataJobRow> {
  const changed = await tx.dataJob.updateMany({
    // updatedAt is the public revision token.  Include the leased state in
    // the predicate as a second CAS fence for databases whose timestamp
    // precision rounds two very fast writes to the same millisecond.
    where: {
      id: row.id,
      updatedAt: row.updatedAt,
      status: row.status,
      attempt: row.attempt,
      progress: row.progress,
      leaseOwner: row.leaseOwner,
      leaseExpiresAt: row.leaseExpiresAt,
      errorCode: row.errorCode,
      retryable: row.retryable,
    },
    data: {
      status: state.status,
      attempt: state.attempt,
      progress: state.progress,
      leaseOwner: state.leaseOwner,
      leaseExpiresAt: state.leaseExpiresAt ? new Date(state.leaseExpiresAt) : null,
      errorCode: state.lastErrorCode,
      retryable: state.retryable,
    },
  });
  if (changed.count !== 1) throw new ApiError("DATA_JOB_REVISION_CONFLICT", 409);
  return tx.dataJob.findUniqueOrThrow({ where: { id: row.id } });
}

async function workerTransitionDataLifecycleJob(
  jobId: string,
  workerId: string,
  expectedRevision: number,
  command: DataJobCommand,
): Promise<DataJobDto> {
  return prisma.$transaction(async (tx) => {
    const row = await lockDataJob(tx, normalizeJobId(jobId));
    if (!row) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
    if (row.queueVersion !== 0) throw new ApiError("DATA_JOB_WORKER_PROTOCOL_MISMATCH", 409);
    if (row.kind !== "EXPORT") throw new ApiError("DATA_JOB_KIND_NOT_WORKER_ELIGIBLE", 409);
    if (row.updatedAt.getTime() !== expectedRevision) throw new ApiError("DATA_JOB_REVISION_CONFLICT", 409);
    if (row.leaseOwner !== workerId) throw new ApiError("DATA_JOB_LEASE_OWNER_MISMATCH", 409);
    const state = transitionOrThrow(rowToDataJobState(row), command);
    const updated = await persistDataJobState(tx, row, state);
    await writeDataAudit(tx, null, `DATA_JOB_${command.type}`, row.id, {
      workerId,
      revision: updated.updatedAt.getTime(),
      status: updated.status,
    });
    return serializeDataJob(updated);
  }, { isolationLevel: "Serializable" });
}

function normalizeJobId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
  return id;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}
