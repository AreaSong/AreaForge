import {
  canonicalizeHttpsUrl,
  createStableKey,
} from "@areaforge/core";
import {
  STUDY_RESOURCE_MAX_FILES_PER_BATCH,
  createStudyResourceUploadPolicy,
  isInlinePreviewAllowed,
  parseSingleFileMultipart,
  preferredDownloadDisposition,
  type BoundedFileScan,
} from "@areaforge/storage";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import {
  createWorkspaceAttachment,
  getAttachmentDownload,
  type AttachmentDownload,
} from "./attachments-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import type { AttachmentDto } from "./types";

export type StudyResourceOrganizeStatus = "UNSORTED" | "READY_FOR_USE" | "ARCHIVED";

export interface StudyResourceDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  title: string;
  category: string;
  sourceType: "FILE" | "LINK";
  subjectId: string | null;
  attachmentId: string | null;
  externalUrl: string | null;
  displayHost: string | null;
  duplicateOfResourceId: string | null;
  revision: number;
  archivedAt: string | null;
  organizeStatus: StudyResourceOrganizeStatus;
  tags: string[];
  mimeType: string | null;
  originalName: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StagingUploadResult {
  attachment: AttachmentDto;
  duplicates: Array<{
    resourceId: string;
    stableKey: string;
    title: string;
    hash: string;
  }>;
}

const resourceInclude = {
  tags: true,
  attachment: {
    select: {
      id: true,
      mimeType: true,
      originalName: true,
      sizeBytes: true,
      status: true,
      hash: true,
    },
  },
} satisfies Prisma.StudyResourceInclude;

type ResourceRow = Prisma.StudyResourceGetPayload<{ include: typeof resourceInclude }>;

function deriveOrganizeStatus(row: ResourceRow): StudyResourceOrganizeStatus {
  if (row.archivedAt) return "ARCHIVED";
  if (!row.title.trim()) return "UNSORTED";
  if (row.sourceType === "FILE") {
    if (!row.attachment || row.attachment.status !== "READY") return "UNSORTED";
    return "READY_FOR_USE";
  }
  if (!row.externalUrl || !row.displayHost) return "UNSORTED";
  return "READY_FOR_USE";
}

function serialize(row: ResourceRow): StudyResourceDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    stableKey: row.stableKey,
    title: row.title,
    category: row.category,
    sourceType: row.sourceType,
    subjectId: row.subjectId,
    attachmentId: row.attachmentId,
    externalUrl: row.externalUrl,
    displayHost: row.displayHost,
    duplicateOfResourceId: row.duplicateOfResourceId,
    revision: row.revision,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    organizeStatus: deriveOrganizeStatus(row),
    tags: row.tags.map((tag) => tag.tagDisplay),
    mimeType: row.attachment?.mimeType ?? null,
    originalName: row.attachment?.originalName ?? null,
    sizeBytes: row.attachment?.sizeBytes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadResource(workspaceId: string, id: string): Promise<ResourceRow> {
  const row = await prisma.studyResource.findFirst({
    where: { id, workspaceId },
    include: resourceInclude,
  });
  if (!row) throw new ApiError("STUDY_RESOURCE_NOT_FOUND", 404);
  return row;
}

export async function listStudyResources(
  actorId: string,
  options?: { includeArchived?: boolean; subjectId?: string },
): Promise<StudyResourceDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.studyResource.findMany({
    where: {
      workspaceId: workspace.id,
      ...(options?.includeArchived ? {} : { archivedAt: null }),
      ...(options?.subjectId ? { subjectId: options.subjectId } : {}),
    },
    include: resourceInclude,
    orderBy: [{ updatedAt: "desc" }],
  });
  return rows.map(serialize);
}

export async function getStudyResource(actorId: string, id: string): Promise<StudyResourceDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  return serialize(await loadResource(workspace.id, id));
}

export async function createLinkStudyResource(
  actorId: string,
  input: {
    title: string;
    url: string;
    subjectId?: string | null;
    category?: string;
    stableKey?: string;
    tags?: string[];
  },
): Promise<StudyResourceDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const urlResult = canonicalizeHttpsUrl(input.url);
  if (!urlResult.ok) {
    throw new ApiError("STUDY_RESOURCE_URL_INVALID", 400);
  }
  if (input.subjectId) {
    await assertSubjectInWorkspace(workspace.id, input.subjectId);
  }

  const stableKey = input.stableKey?.trim() || createStableKey("resource", `${workspace.id}:${urlResult.url}`);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.studyResource.create({
        data: {
          workspaceId: workspace.id,
          stableKey,
          title: input.title.trim(),
          category: (input.category as "OTHER") ?? "OTHER",
          sourceType: "LINK",
          subjectId: input.subjectId ?? null,
          externalUrl: urlResult.url,
          displayHost: urlResult.host,
          actorId,
          tags: input.tags?.length
            ? {
                create: input.tags.map((tag) => ({
                  tagNorm: normalizeTag(tag),
                  tagDisplay: tag.trim(),
                })),
              }
            : undefined,
        },
        include: resourceInclude,
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "STUDY_RESOURCE_LINK_CREATED",
          entityType: "StudyResource",
          entityId: row.id,
          metadata: { sourceType: "LINK", displayHost: urlResult.host },
        },
      });
      return row;
    });
    return serialize(created);
  } catch (error) {
    if (isUnique(error)) throw new ApiError("STUDY_RESOURCE_STABLE_KEY_CONFLICT", 409);
    throw error;
  }
}

export async function stageStudyResourceUpload(
  actorId: string,
  scan: BoundedFileScan,
): Promise<StagingUploadResult> {
  const workspace = await resolveActiveWorkspace(actorId);
  const policy = createStudyResourceUploadPolicy();
  if (!scan.detectedMimeType || !policy.allowedMimeTypes.includes(scan.detectedMimeType)) {
    throw new ApiError("ATTACHMENT_UNSUPPORTED_TYPE", 400);
  }

  const attachment = await createWorkspaceAttachment({ scan }, actorId);
  const ready = await prisma.attachment.findUniqueOrThrow({
    where: { id: attachment.id },
    select: { hash: true, status: true },
  });
  if (ready.status !== "READY") {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }

  const duplicates = await prisma.studyResource.findMany({
    where: {
      workspaceId: workspace.id,
      sourceType: "FILE",
      attachment: { hash: ready.hash, status: "READY" },
      archivedAt: null,
    },
    select: { id: true, stableKey: true, title: true, attachment: { select: { hash: true } } },
    take: 20,
  });

  return {
    attachment,
    duplicates: duplicates.map((row) => ({
      resourceId: row.id,
      stableKey: row.stableKey,
      title: row.title,
      hash: row.attachment?.hash ?? ready.hash,
    })),
  };
}

export async function resolveStudyResourceUpload(
  actorId: string,
  input: {
    attachmentId: string;
    decision: "reuse" | "copy" | "skip";
    reuseResourceId?: string;
    title?: string;
    subjectId?: string | null;
    category?: string;
    tags?: string[];
    stableKey?: string;
  },
): Promise<StudyResourceDto | { skipped: true }> {
  const workspace = await resolveActiveWorkspace(actorId);
  if (input.decision === "skip") {
    return { skipped: true };
  }

  const attachment = await prisma.attachment.findUnique({
    where: { id: input.attachmentId },
    include: {
      studyResource: true,
      note: { select: { subject: { select: { workspaceId: true } } } },
    },
  });
  if (!attachment || attachment.status !== "READY") {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }
  await assertAttachmentOwnedByActor(actorId, workspace.id, attachment);
  if (attachment.studyResource) {
    throw new ApiError("STUDY_RESOURCE_ATTACHMENT_BOUND", 409);
  }

  if (input.decision === "reuse") {
    if (!input.reuseResourceId) throw new ApiError("STUDY_RESOURCE_REUSE_REQUIRED", 400);
    const existing = await loadResource(workspace.id, input.reuseResourceId);
    if (existing.sourceType !== "FILE" || !existing.attachment) {
      throw new ApiError("STUDY_RESOURCE_REUSE_INVALID", 400);
    }
    if (existing.attachment.hash !== attachment.hash) {
      throw new ApiError("STUDY_RESOURCE_HASH_MISMATCH", 409);
    }
    return serialize(existing);
  }

  // copy: new StudyResource + same attachment binding (new attachment already uploaded)
  if (input.subjectId) await assertSubjectInWorkspace(workspace.id, input.subjectId);
  const title = (input.title ?? attachment.originalName).trim();
  const stableKey =
    input.stableKey?.trim() || createStableKey("resource", `${workspace.id}:${attachment.hash}:${Date.now()}`);

  const duplicateOf = await prisma.studyResource.findFirst({
    where: {
      workspaceId: workspace.id,
      sourceType: "FILE",
      attachment: { hash: attachment.hash },
      archivedAt: null,
    },
    select: { id: true },
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.studyResource.create({
        data: {
          workspaceId: workspace.id,
          stableKey,
          title,
          category: (input.category as never) ?? "OTHER",
          sourceType: "FILE",
          subjectId: input.subjectId ?? null,
          attachmentId: attachment.id,
          duplicateOfResourceId: duplicateOf?.id ?? null,
          actorId,
          tags: input.tags?.length
            ? {
                create: input.tags.map((tag) => ({
                  tagNorm: normalizeTag(tag),
                  tagDisplay: tag.trim(),
                })),
              }
            : undefined,
        },
        include: resourceInclude,
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "STUDY_RESOURCE_FILE_CREATED",
          entityType: "StudyResource",
          entityId: row.id,
          metadata: {
            sourceType: "FILE",
            duplicateOfResourceId: duplicateOf?.id ?? null,
            mimeType: attachment.mimeType,
          },
        },
      });
      return row;
    });
    return serialize(created);
  } catch (error) {
    if (isUnique(error)) throw new ApiError("STUDY_RESOURCE_STABLE_KEY_CONFLICT", 409);
    throw error;
  }
}

export async function createStudyResourceFromAttachment(
  actorId: string,
  input: {
    attachmentId: string;
    title?: string;
    subjectId?: string | null;
    category?: string;
    tags?: string[];
  },
): Promise<StudyResourceDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const attachment = await prisma.attachment.findUnique({
    where: { id: input.attachmentId },
    include: {
      studyResource: true,
      note: { select: { subject: { select: { workspaceId: true } } } },
    },
  });
  if (!attachment || attachment.status !== "READY") {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }
  if (attachment.studyResource) {
    throw new ApiError("STUDY_RESOURCE_ATTACHMENT_BOUND", 409);
  }
  const noteWorkspaceId = attachment.note?.subject.workspaceId ?? null;
  if (attachment.noteId && noteWorkspaceId && noteWorkspaceId !== workspace.id) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  }

  return resolveStudyResourceUpload(actorId, {
    attachmentId: attachment.id,
    decision: "copy",
    title: input.title,
    subjectId: input.subjectId,
    category: input.category,
    tags: input.tags,
  }) as Promise<StudyResourceDto>;
}

export async function updateStudyResource(
  actorId: string,
  id: string,
  input: {
    title?: string;
    category?: string;
    subjectId?: string | null;
    tags?: string[];
    expectedRevision: number;
  },
): Promise<StudyResourceDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await loadResource(workspace.id, id);
  if (existing.revision !== input.expectedRevision) {
    throw new ApiError("STUDY_RESOURCE_REVISION_CONFLICT", 409, {
      latest: { revision: existing.revision },
    });
  }
  if (input.subjectId) await assertSubjectInWorkspace(workspace.id, input.subjectId);

  const updated = await prisma.$transaction(async (tx) => {
    if (input.tags) {
      await tx.studyResourceTag.deleteMany({ where: { resourceId: id } });
      if (input.tags.length > 0) {
        await tx.studyResourceTag.createMany({
          data: input.tags.map((tag) => ({
            resourceId: id,
            tagNorm: normalizeTag(tag),
            tagDisplay: tag.trim(),
          })),
        });
      }
    }
    return tx.studyResource.update({
      where: { id },
      data: {
        title: input.title?.trim(),
        category: input.category as never,
        subjectId: input.subjectId === undefined ? undefined : input.subjectId,
        revision: { increment: 1 },
      },
      include: resourceInclude,
    });
  });
  return serialize(updated);
}

export async function linkStudyResource(
  actorId: string,
  id: string,
  input: {
    taskIds?: string[];
    noteIds?: string[];
    mistakeIds?: string[];
    syllabusNodeIds?: string[];
  },
): Promise<StudyResourceDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  await loadResource(workspace.id, id);

  await prisma.$transaction(async (tx) => {
    await assertLinkTargetsInWorkspace(tx, workspace.id, input);

    if (input.taskIds) {
      await tx.studyResourceTaskLink.deleteMany({ where: { resourceId: id } });
      if (input.taskIds.length) {
        await tx.studyResourceTaskLink.createMany({
          data: input.taskIds.map((taskId) => ({ resourceId: id, taskId })),
          skipDuplicates: true,
        });
      }
    }
    if (input.noteIds) {
      await tx.studyResourceNoteLink.deleteMany({ where: { resourceId: id } });
      if (input.noteIds.length) {
        await tx.studyResourceNoteLink.createMany({
          data: input.noteIds.map((noteId) => ({ resourceId: id, noteId })),
          skipDuplicates: true,
        });
      }
    }
    if (input.mistakeIds) {
      await tx.studyResourceMistakeLink.deleteMany({ where: { resourceId: id } });
      if (input.mistakeIds.length) {
        await tx.studyResourceMistakeLink.createMany({
          data: input.mistakeIds.map((mistakeId) => ({ resourceId: id, mistakeId })),
          skipDuplicates: true,
        });
      }
    }
    if (input.syllabusNodeIds) {
      await tx.studyResourceSyllabusNodeLink.deleteMany({ where: { resourceId: id } });
      if (input.syllabusNodeIds.length) {
        await tx.studyResourceSyllabusNodeLink.createMany({
          data: input.syllabusNodeIds.map((syllabusNodeId) => ({ resourceId: id, syllabusNodeId })),
          skipDuplicates: true,
        });
      }
    }
    await tx.studyResource.update({
      where: { id },
      data: { revision: { increment: 1 } },
    });
  });

  return serialize(await loadResource(workspace.id, id));
}

async function assertAttachmentOwnedByActor(
  actorId: string,
  workspaceId: string,
  attachment: {
    id: string;
    noteId: string | null;
    note: { subject: { workspaceId: string | null } } | null;
  },
): Promise<void> {
  if (attachment.noteId) {
    if (attachment.note?.subject.workspaceId !== workspaceId) {
      throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
    }
    return;
  }

  const intent = await prisma.auditEvent.findFirst({
    where: {
      actorId,
      action: "ATTACHMENT_INTENT_CREATED",
      entityType: "Attachment",
      entityId: attachment.id,
    },
    select: { id: true },
  });
  if (!intent) throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
}

async function assertLinkTargetsInWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: {
    taskIds?: string[];
    noteIds?: string[];
    mistakeIds?: string[];
    syllabusNodeIds?: string[];
  },
): Promise<void> {
  const checks = await Promise.all([
    countOwnedIds(input.taskIds, (ids) =>
      tx.studyTask.count({ where: { id: { in: ids }, subject: { workspaceId } } }),
    ),
    countOwnedIds(input.noteIds, (ids) =>
      tx.note.count({ where: { id: { in: ids }, subject: { workspaceId } } }),
    ),
    countOwnedIds(input.mistakeIds, (ids) =>
      tx.mistake.count({ where: { id: { in: ids }, subject: { workspaceId } } }),
    ),
    countOwnedIds(input.syllabusNodeIds, (ids) =>
      tx.syllabusNode.count({ where: { id: { in: ids }, subject: { workspaceId } } }),
    ),
  ]);
  if (checks.some((valid) => !valid)) {
    throw new ApiError("STUDY_RESOURCE_LINK_TARGET_NOT_FOUND", 404);
  }
}

async function countOwnedIds(
  ids: string[] | undefined,
  count: (uniqueIds: string[]) => Promise<number>,
): Promise<boolean> {
  if (!ids) return true;
  const uniqueIds = [...new Set(ids)];
  return (await count(uniqueIds)) === uniqueIds.length;
}

export async function archiveStudyResource(actorId: string, id: string): Promise<StudyResourceDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  await loadResource(workspace.id, id);
  const updated = await prisma.studyResource.update({
    where: { id },
    data: { archivedAt: new Date(), revision: { increment: 1 } },
    include: resourceInclude,
  });
  return serialize(updated);
}

export async function restoreStudyResource(actorId: string, id: string): Promise<StudyResourceDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  await loadResource(workspace.id, id);
  const updated = await prisma.studyResource.update({
    where: { id },
    data: { archivedAt: null, revision: { increment: 1 } },
    include: resourceInclude,
  });
  return serialize(updated);
}

export async function downloadStudyResource(
  actorId: string,
  id: string,
  disposition?: "attachment" | "inline",
): Promise<AttachmentDownload> {
  const workspace = await resolveActiveWorkspace(actorId);
  const resource = await loadResource(workspace.id, id);
  if (resource.sourceType !== "FILE" || !resource.attachmentId) {
    throw new ApiError("STUDY_RESOURCE_NOT_FILE", 400);
  }
  const mimeType = resource.attachment?.mimeType ?? "application/octet-stream";
  const resolvedDisposition =
    disposition ?? preferredDownloadDisposition(mimeType);
  if (resolvedDisposition === "inline" && !isInlinePreviewAllowed(mimeType)) {
    throw new ApiError("ATTACHMENT_INVALID_DISPOSITION", 400);
  }
  return getAttachmentDownload(resource.attachmentId, resolvedDisposition, actorId);
}

export function assertBatchFileLimit(count: number): void {
  if (count < 1 || count > STUDY_RESOURCE_MAX_FILES_PER_BATCH) {
    throw new ApiError("STUDY_RESOURCE_BATCH_LIMIT", 400);
  }
}

export { createStudyResourceUploadPolicy, parseSingleFileMultipart, STUDY_RESOURCE_MAX_FILES_PER_BATCH };

async function assertSubjectInWorkspace(workspaceId: string, subjectId: string): Promise<void> {
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, workspaceId },
    select: { id: true },
  });
  if (!subject) throw new ApiError("SUBJECT_NOT_FOUND", 404);
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().slice(0, 64);
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
