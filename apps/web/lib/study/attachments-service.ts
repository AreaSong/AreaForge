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
  createUploadPolicy,
  defaultAllowedUploadMimeTypes,
  parseAllowedUploadMimeTypes,
  parseAttachmentUri,
  stagingDirectoryName,
  type BoundedFileScan,
} from "@areaforge/storage";
import { getAuthEnv } from "@/lib/auth/env";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { AttachmentDto } from "./types";

/**
 * OPS-007 附件写入意图协议：
 * PENDING intent（无文件）→ .staging 独占写入 + fsync → 同文件系统原子 rename + 目录 fsync
 * → 重新打开校验 hash/size → READY CAS。所有文件 IO 都在数据库事务之外。
 * 失败路径保留 PENDING/FAILED 记录与稳定 failure code，不静默删除可能已被确认的 final 文件。
 */

export interface CreateNoteAttachmentInput {
  noteId: string;
  scan: BoundedFileScan;
}

export interface AttachmentDownload {
  bytes: Uint8Array;
  headers: Record<string, string>;
}

export const attachmentProtocolVersion = 1;

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
  await assertNoteExists(input.noteId);

  const env = getAuthEnv();
  const policy = createUploadPolicy(env.MAX_UPLOAD_MB, parseAllowedUploadMimeTypes(env.ALLOWED_UPLOAD_MIME));
  const draftResult = createAttachmentMetadataDraftFromScan({
    sizeBytes: input.scan.sizeBytes,
    sha256Hex: input.scan.sha256Hex,
    detectedMimeType: input.scan.detectedMimeType,
    declaredMimeType: input.scan.declaredMimeType,
    originalName: input.scan.originalName,
    randomId: hooks?.storageId?.() ?? createStorageId(),
    policy,
  });

  if (!draftResult.ok) {
    throw uploadValidationError(draftResult.validation.reason);
  }

  const draft = draftResult.draft;
  const stagingName = createStagingAttachmentName(draft.storedName);
  const finalPath = getSafeAttachmentPath(env.UPLOAD_DIR, draft.storedName);
  const stagingPath = getSafeStagingPath(env.UPLOAD_DIR, stagingName);

  await mkdir(finalPath.uploadRoot, { recursive: true });
  await mkdir(path.dirname(stagingPath.filePath), { recursive: true });
  await assertResolvedUploadRoot(finalPath.uploadRoot);

  // 步骤 2：先在事务内落 PENDING 写入意图；此时不存在任何文件，唯一冲突发生在文件写入之前。
  const intent = await createPendingIntent(input.noteId, draft, stagingName, actorId);

  // 步骤 3-5：文件 IO 全部在事务外。
  try {
    await hooks?.beforeStagingWrite?.();
    await writeStagingFileDurably(stagingPath.filePath, input.scan.bytes);
    await hooks?.afterStagingWrite?.();
  } catch (error) {
    await failIntentWithCompensation(intent.id, "staging_write", "STAGING_WRITE_FAILED", stagingPath.filePath, hooks);
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }

  try {
    await hooks?.beforeAtomicRename?.();
    await rename(stagingPath.filePath, finalPath.filePath);
    await fsyncDirectory(finalPath.uploadRoot);
    await hooks?.afterAtomicRename?.();
  } catch (error) {
    await failIntentWithCompensation(intent.id, "atomic_rename", "ATOMIC_RENAME_FAILED", stagingPath.filePath, hooks);
    throw toApiError(error, "ATTACHMENT_WRITE_FAILED");
  }

  // 步骤 6：重新打开 final 文件校验 hash/size；mismatch 保留 final 文件与 FAILED 记录，不自动删除。
  const verified = await verifyFinalFile(finalPath.uploadRoot, finalPath.filePath, draft.hash, draft.sizeBytes);
  if (!verified) {
    await markIntentFailed(intent.id, "post_rename_verify", "INTEGRITY_MISMATCH");
    throw new ApiError("ATTACHMENT_WRITE_FAILED", 500);
  }

  // 步骤 7：READY CAS；失败时保留 PENDING 与 final 文件，交给显式 reconciliation。
  await hooks?.beforeReadyCas?.();
  const finalized = await prisma.attachment.updateMany({
    where: {
      id: intent.id,
      status: "PENDING",
      protocolVersion: attachmentProtocolVersion,
      updatedAt: intent.updatedAt,
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
  if (finalized.count !== 1) {
    throw new ApiError("ATTACHMENT_RECONCILIATION_REQUIRED", 500);
  }

  const attachment = await prisma.attachment.findUniqueOrThrow({
    where: { id: intent.id },
    select: attachmentDtoSelect,
  });
  return serializeAttachment(attachment);
}

export async function getAttachmentDownload(
  id: string,
  disposition: "attachment" | "inline" = "attachment",
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
    },
  });

  if (!attachment || !attachment.noteId) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  }
  if (attachment.status !== "READY") {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }
  const inlineAllowed = defaultAllowedUploadMimeTypes.some((mimeType) => mimeType === attachment.mimeType);
  if (disposition === "inline" && !inlineAllowed) {
    throw new ApiError("ATTACHMENT_INVALID_DISPOSITION", 400);
  }

  const storedName = parseAttachmentUri(attachment.uri);
  if (!storedName) {
    throw new ApiError("ATTACHMENT_URI_INVALID", 500);
  }

  const env = getAuthEnv();
  const safePath = getSafeAttachmentPath(env.UPLOAD_DIR, storedName);
  await assertResolvedUploadRoot(safePath.uploadRoot);

  // O_NOFOLLOW 打开后基于同一句柄 fstat、读取和校验，消除 lstat/readFile TOCTOU。
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
    // 报告型拒绝：不修改历史 row，等显式 reconciliation 标记 needs_attention。
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

async function createPendingIntent(
  noteId: string,
  draft: { originalName: string; storedName: string; mimeType: string; sizeBytes: number; hash: string; uri: string },
  stagingName: string,
  actorId: string,
): Promise<{ id: string; updatedAt: Date }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          noteId,
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
            noteId,
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

async function assertNoteExists(noteId: string): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true },
  });

  if (!note) {
    throw new ApiError("NOTE_NOT_FOUND", 404);
  }
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
