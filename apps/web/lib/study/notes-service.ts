import { isNoteKind, normalizeRelatedNodeIds } from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { serializeAttachment } from "./attachments-service";
import type { NoteDto, NoteMasteryStatusDto } from "./types";

export interface CreateNoteInput {
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

export async function listNotes(): Promise<NoteDto[]> {
  const notes = await prisma.note.findMany({
    include: {
      subject: true,
      syllabusNode: true,
      task: true,
      relatedSyllabusNodes: true,
      attachments: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return notes.map(serializeNote);
}

export async function getNoteById(noteId: string): Promise<NoteDto | null> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: {
      subject: true,
      syllabusNode: true,
      task: true,
      relatedSyllabusNodes: true,
      attachments: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return note ? serializeNote(note) : null;
}

export async function createNote(input: CreateNoteInput, actorId: string): Promise<NoteDto> {
  await assertSubjectExists(input.subjectId);

  if (input.syllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId);
  }

  if (input.taskId) {
    await assertTaskBelongsToSubject(input.taskId, input.subjectId);
  }

  const kind = input.kind ?? "GENERAL";
  if (!isNoteKind(kind)) {
    throw new ApiError("INVALID_NOTE_KIND", 400);
  }

  const relatedIds = input.relatedSyllabusNodeIds ?? [];
  if (relatedIds.length > 0 || input.syllabusNodeId) {
    const nodeIds = Array.from(new Set([...(input.syllabusNodeId ? [input.syllabusNodeId] : []), ...relatedIds]));
    const nodes = await prisma.syllabusNode.findMany({
      where: { id: { in: nodeIds } },
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

  const note = await prisma.note.create({
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
      relatedSyllabusNodes: relatedIds.length
        ? {
            create: relatedIds
              .filter((id) => id !== input.syllabusNodeId)
              .map((syllabusNodeId) => ({ syllabusNodeId })),
          }
        : undefined,
    },
    include: {
      subject: true,
      syllabusNode: true,
      task: true,
      relatedSyllabusNodes: true,
      attachments: { where: { status: "READY" } },
    },
  });

  await audit(actorId, "NOTE_CREATED", "Note", note.id);
  return serializeNote(note);
}

async function assertSubjectExists(subjectId: string): Promise<void> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
}

async function assertTaskBelongsToSubject(taskId: string, subjectId: string): Promise<void> {
  const task = await prisma.studyTask.findUnique({
    where: { id: taskId },
    select: { subjectId: true },
  });

  if (!task) {
    throw new ApiError("TASK_NOT_FOUND", 404);
  }

  if (task.subjectId !== subjectId) {
    throw new ApiError("TASK_SUBJECT_MISMATCH", 400);
  }
}

function serializeNote(note: {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  taskId: string | null;
  kind: string;
  studyDate: Date | null;
  stableKey: string | null;
  revision: number;
  title: string;
  content: string;
  masteryStatus: string | null;
  nextReviewAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subject: {
    name: string;
    color: string;
  };
  syllabusNode?: {
    title: string;
  } | null;
  task?: {
    title: string;
  } | null;
  relatedSyllabusNodes?: Array<{ syllabusNodeId: string }>;
  attachments: Array<{
    id: string;
    noteId: string | null;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }>;
}): NoteDto {
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
    title: note.title,
    content: note.content,
    masteryStatus: note.masteryStatus as NoteMasteryStatusDto | null,
    nextReviewAt: note.nextReviewAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    attachments: note.attachments.map(serializeAttachment),
  };
}

async function audit(actorId: string, action: string, entityType: string, entityId: string): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
    },
  });
}
