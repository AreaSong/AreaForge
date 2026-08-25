import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm } from "node:fs/promises";
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
} from "@areaforge/storage";
import { getAuthEnv } from "@/lib/auth/env";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
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
 * → 重新打开校验 hash/size → READY CAS。所有文件 IO 都在数据库事务之外。
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

export interface DiscardedAttachmentCleanup {
  attachmentId: string;
  uri: string;
  stagingName: string | null;
}

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
  const claim = await claimNoteAttachmentCommand(command, input.noteId, actorId);
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

  const attachment = await createAttachmentWithOps007({
    noteId: input.noteId,
    workspaceId,
    scan: input.scan,
    actorId,
    policyMimeTypes,
    maxUploadMb: env.MAX_UPLOAD_MB,
    hooks,
  });
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
export async function finalizeWorkspaceAttachment(
  actorId: string,
  attachmentId: string,
  hooks?: AttachmentProtocolHooks,
): Promise<AttachmentDto> {
  const attachment = await prisma.attachment.findUnique({
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
  await assertAttachmentIntentOwner(actorId, attachment.id);
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
    const finalPresent = (await verifyFinalFile(finalPath.uploadRoot, finalPath.filePath, attachment.hash, attachment.sizeBytes));
    if (!finalPresent) {
      if (!stagingPath) throw new ApiError("ATTACHMENT_STAGING_MISSING", 409);
      try {
        await rename(stagingPath.filePath, finalPath.filePath);
        await fsyncDirectory(finalPath.uploadRoot);
      } catch (error) {
        // A maintenance reconciliation may have completed the rename between
        // the probe and this call. Accept it only after re-verifying the final.
        if (!(await verifyFinalFile(finalPath.uploadRoot, finalPath.filePath, attachment.hash, attachment.sizeBytes))) {
          throw error;
        }
      }
    }
    await hooks?.afterAtomicRename?.();
  } catch (error) {
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }

  if (!(await verifyFinalFile(finalPath.uploadRoot, finalPath.filePath, attachment.hash, attachment.sizeBytes))) {
    await markIntentFailed(attachment.id, "post_rename_verify", "INTEGRITY_MISMATCH");
    throw new ApiError("ATTACHMENT_WRITE_FAILED", 500);
  }

  await hooks?.beforeReadyCas?.();
  const finalized = await prisma.attachment.updateMany({
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
  return serializeAttachment(await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id }, select: attachmentDtoSelect }));
}

async function createAttachmentWithOps007(input: {
  noteId: string | null;
  workspaceId: string;
  scan: BoundedFileScan;
  actorId: string;
  policyMimeTypes: readonly string[];
  maxUploadMb: number;
  hooks?: AttachmentProtocolHooks;
  intentMetadata?: Prisma.InputJsonObject;
}): Promise<AttachmentDto> {
  const staged = await stageAttachmentWithOps007(input);
  return finalizeStagedAttachment(
    staged,
    input.hooks,
    input.noteId ? { noteId: input.noteId, workspaceId: input.workspaceId, actorId: input.actorId } : undefined,
  );
}

interface StagedAttachment {
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

async function stageAttachmentWithOps007(input: {
  noteId: string | null;
  workspaceId: string;
  scan: BoundedFileScan;
  actorId: string;
  policyMimeTypes: readonly string[];
  maxUploadMb: number;
  hooks?: AttachmentProtocolHooks;
  intentMetadata?: Prisma.InputJsonObject;
}): Promise<StagedAttachment> {
  const env = getAuthEnv();
  const policy = createUploadPolicy(input.maxUploadMb, input.policyMimeTypes);
  const draftResult = createAttachmentMetadataDraftFromScan({
    sizeBytes: input.scan.sizeBytes,
    sha256Hex: input.scan.sha256Hex,
    detectedMimeType: input.scan.detectedMimeType,
    declaredMimeType: input.scan.declaredMimeType,
    originalName: input.scan.originalName,
    randomId: input.hooks?.storageId?.() ?? createStorageId(),
    policy,
  });

  if (!draftResult.ok) {
    throw uploadValidationError(draftResult.validation.reason);
  }

  const draft = draftResult.draft;
  const stagingName = createStagingAttachmentName(draft.storedName);
  const finalPath = getSafeAttachmentPath(env.UPLOAD_DIR, draft.storedName);
  const stagingPath = getSafeStagingPath(env.UPLOAD_DIR, stagingName);
  const hooks = input.hooks;

  await mkdir(finalPath.uploadRoot, { recursive: true });
  await mkdir(path.dirname(stagingPath.filePath), { recursive: true });
  await assertResolvedUploadRoot(finalPath.uploadRoot);

  const intent = await createPendingIntent(
    input.noteId,
    input.workspaceId,
    draft,
    stagingName,
    input.actorId,
    input.intentMetadata,
  );

  try {
    await hooks?.beforeStagingWrite?.();
    await writeStagingFileDurably(stagingPath.filePath, input.scan.bytes);
    await hooks?.afterStagingWrite?.();
  } catch (error) {
    await failIntentWithCompensation(intent.id, "staging_write", "STAGING_WRITE_FAILED", stagingPath.filePath, hooks);
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }

  const attachment = await prisma.attachment.findUniqueOrThrow({
    where: { id: intent.id },
    select: {
      id: true,
      noteId: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });
  return {
    attachment,
    updatedAt: intent.updatedAt,
    draft: { storedName: draft.storedName, hash: draft.hash, sizeBytes: draft.sizeBytes },
    stagingPath,
    finalPath,
  };
}

async function finalizeStagedAttachment(
  staged: StagedAttachment,
  hooks?: AttachmentProtocolHooks,
  noteContext?: NoteAttachmentFinalizeContext,
): Promise<AttachmentDto> {
  try {
    await hooks?.beforeAtomicRename?.();
    await rename(staged.stagingPath.filePath, staged.finalPath.filePath);
    await fsyncDirectory(staged.finalPath.uploadRoot);
    await hooks?.afterAtomicRename?.();
  } catch (error) {
    await failIntentWithCompensation(staged.attachment.id, "atomic_rename", "ATOMIC_RENAME_FAILED", staged.stagingPath.filePath, hooks);
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }

  if (!(await verifyFinalFile(staged.finalPath.uploadRoot, staged.finalPath.filePath, staged.draft.hash, staged.draft.sizeBytes))) {
    await markIntentFailed(staged.attachment.id, "post_rename_verify", "INTEGRITY_MISMATCH");
    throw new ApiError("ATTACHMENT_WRITE_FAILED", 500);
  }

  await hooks?.beforeReadyCas?.();
  if (noteContext) {
    const result = await finalizeNoteAttachmentReady(staged, noteContext);
    if (!result.ok) throw result.error;
    return result.attachment;
  }
  const finalized = await prisma.attachment.updateMany({
    where: {
      id: staged.attachment.id,
      status: "PENDING",
      protocolVersion: attachmentProtocolVersion,
      updatedAt: staged.updatedAt,
      reconciliationClaimId: null,
    },
    data: { status: "READY", finalizedAt: new Date(), stagingName: null, failureCode: null, failurePhase: null },
  });
  if (finalized.count !== 1) throw new ApiError("ATTACHMENT_RECONCILIATION_REQUIRED", 500);
  return serializeAttachment(await prisma.attachment.findUniqueOrThrow({ where: { id: staged.attachment.id }, select: attachmentDtoSelect }));
}

async function finalizeNoteAttachmentReady(
  staged: StagedAttachment,
  context: NoteAttachmentFinalizeContext,
): Promise<{ ok: true; attachment: AttachmentDto } | { ok: false; error: ApiError }> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, context.actorId);
    if (workspace.id !== context.workspaceId) {
      return rejectNoteAttachmentBeforeReady(tx, staged, new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
        latest: { workspaceId: workspace.id },
        conflictFields: ["workspaceId"],
        workbench: "/settings/exams",
      }), "ACTIVE_WORKSPACE_CHANGED");
    }

    const note = await tx.note.findFirst({
      where: { id: context.noteId, subject: { workspaceId: context.workspaceId } },
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
  });
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
  actorId?: string,
): Promise<AttachmentDownload> {
  const attachment = await prisma.attachment.findUnique({
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
      studyResource: {
        select: {
          id: true,
          workspace: { select: { userId: true } },
        },
      },
      note: {
        select: {
          subject: { select: { workspace: { select: { userId: true } } } },
        },
      },
    },
  });

  if (!attachment) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  }

  const noteOwned = Boolean(attachment.noteId);
  const resourceOwned = Boolean(attachment.studyResource);
  if (!noteOwned && !resourceOwned) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  }

  if (actorId) {
    const ownerId =
      attachment.studyResource?.workspace.userId ??
      attachment.note?.subject.workspace?.userId ??
      null;
    // Legacy notes may lack workspace; noteId presence alone was historically enough.
    if (ownerId && ownerId !== actorId) {
      throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
    }
  }

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

/**
 * Ends an explicitly skipped, still-unbound workspace upload without leaving
 * a READY file that can never be reached through a business object.
 */
export async function discardUnboundAttachment(actorId: string, attachmentId: string): Promise<void> {
  const cleanup = await markUnboundAttachmentDiscarded(actorId, attachmentId);
  if (cleanup) await cleanupDiscardedAttachmentFiles(cleanup);
}

export async function markUnboundAttachmentDiscarded(
  actorId: string,
  attachmentId: string,
  client: AttachmentDbClient = prisma,
): Promise<DiscardedAttachmentCleanup | null> {
  const attachment = await client.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      uri: true,
      stagingName: true,
      status: true,
      noteId: true,
      studyResource: { select: { id: true } },
    },
  });
  if (!attachment || attachment.noteId || attachment.studyResource) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  }
  await assertAttachmentIntentOwner(actorId, attachment.id, client);
  const cleanup = {
    attachmentId: attachment.id,
    uri: attachment.uri,
    stagingName: attachment.stagingName,
  };
  if (attachment.status === "FAILED") return cleanup;
  const updated = await client.attachment.updateMany({
    where: { id: attachment.id, status: { in: ["PENDING", "READY"] } },
    data: {
      status: "FAILED",
      failureCode: "STAGING_SKIPPED",
      failurePhase: "user_skip",
    },
  });
  return updated.count === 1 ? cleanup : null;
}

export async function cleanupDiscardedAttachmentFiles(cleanup: DiscardedAttachmentCleanup): Promise<boolean> {
  try {
    const storedName = parseAttachmentUri(cleanup.uri);
    if (!storedName) throw new Error("invalid attachment uri");
    const env = getAuthEnv();
    const safePath = getSafeAttachmentPath(env.UPLOAD_DIR, storedName);
    const safeStagingPath = cleanup.stagingName ? getSafeStagingPath(env.UPLOAD_DIR, cleanup.stagingName) : null;
    await rm(safePath.filePath, { force: true });
    if (safeStagingPath) {
      await rm(safeStagingPath.filePath, { force: true });
      await fsyncDirectory(path.dirname(safeStagingPath.filePath));
    }
    await fsyncDirectory(safePath.uploadRoot);
    if (cleanup.stagingName) {
      await prisma.attachment.updateMany({
        where: {
          id: cleanup.attachmentId,
          status: "FAILED",
          stagingName: cleanup.stagingName,
        },
        data: { stagingName: null },
      });
    }
    return true;
  } catch (error) {
    console.error("Attachment discard cleanup deferred to reconciliation", {
      attachmentId: cleanup.attachmentId,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
    return false;
  }
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
    where: { id: attachmentId, noteId, status: "READY" },
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
) {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    if (workspace.id !== command.workspaceId) {
      throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
        latest: { workspaceId: workspace.id },
        conflictFields: ["workspaceId"],
        workbench: "/settings/exams",
      });
    }
    const note = await tx.note.findFirst({
      where: { id: noteId, subject: { workspaceId: workspace.id } },
      select: { id: true, revision: true, archivedAt: true },
    });
    if (!note) throw new ApiError("NOTE_NOT_FOUND", 404);
    if (note.archivedAt) {
      const replay = await findPersistentCreateReplay(tx, command);
      if (replay) return { state: "replayed" as const, replay };
      throw noteArchivedError(note);
    }
    return claimPersistentCreateCommand(tx, command);
  });
}

async function createPendingIntent(
  noteId: string | null,
  workspaceId: string,
  draft: { originalName: string; storedName: string; mimeType: string; sizeBytes: number; hash: string; uri: string },
  stagingName: string,
  actorId: string,
  extraMetadata?: Prisma.InputJsonObject,
): Promise<{ id: string; updatedAt: Date }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          noteId: noteId ?? undefined,
          originalName: draft.originalName,
          storedName: draft.storedName,
          mimeType: draft.mimeType,
          sizeBytes: draft.sizeBytes,
          hash: draft.hash,
          uri: draft.uri,
          status: "PENDING",
          protocolVersion: attachmentProtocolVersion,
          stagingName,
        },
        select: { id: true, updatedAt: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "ATTACHMENT_INTENT_CREATED",
          entityType: "Attachment",
          entityId: created.id,
          metadata: {
            ...extraMetadata,
            noteId,
            workspaceId,
            mimeType: draft.mimeType,
            sizeBytes: draft.sizeBytes,
            protocolVersion: attachmentProtocolVersion,
          },
        },
      });

      return created;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError("ATTACHMENT_STORAGE_CONFLICT", 500);
    }
    throw toApiError(error, "ATTACHMENT_METADATA_WRITE_FAILED");
  }
}

async function assertAttachmentIntentOwner(
  actorId: string,
  attachmentId: string,
  client: AttachmentDbClient = prisma,
): Promise<void> {
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
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== expectedSize) return false;
    const bytes = await handle.readFile();
    return createHashHex(new Uint8Array(bytes)) === expectedHash && isInside(uploadRoot, filePath);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** 补偿：仅删除本次新建的 staging 文件；删除失败保留稳定 failure code，不吞错误。 */
async function failIntentWithCompensation(
  attachmentId: string,
  failurePhase: string,
  failureCode: string,
  stagingFilePath: string,
  hooks?: AttachmentProtocolHooks,
): Promise<void> {
  await markIntentFailed(attachmentId, failurePhase, failureCode);
  try {
    if (hooks?.compensationUnlink) {
      await hooks.compensationUnlink(stagingFilePath);
    } else {
      await rm(stagingFilePath, { force: true });
    }
  } catch {
    await prisma.attachment.updateMany({
      where: { id: attachmentId, status: "FAILED", failurePhase, protocolVersion: attachmentProtocolVersion },
      data: { failureCode: `${failureCode}_STAGING_CLEANUP_FAILED` },
    }).catch(() => undefined);
  }
}

async function markIntentFailed(attachmentId: string, failurePhase: string, failureCode: string): Promise<void> {
  await prisma.attachment.updateMany({
    where: { id: attachmentId, status: "PENDING", protocolVersion: attachmentProtocolVersion },
    data: { status: "FAILED", failureCode, failurePhase },
  }).catch(() => undefined);
}

async function assertNoteExists(noteId: string, actorId: string): Promise<string> {
  const workspace = await resolveActiveWorkspace(actorId);
  const note = await prisma.note.findFirst({
    where: { id: noteId, subject: { workspaceId: workspace.id } },
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
