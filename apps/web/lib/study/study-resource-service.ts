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
  cleanupDiscardedAttachmentFiles,
  finalizeWorkspaceAttachment,
  getAttachmentDownload,
  markUnboundAttachmentDiscarded,
  stageWorkspaceAttachment,
  type AttachmentDownload,
  type DiscardedAttachmentCleanup,
} from "./attachments-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import type { AttachmentDto } from "./types";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  type PersistentCreateCommand,
} from "./persistent-idempotency";

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
  }>;
}

export interface StudyResourceUploadBatchItem {
  index: number;
  originalName: string;
  staging: StagingUploadResult | null;
  error: string | null;
}

interface StudyResourceUploadResolutionInput {
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
}

type StudyResourceUploadDecision = StudyResourceUploadResolutionInput["decision"];

interface StudyResourceUploadResolutionSnapshot {
  attachmentId: string;
  decision: StudyResourceUploadDecision;
  reuseResourceId: string | null;
  title: string | null;
  subjectId: string | null;
  category: string | null;
  tags: string[];
  stableKey: string | null;
  taskIds: string[];
  noteIds: string[];
  mistakeIds: string[];
  syllabusNodeIds: string[];
}

interface ResolvedStudyResourceUpload {
  decision: StudyResourceUploadDecision;
  resourceId?: string;
  requestFingerprint?: string;
  requestSnapshot?: StudyResourceUploadResolutionSnapshot;
  workspaceId?: string;
}

interface StudyResourceResolutionOutcome {
  result: StudyResourceDto | { skipped: true };
  cleanup?: DiscardedAttachmentCleanup | null;
}

export interface StudyResourceEditorOptionsDto {
  subjects: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; title: string }>;
  notes: Array<{ id: string; title: string }>;
  mistakes: Array<{ id: string; title: string }>;
  syllabusNodes: Array<{ id: string; title: string }>;
}

const resourceInclude = {
  subject: { select: { archivedAt: true } },
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
type StudyResourceDbClient = typeof prisma | Prisma.TransactionClient;

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

async function loadResource(
  workspaceId: string,
  id: string,
  client: StudyResourceDbClient = prisma,
): Promise<ResourceRow> {
  const row = await client.studyResource.findFirst({
    where: { id, workspaceId },
    include: resourceInclude,
  });
  if (!row) throw new ApiError("STUDY_RESOURCE_NOT_FOUND", 404);
  return row;
}

export async function listStudyResources(
  actorId: string,
  options?: { includeArchived?: boolean; subjectId?: string; q?: string },
): Promise<StudyResourceDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const query = options?.q?.trim().slice(0, 120) || undefined;
  const rows = await prisma.studyResource.findMany({
    where: {
      workspaceId: workspace.id,
      ...(options?.includeArchived ? {} : { archivedAt: null }),
      ...(options?.subjectId ? { subjectId: options.subjectId } : {}),
      ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}),
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
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        status: { notIn: ["DONE", "SKIPPED"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.note.findMany({
      where: { subject: { workspaceId: workspace.id, archivedAt: null }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.mistake.findMany({
      where: { subject: { workspaceId: workspace.id, archivedAt: null }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.syllabusNode.findMany({
      where: { subject: { workspaceId: workspace.id, archivedAt: null }, archivedAt: null },
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
  const urlResult = canonicalizeHttpsUrl(input.url);
  if (!urlResult.ok) {
    throw new ApiError("STUDY_RESOURCE_URL_INVALID", 400);
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
      if (input.subjectId) {
        await assertSubjectInWorkspace(workspace.id, input.subjectId, tx);
      }
      const stableKey = input.stableKey?.trim() || createStableKey("resource", `${workspace.id}:${urlResult.url}`);
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
    if (isUnique(error)) {
      const workspace = await resolveActiveWorkspace(actorId);
      const conflictStableKey = input.stableKey?.trim() || createStableKey("resource", `${workspace.id}:${urlResult.url}`);
      const latest = await prisma.studyResource.findFirst({
        where: { workspaceId: workspace.id, stableKey: conflictStableKey },
        include: resourceInclude,
      });
      throw new ApiError("STUDY_RESOURCE_STABLE_KEY_CONFLICT", 409, {
        latest: latest ? serialize(latest) : { stableKey: conflictStableKey },
        conflictFields: ["stableKey"],
        workbench: "/knowledge/resources",
      });
    }
    throw error;
  }
}

export async function stageStudyResourceUploadBatch(
  actorId: string,
  scans: BoundedFileScan[],
  idempotencyKey: string,
): Promise<StudyResourceUploadBatchItem[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const command: PersistentCreateCommand = {
    actorId,
    workspaceId: workspace.id,
    action: "STUDY_RESOURCE_UPLOAD_BATCH_COMMAND",
    entityType: "StudyResourceUploadBatch",
    idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
    requestFingerprint: buildPersistentCreateFingerprint("study-resource-upload-batch-v1", {
      files: scans.map(uploadScanIdentity),
    }),
    conflictCode: "STUDY_RESOURCE_UPLOAD_BATCH_CONFLICT",
    pendingLeaseMs: 5 * 60 * 1000,
  };
  const claim = await prisma.$transaction((tx) => claimPersistentCreateCommand(tx, command));
  if (claim.state === "pending") {
    throw new ApiError("STUDY_RESOURCE_UPLOAD_BATCH_IN_PROGRESS", 409, {
      latest: { state: "pending" },
      conflictFields: ["idempotencyKey"],
      workbench: "/knowledge/resources",
    });
  }
  if (claim.state === "replayed") {
    const replay = readStudyResourceUploadBatchSnapshot(claim.replay.resultSnapshot);
    if (!replay) {
      throw new ApiError("STUDY_RESOURCE_UPLOAD_BATCH_RESULT_UNAVAILABLE", 409, {
        latest: { state: "completed" },
        conflictFields: ["idempotencyKey"],
        workbench: "/knowledge/resources",
      });
    }
    return replay;
  }

  const items: StudyResourceUploadBatchItem[] = [];
  for (const [index, scan] of scans.entries()) {
    if (scan.businessError === "too_large") {
      items.push({ index, originalName: scan.originalName, staging: null, error: "ATTACHMENT_TOO_LARGE" });
      continue;
    }
    try {
      items.push({
        index,
        originalName: scan.originalName,
        staging: await stageStudyResourceUploadItem(
          actorId,
          workspace.id,
          scan,
          claim.claimEventId,
          index,
          command.idempotencyKey,
        ),
        error: null,
      });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      items.push({
        index,
        originalName: scan.originalName,
        staging: null,
        error: apiError?.code ?? "STUDY_RESOURCE_UPLOAD_FAILED",
      });
    }
  }

  try {
    await prisma.$transaction((tx) => completePersistentCreateClaim(
      tx,
      command,
      claim.claimEventId,
      claim.claimEventId,
      { itemCount: items.length },
      studyResourceUploadBatchSnapshot(items),
    ));
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "STUDY_RESOURCE_UPLOAD_BATCH_CONFLICT_CLAIM_COMPLETED") throw error;
    const replay = await prisma.$transaction((tx) => findPersistentCreateReplay(tx, command));
    const snapshot = readStudyResourceUploadBatchSnapshot(replay?.resultSnapshot);
    if (!snapshot) throw error;
    return snapshot;
  }
  return items;
}

async function stageStudyResourceUploadItem(
  actorId: string,
  expectedWorkspaceId: string,
  scan: BoundedFileScan,
  batchClaimEventId: string,
  batchIndex: number,
  batchIdempotencyKey: string,
): Promise<StagingUploadResult> {
  const workspace = await resolveActiveWorkspace(actorId);
  if (workspace.id !== expectedWorkspaceId) {
    throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
      latest: { workspaceId: workspace.id },
      conflictFields: ["workspaceId"],
      workbench: "/settings/workspace",
    });
  }
  const policy = createStudyResourceUploadPolicy();
  if (!scan.detectedMimeType || !policy.allowedMimeTypes.includes(scan.detectedMimeType)) {
    throw new ApiError("ATTACHMENT_UNSUPPORTED_TYPE", 400);
  }

  const recovered = await findRecoverableBatchStaging(
    actorId,
    workspace.id,
    batchClaimEventId,
    batchIndex,
  );
  if (recovered) return recovered;

  const attachment = await stageWorkspaceAttachment({
    scan,
    workspaceId: workspace.id,
    intentMetadata: {
      purpose: "study-resource-upload",
      batchClaimEventId,
      batchIndex,
      batchIdempotencyKey,
      scanFingerprint: buildPersistentCreateFingerprint("study-resource-upload-item-v1", uploadScanIdentity(scan)),
    },
  }, actorId);
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
    throw new ApiError("ATTACHMENT_NOT_READY", 409, {
      latest: { id: attachment.id, status: staged.status },
      conflictFields: ["attachment.status"],
      workbench: "/knowledge/resources",
    });
  }

  const duplicates = await prisma.studyResource.findMany({
    where: {
      workspaceId: workspace.id,
      sourceType: "FILE",
      attachment: { hash: staged.hash, status: "READY" },
      archivedAt: null,
      OR: [{ subjectId: null }, { subject: { archivedAt: null } }],
    },
    select: { id: true, stableKey: true, title: true },
    take: 20,
  });

  return {
    attachment,
    duplicates: duplicates.map((row) => ({
      resourceId: row.id,
      stableKey: row.stableKey,
      title: row.title,
    })),
  };
}

async function findRecoverableBatchStaging(
  actorId: string,
  workspaceId: string,
  batchClaimEventId: string,
  batchIndex: number,
): Promise<StagingUploadResult | null> {
  const intent = await prisma.auditEvent.findFirst({
    where: {
      actorId,
      action: "ATTACHMENT_INTENT_CREATED",
      entityType: "Attachment",
      entityId: { not: null },
      AND: [
        { metadata: { path: ["workspaceId"], equals: workspaceId } },
        { metadata: { path: ["batchClaimEventId"], equals: batchClaimEventId } },
        { metadata: { path: ["batchIndex"], equals: batchIndex } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { entityId: true },
  });
  if (!intent?.entityId) return null;
  const attachment = await prisma.attachment.findFirst({
    where: {
      id: intent.entityId,
      noteId: null,
      status: { in: ["PENDING", "READY"] },
      studyResource: null,
    },
    select: {
      id: true,
      noteId: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      hash: true,
    },
  });
  if (!attachment) return null;
  const duplicates = await prisma.studyResource.findMany({
    where: {
      workspaceId,
      sourceType: "FILE",
      attachment: { hash: attachment.hash, status: "READY" },
      archivedAt: null,
      OR: [{ subjectId: null }, { subject: { archivedAt: null } }],
    },
    select: { id: true, stableKey: true, title: true },
    take: 20,
  });
  return {
    attachment: {
      id: attachment.id,
      noteId: attachment.noteId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      createdAt: attachment.createdAt.toISOString(),
      downloadApiPath: `/api/attachments/${attachment.id}`,
    },
    duplicates: duplicates.map((row) => ({
      resourceId: row.id,
      stableKey: row.stableKey,
      title: row.title,
    })),
  };
}

export async function resolveStudyResourceUpload(
  actorId: string,
  input: StudyResourceUploadResolutionInput,
): Promise<StudyResourceDto | { skipped: true }> {
  return resolveStudyResourceUploadInternal(actorId, input, true);
}

async function resolveStudyResourceUploadInternal(
  actorId: string,
  input: StudyResourceUploadResolutionInput,
  requireStagedWorkspace: boolean,
): Promise<StudyResourceDto | { skipped: true }> {
  const workspace = await resolveActiveWorkspace(actorId);
  const requestSnapshot = createStudyResourceResolutionSnapshot(input);
  const requestFingerprint = studyResourceResolutionFingerprint(requestSnapshot);
  const outcome = input.decision === "copy"
    ? await resolveCopyStudyResourceUpload(
        actorId,
        workspace.id,
        input,
        requestSnapshot,
        requestFingerprint,
        requireStagedWorkspace,
      )
    : await resolveDiscardingStudyResourceUpload(
        actorId,
        workspace.id,
        input,
        requestSnapshot,
        requestFingerprint,
        requireStagedWorkspace,
      );
  if (outcome.cleanup) await cleanupDiscardedAttachmentFiles(outcome.cleanup);
  return outcome.result;
}

async function resolveDiscardingStudyResourceUpload(
  actorId: string,
  expectedWorkspaceId: string,
  input: StudyResourceUploadResolutionInput,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
  requestFingerprint: string,
  requireStagedWorkspace: boolean,
): Promise<StudyResourceResolutionOutcome> {
  return prisma.$transaction(async (tx) => {
    await lockStudyResourceUploadResolution(tx, actorId, input.attachmentId);
    const workspace = await assertResolutionWorkspace(tx, actorId, expectedWorkspaceId);
    const prior = await resolvePriorStudyResourceUpload(tx, actorId, workspace.id, input, requestSnapshot, requestFingerprint);
    if (prior) return prior;
    const attachment = await loadReadyResolutionAttachment(tx, input.attachmentId);
    await assertAttachmentOwnedByActor(actorId, workspace.id, attachment, { client: tx, requireStagedWorkspace });
    if (attachment.studyResource) return { result: serialize(await loadResource(workspace.id, attachment.studyResource.id, tx)) };
    if (input.decision === "skip") {
      const cleanup = await markUnboundAttachmentDiscarded(actorId, attachment.id, tx);
      await markStudyResourceUploadResolved(actorId, workspace.id, attachment.id, "skip", undefined, requestFingerprint, requestSnapshot, tx);
      return { result: { skipped: true }, cleanup };
    }
    return resolveReuseStudyResourceUpload(tx, actorId, workspace.id, attachment, input, requestSnapshot, requestFingerprint);
  });
}

async function resolveReuseStudyResourceUpload(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  attachment: Awaited<ReturnType<typeof loadReadyResolutionAttachment>>,
  input: StudyResourceUploadResolutionInput,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
  requestFingerprint: string,
): Promise<StudyResourceResolutionOutcome> {
  if (!input.reuseResourceId) throw new ApiError("STUDY_RESOURCE_REUSE_REQUIRED", 400);
  const existing = await loadResource(workspaceId, input.reuseResourceId, tx);
  const latest = serialize(existing);
  if (existing.subject?.archivedAt) throw subjectArchivedError(latest);
  if (existing.sourceType !== "FILE" || !existing.attachment) throw new ApiError("STUDY_RESOURCE_REUSE_INVALID", 400);
  if (existing.attachment.hash !== attachment.hash) {
    throw new ApiError("STUDY_RESOURCE_HASH_MISMATCH", 409, {
      latest: { attachment: resolutionAttachmentLatest(attachment), resource: latest },
      conflictFields: ["reuseResourceId", "attachmentHash"],
      workbench: "/knowledge/resources",
    });
  }
  const row = hasResourceAssociationUpdate(input)
    ? await updateStudyResourceInTransaction(tx, actorId, workspaceId, existing.id, {
        subjectId: input.subjectId,
        category: input.category,
        tags: input.tags,
        taskIds: input.taskIds,
        noteIds: input.noteIds,
        mistakeIds: input.mistakeIds,
        syllabusNodeIds: input.syllabusNodeIds,
        expectedRevision: existing.revision,
      })
    : existing;
  const cleanup = await markUnboundAttachmentDiscarded(actorId, attachment.id, tx);
  await markStudyResourceUploadResolved(actorId, workspaceId, attachment.id, "reuse", row.id, requestFingerprint, requestSnapshot, tx);
  return { result: serialize(row), cleanup };
}

async function resolveCopyStudyResourceUpload(
  actorId: string,
  expectedWorkspaceId: string,
  input: StudyResourceUploadResolutionInput,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
  requestFingerprint: string,
  requireStagedWorkspace: boolean,
): Promise<StudyResourceResolutionOutcome> {
  const prepared = await inspectStudyResourceCopy(
    actorId,
    expectedWorkspaceId,
    input,
    requestSnapshot,
    requestFingerprint,
    requireStagedWorkspace,
  );
  if ("result" in prepared) return prepared;
  try {
    if (prepared.status === "PENDING") await finalizeWorkspaceAttachment(actorId, input.attachmentId);
  } catch (error) {
    const replay = await replayStudyResourceResolution(actorId, expectedWorkspaceId, input, requestSnapshot, requestFingerprint);
    if (replay) return replay;
    throw error;
  }
  try {
    return await createCopiedStudyResource(
      actorId,
      expectedWorkspaceId,
      input,
      requestSnapshot,
      requestFingerprint,
      requireStagedWorkspace,
    );
  } catch (error) {
    if (!isUnique(error)) throw error;
    const latest = input.stableKey
      ? await prisma.studyResource.findFirst({ where: { workspaceId: expectedWorkspaceId, stableKey: input.stableKey }, include: resourceInclude })
      : null;
    throw new ApiError("STUDY_RESOURCE_STABLE_KEY_CONFLICT", 409, {
      latest: latest ? serialize(latest) : { stableKey: input.stableKey ?? null },
      conflictFields: ["stableKey"],
      workbench: "/knowledge/resources",
    });
  }
}

async function inspectStudyResourceCopy(
  actorId: string,
  expectedWorkspaceId: string,
  input: StudyResourceUploadResolutionInput,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
  requestFingerprint: string,
  requireStagedWorkspace: boolean,
): Promise<StudyResourceResolutionOutcome | { status: "PENDING" | "READY" }> {
  return prisma.$transaction(async (tx) => {
    await lockStudyResourceUploadResolution(tx, actorId, input.attachmentId);
    const workspace = await assertResolutionWorkspace(tx, actorId, expectedWorkspaceId);
    const prior = await resolvePriorStudyResourceUpload(tx, actorId, workspace.id, input, requestSnapshot, requestFingerprint);
    if (prior) return prior;
    const attachment = await loadReadyResolutionAttachment(tx, input.attachmentId);
    await assertAttachmentOwnedByActor(actorId, workspace.id, attachment, { client: tx, requireStagedWorkspace });
    if (attachment.studyResource) return { result: serialize(await loadResource(workspace.id, attachment.studyResource.id, tx)) };
    return { status: attachment.status === "PENDING" ? "PENDING" : "READY" };
  });
}

async function createCopiedStudyResource(
  actorId: string,
  expectedWorkspaceId: string,
  input: StudyResourceUploadResolutionInput,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
  requestFingerprint: string,
  requireStagedWorkspace: boolean,
): Promise<StudyResourceResolutionOutcome> {
  return prisma.$transaction(async (tx) => {
    await lockStudyResourceUploadResolution(tx, actorId, input.attachmentId);
    const workspace = await assertResolutionWorkspace(tx, actorId, expectedWorkspaceId);
    const prior = await resolvePriorStudyResourceUpload(tx, actorId, workspace.id, input, requestSnapshot, requestFingerprint);
    if (prior) return prior;
    const attachment = await loadReadyResolutionAttachment(tx, input.attachmentId, true);
    await assertAttachmentOwnedByActor(actorId, workspace.id, attachment, { client: tx, requireStagedWorkspace });
    if (attachment.studyResource) return { result: serialize(await loadResource(workspace.id, attachment.studyResource.id, tx)) };
    if (input.subjectId) await assertSubjectInWorkspace(workspace.id, input.subjectId, tx);
    await assertLinkTargetsInWorkspace(tx, workspace.id, input);
    const row = await insertCopiedStudyResource(tx, actorId, workspace.id, attachment, input);
    await markStudyResourceUploadResolved(actorId, workspace.id, attachment.id, "copy", row.id, requestFingerprint, requestSnapshot, tx);
    return { result: serialize(await tx.studyResource.findUniqueOrThrow({ where: { id: row.id }, include: resourceInclude })) };
  });
}

async function insertCopiedStudyResource(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  attachment: Awaited<ReturnType<typeof loadReadyResolutionAttachment>>,
  input: StudyResourceUploadResolutionInput,
) {
  const duplicateOf = await tx.studyResource.findFirst({
    where: {
      workspaceId,
      sourceType: "FILE",
      attachment: { hash: attachment.hash },
      archivedAt: null,
      OR: [{ subjectId: null }, { subject: { archivedAt: null } }],
    },
    select: { id: true },
  });
  const row = await tx.studyResource.create({
    data: {
      workspaceId,
      stableKey: input.stableKey?.trim() || createStableKey("resource", `${workspaceId}:${attachment.hash}:${Date.now()}`),
      title: (input.title ?? attachment.originalName).trim(),
      category: normalizeCategory(input.category),
      sourceType: "FILE",
      subjectId: input.subjectId ?? null,
      attachmentId: attachment.id,
      duplicateOfResourceId: duplicateOf?.id ?? null,
      actorId,
      tags: input.tags?.length ? { create: input.tags.map((tag) => ({ tagNorm: normalizeTag(tag), tagDisplay: tag.trim() })) } : undefined,
    },
  });
  await replaceResourceLinks(tx, row.id, input);
  await tx.auditEvent.create({
    data: {
      actorId,
      action: "STUDY_RESOURCE_FILE_CREATED",
      entityType: "StudyResource",
      entityId: row.id,
      metadata: { sourceType: "FILE", duplicateOfResourceId: duplicateOf?.id ?? null, mimeType: attachment.mimeType },
    },
  });
  return row;
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
    throw new ApiError("ATTACHMENT_NOT_READY", 409, {
      latest: attachment ? resolutionAttachmentLatest(attachment) : { id: input.attachmentId, status: "MISSING" },
      conflictFields: ["attachment.status"],
      workbench: "/knowledge/resources",
    });
  }
  if (attachment.studyResource) {
    throw new ApiError("STUDY_RESOURCE_ATTACHMENT_BOUND", 409, {
      latest: serialize(await loadResource(workspace.id, attachment.studyResource.id)),
      conflictFields: ["attachment.studyResource"],
      workbench: "/knowledge/resources",
    });
  }
  const noteWorkspaceId = attachment.note?.subject.workspaceId ?? null;
  if (attachment.noteId && noteWorkspaceId && noteWorkspaceId !== workspace.id) {
    throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  }

  return resolveStudyResourceUploadInternal(actorId, {
    attachmentId: attachment.id,
    decision: "copy",
    title: input.title,
    subjectId: input.subjectId,
    category: input.category,
    tags: input.tags,
  }, false) as Promise<StudyResourceDto>;
}

/**
 * Returns actor-owned, unbound uploads so a page refresh or a lost response
 * can resume the duplicate decision. The result intentionally contains only
 * the public attachment DTO and duplicate summaries, never storage identity.
 */
export async function listStagedStudyResourceUploads(actorId: string): Promise<StagingUploadResult[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [stagedEvents, resolvedEvents] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        actorId,
        action: { in: ["STUDY_RESOURCE_UPLOAD_STAGED", "ATTACHMENT_INTENT_CREATED"] },
        entityType: "Attachment",
        entityId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 600,
      select: { entityId: true, metadata: true },
    }),
    prisma.auditEvent.findMany({
      where: { actorId, action: "STUDY_RESOURCE_UPLOAD_RESOLVED", entityType: "Attachment", entityId: { not: null } },
      select: { entityId: true },
    }),
  ]);
  const resolvedIds = new Set(resolvedEvents.map((event) => event.entityId).filter((id): id is string => Boolean(id)));
  const attachmentIds = Array.from(new Set(
    stagedEvents
      .filter((event) => readAuditWorkspaceId(event.metadata) === workspace.id)
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
      OR: [{ subjectId: null }, { subject: { archivedAt: null } }],
    },
    select: { id: true, stableKey: true, title: true, attachment: { select: { hash: true } } },
    take: 100,
  });
  const duplicatesByHash = new Map<string, StagingUploadResult["duplicates"]>();
  for (const duplicate of duplicates) {
    const hash = duplicate.attachment?.hash;
    if (!hash) continue;
    const bucket = duplicatesByHash.get(hash) ?? [];
    bucket.push({ resourceId: duplicate.id, stableKey: duplicate.stableKey, title: duplicate.title });
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
  workspaceId: string,
  attachmentId: string,
  decision: StudyResourceUploadDecision,
  resourceId?: string,
  requestFingerprint?: string,
  requestSnapshot?: StudyResourceUploadResolutionSnapshot,
  client: StudyResourceDbClient = prisma,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId,
      action: "STUDY_RESOURCE_UPLOAD_RESOLVED",
      entityType: "Attachment",
      entityId: attachmentId,
      metadata: {
        workspaceId,
        decision,
        ...(resourceId ? { resourceId } : {}),
        ...(requestFingerprint ? { requestFingerprint } : {}),
        ...(requestSnapshot ? { requestSnapshot: resolutionSnapshotAsJson(requestSnapshot) } : {}),
      },
    },
  });
}

async function findResolvedUpload(
  actorId: string,
  attachmentId: string,
  client: StudyResourceDbClient = prisma,
): Promise<ResolvedStudyResourceUpload | null> {
  const event = await client.auditEvent.findFirst({
    where: { actorId, action: "STUDY_RESOURCE_UPLOAD_RESOLVED", entityType: "Attachment", entityId: attachmentId },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if (!event || !event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) return null;
  const metadata = event.metadata as Record<string, unknown>;
  if (metadata.decision !== "reuse" && metadata.decision !== "copy" && metadata.decision !== "skip") return null;
  return {
    decision: metadata.decision,
    resourceId: typeof metadata.resourceId === "string" ? metadata.resourceId : undefined,
    requestFingerprint: typeof metadata.requestFingerprint === "string" ? metadata.requestFingerprint : undefined,
    requestSnapshot: readStudyResourceResolutionSnapshot(metadata.requestSnapshot) ?? undefined,
    workspaceId: typeof metadata.workspaceId === "string" ? metadata.workspaceId : undefined,
  };
}

function createStudyResourceResolutionSnapshot(
  input: StudyResourceUploadResolutionInput,
): StudyResourceUploadResolutionSnapshot {
  return {
    attachmentId: input.attachmentId,
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
}

function studyResourceResolutionFingerprint(snapshot: StudyResourceUploadResolutionSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function resolutionSnapshotAsJson(snapshot: StudyResourceUploadResolutionSnapshot): Prisma.InputJsonObject {
  return { ...snapshot };
}

function readStudyResourceResolutionSnapshot(value: unknown): StudyResourceUploadResolutionSnapshot | null {
  if (!isJsonRecord(value)) return null;
  if (
    typeof value.attachmentId !== "string" ||
    (value.decision !== "reuse" && value.decision !== "copy" && value.decision !== "skip") ||
    !isNullableString(value.reuseResourceId) ||
    !isNullableString(value.title) ||
    !isNullableString(value.subjectId) ||
    !isNullableString(value.category) ||
    !isNullableString(value.stableKey)
  ) return null;
  const arrays = [value.tags, value.taskIds, value.noteIds, value.mistakeIds, value.syllabusNodeIds];
  if (!arrays.every(isStringArray)) return null;
  return value as unknown as StudyResourceUploadResolutionSnapshot;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
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

function studyResourceUploadBatchSnapshot(items: StudyResourceUploadBatchItem[]): Prisma.InputJsonArray {
  return items.map((item) => ({
    index: item.index,
    originalName: item.originalName,
    error: item.error,
    staging: item.staging ? {
      attachment: {
        id: item.staging.attachment.id,
        noteId: item.staging.attachment.noteId,
        originalName: item.staging.attachment.originalName,
        mimeType: item.staging.attachment.mimeType,
        sizeBytes: item.staging.attachment.sizeBytes,
        downloadApiPath: item.staging.attachment.downloadApiPath,
        createdAt: item.staging.attachment.createdAt,
      },
      duplicates: item.staging.duplicates.map((duplicate) => ({
        resourceId: duplicate.resourceId,
        stableKey: duplicate.stableKey,
        title: duplicate.title,
      })),
    } : null,
  }));
}

function readStudyResourceUploadBatchSnapshot(value: Prisma.JsonValue | undefined): StudyResourceUploadBatchItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: StudyResourceUploadBatchItem[] = [];
  for (const candidate of value) {
    if (!isJsonRecord(candidate)) return null;
    if (
      typeof candidate.index !== "number" ||
      !Number.isInteger(candidate.index) ||
      typeof candidate.originalName !== "string" ||
      (candidate.error !== null && typeof candidate.error !== "string")
    ) {
      return null;
    }
    const staging = candidate.staging === null ? null : readStagingUploadSnapshot(candidate.staging);
    if (candidate.staging !== null && !staging) return null;
    items.push({
      index: candidate.index,
      originalName: candidate.originalName,
      staging,
      error: candidate.error,
    });
  }
  return items;
}

function readStagingUploadSnapshot(value: unknown): StagingUploadResult | null {
  if (!isJsonRecord(value) || !isJsonRecord(value.attachment) || !Array.isArray(value.duplicates)) return null;
  const attachment = value.attachment;
  if (
    typeof attachment.id !== "string" ||
    (attachment.noteId !== null && typeof attachment.noteId !== "string") ||
    typeof attachment.originalName !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.sizeBytes !== "number" ||
    typeof attachment.downloadApiPath !== "string" ||
    typeof attachment.createdAt !== "string"
  ) {
    return null;
  }
  const duplicates = value.duplicates.map((candidate) => {
    if (
      !isJsonRecord(candidate) ||
      typeof candidate.resourceId !== "string" ||
      typeof candidate.stableKey !== "string" ||
      typeof candidate.title !== "string"
    ) {
      return null;
    }
    return { resourceId: candidate.resourceId, stableKey: candidate.stableKey, title: candidate.title };
  });
  if (duplicates.some((candidate) => candidate === null)) return null;
  return {
    attachment: {
      id: attachment.id,
      noteId: attachment.noteId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      downloadApiPath: attachment.downloadApiPath,
      createdAt: attachment.createdAt,
    },
    duplicates: duplicates as StagingUploadResult["duplicates"],
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const studyResourceResolutionLockNamespace = 8212;

const resolutionAttachmentInclude = {
  studyResource: { select: { id: true } },
  note: { select: { subject: { select: { workspaceId: true } } } },
} satisfies Prisma.AttachmentInclude;

type ResolutionAttachmentRow = Prisma.AttachmentGetPayload<{ include: typeof resolutionAttachmentInclude }>;

async function lockStudyResourceUploadResolution(
  tx: Prisma.TransactionClient,
  actorId: string,
  attachmentId: string,
): Promise<void> {
  const scope = `${actorId}:${attachmentId}`;
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${studyResourceResolutionLockNamespace}, hashtext(${scope}))`;
}

async function assertResolutionWorkspace(
  tx: Prisma.TransactionClient,
  actorId: string,
  expectedWorkspaceId: string,
) {
  const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
  if (workspace.id !== expectedWorkspaceId) {
    throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
      latest: { workspaceId: workspace.id },
      conflictFields: ["workspaceId"],
      workbench: "/settings/workspace",
    });
  }
  return workspace;
}

async function loadReadyResolutionAttachment(
  tx: Prisma.TransactionClient,
  attachmentId: string,
  requireReady = false,
): Promise<ResolutionAttachmentRow> {
  const attachment = await tx.attachment.findUnique({
    where: { id: attachmentId },
    include: resolutionAttachmentInclude,
  });
  const acceptable = attachment && (requireReady ? attachment.status === "READY" : ["PENDING", "READY"].includes(attachment.status));
  if (!attachment || !acceptable) {
    throw new ApiError("ATTACHMENT_NOT_READY", 409, {
      latest: attachment ? resolutionAttachmentLatest(attachment) : { id: attachmentId, status: "MISSING" },
      conflictFields: ["attachment.status"],
      workbench: "/knowledge/resources",
    });
  }
  return attachment;
}

function resolutionAttachmentLatest(attachment: ResolutionAttachmentRow) {
  return {
    id: attachment.id,
    status: attachment.status,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    hash: attachment.hash,
    resourceId: attachment.studyResource?.id ?? null,
    failureCode: attachment.failureCode,
    failurePhase: attachment.failurePhase,
  };
}

async function resolvePriorStudyResourceUpload(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  input: StudyResourceUploadResolutionInput,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
  requestFingerprint: string,
): Promise<StudyResourceResolutionOutcome | null> {
  const prior = await findResolvedUpload(actorId, input.attachmentId, tx);
  if (!prior) return null;
  const latestResource = prior.resourceId ? serialize(await loadResource(workspaceId, prior.resourceId, tx)) : null;
  const requestChanged = prior.requestFingerprint
    ? prior.requestFingerprint !== requestFingerprint
    : prior.decision !== input.decision || (input.decision === "reuse" && prior.resourceId !== input.reuseResourceId);
  if (prior.workspaceId && prior.workspaceId !== workspaceId) {
    throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
      latest: { workspaceId: prior.workspaceId },
      conflictFields: ["workspaceId"],
      workbench: "/settings/workspace",
    });
  }
  if (requestChanged) throwStudyResourceResolutionConflict(input.attachmentId, prior, latestResource, requestSnapshot);
  if (prior.decision === "skip") {
    const cleanup = await markUnboundAttachmentDiscarded(actorId, input.attachmentId, tx);
    return { result: { skipped: true }, cleanup };
  }
  if (!latestResource) {
    throw new ApiError("STUDY_RESOURCE_UPLOAD_RESULT_UNAVAILABLE", 409, {
      latest: { attachmentId: input.attachmentId, decision: prior.decision, resourceId: prior.resourceId ?? null },
      conflictFields: ["resourceId"],
      workbench: "/knowledge/resources",
    });
  }
  const cleanup = prior.decision === "reuse"
    ? await markUnboundAttachmentDiscarded(actorId, input.attachmentId, tx)
    : null;
  return { result: latestResource, cleanup };
}

function throwStudyResourceResolutionConflict(
  attachmentId: string,
  prior: ResolvedStudyResourceUpload,
  latestResource: StudyResourceDto | null,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
): never {
  throw new ApiError("STUDY_RESOURCE_UPLOAD_DECISION_CONFLICT", 409, {
    latest: {
      attachmentId,
      decision: prior.decision,
      resourceId: prior.resourceId ?? null,
      resource: latestResource,
      request: prior.requestSnapshot ?? null,
    },
    conflictFields: studyResourceResolutionConflictFields(requestSnapshot, prior),
    workbench: "/knowledge/resources",
  });
}

function studyResourceResolutionConflictFields(
  request: StudyResourceUploadResolutionSnapshot,
  prior: ResolvedStudyResourceUpload,
): string[] {
  if (!prior.requestSnapshot) {
    return prior.decision !== request.decision ? ["decision"] : ["requestFingerprint"];
  }
  const fields = (Object.keys(request) as Array<keyof StudyResourceUploadResolutionSnapshot>)
    .filter((field) => JSON.stringify(request[field]) !== JSON.stringify(prior.requestSnapshot?.[field]));
  return fields.length ? fields : ["requestFingerprint"];
}

async function replayStudyResourceResolution(
  actorId: string,
  expectedWorkspaceId: string,
  input: StudyResourceUploadResolutionInput,
  requestSnapshot: StudyResourceUploadResolutionSnapshot,
  requestFingerprint: string,
): Promise<StudyResourceResolutionOutcome | null> {
  return prisma.$transaction(async (tx) => {
    await lockStudyResourceUploadResolution(tx, actorId, input.attachmentId);
    const workspace = await assertResolutionWorkspace(tx, actorId, expectedWorkspaceId);
    return resolvePriorStudyResourceUpload(tx, actorId, workspace.id, input, requestSnapshot, requestFingerprint);
  });
}

function hasResourceAssociationUpdate(input: StudyResourceUploadResolutionInput): boolean {
  return input.subjectId !== undefined ||
    input.category !== undefined ||
    input.tags !== undefined ||
    input.taskIds !== undefined ||
    input.noteIds !== undefined ||
    input.mistakeIds !== undefined ||
    input.syllabusNodeIds !== undefined;
}

function subjectArchivedError(latest: unknown, conflictField = "subjectId"): ApiError {
  return new ApiError("SUBJECT_ARCHIVED", 409, {
    latest,
    conflictFields: [conflictField],
    workbench: "/knowledge/resources",
  });
}

interface UpdateStudyResourceInput {
  title?: string;
  category?: string;
  subjectId?: string | null;
  tags?: string[];
  taskIds?: string[];
  noteIds?: string[];
  mistakeIds?: string[];
  syllabusNodeIds?: string[];
  expectedRevision: number;
}

export async function updateStudyResource(
  actorId: string,
  id: string,
  input: UpdateStudyResourceInput,
): Promise<StudyResourceDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    return updateStudyResourceInTransaction(tx, actorId, workspace.id, id, input);
  });
  return serialize(updated);
}

async function updateStudyResourceInTransaction(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  id: string,
  input: UpdateStudyResourceInput,
) {
  const existing = await loadResource(workspaceId, id, tx);
  if (existing.subjectId) await assertSubjectInWorkspace(workspaceId, existing.subjectId, tx);
  if (existing.revision !== input.expectedRevision) {
    const latest = serialize(existing);
    throw new ApiError("STUDY_RESOURCE_REVISION_CONFLICT", 409, {
      latest,
      conflictFields: studyResourceConflictFields(input, latest),
      workbench: "/knowledge/resources",
    });
  }
  if (input.subjectId) await assertSubjectInWorkspace(workspaceId, input.subjectId, tx);
  await assertLinkTargetsInWorkspace(tx, workspaceId, input);
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
  const changed = await tx.studyResource.updateMany({
    where: { id, workspaceId, revision: input.expectedRevision },
    data: {
      title: input.title?.trim(),
      category: input.category === undefined ? undefined : normalizeCategory(input.category),
      subjectId: input.subjectId === undefined ? undefined : input.subjectId,
      revision: { increment: 1 },
      actorId,
    },
  });
  if (changed.count !== 1) {
    const latest = serialize(await loadResource(workspaceId, id, tx));
    throw new ApiError("STUDY_RESOURCE_REVISION_CONFLICT", 409, {
      latest,
      conflictFields: studyResourceConflictFields(input, latest),
      workbench: "/knowledge/resources",
    });
  }
  return tx.studyResource.findUniqueOrThrow({ where: { id }, include: resourceInclude });
}

function studyResourceConflictFields(input: UpdateStudyResourceInput, latest: StudyResourceDto): string[] {
  return [
    "revision",
    ...(input.title !== undefined && input.title.trim() !== latest.title ? ["title"] : []),
    ...(input.category !== undefined && normalizeCategory(input.category) !== latest.category ? ["category"] : []),
    ...(input.subjectId !== undefined && input.subjectId !== latest.subjectId ? ["subjectId"] : []),
    ...(input.tags !== undefined && !sameStringSet(input.tags, latest.tags) ? ["tags"] : []),
    ...(input.taskIds !== undefined && !sameStringSet(input.taskIds, latest.taskIds) ? ["taskIds"] : []),
    ...(input.noteIds !== undefined && !sameStringSet(input.noteIds, latest.noteIds) ? ["noteIds"] : []),
    ...(input.mistakeIds !== undefined && !sameStringSet(input.mistakeIds, latest.mistakeIds) ? ["mistakeIds"] : []),
    ...(input.syllabusNodeIds !== undefined && !sameStringSet(input.syllabusNodeIds, latest.syllabusNodeIds) ? ["syllabusNodeIds"] : []),
  ];
}

function sameStringSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
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
  const updated = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await loadResource(workspace.id, id, tx);
    if (existing.subjectId) {
      await assertSubjectInWorkspace(workspace.id, existing.subjectId, tx);
    }
    await assertLinkTargetsInWorkspace(tx, workspace.id, input);
    await replaceResourceLinks(tx, id, input);
    return tx.studyResource.update({
      where: { id },
      data: { revision: { increment: 1 } },
      include: resourceInclude,
    });
  });

  return serialize(updated);
}

async function assertAttachmentOwnedByActor(
  actorId: string,
  workspaceId: string,
  attachment: {
    id: string;
    noteId: string | null;
    note: { subject: { workspaceId: string | null } } | null;
  },
  options: { client?: StudyResourceDbClient; requireStagedWorkspace?: boolean } = {},
): Promise<void> {
  if (attachment.noteId) {
    if (attachment.note?.subject.workspaceId !== workspaceId) {
      throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
    }
    return;
  }

  const client = options.client ?? prisma;
  const [intent, staged] = await Promise.all([
    client.auditEvent.findFirst({
      where: {
        actorId,
        action: "ATTACHMENT_INTENT_CREATED",
        entityType: "Attachment",
        entityId: attachment.id,
      },
      select: { id: true, metadata: true },
    }),
    client.auditEvent.findFirst({
      where: {
        actorId,
        action: "STUDY_RESOURCE_UPLOAD_STAGED",
        entityType: "Attachment",
        entityId: attachment.id,
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    }),
  ]);
  if (!intent) throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
  if (options.requireStagedWorkspace || staged) {
    const stagedWorkspaceId = readAuditWorkspaceId(staged?.metadata);
    const intentWorkspaceId = readAuditWorkspaceId(intent.metadata);
    if (stagedWorkspaceId !== workspaceId && intentWorkspaceId !== workspaceId) {
      throw new ApiError("ATTACHMENT_NOT_FOUND", 404);
    }
  }
}

function readAuditWorkspaceId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const workspaceId = (metadata as { workspaceId?: unknown }).workspaceId;
  return typeof workspaceId === "string" ? workspaceId : null;
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
  await Promise.all([
    assertActiveLinkTargets("taskIds", input.taskIds, (ids) =>
      tx.studyTask.findMany({
        where: { id: { in: ids }, subject: { workspaceId } },
        select: { id: true, subject: { select: { archivedAt: true } } },
      }),
    ),
    assertActiveLinkTargets("noteIds", input.noteIds, (ids) =>
      tx.note.findMany({
        where: { id: { in: ids }, subject: { workspaceId } },
        select: { id: true, subject: { select: { archivedAt: true } } },
      }),
    ),
    assertActiveLinkTargets("mistakeIds", input.mistakeIds, (ids) =>
      tx.mistake.findMany({
        where: { id: { in: ids }, subject: { workspaceId } },
        select: { id: true, subject: { select: { archivedAt: true } } },
      }),
    ),
    assertActiveLinkTargets("syllabusNodeIds", input.syllabusNodeIds, (ids) =>
      tx.syllabusNode.findMany({
        where: { id: { in: ids }, subject: { workspaceId } },
        select: { id: true, subject: { select: { archivedAt: true } } },
      }),
    ),
  ]);
}

async function assertActiveLinkTargets(
  field: "taskIds" | "noteIds" | "mistakeIds" | "syllabusNodeIds",
  ids: string[] | undefined,
  load: (uniqueIds: string[]) => Promise<Array<{ id: string; subject: { archivedAt: Date | null } }>>,
): Promise<void> {
  if (!ids) return;
  const uniqueIds = [...new Set(ids)];
  const rows = await load(uniqueIds);
  if (rows.length !== uniqueIds.length) {
    throw new ApiError("STUDY_RESOURCE_LINK_TARGET_NOT_FOUND", 404);
  }
  const archived = rows.filter((row) => row.subject.archivedAt);
  if (archived.length > 0) {
    throw subjectArchivedError({
      field,
      archivedTargets: archived.map((row) => ({
        id: row.id,
        archivedAt: row.subject.archivedAt?.toISOString() ?? null,
      })),
    }, field);
  }
}

export async function archiveStudyResource(actorId: string, id: string, expectedRevision: number): Promise<StudyResourceDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await loadResource(workspace.id, id, tx);
    if (existing.subjectId) {
      await assertSubjectInWorkspace(workspace.id, existing.subjectId, tx);
    }
    if (existing.revision !== expectedRevision) throw studyResourceRevisionConflict(existing);
    if (existing.archivedAt) return existing;
    const changed = await tx.studyResource.updateMany({
      where: { id, workspaceId: workspace.id, archivedAt: null, revision: expectedRevision },
      data: { archivedAt: new Date(), revision: { increment: 1 }, actorId },
    });
    if (changed.count !== 1) throw studyResourceRevisionConflict(await loadResource(workspace.id, id, tx));
    await tx.reviewSchedule.updateMany({
      where: { workspaceId: workspace.id, studyResourceId: id, status: "ACTIVE" },
      data: { status: "PAUSED", dueDate: null, pausedReason: "TARGET_ARCHIVED", revision: { increment: 1 } },
    });
    return loadResource(workspace.id, id, tx);
  });
  return serialize(updated);
}

export async function restoreStudyResource(actorId: string, id: string, expectedRevision: number): Promise<StudyResourceDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await loadResource(workspace.id, id, tx);
    if (existing.subjectId) {
      await assertSubjectInWorkspace(workspace.id, existing.subjectId, tx);
    }
    if (existing.revision !== expectedRevision) throw studyResourceRevisionConflict(existing);
    if (!existing.archivedAt) return existing;
    const changed = await tx.studyResource.updateMany({
      where: { id, workspaceId: workspace.id, archivedAt: { not: null }, revision: expectedRevision },
      data: { archivedAt: null, revision: { increment: 1 }, actorId },
    });
    if (changed.count !== 1) throw studyResourceRevisionConflict(await loadResource(workspace.id, id, tx));
    return loadResource(workspace.id, id, tx);
  });
  return serialize(updated);
}

function studyResourceRevisionConflict(latest: ResourceRow): ApiError {
  return new ApiError("STUDY_RESOURCE_REVISION_CONFLICT", 409, {
    latest: serialize(latest),
    conflictFields: ["revision", "archivedAt"],
    workbench: "/knowledge/resources",
  });
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

async function assertSubjectInWorkspace(
  workspaceId: string,
  subjectId: string,
  client: StudyResourceDbClient,
): Promise<void> {
  const subject = await client.subject.findFirst({
    where: { id: subjectId, workspaceId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!subject) throw new ApiError("SUBJECT_NOT_FOUND", 404);
  if (subject.archivedAt) {
    throw subjectArchivedError({
      id: subject.id,
      name: subject.name,
      archivedAt: subject.archivedAt.toISOString(),
    });
  }
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
