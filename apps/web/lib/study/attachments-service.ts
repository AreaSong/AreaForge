import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import {
  createAttachmentMetadataDraft,
  createAttachmentResponseHeaders,
  createSafeAttachmentFilePath,
  createUploadPolicy,
  defaultAllowedUploadMimeTypes,
  parseAllowedUploadMimeTypes,
  parseAttachmentUri,
} from "@areaforge/storage";
import { getAuthEnv } from "@/lib/auth/env";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { AttachmentDto } from "./types";

export interface CreateNoteAttachmentInput {
  noteId: string;
  file: File;
}

export interface AttachmentDownload {
  bytes: Uint8Array;
  headers: Record<string, string>;
}

const publicUploadRoots = [
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "apps/web/public"),
];

export async function createNoteAttachment(
  input: CreateNoteAttachmentInput,
  actorId: string,
): Promise<AttachmentDto> {
  await assertNoteExists(input.noteId);

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const env = getAuthEnv();
  const policy = createUploadPolicy(env.MAX_UPLOAD_MB, parseAllowedUploadMimeTypes(env.ALLOWED_UPLOAD_MIME));
  const draftResult = createAttachmentMetadataDraft({
    bytes,
    declaredMimeType: input.file.type || null,
    originalName: input.file.name,
    randomId: createStorageId(),
    policy,
  });

  if (!draftResult.ok) {
    throw uploadValidationError(draftResult.validation.reason);
  }

  const safePath = getSafeAttachmentPath(env.UPLOAD_DIR, draftResult.draft.storedName);
  let wroteFile = false;
  try {
    await mkdir(safePath.uploadRoot, { recursive: true });
    await assertResolvedUploadRoot(safePath.uploadRoot);
    await writeFile(safePath.filePath, bytes, { flag: "wx" });
    wroteFile = true;
    await assertResolvedAttachmentPath(safePath.uploadRoot, safePath.filePath);
  } catch (error) {
    if (wroteFile) {
      await removeBestEffort(safePath.filePath);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError("ATTACHMENT_WRITE_FAILED", 500);
  }

  try {
    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          noteId: input.noteId,
          originalName: draftResult.draft.originalName,
          storedName: draftResult.draft.storedName,
          mimeType: draftResult.draft.mimeType,
          sizeBytes: draftResult.draft.sizeBytes,
          hash: draftResult.draft.hash,
          uri: draftResult.draft.uri,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "ATTACHMENT_CREATED",
          entityType: "Attachment",
          entityId: created.id,
          metadata: {
            noteId: input.noteId,
            mimeType: created.mimeType,
            sizeBytes: created.sizeBytes,
            hash: created.hash,
          },
        },
      });

      return created;
    });

    return serializeAttachment(attachment);
  } catch (error) {
    await removeBestEffort(safePath.filePath);
    if (error instanceof ApiError) throw error;
    throw new ApiError("ATTACHMENT_METADATA_WRITE_FAILED", 500);
  }
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
      createdAt: true,
    },
  });

  if (!attachment || !attachment.noteId) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
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

  let bytes: Uint8Array;
  try {
    await assertResolvedAttachmentPath(safePath.uploadRoot, safePath.filePath);
    bytes = new Uint8Array(await readFile(safePath.filePath));
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new ApiError("ATTACHMENT_FILE_MISSING", 404);
    }
    throw error;
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

export function serializeAttachment(attachment: {
  id: string;
  noteId?: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  createdAt: Date;
}): AttachmentDto {
  return {
    id: attachment.id,
    noteId: attachment.noteId ?? null,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    hash: attachment.hash,
    downloadApiPath: `/api/attachments/${attachment.id}`,
    createdAt: attachment.createdAt.toISOString(),
  };
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

async function assertResolvedAttachmentPath(uploadRoot: string, filePath: string): Promise<void> {
  const stat = await lstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new ApiError("UPLOAD_DIR_UNSAFE", 500);
  }

  const resolvedFilePath = await realpath(filePath);
  if (!isInside(uploadRoot, resolvedFilePath)) {
    throw new ApiError("UPLOAD_DIR_UNSAFE", 500);
  }
}

async function removeBestEffort(filePath: string): Promise<void> {
  await rm(filePath, { force: true }).catch(() => undefined);
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

function getSafeAttachmentPath(uploadDir: string, storedName: string) {
  try {
    return createSafeAttachmentFilePath(uploadDir, storedName, {
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
