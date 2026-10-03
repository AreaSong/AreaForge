import { isVerifiedStorageRelease, storageReleaseProof, WorkspaceStorageQuotaError, type StorageReleaseIdentity } from "@areaforge/core";
import { checkWorkspaceStorageQuotaAdmission, guardAttachmentStorageTransaction, isWorkspaceStorageQuotaBusy,
  lockAttachmentFileOperation, prisma, readStorageQuotaFileClaims, storageQuotaTransactionOptions, type Prisma } from "@areaforge/db";
import { assertStorageQuotaFilesAbsent, removeStorageQuotaAttachmentFiles, StorageQuotaFileError, verifyStorageQuotaInventory,
  type StorageCleanupHooks, type StorageCleanupMode } from "@areaforge/storage";
import { ApiError } from "@/lib/api/responses";
import { workspaceStorageQuotaErrorStatus } from "@/lib/api/workspace-storage-quota-errors";
import { getAuthEnv } from "@/lib/auth/env";

export interface PendingStorageAttachmentInput {
  noteId: string | null; workspaceId: string; actorId: string; stagingName: string;
  draft: { originalName: string; storedName: string; mimeType: string; sizeBytes: number; hash: string; uri: string };
  intentMetadata?: Prisma.InputJsonObject;
}
export interface DiscardedAttachmentCleanup extends StorageReleaseIdentity {
  attachmentId: string; stagingName: string | null; updatedAt: Date;
}
/** 仅隔离验收通过参数注入；生产调用不传钩子。 */
export interface AttachmentStorageCleanupHooks extends StorageCleanupHooks {
  beforeReleaseCommit?: () => Promise<void>;
  /** count=1 之后、事务回调结束之前；不代表网络层 COMMIT 已发送。 */
  afterReleaseCas?: (tx: Prisma.TransactionClient) => Promise<void>;
  afterVerifiedRelease?: (tx: Prisma.TransactionClient) => Promise<void>;
  afterReleaseCommit?: () => Promise<void>;
}

export async function attachmentStorageTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>, admission = false): Promise<T> {
  try {
    return await prisma.$transaction(async tx => {
      await guardAttachmentStorageTransaction(tx);
      return run(tx);
    }, { maxWait: 5_000, timeout: 15_000, ...(admission ? storageQuotaTransactionOptions() : {}) });
  } catch (error) { throwStorageQuotaApiError(error); }
}

export function withAttachmentFileOperation<T>(attachmentId: string, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return attachmentStorageTransaction(async tx => {
    await lockAttachmentFileOperation(tx, attachmentId);
    return run(tx);
  });
}

/** 调用方须先在同一事务中核对 actor、活动工作区和目标；这里只负责原子准入与意图。 */
export async function createStorageAttachmentIntent(tx: Prisma.TransactionClient, input: PendingStorageAttachmentInput) {
  await checkWorkspaceStorageQuotaAdmission(tx, { workspaceId: input.workspaceId, requestedBytes: input.draft.sizeBytes }, {
    verifyInventory: current => verifyStorageQuotaInventory(getAuthEnv().UPLOAD_DIR, names => readStorageQuotaFileClaims(current, names)),
  });
  const created = await tx.attachment.create({ data: { ...input.draft, ownerUserId: input.actorId, noteId: input.noteId,
    status: "PENDING", protocolVersion: 1, stagingName: input.stagingName, storageWorkspaceId: input.workspaceId },
    select: { id: true, updatedAt: true } });
  await tx.auditEvent.create({ data: { actorId: input.actorId, action: "ATTACHMENT_INTENT_CREATED", entityType: "Attachment", entityId: created.id,
    metadata: { ...input.intentMetadata, noteId: input.noteId, workspaceId: input.workspaceId,
      mimeType: input.draft.mimeType, sizeBytes: input.draft.sizeBytes, protocolVersion: 1 } } });
  return created;
}

export const storageCleanupSelect = { id: true, ownerUserId: true, storageWorkspaceId: true, storedName: true, uri: true,
  hash: true, sizeBytes: true, protocolVersion: true, stagingName: true, updatedAt: true, status: true,
  storageReleasedAt: true, storageReleaseProof: true, reconciliationClaimId: true,
  noteId: true, studyResource: { select: { id: true } } } satisfies Prisma.AttachmentSelect;
type CleanupRow = Prisma.AttachmentGetPayload<{ select: typeof storageCleanupSelect }>;
export function storageCleanupDescriptor(row: CleanupRow): DiscardedAttachmentCleanup {
  return { attachmentId: row.id, id: row.id, ownerUserId: row.ownerUserId, storageWorkspaceId: row.storageWorkspaceId,
    storedName: row.storedName, uri: row.uri, hash: row.hash, sizeBytes: row.sizeBytes,
    protocolVersion: row.protocolVersion, stagingName: row.stagingName, updatedAt: row.updatedAt };
}

export async function completeAttachmentStorageCleanup(cleanup: DiscardedAttachmentCleanup,
  hooks: AttachmentStorageCleanupHooks = {}, options: { boundNote?: boolean; mode?: StorageCleanupMode } = {}): Promise<boolean> {
  try {
    const result = await withAttachmentFileOperation(cleanup.attachmentId, tx => settleAttachmentStorageCleanup(tx, cleanup, hooks, options));
    await hooks.afterReleaseCommit?.();
    return result;
  } catch (error) {
    // 失败保留原占用和可重试意图，不记录文件路径、正文或凭据。
    console.error("Attachment storage cleanup deferred", { code: error instanceof ApiError ? error.code : "ATTACHMENT_CLEANUP_FAILED" });
    return false;
  }
}

export async function settleAttachmentStorageCleanup(tx: Prisma.TransactionClient, cleanup: DiscardedAttachmentCleanup,
  hooks: AttachmentStorageCleanupHooks = {}, options: { boundNote?: boolean; mode?: StorageCleanupMode } = {}): Promise<boolean> {
  await lockAttachmentFileOperation(tx, cleanup.attachmentId);
  await tx.$queryRaw`SELECT id FROM "Attachment" WHERE id=${cleanup.attachmentId} FOR UPDATE NOWAIT`;
  const row = await tx.attachment.findUnique({ where: { id: cleanup.attachmentId }, select: storageCleanupSelect });
  if (!row || (!options.boundNote && row.noteId) || row.studyResource || row.id !== cleanup.id
    || storageReleaseProof(row) !== storageReleaseProof(cleanup)) throw new ApiError("ATTACHMENT_CLEANUP_CHANGED", 409);
  const uploadDir = getAuthEnv().UPLOAD_DIR;
  if (isVerifiedStorageRelease(row)) {
    await assertStorageQuotaFilesAbsent(uploadDir, row);
    await hooks.afterVerifiedRelease?.(tx);
    return true;
  }
  if (row.status !== "FAILED" || row.reconciliationClaimId !== null || row.updatedAt.getTime() !== cleanup.updatedAt.getTime()
    || row.stagingName !== cleanup.stagingName) throw new ApiError("ATTACHMENT_CLEANUP_CHANGED", 409);
  const proof = await removeStorageQuotaAttachmentFiles(uploadDir, row, hooks, options.mode);
  if (proof.storedName !== row.storedName || proof.hash !== row.hash || proof.sizeBytes !== row.sizeBytes) throw new ApiError("ATTACHMENT_CLEANUP_CHANGED", 409);
  await hooks.beforeReleaseCommit?.();
  await assertStorageQuotaFilesAbsent(uploadDir, row);
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const changed = await tx.attachment.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, status: "FAILED", storageReleasedAt: null },
    data: { storageReleasedAt: clock!.now, storageReleaseProof: storageReleaseProof(row), stagingName: null } });
  if (changed.count !== 1) throw new ApiError("ATTACHMENT_CLEANUP_CHANGED", 409);
  await hooks.afterReleaseCas?.(tx);
  return true;
}

export function throwStorageQuotaApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof WorkspaceStorageQuotaError) throw new ApiError(error.code, workspaceStorageQuotaErrorStatus(error.code) ?? 503);
  if (error instanceof StorageQuotaFileError) throw new ApiError("WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN", 503);
  if (isWorkspaceStorageQuotaBusy(error)) throw new ApiError("WORKSPACE_STORAGE_QUOTA_BUSY", 503);
  throw error;
}
