import { isNoteKind, normalizeRelatedNodeIds } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  NoteEditorOptionsDto,
  OwnedNoteDetailDto,
} from "@/lib/contracts/knowledge-library";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { serializeAttachment } from "./attachments-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { pauseScheduleOnTargetArchive } from "./review-schedule-service";
import { fromDbTaskStatus } from "./task-serializer";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";
import type { NoteDto, NoteMasteryStatusDto } from "@/lib/contracts";

export type {
  NoteEditorOptionsDto,
  OwnedNoteDetailDto,
} from "@/lib/contracts/knowledge-library";

export interface CreateNoteInput {
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  taskId?: string | null;
  kind?: string;
  studyDate?: string | null;
  stableKey?: string | null;
  title: string;
  content: string;
  masteryStatus?: NoteMasteryStatusDto | null;
  nextReviewAt?: string | null;
}

export interface UpdateNoteInput {
  expectedRevision: number;
  subjectId?: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  taskId?: string | null;
  resourceIds?: string[];
  kind?: string;
  studyDate?: string | null;
  title?: string;
  content?: string;
  masteryStatus?: NoteMasteryStatusDto | null;
  nextReviewAt?: string | null;
}

const noteCoreInclude = {
  subject: { select: { name: true, color: true, archivedAt: true } },
  syllabusNode: { select: { id: true, title: true, archivedAt: true } },
  task: { select: { id: true, title: true, status: true } },
  relatedSyllabusNodes: {
    include: { syllabusNode: { select: { id: true, title: true, archivedAt: true } } },
    orderBy: { createdAt: "asc" },
  },
  attachments: {
    where: { status: "READY" },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.NoteInclude;

const noteDetailInclude = {
  ...noteCoreInclude,
  studyResourceLinks: {
    include: { resource: { select: { id: true, title: true, sourceType: true, archivedAt: true } } },
    orderBy: { createdAt: "asc" },
  },
  reviewSchedules: {
    orderBy: { createdAt: "desc" },
    take: 1,
    include: {
      events: {
        orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
        take: 50,
      },
    },
  },
} satisfies Prisma.NoteInclude;

const ownedNoteDetailInclude = {
  ...noteDetailInclude,
  subject: {
    select: {
      name: true,
      color: true,
      archivedAt: true,
      workspace: { select: { name: true, status: true } },
    },
  },
} satisfies Prisma.NoteInclude;

type NoteCoreRow = Prisma.NoteGetPayload<{ include: typeof noteCoreInclude }>;
type NoteDetailRow = Prisma.NoteGetPayload<{ include: typeof noteDetailInclude }>;
type NoteDbClient = typeof prisma | Prisma.TransactionClient;

export async function listNotes(actorId: string, options?: { q?: string }): Promise<NoteDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const query = options?.q?.trim().slice(0, 120) || undefined;
  const notes = await prisma.note.findMany({
    where: {
      subject: { workspaceId: workspace.id },
      ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}),
    },
    include: noteCoreInclude,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return notes.map(serializeNote);
}

export async function getNoteById(noteId: string, actorId: string): Promise<NoteDto | null> {
  return (await getOwnedNoteDetail(noteId, actorId))?.note ?? null;
}

export async function getOwnedNoteDetail(noteId: string, actorId: string): Promise<OwnedNoteDetailDto | null> {
  const note = await prisma.note.findFirst({
    where: { id: noteId, subject: { workspace: { userId: actorId } } },
    include: ownedNoteDetailInclude,
  });
  if (!note?.subject.workspace) return null;
  const subjectArchived = Boolean(note.subject.archivedAt);
  return {
    note: serializeNote(note),
    readOnly: note.subject.workspace.status !== "ACTIVE" || subjectArchived,
    subjectArchived,
    workspaceName: note.subject.workspace.name,
  };
}

export async function getNoteEditorOptions(actorId: string): Promise<NoteEditorOptionsDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [subjects, tasks, syllabusNodes, resources] = await Promise.all([
    prisma.subject.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, archivedAt: true },
    }),
    prisma.studyTask.findMany({
      where: { subject: { workspaceId: workspace.id } },
      orderBy: [{ plannedDate: "desc" }, { createdAt: "desc" }],
      select: { id: true, subjectId: true, title: true, status: true },
      take: 500,
    }),
    prisma.syllabusNode.findMany({
      where: { subject: { workspaceId: workspace.id } },
      orderBy: [{ subjectId: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
      select: { id: true, subjectId: true, title: true, archivedAt: true },
    }),
    prisma.studyResource.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, title: true, archivedAt: true },
      take: 500,
    }),
  ]);

  return {
    subjects: subjects.map((subject) => ({
      ...subject,
      archivedAt: subject.archivedAt?.toISOString() ?? null,
    })),
    tasks: tasks.map((task) => ({ ...task, status: fromDbTaskStatus(task.status) })),
    syllabusNodes: syllabusNodes.map((node) => ({
      ...node,
      archivedAt: node.archivedAt?.toISOString() ?? null,
    })),
    resources: resources.map((resource) => ({
      ...resource,
      archivedAt: resource.archivedAt?.toISOString() ?? null,
    })),
  };
}

export async function createNote(input: CreateNoteInput, actorId: string): Promise<NoteDto> {
  const kind = input.kind ?? "GENERAL";
  if (!isNoteKind(kind)) {
    throw new ApiError("INVALID_NOTE_KIND", 400);
  }

  const relatedIds = input.relatedSyllabusNodeIds ?? [];
  const normalizedRelatedIds = Array.from(new Set(relatedIds.filter((id) => id !== input.syllabusNodeId))).sort();
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("note-create-v1", {
    subjectId: input.subjectId,
    syllabusNodeId: input.syllabusNodeId ?? null,
    relatedSyllabusNodeIds: normalizedRelatedIds,
    taskId: input.taskId ?? null,
    kind,
    studyDate: input.studyDate ?? null,
    stableKey: input.stableKey ?? null,
    title: input.title,
    content: input.content,
    masteryStatus: input.masteryStatus ?? null,
    nextReviewAt: input.nextReviewAt ?? null,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "NOTE_CREATED",
      entityType: "Note",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "NOTE_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const storedNote = await tx.note.findFirst({
        where: { id: replay.resultId, subject: { workspaceId: workspace.id } },
        include: noteDetailInclude,
      });
      if (!storedNote) throw new ApiError("NOTE_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
      return serializeNote(storedNote);
    }
    await assertSubjectExists(input.subjectId, workspace.id, tx);

    if (input.syllabusNodeId) {
      await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId, tx, workspace.id);
    }
    if (input.taskId) {
      await assertTaskBelongsToSubject(input.taskId, input.subjectId, workspace.id, tx);
    }
    if (relatedIds.length > 0 || input.syllabusNodeId) {
      const nodeIds = Array.from(new Set([...(input.syllabusNodeId ? [input.syllabusNodeId] : []), ...relatedIds]));
      const nodes = await tx.syllabusNode.findMany({
        where: { id: { in: nodeIds }, subject: { workspaceId: workspace.id } },
        select: { id: true, subjectId: true },
      });
      const nodeSubjectIds = Object.fromEntries(nodes.map((node) => [node.id, node.subjectId]));
      const normalized = normalizeRelatedNodeIds({
        primaryNodeId: input.syllabusNodeId,
        relatedNodeIds: relatedIds,
        nodeSubjectIds,
        taskSubjectId: input.subjectId,
      });
      if (!normalized.ok) {
        throw new ApiError("NOTE_NODE_SUBJECT_MISMATCH", 400);
      }
    }

    const created = await tx.note.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        taskId: input.taskId ?? null,
        kind,
        studyDate: input.studyDate ? new Date(input.studyDate) : null,
        stableKey: input.stableKey ?? null,
        title: input.title,
        content: input.content,
        masteryStatus: input.masteryStatus ?? null,
        nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
        relatedSyllabusNodes: normalizedRelatedIds.length
          ? {
              create: normalizedRelatedIds.map((syllabusNodeId) => ({ syllabusNodeId })),
            }
          : undefined,
      },
      include: noteDetailInclude,
    });

    const result = serializeNote(created);
    await recordPersistentCreateResult(tx, command, created.id, {
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

export async function updateNote(noteId: string, input: UpdateNoteInput, actorId: string): Promise<NoteDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await loadNote(workspace.id, noteId, tx);
    const latest = serializeNote(existing);
    if (existing.revision !== input.expectedRevision) {
      throwNoteRevisionConflict(input, latest);
    }
    if (existing.archivedAt) {
      throw new ApiError("NOTE_ARCHIVED", 409, {
        latest,
        conflictFields: ["archivedAt"],
        workbench: "/knowledge/cards",
      });
    }

    const subjectId = input.subjectId ?? existing.subjectId;
    const syllabusNodeId = input.syllabusNodeId === undefined ? existing.syllabusNodeId : input.syllabusNodeId;
    const relatedIds = input.relatedSyllabusNodeIds ?? existing.relatedSyllabusNodes.map((row) => row.syllabusNodeId);
    const normalizedRelatedIds = uniqueIds(relatedIds.filter((id) => id !== syllabusNodeId));
    const taskId = input.taskId === undefined ? existing.taskId : input.taskId;
    const kind = input.kind ?? existing.kind;

    if (!isNoteKind(kind)) throw new ApiError("INVALID_NOTE_KIND", 400);
    await assertSubjectExists(subjectId, workspace.id, tx);
    await assertNoteNodeSelection({
      tx,
      workspaceId: workspace.id,
      subjectId,
      syllabusNodeId,
      relatedSyllabusNodeIds: normalizedRelatedIds,
      existing,
    });
    if (taskId) await assertTaskBelongsToSubject(taskId, subjectId, workspace.id, tx);
    if (input.resourceIds !== undefined) {
      await assertNoteResourcesSelectable(tx, workspace.id, uniqueIds(input.resourceIds), existing);
    }

    const changed = await tx.note.updateMany({
      where: { id: noteId, revision: input.expectedRevision, archivedAt: null },
      data: {
        subjectId: input.subjectId === undefined ? undefined : subjectId,
        syllabusNodeId: input.syllabusNodeId === undefined ? undefined : syllabusNodeId,
        taskId: input.taskId === undefined ? undefined : taskId,
        kind: input.kind === undefined ? undefined : kind,
        studyDate: input.studyDate === undefined ? undefined : input.studyDate ? new Date(input.studyDate) : null,
        title: input.title?.trim(),
        content: input.content,
        masteryStatus: input.masteryStatus === undefined ? undefined : input.masteryStatus,
        nextReviewAt: input.nextReviewAt === undefined ? undefined : input.nextReviewAt ? new Date(input.nextReviewAt) : null,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throwNoteRevisionConflict(input, serializeNote(await loadNote(workspace.id, noteId, tx)));
    }

    if (input.relatedSyllabusNodeIds !== undefined || input.syllabusNodeId !== undefined) {
      await tx.noteRelatedSyllabusNode.deleteMany({ where: { noteId } });
      if (normalizedRelatedIds.length > 0) {
        await tx.noteRelatedSyllabusNode.createMany({
          data: normalizedRelatedIds.map((relatedSyllabusNodeId) => ({
            noteId,
            syllabusNodeId: relatedSyllabusNodeId,
          })),
        });
      }
    }
    if (input.resourceIds !== undefined) {
      const resourceIds = uniqueIds(input.resourceIds);
      await tx.studyResourceNoteLink.deleteMany({ where: { noteId } });
      if (resourceIds.length > 0) {
        await tx.studyResourceNoteLink.createMany({
          data: resourceIds.map((resourceId) => ({ resourceId, noteId })),
        });
      }
    }
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "NOTE_UPDATED",
        entityType: "Note",
        entityId: noteId,
        metadata: {
          previousRevision: input.expectedRevision,
          revision: input.expectedRevision + 1,
          relatedNodeCount: normalizedRelatedIds.length,
          resourceCount: input.resourceIds === undefined ? existing.studyResourceLinks.length : uniqueIds(input.resourceIds).length,
        },
      },
    });
    return serializeNote(await loadNote(workspace.id, noteId, tx));
  });
}

export async function archiveNote(noteId: string, expectedRevision: number, actorId: string): Promise<NoteDto> {
  return setNoteArchived(noteId, expectedRevision, actorId, true);
}

export async function restoreNote(noteId: string, expectedRevision: number, actorId: string): Promise<NoteDto> {
  return setNoteArchived(noteId, expectedRevision, actorId, false);
}

async function setNoteArchived(
  noteId: string,
  expectedRevision: number,
  actorId: string,
  archived: boolean,
): Promise<NoteDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await loadNote(workspace.id, noteId, tx);
    const latest = serializeNote(existing);
    if (existing.subject.archivedAt) {
      throw new ApiError("SUBJECT_ARCHIVED", 409, {
        latest,
        conflictFields: ["subject.archivedAt"],
        workbench: "/knowledge/cards",
      });
    }
    if (existing.revision !== expectedRevision) {
      throw new ApiError("NOTE_REVISION_CONFLICT", 409, {
        latest,
        conflictFields: ["revision", "archivedAt"],
        workbench: "/knowledge/cards",
      });
    }
    if (Boolean(existing.archivedAt) === archived) return latest;

    const changed = await tx.note.updateMany({
      where: {
        id: noteId,
        revision: expectedRevision,
        archivedAt: archived ? null : { not: null },
      },
      data: {
        archivedAt: archived ? new Date() : null,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw new ApiError("NOTE_REVISION_CONFLICT", 409, {
        latest: serializeNote(await loadNote(workspace.id, noteId, tx)),
        conflictFields: ["revision", "archivedAt"],
        workbench: "/knowledge/cards",
      });
    }
    if (archived) await pauseScheduleOnTargetArchive(tx, { noteId });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: archived ? "NOTE_ARCHIVED" : "NOTE_RESTORED",
        entityType: "Note",
        entityId: noteId,
        metadata: { previousRevision: expectedRevision, revision: expectedRevision + 1 },
      },
    });
    return serializeNote(await loadNote(workspace.id, noteId, tx));
  });
}

function throwNoteRevisionConflict(input: UpdateNoteInput, latest: NoteDto): never {
  throw new ApiError("NOTE_REVISION_CONFLICT", 409, {
    latest,
    conflictFields: collectNoteConflictFields(input, latest),
    workbench: "/knowledge/cards",
  });
}

function collectNoteConflictFields(input: UpdateNoteInput, latest: NoteDto): string[] {
  return [
    "revision",
    ...(input.subjectId !== undefined && input.subjectId !== latest.subjectId ? ["subjectId"] : []),
    ...(input.syllabusNodeId !== undefined && input.syllabusNodeId !== latest.syllabusNodeId ? ["syllabusNodeId"] : []),
    ...(input.relatedSyllabusNodeIds !== undefined && !sameIds(input.relatedSyllabusNodeIds, latest.relatedSyllabusNodeIds) ? ["relatedSyllabusNodeIds"] : []),
    ...(input.taskId !== undefined && input.taskId !== latest.taskId ? ["taskId"] : []),
    ...(input.resourceIds !== undefined && !sameIds(input.resourceIds, latest.linkedResources.map((resource) => resource.id)) ? ["resourceIds"] : []),
    ...(input.kind !== undefined && input.kind !== latest.kind ? ["kind"] : []),
    ...(input.studyDate !== undefined && input.studyDate !== latest.studyDate ? ["studyDate"] : []),
    ...(input.title !== undefined && input.title.trim() !== latest.title ? ["title"] : []),
    ...(input.content !== undefined && input.content !== latest.content ? ["content"] : []),
    ...(input.masteryStatus !== undefined && input.masteryStatus !== latest.masteryStatus ? ["masteryStatus"] : []),
    ...(input.nextReviewAt !== undefined && input.nextReviewAt !== latest.nextReviewAt ? ["nextReviewAt"] : []),
  ];
}

async function loadNote(
  workspaceId: string,
  noteId: string,
  client: NoteDbClient = prisma,
): Promise<NoteDetailRow> {
  const note = await client.note.findFirst({
    where: { id: noteId, subject: { workspaceId } },
    include: noteDetailInclude,
  });
  if (!note) throw new ApiError("NOTE_NOT_FOUND", 404);
  return note;
}

async function assertNoteNodeSelection(input: {
  tx: Prisma.TransactionClient;
  workspaceId: string;
  subjectId: string;
  syllabusNodeId: string | null;
  relatedSyllabusNodeIds: string[];
  existing: NoteDetailRow;
}): Promise<void> {
  const nodeIds = uniqueIds([
    ...(input.syllabusNodeId ? [input.syllabusNodeId] : []),
    ...input.relatedSyllabusNodeIds,
  ]);
  if (nodeIds.length === 0) return;
  const nodes = await input.tx.syllabusNode.findMany({
    where: { id: { in: nodeIds }, subject: { workspaceId: input.workspaceId } },
    select: { id: true, subjectId: true, archivedAt: true },
  });
  if (nodes.length !== nodeIds.length) throw new ApiError("NOTE_SYLLABUS_NODE_NOT_FOUND", 404);

  const nodeSubjectIds = Object.fromEntries(nodes.map((node) => [node.id, node.subjectId]));
  const normalized = normalizeRelatedNodeIds({
    primaryNodeId: input.syllabusNodeId,
    relatedNodeIds: input.relatedSyllabusNodeIds,
    nodeSubjectIds,
    taskSubjectId: input.subjectId,
  });
  if (!normalized.ok) throw new ApiError("NOTE_NODE_SUBJECT_MISMATCH", 400);

  const existingRelatedIds = new Set(input.existing.relatedSyllabusNodes.map((row) => row.syllabusNodeId));
  const newlySelectedArchivedNode = nodes.find((node) =>
    node.archivedAt && (
      (node.id === input.syllabusNodeId && node.id !== input.existing.syllabusNodeId) ||
      (node.id !== input.syllabusNodeId && !existingRelatedIds.has(node.id))
    ),
  );
  if (newlySelectedArchivedNode) {
    throw new ApiError("NOTE_SYLLABUS_NODE_ARCHIVED", 409, {
      latest: serializeNote(input.existing),
      conflictFields: ["syllabusNodeId", "relatedSyllabusNodeIds"],
      workbench: "/knowledge/cards",
    });
  }
}

async function assertNoteResourcesSelectable(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  resourceIds: string[],
  existing: NoteDetailRow,
): Promise<void> {
  if (resourceIds.length === 0) return;
  const resources = await tx.studyResource.findMany({
    where: { id: { in: resourceIds }, workspaceId },
    select: { id: true, archivedAt: true },
  });
  if (resources.length !== resourceIds.length) throw new ApiError("NOTE_RESOURCE_NOT_FOUND", 404);
  const existingResourceIds = new Set(existing.studyResourceLinks.map((link) => link.resourceId));
  if (resources.some((resource) => resource.archivedAt && !existingResourceIds.has(resource.id))) {
    throw new ApiError("NOTE_RESOURCE_ARCHIVED", 409, {
      latest: serializeNote(existing),
      conflictFields: ["resourceIds"],
      workbench: "/knowledge/cards",
    });
  }
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

function sameIds(left: string[], right: string[]): boolean {
  return JSON.stringify(uniqueIds(left)) === JSON.stringify(uniqueIds(right));
}

async function assertSubjectExists(
  subjectId: string,
  workspaceId: string,
  client: Prisma.TransactionClient,
): Promise<void> {
  const subject = await client.subject.findFirst({
    where: { id: subjectId, workspaceId },
    select: { archivedAt: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
  if (subject.archivedAt) {
    throw new ApiError("SUBJECT_ARCHIVED", 409);
  }
}

async function assertTaskBelongsToSubject(
  taskId: string,
  subjectId: string,
  workspaceId: string,
  client: Prisma.TransactionClient,
): Promise<void> {
  const task = await client.studyTask.findFirst({
    where: { id: taskId, subject: { workspaceId } },
    select: { subjectId: true },
  });

  if (!task) {
    throw new ApiError("TASK_NOT_FOUND", 404);
  }

  if (task.subjectId !== subjectId) {
    throw new ApiError("TASK_SUBJECT_MISMATCH", 400);
  }
}

function serializeNote(note: NoteCoreRow | NoteDetailRow): NoteDto {
  const detail = "studyResourceLinks" in note && "reviewSchedules" in note ? note : null;
  const schedule = detail?.reviewSchedules[0] ?? null;
  return {
    id: note.id,
    subjectId: note.subjectId,
    subjectName: note.subject.name,
    subjectColor: note.subject.color,
    syllabusNodeId: note.syllabusNodeId,
    syllabusNodeTitle: note.syllabusNode?.title ?? null,
    relatedSyllabusNodeIds: (note.relatedSyllabusNodes ?? []).map((row) => row.syllabusNodeId),
    taskId: note.taskId,
    taskTitle: note.task?.title ?? null,
    kind: note.kind,
    studyDate: note.studyDate?.toISOString() ?? null,
    stableKey: note.stableKey,
    revision: note.revision,
    archivedAt: note.archivedAt?.toISOString() ?? null,
    title: note.title,
    content: note.content,
    masteryStatus: note.masteryStatus as NoteMasteryStatusDto | null,
    nextReviewAt: note.nextReviewAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    attachments: note.attachments.map(serializeAttachment),
    relatedSyllabusNodes: note.relatedSyllabusNodes.map((row) => ({
      id: row.syllabusNode.id,
      title: row.syllabusNode.title,
      archivedAt: row.syllabusNode.archivedAt?.toISOString() ?? null,
    })),
    linkedResources: detail?.studyResourceLinks.map((link) => ({
      id: link.resource.id,
      title: link.resource.title,
      sourceType: link.resource.sourceType,
      archivedAt: link.resource.archivedAt?.toISOString() ?? null,
    })) ?? [],
    reviewSchedule: schedule ? {
      id: schedule.id,
      status: schedule.status as "ACTIVE" | "PAUSED",
      dueDate: schedule.dueDate?.toISOString() ?? null,
      pausedReason: schedule.pausedReason,
      consecutivePassCount: schedule.consecutivePassCount,
      revision: schedule.revision,
      events: schedule.events.map((event) => ({
        id: event.id,
        result: event.result as "PASSED" | "PARTIAL" | "FAILED",
        durationSeconds: event.durationSeconds,
        confirmedAt: event.confirmedAt.toISOString(),
        nextDueDate: event.nextDueDate.toISOString(),
        correctedEventId: event.correctedEventId,
        note: event.note,
      })),
    } : null,
  };
}
