import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  MistakeCreatePrefillDto,
  OwnedMistakeDetailDto,
} from "@/lib/contracts/knowledge-library";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";
import { pauseScheduleOnTargetArchive } from "./review-schedule-service";
import type { MistakeAttemptDto, MistakeCauseDto, MistakeDto } from "@/lib/contracts";

export type {
  MistakeCreatePrefillDto,
  OwnedMistakeDetailDto,
} from "@/lib/contracts/knowledge-library";

type DbMistakeCause =
  | "UNKNOWN"
  | "CONCEPT_CONFUSION"
  | "FORMULA_UNFAMILIAR"
  | "WRONG_APPROACH"
  | "CARELESS"
  | "TIME_PRESSURE"
  | "UNFAMILIAR_PATTERN";

export interface CreateMistakeInput {
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  title: string;
  questionText: string;
  source?: string | null;
  cause: MistakeCauseDto;
  causeNote?: string | null;
  correctAnswer?: string | null;
  correctIdea?: string | null;
  nextReviewAt?: string | null;
  simulationLossItemId?: string | null;
}

export interface UpdateMistakeInput {
  expectedUpdatedAt: string;
  subjectId?: string;
  syllabusNodeId?: string | null;
  title?: string;
  questionText?: string;
  source?: string | null;
  cause?: MistakeCauseDto;
  causeNote?: string | null;
  correctAnswer?: string | null;
  correctIdea?: string | null;
  nextReviewAt?: string | null;
}


const mistakeDetailInclude = {
  _count: { select: { attempts: true } },
  subject: true,
  syllabusNode: true,
  reviewSchedules: {
    include: {
      events: {
        orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
      },
    },
    orderBy: [{ createdAt: "desc" }],
  },
  attempts: {
    orderBy: [{ attemptedAt: "desc" as const }, { id: "desc" as const }],
    take: 50,
  },
  noteLinks: {
    include: { note: { select: { id: true, title: true } } },
    orderBy: [{ createdAt: "asc" as const }],
  },
  studyResourceLinks: {
    include: { resource: { select: { id: true, title: true } } },
    orderBy: [{ createdAt: "asc" as const }],
  },
} satisfies Prisma.MistakeInclude;

const ownedMistakeDetailInclude = {
  ...mistakeDetailInclude,
  subject: {
    include: {
      workspace: { select: { name: true, status: true } },
    },
  },
} satisfies Prisma.MistakeInclude;

type MistakeDetailRow = Prisma.MistakeGetPayload<{ include: typeof mistakeDetailInclude }>;

export async function listMistakes(actorId: string, options?: { q?: string }): Promise<MistakeDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const query = options?.q?.trim().slice(0, 120) || undefined;
  const mistakes = await prisma.mistake.findMany({
    where: {
      subject: { workspaceId: workspace.id },
      ...(query ? {
        OR: [
          { title: { contains: query, mode: "insensitive" as const } },
          { questionText: { contains: query, mode: "insensitive" as const } },
          { source: { contains: query, mode: "insensitive" as const } },
        ],
      } : {}),
    },
    include: {
      _count: { select: { attempts: true } },
      subject: true,
      syllabusNode: true,
      reviewSchedules: {
        select: {
          id: true,
          status: true,
          dueDate: true,
          pausedReason: true,
          consecutivePassCount: true,
          revision: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: "desc" }],
      },
      attempts: {
        orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
        take: 5,
      },
      noteLinks: {
        include: { note: { select: { id: true, title: true } } },
        orderBy: [{ createdAt: "asc" }],
      },
      studyResourceLinks: {
        include: { resource: { select: { id: true, title: true } } },
        orderBy: [{ createdAt: "asc" }],
      },
    },
    orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return mistakes.map(serializeMistake);
}

export async function getMistakeCreatePrefill(
  actorId: string,
  simulationLossItemId: string,
): Promise<MistakeCreatePrefillDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const item = await prisma.simulationLossItem.findFirst({
    where: {
      id: simulationLossItemId,
      archivedAt: null,
      simulationSubjectResult: { simulationExam: { workspaceId: workspace.id } },
    },
    include: {
      simulationSubjectResult: {
        include: {
          subject: { select: { id: true, name: true } },
          simulationExam: { select: { name: true } },
        },
      },
    },
  });
  if (!item) return null;
  const note = item.note?.trim() ?? "";
  return {
    simulationLossItemId: item.id,
    linkedMistakeId: item.mistakeId,
    subjectId: item.simulationSubjectResult.subject.id,
    syllabusNodeId: item.syllabusNodeId,
    title: note ? `模拟失分：${note.slice(0, 160)}` : `模拟失分：${simulationLossReasonLabel(item.reason)}`,
    questionText: note,
    source: `${item.simulationSubjectResult.simulationExam.name} · ${item.simulationSubjectResult.subject.name} · 失分 ${item.lostScore} 分`,
    cause: simulationReasonToMistakeCause(item.reason),
    causeNote: note,
  };
}

export async function getMistakeById(id: string, actorId: string): Promise<MistakeDto | null> {
  return (await getOwnedMistakeDetail(id, actorId))?.mistake ?? null;
}

export async function getOwnedMistakeDetail(id: string, actorId: string): Promise<OwnedMistakeDetailDto | null> {
  const mistake = await prisma.mistake.findFirst({
    where: { id, subject: { workspace: { userId: actorId } } },
    include: ownedMistakeDetailInclude,
  });
  if (!mistake?.subject.workspace) return null;
  const subjectArchived = Boolean(mistake.subject.archivedAt);
  return {
    mistake: serializeMistake(mistake),
    readOnly: mistake.subject.workspace.status !== "ACTIVE" || subjectArchived,
    subjectArchived,
    workspaceName: mistake.subject.workspace.name,
  };
}

export async function createMistake(input: CreateMistakeInput, actorId: string): Promise<MistakeDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("mistake-create-v1", {
    subjectId: input.subjectId,
    syllabusNodeId: input.syllabusNodeId ?? null,
    title: input.title,
    questionText: input.questionText.trim(),
    source: input.source ?? null,
    cause: input.cause,
    causeNote: input.causeNote?.trim() ?? null,
    correctAnswer: input.correctAnswer?.trim() ?? null,
    correctIdea: input.correctIdea?.trim() ?? null,
    nextReviewAt: input.nextReviewAt ?? null,
    simulationLossItemId: input.simulationLossItemId ?? null,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "MISTAKE_CREATED",
      entityType: "Mistake",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "MISTAKE_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseMistakeSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const storedMistake = await tx.mistake.findFirst({
        where: { id: replay.resultId, subject: { workspaceId: workspace.id } },
        include: { subject: true, syllabusNode: true },
      });
      if (!storedMistake) throw new ApiError("MISTAKE_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
      return serializeMistake(storedMistake);
    }
    await assertSubjectExists(input.subjectId, workspace.id, tx);
    if (input.syllabusNodeId) {
      await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId, tx, workspace.id);
    }
    if (input.cause === "unknown" || !input.correctIdea?.trim()) {
      throw new ApiError("MISTAKE_INCOMPLETE", 400);
    }

    const simulationLossItem = input.simulationLossItemId
      ? await tx.simulationLossItem.findFirst({
        where: {
          id: input.simulationLossItemId,
          simulationSubjectResult: { simulationExam: { workspaceId: workspace.id } },
        },
        select: { id: true, mistakeId: true, simulationSubjectResult: { select: { subjectId: true } } },
      })
      : null;
    if (input.simulationLossItemId && !simulationLossItem) throw new ApiError("SIMULATION_LOSS_ITEM_NOT_FOUND", 404);
    if (simulationLossItem?.mistakeId) throw new ApiError("SIMULATION_LOSS_ITEM_ALREADY_LINKED", 409);
    if (simulationLossItem && simulationLossItem.simulationSubjectResult.subjectId !== input.subjectId) {
      throw new ApiError("SIMULATION_LOSS_ITEM_SUBJECT_MISMATCH", 409);
    }

    const created = await tx.mistake.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        title: input.title,
        questionText: input.questionText.trim(),
        source: input.source ?? null,
        cause: toDbCause(input.cause),
        causeNote: input.causeNote?.trim() || null,
        correctAnswer: input.correctAnswer?.trim() || null,
        correctIdea: input.correctIdea.trim(),
        nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    if (simulationLossItem) {
      const linked = await tx.simulationLossItem.updateMany({
        where: { id: simulationLossItem.id, mistakeId: null },
        data: { mistakeId: created.id },
      });
      if (linked.count !== 1) throw new ApiError("SIMULATION_LOSS_ITEM_ALREADY_LINKED", 409);
    }

    const result = serializeMistake(created);
    await recordPersistentCreateResult(tx, command, created.id, {
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

function parseMistakeSnapshot(value: Prisma.JsonValue | undefined): MistakeDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  return {
    ...(value as unknown as MistakeDto),
    archivedAt: typeof value.archivedAt === "string" ? value.archivedAt : null,
    reviewSchedule: null,
    reviewHistory: [],
  };
}

export async function updateMistake(id: string, input: UpdateMistakeInput, actorId: string): Promise<MistakeDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await tx.mistake.findFirst({
      where: { id, subject: { workspaceId: workspace.id } },
      include: mistakeDetailInclude,
    });

    if (!existing) throw new ApiError("MISTAKE_NOT_FOUND", 404);
    const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
    const latest = serializeMistake(existing);
    if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw mistakeConflict("MISTAKE_UPDATED_AT_CONFLICT", latest, input);
    }
    if (existing.archivedAt) {
      throw new ApiError("MISTAKE_ARCHIVED", 409, {
        latest,
        conflictFields: ["archivedAt"],
        workbench: "/knowledge/mistakes",
      });
    }
    if (existing.subject.archivedAt) {
      throw new ApiError("SUBJECT_ARCHIVED", 409, {
        latest,
        conflictFields: ["subject.archivedAt"],
        workbench: "/knowledge/mistakes",
      });
    }

    const existingComplete = isCompleteMistake(existing.questionText, existing.cause, existing.correctIdea);
    const nonCompletionFields = changedNonCompletionFields(input);
    if (!existingComplete && nonCompletionFields.length > 0) {
      throw new ApiError("MISTAKE_COMPLETION_ONLY", 409, {
        latest,
        conflictFields: nonCompletionFields,
        workbench: "/knowledge/mistakes",
      });
    }

    const nextCause = input.cause ? toDbCause(input.cause) : existing.cause;
    const nextCorrectIdea = input.correctIdea === undefined
      ? existing.correctIdea
      : input.correctIdea?.trim() || null;
    const nextQuestionText = input.questionText === undefined ? existing.questionText : input.questionText.trim();
    if (!isCompleteMistake(nextQuestionText, nextCause, nextCorrectIdea)) {
      throw new ApiError(existingComplete ? "MISTAKE_INCOMPLETE" : "MISTAKE_COMPLETION_REQUIRED", existingComplete ? 400 : 409, {
        latest,
        conflictFields: ["questionText", "cause", "correctIdea"],
        workbench: "/knowledge/mistakes",
      });
    }

    if (input.subjectId) {
      await assertSubjectExists(input.subjectId, workspace.id, tx);
    }

    const resolvedSubjectId = input.subjectId ?? existing.subjectId;
    const resolvedSyllabusNodeId = input.syllabusNodeId === undefined ? existing.syllabusNodeId : input.syllabusNodeId;
    if (resolvedSyllabusNodeId) {
      await assertSyllabusNodeBelongsToSubject(resolvedSyllabusNodeId, resolvedSubjectId, tx, workspace.id);
    }

    const changed = await tx.mistake.updateMany({
      where: {
        id,
        updatedAt: expectedUpdatedAt,
        archivedAt: null,
        subject: { workspaceId: workspace.id, archivedAt: null },
      },
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId,
        title: input.title,
        questionText: input.questionText,
        source: input.source,
        cause: input.cause ? toDbCause(input.cause) : undefined,
        causeNote: input.causeNote === undefined ? undefined : input.causeNote,
        correctAnswer: input.correctAnswer === undefined ? undefined : input.correctAnswer,
        correctIdea: input.correctIdea === undefined ? undefined : nextCorrectIdea,
        nextReviewAt: input.nextReviewAt === undefined ? undefined : input.nextReviewAt ? new Date(input.nextReviewAt) : null,
      },
    });
    if (changed.count !== 1) {
      const raced = await loadMistakeDetail(tx, id, workspace.id);
      if (!raced) throw new ApiError("MISTAKE_NOT_FOUND", 404);
      throw mistakeConflict("MISTAKE_UPDATED_AT_CONFLICT", serializeMistake(raced), input);
    }

    await audit(actorId, "MISTAKE_UPDATED", "Mistake", id, tx);
    return serializeMistake(await loadMistakeDetailOrThrow(tx, id, workspace.id));
  });
}

export async function archiveMistake(id: string, expectedUpdatedAt: string, actorId: string): Promise<MistakeDto> {
  return mutateMistakeArchiveState(id, expectedUpdatedAt, actorId, true);
}

export async function restoreMistake(id: string, expectedUpdatedAt: string, actorId: string): Promise<MistakeDto> {
  return mutateMistakeArchiveState(id, expectedUpdatedAt, actorId, false);
}

export async function updateMistakeLinks(
  id: string,
  input: { expectedUpdatedAt: string; noteIds: string[]; resourceIds: string[] },
  actorId: string,
): Promise<MistakeDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await loadMistakeDetail(tx, id, workspace.id);
    if (!existing) throw new ApiError("MISTAKE_NOT_FOUND", 404);
    if (existing.archivedAt) throw new ApiError("MISTAKE_ARCHIVED", 409);
    if (existing.subject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);

    const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
    if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw mistakeConflict("MISTAKE_UPDATED_AT_CONFLICT", serializeMistake(existing), input as UpdateMistakeInput);
    }

    const [notes, resources] = await Promise.all([
      tx.note.findMany({ where: { id: { in: input.noteIds }, subject: { workspaceId: workspace.id } }, select: { id: true } }),
      tx.studyResource.findMany({ where: { id: { in: input.resourceIds }, workspaceId: workspace.id }, select: { id: true } }),
    ]);
    if (notes.length !== new Set(input.noteIds).size) throw new ApiError("NOTE_NOT_FOUND", 404);
    if (resources.length !== new Set(input.resourceIds).size) throw new ApiError("STUDY_RESOURCE_NOT_FOUND", 404);

    const claimed = await tx.mistake.updateMany({
      where: { id, updatedAt: expectedUpdatedAt, archivedAt: null, subject: { workspaceId: workspace.id, archivedAt: null } },
      data: { updatedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const raced = await loadMistakeDetail(tx, id, workspace.id);
      if (!raced) throw new ApiError("MISTAKE_NOT_FOUND", 404);
      throw mistakeConflict("MISTAKE_UPDATED_AT_CONFLICT", serializeMistake(raced), input as UpdateMistakeInput);
    }

    await tx.noteMistakeLink.deleteMany({ where: { mistakeId: id } });
    await tx.studyResourceMistakeLink.deleteMany({ where: { mistakeId: id } });
    if (input.noteIds.length) {
      await tx.noteMistakeLink.createMany({ data: input.noteIds.map((noteId) => ({ noteId, mistakeId: id })), skipDuplicates: true });
    }
    if (input.resourceIds.length) {
      await tx.studyResourceMistakeLink.createMany({ data: input.resourceIds.map((resourceId) => ({ resourceId, mistakeId: id })), skipDuplicates: true });
    }
    await audit(actorId, "MISTAKE_LINKS_UPDATED", "Mistake", id, tx);
    return serializeMistake(await loadMistakeDetailOrThrow(tx, id, workspace.id));
  });
}

async function mutateMistakeArchiveState(
  id: string,
  expectedUpdatedAtValue: string,
  actorId: string,
  archive: boolean,
): Promise<MistakeDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await loadMistakeDetail(tx, id, workspace.id);
    if (!existing) throw new ApiError("MISTAKE_NOT_FOUND", 404);

    const latest = serializeMistake(existing);
    const expectedUpdatedAt = parseExpectedUpdatedAt(expectedUpdatedAtValue);
    const hasExpectedState = archive ? existing.archivedAt === null : existing.archivedAt !== null;
    if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime() || !hasExpectedState) {
      throw new ApiError("MISTAKE_UPDATED_AT_CONFLICT", 409, {
        latest,
        conflictFields: ["updatedAt", "archivedAt"],
        workbench: "/knowledge/mistakes",
      });
    }
    if (existing.subject.archivedAt) {
      throw new ApiError("SUBJECT_ARCHIVED", 409, {
        latest,
        conflictFields: ["subject.archivedAt"],
        workbench: "/knowledge/mistakes",
      });
    }

    const archiveState: Prisma.MistakeWhereInput = archive
      ? { archivedAt: null }
      : { archivedAt: { not: null } };
    const changed = await tx.mistake.updateMany({
      where: {
        id,
        updatedAt: expectedUpdatedAt,
        subject: { workspaceId: workspace.id, archivedAt: null },
        ...archiveState,
      },
      data: { archivedAt: archive ? new Date() : null },
    });
    if (changed.count !== 1) {
      const raced = await loadMistakeDetail(tx, id, workspace.id);
      if (!raced) throw new ApiError("MISTAKE_NOT_FOUND", 404);
      throw new ApiError("MISTAKE_UPDATED_AT_CONFLICT", 409, {
        latest: serializeMistake(raced),
        conflictFields: ["updatedAt", "archivedAt"],
        workbench: "/knowledge/mistakes",
      });
    }

    if (archive) await pauseScheduleOnTargetArchive(tx, { mistakeId: id });
    await audit(actorId, archive ? "MISTAKE_ARCHIVED" : "MISTAKE_RESTORED", "Mistake", id, tx);
    return serializeMistake(await loadMistakeDetailOrThrow(tx, id, workspace.id));
  });
}

function parseExpectedUpdatedAt(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ApiError("INVALID_EXPECTED_UPDATED_AT", 400);
  return parsed;
}

function isCompleteMistake(questionText: string | null, cause: DbMistakeCause, correctIdea: string | null): boolean {
  return Boolean(questionText?.trim()) && cause !== "UNKNOWN" && Boolean(correctIdea?.trim());
}

function changedNonCompletionFields(input: UpdateMistakeInput): string[] {
  return [
    input.subjectId !== undefined ? "subjectId" : null,
    input.syllabusNodeId !== undefined ? "syllabusNodeId" : null,
    input.title !== undefined ? "title" : null,
    input.source !== undefined ? "source" : null,
    input.nextReviewAt !== undefined ? "nextReviewAt" : null,
  ].filter((field): field is string => field !== null);
}

function mistakeConflict(code: string, latest: MistakeDto, input: UpdateMistakeInput): ApiError {
  return new ApiError(code, 409, {
    latest,
    conflictFields: mistakeConflictFields(input, latest),
    workbench: "/knowledge/mistakes",
  });
}

function mistakeConflictFields(input: UpdateMistakeInput, latest: MistakeDto): string[] {
  return [
    "updatedAt",
    input.subjectId !== undefined && input.subjectId !== latest.subjectId ? "subjectId" : null,
    input.syllabusNodeId !== undefined && input.syllabusNodeId !== latest.syllabusNodeId ? "syllabusNodeId" : null,
    input.title !== undefined && input.title !== latest.title ? "title" : null,
    input.questionText !== undefined && (input.questionText.trim() || null) !== latest.questionText ? "questionText" : null,
    input.source !== undefined && input.source !== latest.source ? "source" : null,
    input.cause !== undefined && input.cause !== latest.cause ? "cause" : null,
    input.causeNote !== undefined && (input.causeNote?.trim() || null) !== latest.causeNote ? "causeNote" : null,
    input.correctAnswer !== undefined && (input.correctAnswer?.trim() || null) !== latest.correctAnswer ? "correctAnswer" : null,
    input.correctIdea !== undefined && (input.correctIdea?.trim() || null) !== latest.correctIdea ? "correctIdea" : null,
    input.nextReviewAt !== undefined && input.nextReviewAt !== latest.nextReviewAt ? "nextReviewAt" : null,
  ].filter((field): field is string => field !== null);
}

async function loadMistakeDetail(
  client: Prisma.TransactionClient,
  id: string,
  workspaceId: string,
): Promise<MistakeDetailRow | null> {
  return client.mistake.findFirst({
    where: { id, subject: { workspaceId } },
    include: mistakeDetailInclude,
  });
}

async function loadMistakeDetailOrThrow(
  client: Prisma.TransactionClient,
  id: string,
  workspaceId: string,
): Promise<MistakeDetailRow> {
  const mistake = await loadMistakeDetail(client, id, workspaceId);
  if (!mistake) throw new ApiError("MISTAKE_NOT_FOUND", 404);
  return mistake;
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

function serializeMistake(mistake: {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  title: string;
  questionText: string | null;
  source: string | null;
  cause: DbMistakeCause;
  causeNote: string | null;
  correctAnswer: string | null;
  correctIdea: string | null;
  nextReviewAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subject: {
    name: string;
    color: string;
  };
  syllabusNode?: {
    title: string;
  } | null;
  attempts?: Array<{
    id: string;
    reviewEventId: string | null;
    answerMode: string;
    answerText: string | null;
    result: string;
    durationSeconds: number | null;
    note: string | null;
    attemptedAt: Date;
  }>;
  _count?: { attempts: number };
  noteLinks?: Array<{ id: string; note: { id: string; title: string } }>;
  studyResourceLinks?: Array<{ id: string; resource: { id: string; title: string } }>;
  reviewSchedules?: Array<{
    id: string;
    status: string;
    dueDate: Date | null;
    pausedReason: string | null;
    consecutivePassCount: number;
    revision: number;
    updatedAt: Date;
    events?: Array<{
      id: string;
      reviewScheduleId: string;
      result: string;
      durationSeconds: number;
      confirmedAt: Date;
      learningDate: Date;
      nextDueDate: Date;
      consecutivePassDelta: number;
      correctedEventId: string | null;
      note: string | null;
      appliedRevision: number;
    }>;
  }>;
}): MistakeDto {
  const reviewSchedule = mistake.reviewSchedules?.[0] ?? null;
  const reviewHistory = (mistake.reviewSchedules ?? [])
    .flatMap((schedule) => schedule.events ?? [])
    .sort((left, right) => right.confirmedAt.getTime() - left.confirmedAt.getTime());
  return {
    id: mistake.id,
    subjectId: mistake.subjectId,
    subjectName: mistake.subject.name,
    subjectColor: mistake.subject.color,
    syllabusNodeId: mistake.syllabusNodeId,
    syllabusNodeTitle: mistake.syllabusNode?.title ?? null,
    title: mistake.title,
    questionText: mistake.questionText,
    source: mistake.source,
    cause: fromDbCause(mistake.cause),
    causeNote: mistake.causeNote,
    correctAnswer: mistake.correctAnswer,
    correctIdea: mistake.correctIdea,
    nextReviewAt: mistake.nextReviewAt?.toISOString() ?? null,
    archivedAt: mistake.archivedAt?.toISOString() ?? null,
    createdAt: mistake.createdAt.toISOString(),
    updatedAt: mistake.updatedAt.toISOString(),
    attemptCount: mistake._count?.attempts ?? mistake.attempts?.length ?? 0,
    lastAttemptAt: mistake.attempts?.[0]?.attemptedAt.toISOString() ?? null,
    attempts: (mistake.attempts ?? []).map(serializeAttempt),
    noteLinks: (mistake.noteLinks ?? []).map((link) => ({ id: link.id, noteId: link.note.id, title: link.note.title })),
    resourceLinks: (mistake.studyResourceLinks ?? []).map((link) => ({ id: link.id, resourceId: link.resource.id, title: link.resource.title })),
    reviewSchedule: reviewSchedule ? {
      id: reviewSchedule.id,
      status: reviewSchedule.status as "ACTIVE" | "PAUSED",
      dueDate: reviewSchedule.dueDate?.toISOString() ?? null,
      pausedReason: reviewSchedule.pausedReason,
      consecutivePassCount: reviewSchedule.consecutivePassCount,
      revision: reviewSchedule.revision,
      updatedAt: reviewSchedule.updatedAt.toISOString(),
    } : null,
    reviewHistory: reviewHistory.map((event) => ({
      id: event.id,
      reviewScheduleId: event.reviewScheduleId,
      result: event.result as "PASSED" | "PARTIAL" | "FAILED",
      durationSeconds: event.durationSeconds,
      confirmedAt: event.confirmedAt.toISOString(),
      learningDate: event.learningDate.toISOString(),
      nextDueDate: event.nextDueDate.toISOString(),
      consecutivePassDelta: event.consecutivePassDelta,
      correctedEventId: event.correctedEventId,
      note: event.note,
      appliedRevision: event.appliedRevision,
    })),
  };
}

function serializeAttempt(attempt: {
  id: string;
  reviewEventId: string | null;
  answerMode: string;
  answerText: string | null;
  result: string;
  durationSeconds: number | null;
  note: string | null;
  attemptedAt: Date;
}): MistakeAttemptDto {
  return {
    id: attempt.id,
    reviewEventId: attempt.reviewEventId,
    answerMode: attempt.answerMode as MistakeAttemptDto["answerMode"],
    answerText: attempt.answerText,
    result: attempt.result as MistakeAttemptDto["result"],
    durationSeconds: attempt.durationSeconds,
    note: attempt.note,
    attemptedAt: attempt.attemptedAt.toISOString(),
  };
}

function toDbCause(cause: MistakeCauseDto): DbMistakeCause {
  return cause.toUpperCase() as DbMistakeCause;
}

function fromDbCause(cause: DbMistakeCause): MistakeCauseDto {
  return cause.toLowerCase() as MistakeCauseDto;
}

function simulationReasonToMistakeCause(reason: string): Exclude<MistakeCauseDto, "unknown"> {
  if (reason === "CONCEPT_GAP" || reason === "READING_COMPREHENSION") return "concept_confusion";
  if (reason === "MEMORY_FORMULA") return "formula_unfamiliar";
  if (reason === "CALCULATION_CARELESS") return "careless";
  if (reason === "TIME_ALLOCATION" || reason === "UNANSWERED") return "time_pressure";
  if (reason === "UNFAMILIAR_PATTERN") return "unfamiliar_pattern";
  return "wrong_approach";
}

function simulationLossReasonLabel(reason: string): string {
  return ({
    CONCEPT_GAP: "概念缺口",
    MEMORY_FORMULA: "公式记忆",
    METHOD_ERROR: "方法错误",
    CALCULATION_CARELESS: "计算粗心",
    TIME_ALLOCATION: "时间分配",
    READING_COMPREHENSION: "审题理解",
    UNFAMILIAR_PATTERN: "题型陌生",
    MINDSET: "临场心态",
    UNANSWERED: "未作答",
    OTHER: "其他失分",
  } as Record<string, string>)[reason] ?? "模拟失分";
}

async function audit(actorId: string, action: string, entityType: string, entityId: string, client: Prisma.TransactionClient): Promise<void> {
  await client.auditEvent.create({ data: { actorId, action, entityType, entityId } });
}
