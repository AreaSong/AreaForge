import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { serializeAttachment } from "./attachments-service";
import type { NoteDto, NoteMasteryStatusDto } from "./types";

export interface CreateNoteInput {
  subjectId: string;
  syllabusNodeId?: string | null;
  taskId?: string | null;
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
      attachments: {
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return notes.map(serializeNote);
}

export async function createNote(input: CreateNoteInput, actorId: string): Promise<NoteDto> {
  await assertSubjectExists(input.subjectId);

  if (input.syllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId);
  }

  if (input.taskId) {
    await assertTaskBelongsToSubject(input.taskId, input.subjectId);
  }

  const note = await prisma.note.create({
    data: {
      subjectId: input.subjectId,
      syllabusNodeId: input.syllabusNodeId ?? null,
      taskId: input.taskId ?? null,
      title: input.title,
      content: input.content,
      masteryStatus: input.masteryStatus ?? null,
      nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
    },
    include: {
      subject: true,
      syllabusNode: true,
      task: true,
      attachments: true,
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
  attachments: Array<{
    id: string;
    noteId: string | null;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    hash: string;
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
    taskId: note.taskId,
    taskTitle: note.task?.title ?? null,
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
