import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import type { MistakeCauseDto, MistakeDto } from "./types";

type DbMistakeCause =
  | "UNKNOWN"
  | "CONCEPT_CONFUSION"
  | "FORMULA_UNFAMILIAR"
  | "WRONG_APPROACH"
  | "CARELESS"
  | "TIME_PRESSURE"
  | "UNFAMILIAR_PATTERN";

export interface CreateMistakeInput {
  subjectId: string;
  syllabusNodeId?: string | null;
  title: string;
  source?: string | null;
  cause: MistakeCauseDto;
  correctIdea?: string | null;
  nextReviewAt?: string | null;
}

export interface UpdateMistakeInput {
  subjectId?: string;
  syllabusNodeId?: string | null;
  title?: string;
  source?: string | null;
  cause?: MistakeCauseDto;
  correctIdea?: string | null;
  nextReviewAt?: string | null;
}

export async function listMistakes(): Promise<MistakeDto[]> {
  const mistakes = await prisma.mistake.findMany({
    include: {
      subject: true,
      syllabusNode: true,
    },
    orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return mistakes.map(serializeMistake);
}

export async function createMistake(input: CreateMistakeInput, actorId: string): Promise<MistakeDto> {
  await assertSubjectExists(input.subjectId);
  if (input.syllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId);
  }

  const mistake = await prisma.mistake.create({
    data: {
      subjectId: input.subjectId,
      syllabusNodeId: input.syllabusNodeId ?? null,
      title: input.title,
      source: input.source ?? null,
      cause: toDbCause(input.cause),
      correctIdea: input.correctIdea ?? null,
      nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
    },
    include: {
      subject: true,
      syllabusNode: true,
    },
  });

  await audit(actorId, "MISTAKE_CREATED", "Mistake", mistake.id);
  return serializeMistake(mistake);
}

export async function updateMistake(id: string, input: UpdateMistakeInput, actorId: string): Promise<MistakeDto> {
  const existing = await prisma.mistake.findUnique({
    where: { id },
    select: {
      subjectId: true,
      syllabusNodeId: true,
    },
  });

  if (!existing) {
    throw new ApiError("MISTAKE_NOT_FOUND", 404);
  }

  if (input.subjectId) {
    await assertSubjectExists(input.subjectId);
  }

  const resolvedSubjectId = input.subjectId ?? existing.subjectId;
  const resolvedSyllabusNodeId = input.syllabusNodeId === undefined ? existing.syllabusNodeId : input.syllabusNodeId;
  if (resolvedSyllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(resolvedSyllabusNodeId, resolvedSubjectId);
  }

  const mistake = await prisma.mistake.update({
    where: { id },
    data: {
      subjectId: input.subjectId,
      syllabusNodeId: input.syllabusNodeId,
      title: input.title,
      source: input.source,
      cause: input.cause ? toDbCause(input.cause) : undefined,
      correctIdea: input.correctIdea,
      nextReviewAt: input.nextReviewAt === undefined ? undefined : input.nextReviewAt ? new Date(input.nextReviewAt) : null,
    },
    include: {
      subject: true,
      syllabusNode: true,
    },
  });

  await audit(actorId, "MISTAKE_UPDATED", "Mistake", mistake.id);
  return serializeMistake(mistake);
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

function serializeMistake(mistake: {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  title: string;
  source: string | null;
  cause: DbMistakeCause;
  correctIdea: string | null;
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
}): MistakeDto {
  return {
    id: mistake.id,
    subjectId: mistake.subjectId,
    subjectName: mistake.subject.name,
    subjectColor: mistake.subject.color,
    syllabusNodeId: mistake.syllabusNodeId,
    syllabusNodeTitle: mistake.syllabusNode?.title ?? null,
    title: mistake.title,
    source: mistake.source,
    cause: fromDbCause(mistake.cause),
    correctIdea: mistake.correctIdea,
    nextReviewAt: mistake.nextReviewAt?.toISOString() ?? null,
    createdAt: mistake.createdAt.toISOString(),
    updatedAt: mistake.updatedAt.toISOString(),
  };
}

function toDbCause(cause: MistakeCauseDto): DbMistakeCause {
  return cause.toUpperCase() as DbMistakeCause;
}

function fromDbCause(cause: DbMistakeCause): MistakeCauseDto {
  return cause.toLowerCase() as MistakeCauseDto;
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
