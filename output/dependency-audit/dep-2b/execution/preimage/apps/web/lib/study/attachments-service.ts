import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  createAttachmentMetadataDraftFromScan,
  createSafeAttachmentFilePath,
  createSafeStagingFilePath,
  createStagingAttachmentName,
  createAttachmentResponseHeaders,
  createStudyResourceUploadPolicy,
  createUploadPolicy,
  isInlinePreviewAllowed,
  parseAllowedUploadMimeTypes,
  parseAttachmentUri,
  stagingDirectoryName,
  STUDY_RESOURCE_MAX_UPLOAD_MB,
  type BoundedFileScan,
  type AttachmentMetadataDraft,
} from "@areaforge/storage";
import { getAuthEnv } from "@/lib/auth/env";
import { lockAttachmentFileOperation, prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { isVerifiedStorageRelease, storageReleaseProof, type StorageReleaseIdentity } from "@areaforge/core";
import { assertStorageQuotaFilesAbsent } from "@areaforge/storage";
import { attachmentStorageTransaction, createStorageAttachmentIntent, withAttachmentFileOperation,
  completeAttachmentStorageCleanup, storageCleanupDescriptor, storageCleanupSelect,
  type DiscardedAttachmentCleanup, type AttachmentStorageCleanupHooks } from "./attachment-storage-service";
export type { DiscardedAttachmentCleanup } from "./attachment-storage-service";
import { requireWorkspaceOwner } from "@/lib/workspace/access-service";
import { requireSharedResourceAccess } from "@/lib/workspace/policy-service";
import type { AttachmentDto } from "@/lib/contracts";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  type PersistentCreateCommand,
} from "./persistent-idempotency";

/**
 * OPS-007 附件写入意图协议：
 * PENDING intent（无文件）→ .staging 独占写入 + fsync → 同文件系统原子 rename + 目录 fsync
 * → 重新打开校验 hash/size → READY CAS。按附件的排他文件栅栏串行化写入、确认和清理；
 * 新准入与意图同事务，清理后的缺失证明与额度释放同事务。
 * 失败路径保留 PENDING/FAILED 记录与稳定 failure code，不静默删除可能已被确认的 final 文件。
 */

export interface CreateNoteAttachmentInput {
  noteId: string;
  scan: BoundedFileScan;
  idempotencyKey: string;
}

export interface AttachmentDownload {
  bytes: Uint8Array;
  headers: Record<string, string>;
}

export const attachmentProtocolVersion = 1;
type AttachmentDbClient = typeof prisma | Prisma.TransactionClient;

interface AttachmentUploadInput {
  noteId: string | null; workspaceId: string; scan: BoundedFileScan; actorId: string;
  policyMimeTypes: readonly string[]; maxUploadMb: number; hooks?: AttachmentProtocolHooks;
  intentMetadata?: Prisma.InputJsonObject;
}
interface PreparedAttachmentUpload {
  draft: AttachmentMetadataDraft; stagingName: string;
  finalPath: ReturnType<typeof getSafeAttachmentPath>; stagingPath: ReturnType<typeof getSafeStagingPath>;
}
interface ExistingAttachmentIntent { id: string; updatedAt: Date }

/** 测试注入点：仅隔离 selftest 使用，生产路径永远传 undefined。 */
export interface AttachmentProtocolHooks {
  storageId?: () => string;
  beforeStagingWrite?: () => Promise<void>;
  afterStagingWrite?: () => Promise<void>;
  beforeAtomicRename?: () => Promise<void>;
  afterAtomicRename?: () => Promise<void>;
  beforeReadyCas?: () => Promise<void>;
  compensationUnlink?: (filePath: string) => Promise<void>;
}

const publicUploadRoots = [
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "apps/web/public"),
];

export async function createNoteAttachment(
  input: CreateNoteAttachmentInput,
  actorId: string,
  hooks?: AttachmentProtocolHooks,
): Promise<AttachmentDto> {
  const workspaceId = await assertNoteExists(input.noteId, actorId);
  const env = getAuthEnv();
  const policyMimeTypes = parseAllowedUploadMimeTypes(env.ALLOWED_UPLOAD_MIME);
  assertUploadScanValid(input.scan, createUploadPolicy(env.MAX_UPLOAD_MB, policyMimeTypes));
  const command: PersistentCreateCommand = {
    actorId,
    workspaceId,
    action: "NOTE_ATTACHMENT_UPLOAD_COMMAND",
    entityType: "Attachment",
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    requestFingerprint: buildPersistentCreateFingerprint("note-attachment-upload-v1", {
      noteId: input.noteId,
      file: uploadScanIdentity(input.scan),
    }),
    conflictCode: "NOTE_ATTACHMENT_UPLOAD_CONFLICT",
  };
  const upload: AttachmentUploadInput = { noteId: input.noteId, workspaceId, scan: input.scan, actorId,
    policyMimeTypes, maxUploadMb: env.MAX_UPLOAD_MB, hooks };
  const claim = await claimNoteAttachmentCommand(command, input.noteId, actorId, upload);
  if (claim.state === "pending") {
    throw new ApiError("NOTE_ATTACHMENT_UPLOAD_IN_PROGRESS", 409, {
      latest: { state: "pending" },
      conflictFields: ["idempotencyKey"],
      workbench: "/knowledge/cards",
    });
  }
  if (claim.state === "replayed") {
    return loadReplayedNoteAttachment(actorId, input.noteId, claim.replay.resultId);
  }

  const attachment = await createAttachmentWithOps007({ ...upload, prepared: claim.prepared, intent: claim.intent });
  try {
    await prisma.$transaction((tx) => completePersistentCreateClaim(
    tx,
    command,
    claim.claimEventId,
    attachment.id,
    {
      noteId: input.noteId,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    },
    attachmentSnapshot(attachment),
  ));
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "NOTE_ATTACHMENT_UPLOAD_CONFLICT_CLAIM_COMPLETED") throw error;
    const replay = await prisma.$transaction(tx => findPersistentCreateReplay(tx, command));
    if (replay?.resultId !== attachment.id) throw error;
  }
  return attachment;
}

export async function createWorkspaceAttachment(
  input: { scan: BoundedFileScan },
  actorId: string,
  hooks?: AttachmentProtocolHooks,
): Promise<AttachmentDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const policy = createStudyResourceUploadPolicy(STUDY_RESOURCE_MAX_UPLOAD_MB);
  return createAttachmentWithOps007({
    noteId: null,
    workspaceId: workspace.id,
    scan: input.scan,
    actorId,
    policyMimeTypes: policy.allowedMimeTypes,
    maxUploadMb: STUDY_RESOURCE_MAX_UPLOAD_MB,
    hooks,
  });
}

/**
 * Writes a workspace upload to the private staging area but deliberately
 * leaves the Attachment PENDING until the resource duplicate decision is
 * known. The returned metadata is safe to persist in a resumable client state.
 */
export async function stageWorkspaceAttachment(
  input: {
    scan: BoundedFileScan;
    workspaceId?: string;
    intentMetadata?: Prisma.InputJsonObject;
  },
  actorId: string,
  hooks?: AttachmentProtocolHooks,
): Promise<AttachmentDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  if (input.workspaceId && input.workspaceId !== workspace.id) {
    throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
      latest: { workspaceId: workspace.id },
      conflictFields: ["workspaceId"],
      workbench: "/settings/exams",
    });
  }
  const policy = createStudyResourceUploadPolicy(STUDY_RESOURCE_MAX_UPLOAD_MB);
  const staged = await stageAttachmentWithOps007({
    noteId: null,
    workspaceId: workspace.id,
    scan: input.scan,
    actorId,
    intentMetadata: input.intentMetadata,
    policyMimeTypes: policy.allowedMimeTypes,
    maxUploadMb: STUDY_RESOURCE_MAX_UPLOAD_MB,
    hooks,
  });
  return serializeAttachment(staged.attachment);
}

/** Finalize a previously staged workspace upload after an explicit decision. */
export async function finalizeWorkspaceAttachment(actorId: string, attachmentId: string, hooks?: AttachmentProtocolHooks): Promise<AttachmentDto> {
  const result = await withAttachmentFileOperation(attachmentId, tx => finalizeWorkspaceAttachmentLocked(actorId, attachmentId, hooks, tx));
  if (result instanceof ApiError) throw result;
  return result;
}

async function finalizeWorkspaceAttachmentLocked(actorId: string, attachmentId: string, hooks: AttachmentProtocolHooks | undefined,
  tx: Prisma.TransactionClient): Promise<AttachmentDto | ApiError> {
  const attachment = await tx.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      noteId: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      hash: true,
      uri: true,
      status: true,
      stagingName: true,
      updatedAt: true,
      createdAt: true,
      reconciliationClaimId: true,
      studyResource: { select: { id: true } },
    },
  });
  if (!attachment || attachment.noteId || attachment.studyResource) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  }
  await assertAttachmentIntentOwner(actorId, attachment.id, tx);
  if (attachment.status === "READY") return serializeAttachment(attachment);
  if (attachment.status !== "PENDING" || attachment.reconciliationClaimId) {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }

  const storedName = parseAttachmentUri(attachment.uri);
  if (!storedName) throw new ApiError("ATTACHMENT_URI_INVALID", 500);
  const env = getAuthEnv();
  const finalPath = getSafeAttachmentPath(env.UPLOAD_DIR, storedName);
  const stagingPath = attachment.stagingName ? getSafeStagingPath(env.UPLOAD_DIR, attachment.stagingName) : null;
  await mkdir(finalPath.uploadRoot, { recursive: true });
  await assertResolvedUploadRoot(finalPath.uploadRoot);

  try {
    await hooks?.beforeAtomicRename?.();
    if (stagingPath) await assertResolvedUploadRoot(path.dirname(stagingPath.filePath));
    const finalPresent = (await verifyFinalFile(finalPath.uploadRoot, finalPath.filePath, attachment.hash, attachment.sizeBytes));
    if (finalPresent && stagingPath && await attachmentPathExists(stagingPath.filePath)) throw new ApiError("ATTACHMENT_RECONCILIATION_REQUIRED", 409);
    if (!finalPresent) {
      if (!stagingPath) throw new ApiError("ATTACHMENT_STAGING_MISSING", 409);
      try {
        await promoteAttachmentFile(stagingPath.filePath, finalPath.filePath, finalPath.uploadRoot, attachment.hash, attachment.sizeBytes);
        await fsyncDirectory(finalPath.uploadRoot);
      } catch (error) {
        // A maintenance reconciliation may have completed the rename between
        // the probe and this call. Accept it only after re-verifying the final.
        if ((stagingPath && await attachmentPathExists(stagingPath.filePath))
          || !(await verifyFinalFile(finalPath.uploadRoot, finalPath.filePath, attachment.hash, attachment.sizeBytes))) {
          throw error;
        }
      }
    }
    await hooks?.afterAtomicRename?.();
  } catch (error) {
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }

  if (!(await verifyFinalFile(finalPath.uploadRoot, finalPath.filePath, attachment.hash, attachment.sizeBytes))) {
    await markIntentFailed(attachment.id, "post_rename_verify", "INTEGRITY_MISMATCH", tx);
    return new ApiError("ATTACHMENT_WRITE_FAILED", 500);
  }

  await hooks?.beforeReadyCas?.();
  const finalized = await tx.attachment.updateMany({
    where: {
      id: attachment.id,
      status: "PENDING",
      protocolVersion: attachmentProtocolVersion,
      updatedAt: attachment.updatedAt,
      reconciliationClaimId: null,
    },
    data: {
      status: "READY",
      finalizedAt: new Date(),
      stagingName: null,
      failureCode: null,
      failurePhase: null,
    },
  });
  if (finalized.count !== 1) throw new ApiError("ATTACHMENT_RECONCILIATION_REQUIRED", 500);
  return serializeAttachment(await tx.attachment.findUniqueOrThrow({ where: { id: attachment.id }, select: attachmentDtoSelect }));
}

async function createAttachmentWithOps007(input: AttachmentUploadInput & { prepared?: PreparedAttachmentUpload; intent?: ExistingAttachmentIntent }): Promise<AttachmentDto> {
  const staged = await stageAttachmentWithOps007(input);
  return finalizeStagedAttachment(staged, input.hooks,
    input.noteId ? { noteId: input.noteId, workspaceId: input.workspaceId, actorId: input.actorId } : undefined);
}

interface StagedAttachment {
  identity: StorageReleaseIdentity;
  attachment: {
    id: string;
    noteId: string | null;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  };
  updatedAt: Date;
  draft: { storedName: string; hash: string; sizeBytes: number };
  stagingPath: { filePath: string };
  finalPath: { filePath: string; uploadRoot: string };
}

interface NoteAttachmentFinalizeContext {
  noteId: string;
  workspaceId: string;
  actorId: string;
}

function prepareAttachmentUpload(input: AttachmentUploadInput): PreparedAttachmentUpload {
  const env = getAuthEnv(); const policy = createUploadPolicy(input.maxUploadMb, input.policyMimeTypes);
  const result = createAttachmentMetadataDraftFromScan({ sizeBytes: input.scan.sizeBytes, sha256Hex: input.scan.sha256Hex,
    detectedMimeType: input.scan.detectedMimeType, declaredMimeType: input.scan.declaredMimeType, originalName: input.scan.originalName,
    randomId: input.hooks?.storageId?.() ?? createStorageId(), policy });
  if (!result.ok) throw uploadValidationError(result.validation.reason);
  const draft = result.draft; const stagingName = createStagingAttachmentName(draft.storedName);
  return { draft, stagingName, finalPath: getSafeAttachmentPath(env.UPLOAD_DIR, draft.storedName),
    stagingPath: getSafeStagingPath(env.UPLOAD_DIR, stagingName) };
}

async function ensureAttachmentDirectories(prepared: PreparedAttachmentUpload): Promise<void> {
  await mkdir(prepared.finalPath.uploadRoot, { recursive: true, mode: 0o700 });
  await assertResolvedUploadRoot(prepared.finalPath.uploadRoot);
  const stagingRoot = path.dirname(prepared.stagingPath.filePath);
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  await assertResolvedUploadRoot(stagingRoot);
}

async function stageAttachmentWithOps007(input: AttachmentUploadInput & { prepared?: PreparedAttachmentUpload; intent?: ExistingAttachmentIntent }): Promise<StagedAttachment> {
  const prepared = input.prepared ?? prepareAttachmentUpload(input);
  const { draft, stagingName, finalPath, stagingPath } = prepared;
  await ensureAttachmentDirectories(prepared);
  const intent = input.intent ?? await createPendingIntent(input.noteId, input.workspaceId, draft, stagingName, input.actorId, input.intentMetadata);
  const identity: StorageReleaseIdentity = { id: intent.id, ownerUserId: input.actorId, storageWorkspaceId: input.workspaceId,
    storedName: draft.storedName, uri: draft.uri, hash: draft.hash, sizeBytes: draft.sizeBytes, protocolVersion: attachmentProtocolVersion };
  try {
    await withAttachmentFileOperation(intent.id, async tx => {
      await input.hooks?.beforeStagingWrite?.();
      const row = await tx.attachment.findFirst({ where: { id: intent.id, status: "PENDING", updatedAt: intent.updatedAt,
        storageReleasedAt: null, reconciliationClaimId: null }, select: { id: true } });
      if (!row) throw new ApiError("ATTACHMENT_NOT_READY", 409);
      await writeStagingFileDurably(stagingPath.filePath, input.scan.bytes);
      await input.hooks?.afterStagingWrite?.();
    });
  } catch (error) {
    await failIntentWithCompensation({ identity, failurePhase: "staging_write", failureCode: "STAGING_WRITE_FAILED", stagingFilePath: stagingPath.filePath }, input.hooks);
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }
  const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: intent.id }, select: attachmentDtoSelect });
  return { attachment, identity, updatedAt: intent.updatedAt, draft, stagingPath, finalPath };
}

async function finalizeStagedAttachment(staged: StagedAttachment, hooks?: AttachmentProtocolHooks, noteContext?: NoteAttachmentFinalizeContext): Promise<AttachmentDto> {
  let phase = "atomic_rename";
  try {
    const result = await withAttachmentFileOperation<{ ok: true; attachment: AttachmentDto } | { ok: false; error: ApiError }>(staged.attachment.id, async tx => {
      await hooks?.beforeAtomicRename?.();
      const row = await tx.attachment.findFirst({ where: { id: staged.attachment.id, status: "PENDING", updatedAt: staged.updatedAt,
        reconciliationClaimId: null, storageReleasedAt: null }, select: { id: true } });
      if (!row) throw new ApiError("ATTACHMENT_NOT_READY", 409);
      await promoteAttachmentFile(staged.stagingPath.filePath, staged.finalPath.filePath, staged.finalPath.uploadRoot, staged.draft.hash, staged.draft.sizeBytes);
      await hooks?.afterAtomicRename?.();
      phase = "post_rename_verify";
      if (!(await verifyFinalFile(staged.finalPath.uploadRoot, staged.finalPath.filePath, staged.draft.hash, staged.draft.sizeBytes))) {
        await markIntentFailed(staged.attachment.id, "post_rename_verify", "INTEGRITY_MISMATCH", tx);
        return { ok: false, error: new ApiError("ATTACHMENT_WRITE_FAILED", 500) };
      }
      phase = "ready_cas";
      await hooks?.beforeReadyCas?.();
      if (noteContext) return finalizeNoteAttachmentReady(staged, noteContext, tx);
      const finalized = await tx.attachment.updateMany({ where: { id: staged.attachment.id, status: "PENDING", protocolVersion: attachmentProtocolVersion,
        updatedAt: staged.updatedAt, reconciliationClaimId: null, storageReleasedAt: null },
        data: { status: "READY", finalizedAt: new Date(), stagingName: null, failureCode: null, failurePhase: null } });
      if (finalized.count !== 1) throw new ApiError("ATTACHMENT_RECONCILIATION_REQUIRED", 500);
      return { ok: true, attachment: serializeAttachment(await tx.attachment.findUniqueOrThrow({ where: { id: staged.attachment.id }, select: attachmentDtoSelect })) };
    });
    if (!result.ok) throw result.error;
    return result.attachment;
  } catch (error) {
    if (phase === "atomic_rename") await failIntentWithCompensation({ identity: staged.identity, failurePhase: "atomic_rename", failureCode: "ATOMIC_RENAME_FAILED", stagingFilePath: staged.stagingPath.filePath }, hooks);
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }
}

async function promoteAttachmentFile(stagingFile: string, finalFile: string, uploadRoot: string, hash: string, sizeBytes: number): Promise<void> {
  await assertResolvedUploadRoot(uploadRoot); await assertResolvedUploadRoot(path.dirname(stagingFile));
  if (await attachmentPathExists(finalFile)) throw new ApiError("ATTACHMENT_STORAGE_CONFLICT", 409);
  if (!(await verifyFinalFile(uploadRoot, stagingFile, hash, sizeBytes))) throw new ApiError("ATTACHMENT_FILE_MISMATCH", 409);
  // 所有应用写入者持有同一附件文件栅栏；不覆盖已存在的目标。
  await rename(stagingFile, finalFile);
  await fsyncDirectory(uploadRoot); await fsyncDirectory(path.dirname(stagingFile));
}

async function attachmentPathExists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if (isNotFoundError(error)) return false; throw error; }
}

async function finalizeNoteAttachmentReady(
  staged: StagedAttachment,
  context: NoteAttachmentFinalizeContext,
  tx: Prisma.TransactionClient,
): Promise<{ ok: true; attachment: AttachmentDto } | { ok: false; error: ApiError }> {
    const workspace = await lockActiveWorkspaceForWrite(tx, context.actorId);
    if (workspace.id !== context.workspaceId) {
      return rejectNoteAttachmentBeforeReady(tx, staged, new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
        latest: { workspaceId: workspace.id },
        conflictFields: ["workspaceId"],
        workbench: "/settings/exams",
      }), "ACTIVE_WORKSPACE_CHANGED");
    }

    const note = await tx.note.findFirst({
      where: { id: context.noteId, ownerUserId: context.actorId, subject: { workspaceId: context.workspaceId } },
      select: { id: true, revision: true, archivedAt: true },
    });
    if (!note) {
      return rejectNoteAttachmentBeforeReady(
        tx,
        staged,
        new ApiError("NOTE_NOT_FOUND", 404),
        "NOTE_NOT_FOUND",
      );
    }
    if (note.archivedAt) {
      return rejectNoteAttachmentBeforeReady(tx, staged, noteArchivedError(note), "NOTE_ARCHIVED");
    }

    const finalized = await tx.attachment.updateMany({
      where: {
        id: staged.attachment.id,
        status: "PENDING",
        protocolVersion: attachmentProtocolVersion,
        updatedAt: staged.updatedAt,
        reconciliationClaimId: null,
      },
      data: { status: "READY", finalizedAt: new Date(), stagingName: null, failureCode: null, failurePhase: null },
    });
    if (finalized.count !== 1) {
      return { ok: false, error: new ApiError("ATTACHMENT_RECONCILIATION_REQUIRED", 500) };
    }
    const attachment = await tx.attachment.findUniqueOrThrow({
      where: { id: staged.attachment.id },
      select: attachmentDtoSelect,
    });
    return { ok: true, attachment: serializeAttachment(attachment) };
}

async function rejectNoteAttachmentBeforeReady(
  tx: Prisma.TransactionClient,
  staged: StagedAttachment,
  error: ApiError,
  failureCode: string,
): Promise<{ ok: false; error: ApiError }> {
  const rejected = await tx.attachment.updateMany({
    where: {
      id: staged.attachment.id,
      status: "PENDING",
      protocolVersion: attachmentProtocolVersion,
      updatedAt: staged.updatedAt,
      reconciliationClaimId: null,
    },
    data: { status: "FAILED", failureCode, failurePhase: "ready_cas" },
  });
  return rejected.count === 1
    ? { ok: false, error }
    : { ok: false, error: new ApiError("ATTACHMENT_RECONCILIATION_REQUIRED", 500) };
}

export async function getAttachmentDownload(
  id: string,
  disposition: "attachment" | "inline" = "attachment",
  actorId: string,
): Promise<AttachmentDownload> {
  const attachment = await loadAuthorizedAttachment(id, actorId);

  if (attachment.status !== "READY") {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }

  if (disposition === "inline" && !isInlinePreviewAllowed(attachment.mimeType)) {
    throw new ApiError("ATTACHMENT_INVALID_DISPOSITION", 400);
  }
  // ZIP always forced to attachment disposition
  if (attachment.mimeType === "application/zip") {
    disposition = "attachment";
  }

  const storedName = parseAttachmentUri(attachment.uri);
  if (!storedName) {
    throw new ApiError("ATTACHMENT_URI_INVALID", 500);
  }

  const env = getAuthEnv();
  const safePath = getSafeAttachmentPath(env.UPLOAD_DIR, storedName);
  await assertResolvedUploadRoot(safePath.uploadRoot);

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let bytes: Uint8Array;
  try {
    handle = await open(safePath.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new ApiError("ATTACHMENT_FILE_MISMATCH", 409);
    }
    bytes = new Uint8Array(await handle.readFile());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isNotFoundError(error)) {
      throw new ApiError("ATTACHMENT_FILE_MISSING", 404);
    }
    if (isSymlinkRejection(error)) {
      throw new ApiError("ATTACHMENT_FILE_MISMATCH", 409);
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }

  const fileHash = createHashHex(bytes);
  if (bytes.length !== attachment.sizeBytes || fileHash !== attachment.hash) {
    throw new ApiError("ATTACHMENT_FILE_MISMATCH", 409);
  }

  return {
    bytes,
    headers: createAttachmentResponseHeaders({
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      sizeBytes: attachment.sizeBytes,
      disposition,
    }),
  };
}

async function loadAuthorizedAttachment(id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const identity = await tx.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        ownerUserId: true,
        noteId: true,
        studyResource: { select: { workspaceId: true, ownerUserId: true } },
        note: { select: { ownerUserId: true, subject: { select: { workspaceId: true } } } },
      },
    });
    if (!identity || (!identity.noteId && !identity.studyResource)) throw attachmentNotFound();
    const parentOwners = [identity.note?.ownerUserId, identity.studyResource?.ownerUserId].filter(
      (owner): owner is string => Boolean(owner),
    );
    if (parentOwners.length === 0 || parentOwners.some((owner) => owner !== identity.ownerUserId)) {
      // A mismatched lineage must never be made reachable by a grant on the
      // parent object. Treat it as absent and leave reconciliation to report
      // the data-integrity problem separately.
      throw attachmentNotFound();
    }
    const workspaceId = identity.studyResource?.workspaceId ?? identity.note?.subject.workspaceId ?? null;
    if (!workspaceId) {
      if (identity.ownerUserId !== actorId || getAuthEnv().AUTH_MULTI_USER_ENABLED) throw attachmentNotFound();
    } else if (getAuthEnv().AUTH_RBAC_ENABLED) {
      await requireSharedResourceAccess(tx, {
        actorId,
        workspaceId,
        resourceType: "ATTACHMENT",
        resourceId: id,
      });
    } else {
      // 多人/RBAC 尚未开启时也不能把 Workspace Owner 身份当成附件
      // 读取授权；附件正文默认仍归资源 owner，避免 feature flag 组合泄露。
      if (identity.ownerUserId !== actorId) throw attachmentNotFound();
      await requireWorkspaceOwner(tx, actorId, workspaceId);
    }
    const attachment = await tx.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        noteId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        hash: true,
        uri: true,
        status: true,
        createdAt: true,
      },
    });
    if (!attachment) throw attachmentNotFound();
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "ATTACHMENT_READ",
        entityType: "Attachment",
        entityId: id,
        metadata: { workspaceId },
      },
    });
    return attachment;
  });
}

function attachmentNotFound(): ApiError {
  return new ApiError("ATTACHMENT_NOT_FOUND", 404);
}

/**
 * Ends an explicitly skipped, still-unbound workspace upload without leaving
 * a READY file that can never be reached through a business object.
 */
export async function discardUnboundAttachment(actorId: string, attachmentId: string): Promise<void> {
  const cleanup = await markUnboundAttachmentDiscarded(actorId, attachmentId);
  if (cleanup) await cleanupDiscardedAttachmentFiles(cleanup);
}

export async function markUnboundAttachmentDiscarded(actorId: string, attachmentId: string, client: AttachmentDbClient = prisma): Promise<DiscardedAttachmentCleanup | null> {
  if ("$transaction" in client) return client.$transaction(tx => markUnboundAttachmentDiscardedInTransaction(actorId, attachmentId, tx));
  return markUnboundAttachmentDiscardedInTransaction(actorId, attachmentId, client);
}

async function markUnboundAttachmentDiscardedInTransaction(actorId: string, attachmentId: string, tx: Prisma.TransactionClient): Promise<DiscardedAttachmentCleanup | null> {
  await lockAttachmentFileOperation(tx, attachmentId);
  const attachment = await tx.attachment.findUnique({ where: { id: attachmentId }, select: storageCleanupSelect });
  if (!attachment || attachment.noteId || attachment.studyResource) throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  await assertAttachmentIntentOwner(actorId, attachment.id, tx);
  if (attachment.reconciliationClaimId) throw new ApiError("ATTACHMENT_NOT_READY", 409);
  if (attachment.status === "FAILED") return storageCleanupDescriptor(attachment);
  const updated = await tx.attachment.updateMany({ where: { id: attachment.id, status: { in: ["PENDING", "READY"] }, updatedAt: attachment.updatedAt },
    data: { status: "FAILED", failureCode: "STAGING_SKIPPED", failurePhase: "user_skip" } });
  if (updated.count !== 1) return null;
  return storageCleanupDescriptor(await tx.attachment.findUniqueOrThrow({ where: { id: attachment.id }, select: storageCleanupSelect }));
}

export function cleanupDiscardedAttachmentFiles(cleanup: DiscardedAttachmentCleanup, hooks?: AttachmentStorageCleanupHooks): Promise<boolean> {
  return completeAttachmentStorageCleanup(cleanup, hooks);
}

const attachmentDtoSelect = {
  id: true,
  noteId: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

export function serializeAttachment(attachment: {
  id: string;
  noteId?: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}): AttachmentDto {
  return {
    id: attachment.id,
    noteId: attachment.noteId ?? null,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    downloadApiPath: `/api/attachments/${attachment.id}`,
    createdAt: attachment.createdAt.toISOString(),
  };
}

function attachmentSnapshot(attachment: AttachmentDto): Prisma.InputJsonObject {
  return {
    id: attachment.id,
    noteId: attachment.noteId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    downloadApiPath: attachment.downloadApiPath,
    createdAt: attachment.createdAt,
  };
}

function uploadScanIdentity(scan: BoundedFileScan): Prisma.InputJsonObject {
  return {
    originalName: scan.originalName,
    declaredMimeType: scan.declaredMimeType,
    detectedMimeType: scan.detectedMimeType,
    sizeBytes: scan.sizeBytes,
    sha256Hex: scan.sha256Hex,
    businessError: scan.businessError ?? null,
  };
}

function assertUploadScanValid(scan: BoundedFileScan, policy: ReturnType<typeof createUploadPolicy>): void {
  const result = createAttachmentMetadataDraftFromScan({
    sizeBytes: scan.sizeBytes,
    sha256Hex: scan.sha256Hex,
    detectedMimeType: scan.detectedMimeType,
    declaredMimeType: scan.declaredMimeType,
    originalName: scan.originalName,
    randomId: "validationonly0000000000000000",
    policy,
  });
  if (!result.ok) throw uploadValidationError(result.validation.reason);
}

async function loadReplayedNoteAttachment(
  actorId: string,
  noteId: string,
  attachmentId: string,
): Promise<AttachmentDto> {
  await assertNoteExists(noteId, actorId);
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, ownerUserId: actorId, noteId, status: "READY" },
    select: attachmentDtoSelect,
  });
  if (!attachment) {
    throw new ApiError("NOTE_ATTACHMENT_UPLOAD_RESULT_UNAVAILABLE", 409, {
      latest: { state: "completed", attachmentId },
      conflictFields: ["idempotencyKey"],
      workbench: "/knowledge/cards",
    });
  }
  return serializeAttachment(attachment);
}

async function claimNoteAttachmentCommand(
  command: PersistentCreateCommand,
  noteId: string,
  actorId: string,
  input: AttachmentUploadInput,
) {
  return attachmentStorageTransaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    if (workspace.id !== command.workspaceId) {
      throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
        latest: { workspaceId: workspace.id },
        conflictFields: ["workspaceId"],
        workbench: "/settings/exams",
      });
    }
    const note = await tx.note.findFirst({
      where: { id: noteId, ownerUserId: actorId, subject: { workspaceId: workspace.id } },
      select: { id: true, revision: true, archivedAt: true },
    });
    if (!note) throw new ApiError("NOTE_NOT_FOUND", 404);
    if (note.archivedAt) {
      const replay = await findPersistentCreateReplay(tx, command);
      if (replay) return { state: "replayed" as const, replay };
      throw noteArchivedError(note);
    }
    let claim = await claimPersistentCreateCommand(tx, command);
    if (claim.state === "pending") claim = await resumeReleasedNoteAttachmentClaim(tx, command, noteId, input) ?? claim;
    if (claim.state !== "claimed") return claim;
    const prepared = prepareAttachmentUpload(input);
    await ensureAttachmentDirectories(prepared);
    const intent = await createStorageAttachmentIntent(tx, { noteId, workspaceId: workspace.id, actorId,
      draft: prepared.draft, stagingName: prepared.stagingName, intentMetadata: { noteClaimEventId: claim.claimEventId } });
    const pending = await tx.auditEvent.findUniqueOrThrow({ where: { id: claim.claimEventId }, select: { metadata: true } });
    await tx.auditEvent.update({ where: { id: claim.claimEventId }, data: { metadata: {
      ...(pending.metadata as Prisma.JsonObject), storageIntentId: intent.id,
    } } });
    return { ...claim, prepared, intent };
  }, true);
}

async function resumeReleasedNoteAttachmentClaim(tx: Prisma.TransactionClient, command: PersistentCreateCommand, noteId: string, input: AttachmentUploadInput) {
  const claim = await tx.auditEvent.findFirst({ where: { actorId: command.actorId, action: command.action, entityType: command.entityType,
    AND: [{ metadata: { path: ["workspaceId"], equals: command.workspaceId } }, { metadata: { path: ["idempotencyKey"], equals: command.idempotencyKey } }] },
    orderBy: { createdAt: "desc" }, select: { id: true, metadata: true } });
  if (!claim) return null;
  const metadata = claim.metadata as Prisma.JsonObject;
  if (metadata.claimState !== "pending" || metadata.requestFingerprint !== command.requestFingerprint) throw new ApiError(command.conflictCode, 409);
  if (typeof metadata.storageIntentId !== "string") return null;
  const row = await tx.attachment.findUnique({ where: { id: metadata.storageIntentId },
    select: { ...storageCleanupSelect, originalName: true, mimeType: true, createdAt: true } });
  if (!row || row.noteId !== noteId || row.ownerUserId !== command.actorId || row.storageWorkspaceId !== command.workspaceId
    || row.hash !== input.scan.sha256Hex || row.sizeBytes !== input.scan.sizeBytes || row.originalName !== input.scan.originalName) return null;
  if (row.status !== "READY" && !isVerifiedStorageRelease(row)) return null;
  await lockAttachmentFileOperation(tx, row.id);
  if (row.status === "READY") {
    const storedName = parseAttachmentUri(row.uri);
    if (!storedName) throw new ApiError("ATTACHMENT_URI_INVALID", 500);
    const file = getSafeAttachmentPath(getAuthEnv().UPLOAD_DIR, storedName);
    if (!(await verifyFinalFile(file.uploadRoot, file.filePath, row.hash, row.sizeBytes))) throw new ApiError("ATTACHMENT_FILE_MISMATCH", 409);
    const result = serializeAttachment(row);
    await completePersistentCreateClaim(tx, command, claim.id, row.id, { noteId, mimeType: row.mimeType, sizeBytes: row.sizeBytes }, attachmentSnapshot(result));
    return { state: "replayed" as const, replay: { resultId: row.id } };
  }
  await assertStorageQuotaFilesAbsent(getAuthEnv().UPLOAD_DIR, row);
  await tx.auditEvent.update({ where: { id: claim.id }, data: { metadata: { ...metadata,
    claimAttempt: typeof metadata.claimAttempt === "number" ? metadata.claimAttempt + 1 : 2, claimStartedAt: new Date().toISOString() } } });
  return { state: "claimed" as const, claimEventId: claim.id };
}

async function createPendingIntent(
  noteId: string | null,
  workspaceId: string,
  draft: { originalName: string; storedName: string; mimeType: string; sizeBytes: number; hash: string; uri: string },
  stagingName: string,
  actorId: string,
  extraMetadata?: Prisma.InputJsonObject,
): Promise<ExistingAttachmentIntent> {
  try {
    return await attachmentStorageTransaction(async tx => {
      const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
      if (workspace.id !== workspaceId) throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
        latest: { workspaceId: workspace.id }, conflictFields: ["workspaceId"], workbench: "/settings/exams",
      });
      if (noteId) {
        const note = await tx.note.findFirst({ where: { id: noteId, ownerUserId: actorId, subject: { workspaceId } },
          select: { id: true, revision: true, archivedAt: true } });
        if (!note) throw new ApiError("NOTE_NOT_FOUND", 404);
        if (note.archivedAt) throw noteArchivedError(note);
      }
      return createStorageAttachmentIntent(tx, { noteId, workspaceId, draft, stagingName, actorId, intentMetadata: extraMetadata });
    }, true);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ApiError("ATTACHMENT_STORAGE_CONFLICT", 500);
    throw toApiError(error, "ATTACHMENT_METADATA_WRITE_FAILED");
  }
}

async function assertAttachmentIntentOwner(
  actorId: string,
  attachmentId: string,
  client: AttachmentDbClient = prisma,
): Promise<void> {
  const attachment = await client.attachment.findUnique({
    where: { id: attachmentId },
    select: { ownerUserId: true },
  });
  if (!attachment || attachment.ownerUserId !== actorId) throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  const intent = await client.auditEvent.findFirst({
    where: {
      actorId,
      action: "ATTACHMENT_INTENT_CREATED",
      entityType: "Attachment",
      entityId: attachmentId,
    },
    select: { id: true },
  });
  if (!intent) throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
}

async function writeStagingFileDurably(stagingFilePath: string, bytes: Uint8Array): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(stagingFilePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
  await fsyncDirectory(path.dirname(stagingFilePath));
}

export async function fsyncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function verifyFinalFile(
  uploadRoot: string,
  filePath: string,
  expectedHash: string,
  expectedSize: number,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== expectedSize) return false;
    const bytes = await handle.readFile();
    return createHashHex(new Uint8Array(bytes)) === expectedHash && isInside(uploadRoot, filePath);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** 补偿：仅删除本次新建的 staging 文件；删除失败保留稳定 failure code，不吞错误。 */
async function failIntentWithCompensation(input: {
  identity: StorageReleaseIdentity; failurePhase: string; failureCode: string; stagingFilePath: string;
}, hooks?: AttachmentProtocolHooks): Promise<void> {
  const { identity, failureCode, failurePhase } = input;
  try {
    const cleanup = await withAttachmentFileOperation(identity.id, async tx => {
      const row = await tx.attachment.findUnique({ where: { id: identity.id }, select: storageCleanupSelect });
      if (!row || row.studyResource || row.reconciliationClaimId || storageReleaseProof(row) !== storageReleaseProof(identity)
        || !["PENDING", "FAILED"].includes(row.status)) return null;
      if (row.status === "PENDING") await markIntentFailed(row.id, failurePhase, failureCode, tx);
      return storageCleanupDescriptor(await tx.attachment.findUniqueOrThrow({ where: { id: row.id }, select: storageCleanupSelect }));
    });
    if (!cleanup) return;
    // 仅测试可注入失败；成功返回也必须经过真实缺失/fsync 检查，不能被当成释放证明。
    await hooks?.compensationUnlink?.(input.stagingFilePath);
    const settled = await completeAttachmentStorageCleanup(cleanup, {}, { boundNote: true, mode: "failed-staging" });
    if (!settled) throw new Error("STAGING_CLEANUP_INCOMPLETE");
  } catch {
    await prisma.attachment.updateMany({ where: { id: identity.id, status: "FAILED", failurePhase,
      protocolVersion: attachmentProtocolVersion, storageReleasedAt: null }, data: { failureCode: failureCode + "_STAGING_CLEANUP_FAILED" } }).catch(() => undefined);
  }
}

async function markIntentFailed(attachmentId: string, failurePhase: string, failureCode: string, tx?: Prisma.TransactionClient): Promise<void> {
  const update = async (client: Prisma.TransactionClient) => {
    await client.attachment.updateMany({ where: { id: attachmentId, status: "PENDING", protocolVersion: attachmentProtocolVersion,
      reconciliationClaimId: null, storageReleasedAt: null }, data: { status: "FAILED", failureCode, failurePhase } });
  };
  if (tx) await update(tx);
  else await withAttachmentFileOperation(attachmentId, update).catch(() => undefined);
}

async function assertNoteExists(noteId: string, actorId: string): Promise<string> {
  const workspace = await resolveActiveWorkspace(actorId);
  const note = await prisma.note.findFirst({
    where: { id: noteId, ownerUserId: actorId, subject: { workspaceId: workspace.id } },
    select: { id: true },
  });

  if (!note) {
    throw new ApiError("NOTE_NOT_FOUND", 404);
  }
  return workspace.id;
}

function noteArchivedError(note: { id: string; revision: number; archivedAt: Date | null }): ApiError {
  return new ApiError("NOTE_ARCHIVED", 409, {
    latest: {
      id: note.id,
      revision: note.revision,
      archivedAt: note.archivedAt?.toISOString() ?? null,
    },
    conflictFields: ["archivedAt"],
    workbench: "/knowledge/cards",
  });
}

async function assertResolvedUploadRoot(uploadRoot: string): Promise<void> {
  const resolvedRoot = await realpath(uploadRoot).catch(() => null);
  if (!resolvedRoot || resolvedRoot !== uploadRoot) {
    throw new ApiError("UPLOAD_DIR_UNSAFE", 500);
  }
}

function uploadValidationError(reason: string): ApiError {
  switch (reason) {
    case "empty_file":
      return new ApiError("ATTACHMENT_EMPTY_FILE", 400);
    case "too_large":
      return new ApiError("ATTACHMENT_TOO_LARGE", 413);
    case "declared_mime_mismatch":
      return new ApiError("ATTACHMENT_MIME_MISMATCH", 400);
    case "mime_not_allowed":
    case "unknown_magic_bytes":
      return new ApiError("ATTACHMENT_UNSUPPORTED_TYPE", 400);
    default:
      return new ApiError("ATTACHMENT_INVALID_FILE", 400);
  }
}

function createStorageId(): string {
  return randomUUID().replaceAll("-", "");
}

export function getSafeAttachmentPath(uploadDir: string, storedName: string) {
  try {
    return createSafeAttachmentFilePath(uploadDir, storedName, {
      forbiddenDirectories: publicUploadRoots,
    });
  } catch {
    throw new ApiError("UPLOAD_DIR_UNSAFE", 500);
  }
}

export function getSafeStagingPath(uploadDir: string, stagingName: string) {
  try {
    return createSafeStagingFilePath(uploadDir, stagingName, {
      forbiddenDirectories: publicUploadRoots,
    });
  } catch {
    throw new ApiError("UPLOAD_DIR_UNSAFE", 500);
  }
}

function createHashHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isInside(uploadRoot: string, filePath: string): boolean {
  const relative = path.relative(uploadRoot, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function isSymlinkRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "ELOOP" || error.code === "EMLINK" || error.code === "EFTYPE");
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function toApiError(error: unknown, fallbackCode: string): ApiError {
  return error instanceof ApiError ? error : new ApiError(fallbackCode, 500);
}

export { stagingDirectoryName };
