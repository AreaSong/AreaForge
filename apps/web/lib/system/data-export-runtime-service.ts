import type { FileHandle } from "node:fs/promises";
import { DataExportError } from "@areaforge/core";
import { assertDataExportAuthorization, consumeDataExportDownload, controlQueuedDataJobInTransaction, dataExportEnabled, enqueueDataExportJob, exportDatabaseError, issueDataExportDownloadGrant, prisma, releaseDataExportDownload, requireDataExportEnabled, requirePublishedDataExport, reserveDataExportDownload, revokeDataExportDownloads, DataJobQueueError, type DataJobQueueControl, type ReservedExportDownload } from "@areaforge/db";
import { createAttachmentResponseHeaders, dataExportStorageRoots, exportArchiveStream, openVerifiedExportArchive, DataExportStorageError } from "@areaforge/storage";
import { ApiError } from "@/lib/api/responses";
import { dataJobQuotaErrorStatus } from "@/lib/api/data-job-quota-errors";
import { requireFreshAccountSession } from "@/lib/auth/account-service";
import type { CurrentUser } from "@/lib/auth/session";

type Job = Awaited<ReturnType<typeof prisma.dataJob.findUniqueOrThrow>>;
export interface DataExportAvailability {
  exportState: "PREVIEW_ONLY" | "NOT_READY" | "READY" | "EXPIRED" | "UNAVAILABLE" | "DISABLED";
  downloadable: boolean;
  exportSummary: { fileName: string; sizeBytes: string; recordCount: number; attachmentCount: number } | null;
}

export async function createDurableDataExport(actor: CurrentUser, input: { scope: "ACCOUNT" | "WORKSPACE"; workspaceId?: string; idempotencyKey: string }): Promise<Job> {
  try {
    requireDataExportEnabled();
    await configuredRoots();
    return await prisma.$transaction(async tx => {
      await requireFreshAccountSession(tx, actor);
      return enqueueDataExportJob(tx, { requesterId: actor.id, scope: input.scope, workspaceId: input.workspaceId ?? null, idempotencyKey: input.idempotencyKey });
    }, process.env.DATA_JOB_QUOTA_ENABLED === "true" ? { isolationLevel: "Serializable" } : undefined);
  } catch (error) { throwDataExportApiError(error); }
}

export async function controlDurableDataExport(actor: CurrentUser, jobId: string, expectedRevision: number, action: DataJobQueueControl): Promise<Job> {
  try {
    return await prisma.$transaction(async tx => {
      // 与 worker 同样先锁本人任务，再锁账户/会话，避免重新验证与提交形成反向等待。
      const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "DataJob" WHERE id = ${jobId} AND "requestedByUserId" = ${actor.id} AND kind = 'EXPORT' AND "queueVersion" = 1 FOR UPDATE NOWAIT`;
      if (!found.length) throw new ApiError("DATA_JOB_NOT_FOUND", 404);
      await requireFreshAccountSession(tx, actor);
      if (action === "RESUME" || action === "REPLAY") {
        requireDataExportEnabled();
        await assertDataExportAuthorization(tx, await tx.dataJob.findUniqueOrThrow({ where: { id: jobId } }), true);
      }
      const job = await controlQueuedDataJobInTransaction(tx, { jobId, actorId: actor.id, expectedRevision, action });
      if (action === "CANCEL") await revokeDataExportDownloads(tx, jobId, actor.id);
      return job;
    });
  } catch (error) { throwDataExportApiError(error); }
}

export async function dataExportAvailability(actor: CurrentUser, job: Job): Promise<DataExportAvailability> {
  const empty = { downloadable: false, exportSummary: null } as const;
  if (job.queueVersion !== 1 || job.kind !== "EXPORT") return { ...empty, exportState: "PREVIEW_ONLY" };
  if (job.expiresAt.getTime() <= Date.now()) return { ...empty, exportState: "EXPIRED" };
  if (!dataExportEnabled()) return { ...empty, exportState: "DISABLED" };
  if (job.status !== "SUCCEEDED") return { ...empty, exportState: "NOT_READY" };
  try {
    const { pkg } = await prisma.$transaction(tx => requirePublishedDataExport(tx, job.id, actor.id, false));
    return { exportState: "READY", downloadable: true, exportSummary: { fileName: pkg.fileName, sizeBytes: pkg.sizeBytes.toString(), recordCount: pkg.recordCount, attachmentCount: pkg.attachmentCount } };
  } catch { return { ...empty, exportState: "UNAVAILABLE" }; }
}

export async function issueDurableExportGrant(actor: CurrentUser, jobId: string) {
  try {
    return await prisma.$transaction(async tx => { await requireFreshAccountSession(tx, actor); return issueDataExportDownloadGrant(tx, jobId, actor.id); });
  } catch (error) { throwDataExportApiError(error); }
}

export async function revokeDurableExportGrants(actor: CurrentUser, jobId: string) {
  try {
    return await prisma.$transaction(async tx => { await requireFreshAccountSession(tx, actor); return { revokedCount: await revokeDataExportDownloads(tx, jobId, actor.id) }; });
  } catch (error) { throwDataExportApiError(error); }
}

export async function downloadDurableDataExport(actor: CurrentUser, token: string, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; headers: Record<string, string> }> {
  let reserved: ReservedExportDownload | undefined; let handle: FileHandle | undefined;
  const identity = { requesterId: actor.id, sessionId: actor.sessionId };
  try {
    reserved = await reserveDataExportDownload(prisma, identity, token);
    handle = await openVerifiedExportArchive(await configuredRoots(), { key: reserved.key, sizeBytes: reserved.sizeBytes, sha256: reserved.sha256 }, signal);
    signal?.throwIfAborted();
    await consumeDataExportDownload(prisma, identity, reserved);
    requireDataExportEnabled();
    return { body: exportArchiveStream(handle, signal), headers: createAttachmentResponseHeaders({ originalName: reserved.fileName, mimeType: "application/zip", sizeBytes: reserved.sizeBytes, disposition: "attachment" }) };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (reserved) await releaseDataExportDownload(prisma, identity, reserved).catch(() => undefined);
    throwDataExportApiError(error);
  }
}

async function configuredRoots() {
  if (!process.env.EXPORT_DIR || !process.env.UPLOAD_DIR) throw new DataExportError("DATA_EXPORT_STORAGE_CONFIG_REQUIRED");
  return dataExportStorageRoots(process.env.EXPORT_DIR, process.env.UPLOAD_DIR);
}
export function throwDataExportApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof DataExportError || error instanceof DataExportStorageError) {
    const status = ["DATA_EXPORT_DISABLED", "DATA_EXPORT_DOWNLOAD_NOT_FOUND", "DATA_EXPORT_AUTHORIZATION_CHANGED"].includes(error.code) ? 404
      : error.code.includes("UNAVAILABLE") || error.code.includes("CONFIG_REQUIRED") ? 503 : 409;
    throw new ApiError(error.code, status);
  }
  if (error instanceof DataJobQueueError) throw new ApiError(error.code, dataJobQuotaErrorStatus(error.code) ?? (error.code === "DATA_JOB_QUEUE_NOT_FOUND" ? 404 : 409));
  try { exportDatabaseError(error); }
  catch (mapped) { if (mapped instanceof DataExportError) throw new ApiError(mapped.code, mapped.code === "DATA_EXPORT_SCOPE_BUSY" ? 409 : 503); }
  throw new ApiError("DATA_EXPORT_UNAVAILABLE", 503);
}
