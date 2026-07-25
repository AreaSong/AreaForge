import { createHash } from "node:crypto";
import {
  canonicalizeHttpsUrl,
  createStableKey,
} from "@areaforge/core";
import {
  STUDY_RESOURCE_MAX_FILES_PER_BATCH,
  createStudyResourceUploadPolicy,
  isInlinePreviewAllowed,
  parseSingleFileMultipart,
  parseMultipleFilesMultipart,
  preferredDownloadDisposition,
  type BoundedFileScan,
} from "@areaforge/storage";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import {
  finalizeWorkspaceAttachment,
  discardUnboundAttachment,
  getAttachmentDownload,
  stageWorkspaceAttachment,
  type AttachmentDownload,
} from "./attachments-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import type { AttachmentDto } from "./types";

export type StudyResourceOrganizeStatus = "UNSORTED" | "READY_FOR_USE" | "ARCHIVED";

const RESOURCE_CATEGORIES = [
  "TEXTBOOK",
  "COURSE",
  "EXERCISE",
  "PAST_PAPER",
  "SOLUTION",
  "SUMMARY",
  "IMAGE",
  "OTHER",
] as const;
type StudyResourceCategoryValue = (typeof RESOURCE_CATEGORIES)[number];

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
  taskIds: string[];
  noteIds: string[];
  mistakeIds: string[];
  syllabusNodeIds: string[];
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

export interface StudyResourceEditorOptionsDto {
  subjects: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; title: string }>;
  notes: Array<{ id: string; title: string }>;
  mistakes: Array<{ id: string; title: string }>;
  syllabusNodes: Array<{ id: string; title: string }>;
}

const resourceInclude = {
  tags: true,
  taskLinks: { select: { taskId: true } },
  noteLinks: { select: { noteId: true } },
  mistakeLinks: { select: { mistakeId: true } },
  syllabusNodeLinks: { select: { syllabusNodeId: true } },
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
  const hasAssociation = Boolean(
    row.subjectId ||
    row.tags.length ||
    row.taskLinks.length ||
    row.noteLinks.length ||
    row.mistakeLinks.length ||
    row.syllabusNodeLinks.length,
  );
  if (!hasAssociation) return "UNSORTED";
  if (row.sourceType === "FILE" && (!row.attachment || row.attachment.status !== "READY")) return "UNSORTED";
  if (row.sourceType === "LINK" && (!row.externalUrl || !row.displayHost)) return "UNSORTED";
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
    taskIds: row.taskLinks.map((link) => link.taskId),
    noteIds: row.noteLinks.map((link) => link.noteId),
    mistakeIds: row.mistakeLinks.map((link) => link.mistakeId),
    syllabusNodeIds: row.syllabusNodeLinks.map((link) => link.syllabusNodeId),
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

export async function getStudyResourceEditorOptions(actorId: string): Promise<StudyResourceEditorOptionsDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [subjects, tasks, notes, mistakes, syllabusNodes] = await Promise.all([
    prisma.subject.findMany({
      where: { workspaceId: workspace.id, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.studyTask.findMany({
      where: { subject: { workspaceId: workspace.id }, status: { notIn: ["DONE", "SKIPPED"] } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.note.findMany({
      where: { subject: { workspaceId: workspace.id }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.mistake.findMany({
      where: { subject: { workspaceId: workspace.id }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.syllabusNode.findMany({
      where: { subject: { workspaceId: workspace.id }, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      take: 500,
      select: { id: true, title: true },
    }),
  ]);
  return { subjects, tasks, notes, mistakes, syllabusNodes };
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
          category: normalizeCategory(input.category),
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

  const attachment = await stageWorkspaceAttachment({ scan }, actorId);
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "STUDY_RESOURCE_UPLOAD_STAGED",
      entityType: "Attachment",
      entityId: attachment.id,
      metadata: { workspaceId: workspace.id },
    },
  });
  const staged = await prisma.attachment.findUniqueOrThrow({
    where: { id: attachment.id },
    select: { hash: true, status: true },
  });
  if (staged.status !== "PENDING" && staged.status !== "READY") {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }

  const duplicates = await prisma.studyResource.findMany({
    where: {
      workspaceId: workspace.id,
      sourceType: "FILE",
      attachment: { hash: staged.hash, status: "READY" },
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
      hash: row.attachment?.hash ?? staged.hash,
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
    taskIds?: string[];
    noteIds?: string[];
    mistakeIds?: string[];
    syllabusNodeIds?: string[];
  },
): Promise<StudyResourceDto | { skipped: true }> {
  const workspace = await resolveActiveWorkspace(actorId);
  const requestFingerprint = studyResourceResolutionFingerprint(input);
  const priorResolution = await findResolvedUpload(actorId, input.attachmentId);
  if (priorResolution) {
    const requestChanged = priorResolution.requestFingerprint
      ? priorResolution.requestFingerprint !== requestFingerprint
      : priorResolution.decision !== input.decision || (input.decision === "reuse" && priorResolution.resourceId !== input.reuseResourceId);
    if (requestChanged) {
      throw new ApiError("STUDY_RESOURCE_UPLOAD_DECISION_CONFLICT", 409, {
        latest: { decision: priorResolution.decision, resourceId: priorResolution.resourceId ?? null },
        conflictFields: ["decision"],
      });
    }
    if (priorResolution.decision === "skip") return { skipped: true };
    if (priorResolution.resourceId) return serialize(await loadResource(workspace.id, priorResolution.resourceId));
  }

  const attachment = await prisma.attachment.findUnique({
    where: { id: input.attachmentId },
    include: {
      studyResource: true,
      note: { select: { subject: { select: { workspaceId: true } } } },
    },
  });
  if (!attachment || !["PENDING", "READY"].includes(attachment.status)) {
    throw new ApiError("ATTACHMENT_NOT_READY", 409);
  }
  await assertAttachmentOwnedByActor(actorId, workspace.id, attachment);
  if (attachment.studyResource) {
    return serialize(await loadResource(workspace.id, attachment.studyResource.id));
  }

  if (input.decision === "skip") {
    await discardUnboundAttachment(actorId, attachment.id);
    await markStudyResourceUploadResolved(actorId, attachment.id, "skip", undefined, requestFingerprint);
    return { skipped: true };
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
    let result = serialize(existing);
    const hasAssociationUpdate = Boolean(
      input.subjectId !== undefined ||
      input.category !== undefined ||
      input.tags !== undefined ||
      input.taskIds !== undefined ||
      input.noteIds !== undefined ||
      input.mistakeIds !== undefined ||
      input.syllabusNodeIds !== undefined,
    );
    if (hasAssociationUpdate) {
      result = await updateStudyResource(actorId, existing.id, {
        subjectId: input.subjectId,
        category: input.category,
        tags: input.tags,
        taskIds: input.taskIds,
        noteIds: input.noteIds,
        mistakeIds: input.mistakeIds,
        syllabusNodeIds: input.syllabusNodeIds,
        expectedRevision: existing.revision,
      });
    }
    await discardUnboundAttachment(actorId, attachment.id);
    await markStudyResourceUploadResolved(actorId, attachment.id, "reuse", result.id, requestFingerprint);
    return result;
  }

  // copy: finalize the staged file only after the user has explicitly chosen
  // the duplicate policy, then bind it to a new StudyResource.
  if (attachment.status === "PENDING") {
    await finalizeWorkspaceAttachment(actorId, attachment.id);
  }
  const finalizedAttachment = await prisma.attachment.findUniqueOrThrow({
    where: { id: attachment.id },
    select: {
      id: true,
      hash: true,
      mimeType: true,
      originalName: true,
      status: true,
    },
  });
  if (finalizedAttachment.status !== "READY") throw new ApiError("ATTACHMENT_NOT_READY", 409);
  if (input.subjectId) await assertSubjectInWorkspace(workspace.id, input.subjectId);
  const title = (input.title ?? finalizedAttachment.originalName).trim();
  const stableKey =
    input.stableKey?.trim() || createStableKey("resource", `${workspace.id}:${finalizedAttachment.hash}:${Date.now()}`);

  const duplicateOf = await prisma.studyResource.findFirst({
    where: {
      workspaceId: workspace.id,
      sourceType: "FILE",
      attachment: { hash: finalizedAttachment.hash },
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
          category: normalizeCategory(input.category),
          sourceType: "FILE",
          subjectId: input.subjectId ?? null,
          attachmentId: finalizedAttachment.id,
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
            mimeType: finalizedAttachment.mimeType,
          },
        },
      });
      return row;
    });
    await markStudyResourceUploadResolved(actorId, finalizedAttachment.id, "copy", created.id, requestFingerprint);
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

/**
 * Returns actor-owned, unbound uploads so a page refresh or a lost response
 * can resume the duplicate decision. The result intentionally contains only
 * the public attachment DTO and duplicate summaries, never storage identity.
 */
export async function listStagedStudyResourceUploads(actorId: string): Promise<StagingUploadResult[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [createdEvents, resolvedEvents] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        actorId,
        action: { in: ["ATTACHMENT_INTENT_CREATED", "STUDY_RESOURCE_UPLOAD_STAGED"] },
        entityType: "Attachment",
        entityId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { entityId: true },
    }),
    prisma.auditEvent.findMany({
      where: { actorId, action: "STUDY_RESOURCE_UPLOAD_RESOLVED", entityType: "Attachment", entityId: { not: null } },
      select: { entityId: true },
    }),
  ]);
  const resolvedIds = new Set(resolvedEvents.map((event) => event.entityId).filter((id): id is string => Boolean(id)));
  const attachmentIds = Array.from(new Set(
    createdEvents
      .map((event) => event.entityId)
      .filter((id): id is string => typeof id === "string")
      .filter((id) => !resolvedIds.has(id)),
  ));
  if (!attachmentIds.length) return [];

  const attachments = await prisma.attachment.findMany({
    where: {
      id: { in: attachmentIds },
      noteId: null,
      status: { in: ["PENDING", "READY"] },
      studyResource: null,
    },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      hash: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!attachments.length) return [];
  const hashes = Array.from(new Set(attachments.map((attachment) => attachment.hash)));
  const duplicates = await prisma.studyResource.findMany({
    where: {
      workspaceId: workspace.id,
      sourceType: "FILE",
      archivedAt: null,
      attachment: { hash: { in: hashes }, status: "READY" },
    },
    select: { id: true, stableKey: true, title: true, attachment: { select: { hash: true } } },
    take: 100,
  });
  const duplicatesByHash = new Map<string, StagingUploadResult["duplicates"]>();
  for (const duplicate of duplicates) {
    const hash = duplicate.attachment?.hash;
    if (!hash) continue;
    const bucket = duplicatesByHash.get(hash) ?? [];
    bucket.push({ resourceId: duplicate.id, stableKey: duplicate.stableKey, title: duplicate.title, hash });
    duplicatesByHash.set(hash, bucket);
  }
  return attachments.map((attachment) => ({
    attachment: {
      id: attachment.id,
      noteId: null,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      downloadApiPath: `/api/attachments/${attachment.id}`,
      createdAt: attachment.createdAt.toISOString(),
    },
    duplicates: duplicatesByHash.get(attachment.hash) ?? [],
  }));
}

async function markStudyResourceUploadResolved(
  actorId: string,
  attachmentId: string,
  decision: "reuse" | "copy" | "skip",
  resourceId?: string,
  requestFingerprint?: string,
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "STUDY_RESOURCE_UPLOAD_RESOLVED",
      entityType: "Attachment",
      entityId: attachmentId,
      metadata: { decision, ...(resourceId ? { resourceId } : {}), ...(requestFingerprint ? { requestFingerprint } : {}) },
    },
  });
}

async function findResolvedUpload(
  actorId: string,
  attachmentId: string,
): Promise<{ decision: "reuse" | "copy" | "skip"; resourceId?: string; requestFingerprint?: string } | null> {
  const event = await prisma.auditEvent.findFirst({
    where: { actorId, action: "STUDY_RESOURCE_UPLOAD_RESOLVED", entityType: "Attachment", entityId: attachmentId },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if (!event || !event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) return null;
  const metadata = event.metadata as { decision?: unknown; resourceId?: unknown; requestFingerprint?: unknown };
  if (metadata.decision !== "reuse" && metadata.decision !== "copy" && metadata.decision !== "skip") return null;
  return {
    decision: metadata.decision,
    resourceId: typeof metadata.resourceId === "string" ? metadata.resourceId : undefined,
    requestFingerprint: typeof metadata.requestFingerprint === "string" ? metadata.requestFingerprint : undefined,
  };
}

function studyResourceResolutionFingerprint(input: {
  decision: "reuse" | "copy" | "skip";
  reuseResourceId?: string;
  title?: string;
  subjectId?: string | null;
  category?: string;
  tags?: string[];
  stableKey?: string;
  taskIds?: string[];
  noteIds?: string[];
  mistakeIds?: string[];
  syllabusNodeIds?: string[];
}): string {
  const canonical = {
    decision: input.decision,
    reuseResourceId: input.reuseResourceId ?? null,
    title: input.title?.trim() ?? null,
    subjectId: input.subjectId ?? null,
    category: input.category ?? null,
    tags: input.tags ?? [],
    stableKey: input.stableKey?.trim() ?? null,
    taskIds: input.taskIds ?? [],
    noteIds: input.noteIds ?? [],
    mistakeIds: input.mistakeIds ?? [],
    syllabusNodeIds: input.syllabusNodeIds ?? [],
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function updateStudyResource(
  actorId: string,
  id: string,
  input: {
    title?: string;
    category?: string;
    subjectId?: string | null;
    tags?: string[];
    taskIds?: string[];
    noteIds?: string[];
    mistakeIds?: string[];
    syllabusNodeIds?: string[];
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
    await assertLinkTargetsInWorkspace(tx, workspace.id, input);
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
    await replaceResourceLinks(tx, id, input);
    return tx.studyResource.update({
      where: { id },
      data: {
        title: input.title?.trim(),
        category: input.category === undefined ? undefined : normalizeCategory(input.category),
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
    await replaceResourceLinks(tx, id, input);
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

async function replaceResourceLinks(
  tx: Prisma.TransactionClient,
  resourceId: string,
  input: { taskIds?: string[]; noteIds?: string[]; mistakeIds?: string[]; syllabusNodeIds?: string[] },
): Promise<void> {
  await replaceLinkSet(tx.studyResourceTaskLink, resourceId, "taskId", input.taskIds);
  await replaceLinkSet(tx.studyResourceNoteLink, resourceId, "noteId", input.noteIds);
  await replaceLinkSet(tx.studyResourceMistakeLink, resourceId, "mistakeId", input.mistakeIds);
  await replaceLinkSet(tx.studyResourceSyllabusNodeLink, resourceId, "syllabusNodeId", input.syllabusNodeIds);
}

async function replaceLinkSet(
  model: { deleteMany(args: unknown): Promise<unknown>; createMany(args: unknown): Promise<unknown> },
  resourceId: string,
  field: "taskId" | "noteId" | "mistakeId" | "syllabusNodeId",
  ids: string[] | undefined,
): Promise<void> {
  if (!ids) return;
  await model.deleteMany({ where: { resourceId } });
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length) {
    await model.createMany({
      data: uniqueIds.map((id) => ({ resourceId, [field]: id })),
      skipDuplicates: true,
    });
  }
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
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.studyResource.update({
      where: { id },
      data: { archivedAt: new Date(), revision: { increment: 1 } },
      include: resourceInclude,
    });
    await tx.reviewSchedule.updateMany({
      where: { workspaceId: workspace.id, studyResourceId: id, status: "ACTIVE" },
      data: { status: "PAUSED", dueDate: null, pausedReason: "TARGET_ARCHIVED", revision: { increment: 1 } },
    });
    return row;
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

export {
  createStudyResourceUploadPolicy,
  parseMultipleFilesMultipart,
  parseSingleFileMultipart,
  STUDY_RESOURCE_MAX_FILES_PER_BATCH,
};

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

function normalizeCategory(value: string | undefined): StudyResourceCategoryValue {
  return value && (RESOURCE_CATEGORIES as readonly string[]).includes(value)
    ? (value as StudyResourceCategoryValue)
    : "OTHER";
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
