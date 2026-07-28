import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";
import { pauseScheduleOnTargetArchive } from "./review-schedule-service";
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
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  title: string;
  source?: string | null;
  cause: MistakeCauseDto;
  correctIdea?: string | null;
  nextReviewAt?: string | null;
}

export interface UpdateMistakeInput {
  expectedUpdatedAt: string;
  subjectId?: string;
  syllabusNodeId?: string | null;
  title?: string;
  source?: string | null;
  cause?: MistakeCauseDto;
  correctIdea?: string | null;
  nextReviewAt?: string | null;
}

export interface OwnedMistakeDetailDto {
  mistake: MistakeDto;
  readOnly: boolean;
  subjectArchived: boolean;
  workspaceName: string;
}

const mistakeDetailInclude = {
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
      ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}),
    },
    include: {
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
    },
    orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return mistakes.map(serializeMistake);
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
    source: input.source ?? null,
    cause: input.cause,
    correctIdea: input.correctIdea?.trim() ?? null,
    nextReviewAt: input.nextReviewAt ?? null,
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

    const created = await tx.mistake.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        title: input.title,
        source: input.source ?? null,
        cause: toDbCause(input.cause),
        correctIdea: input.correctIdea.trim(),
        nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

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

    const existingComplete = isCompleteMistake(existing.cause, existing.correctIdea);
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
    if (!isCompleteMistake(nextCause, nextCorrectIdea)) {
      throw new ApiError(existingComplete ? "MISTAKE_INCOMPLETE" : "MISTAKE_COMPLETION_REQUIRED", existingComplete ? 400 : 409, {
        latest,
        conflictFields: ["cause", "correctIdea"],
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
        source: input.source,
        cause: input.cause ? toDbCause(input.cause) : undefined,
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

function isCompleteMistake(cause: DbMistakeCause, correctIdea: string | null): boolean {
  return cause !== "UNKNOWN" && Boolean(correctIdea?.trim());
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
    input.source !== undefined && input.source !== latest.source ? "source" : null,
    input.cause !== undefined && input.cause !== latest.cause ? "cause" : null,
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
  source: string | null;
  cause: DbMistakeCause;
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
    source: mistake.source,
    cause: fromDbCause(mistake.cause),
    correctIdea: mistake.correctIdea,
    nextReviewAt: mistake.nextReviewAt?.toISOString() ?? null,
    archivedAt: mistake.archivedAt?.toISOString() ?? null,
    createdAt: mistake.createdAt.toISOString(),
    updatedAt: mistake.updatedAt.toISOString(),
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

function toDbCause(cause: MistakeCauseDto): DbMistakeCause {
  return cause.toUpperCase() as DbMistakeCause;
}

function fromDbCause(cause: DbMistakeCause): MistakeCauseDto {
  return cause.toLowerCase() as MistakeCauseDto;
}

async function audit(actorId: string, action: string, entityType: string, entityId: string, client: Prisma.TransactionClient): Promise<void> {
  await client.auditEvent.create({ data: { actorId, action, entityType, entityId } });
}
