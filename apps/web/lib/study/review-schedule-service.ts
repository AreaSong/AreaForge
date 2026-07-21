import { createHash, randomUUID } from "node:crypto";
import {
  addShanghaiLearningDays,
  assertExpectedRevision,
  buildReviewRequestFingerprint,
  nextConsecutivePassCount,
  suggestReviewIntervalDays,
  validateReviewDurationSeconds,
  type ReviewResult,
  type ReviewTargetType,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { refreshWorkspaceCheckInSnapshotForDate } from "./check-in-service";

export interface ReviewScheduleDto {
  id: string;
  workspaceId: string;
  targetType: ReviewTargetType;
  noteId: string | null;
  mistakeId: string | null;
  studyResourceId: string | null;
  syllabusNodeId: string | null;
  status: "ACTIVE" | "PAUSED";
  dueDate: string | null;
  pausedReason: string | null;
  consecutivePassCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewEventDto {
  id: string;
  reviewScheduleId: string;
  result: ReviewResult;
  durationSeconds: number;
  confirmedAt: string;
  learningDate: string;
  nextDueDate: string;
  consecutivePassDelta: number;
  correctedEventId: string | null;
  note: string | null;
  appliedRevision: number;
}

type Tx = Prisma.TransactionClient;

function serializeSchedule(row: {
  id: string;
  workspaceId: string;
  targetType: string;
  noteId: string | null;
  mistakeId: string | null;
  studyResourceId: string | null;
  syllabusNodeId: string | null;
  status: string;
  dueDate: Date | null;
  pausedReason: string | null;
  consecutivePassCount: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}): ReviewScheduleDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    targetType: row.targetType as ReviewTargetType,
    noteId: row.noteId,
    mistakeId: row.mistakeId,
    studyResourceId: row.studyResourceId,
    syllabusNodeId: row.syllabusNodeId,
    status: row.status as "ACTIVE" | "PAUSED",
    dueDate: row.dueDate?.toISOString() ?? null,
    pausedReason: row.pausedReason,
    consecutivePassCount: row.consecutivePassCount,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeEvent(row: {
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
}): ReviewEventDto {
  return {
    id: row.id,
    reviewScheduleId: row.reviewScheduleId,
    result: row.result as ReviewResult,
    durationSeconds: row.durationSeconds,
    confirmedAt: row.confirmedAt.toISOString(),
    learningDate: row.learningDate.toISOString(),
    nextDueDate: row.nextDueDate.toISOString(),
    consecutivePassDelta: row.consecutivePassDelta,
    correctedEventId: row.correctedEventId,
    note: row.note,
    appliedRevision: row.appliedRevision,
  };
}

async function lockSchedule(tx: Tx, scheduleId: string) {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM "ReviewSchedule" WHERE "id" = ${scheduleId} FOR UPDATE`;
}

export async function listReviewSchedules(
  actorId: string,
  options?: { status?: "ACTIVE" | "PAUSED"; dueBefore?: Date },
): Promise<ReviewScheduleDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.reviewSchedule.findMany({
    where: {
      workspaceId: workspace.id,
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.dueBefore
        ? { dueDate: { lte: options.dueBefore }, status: "ACTIVE" }
        : {}),
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeSchedule);
}

export async function getReviewSchedule(actorId: string, scheduleId: string): Promise<ReviewScheduleDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const row = await prisma.reviewSchedule.findFirst({
    where: { id: scheduleId, workspaceId: workspace.id },
  });
  if (!row) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
  return serializeSchedule(row);
}

export async function materializeReviewSchedule(
  actorId: string,
  input: {
    targetType: ReviewTargetType;
    noteId?: string;
    mistakeId?: string;
    studyResourceId?: string;
    syllabusNodeId?: string;
    dueDate: string;
  },
): Promise<ReviewScheduleDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const dueDate = getStudyDayRange(new Date(input.dueDate)).start;
  await assertTargetOwned(workspace.id, input);

  const existing = await findExistingSchedule(workspace.id, input);
  if (existing) return serializeSchedule(existing);

  try {
    const created = await prisma.reviewSchedule.create({
      data: {
        workspaceId: workspace.id,
        targetType: input.targetType,
        noteId: input.noteId ?? null,
        mistakeId: input.mistakeId ?? null,
        studyResourceId: input.studyResourceId ?? null,
        syllabusNodeId: input.syllabusNodeId ?? null,
        status: "ACTIVE",
        dueDate,
        consecutivePassCount: 0,
        revision: 1,
        actorId,
      },
    });
    return serializeSchedule(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingSchedule(workspace.id, input);
      if (raced) return serializeSchedule(raced);
    }
    throw error;
  }
}

export async function rescheduleReview(
  actorId: string,
  scheduleId: string,
  input: { expectedRevision: number; dueDate: string },
): Promise<ReviewScheduleDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.reviewSchedule.findFirst({
    where: { id: scheduleId, workspaceId: workspace.id },
  });
  if (!existing) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
  if (existing.status !== "ACTIVE") throw new ApiError("REVIEW_SCHEDULE_PAUSED", 409);
  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
    throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
      latest: serializeSchedule(existing),
      conflictFields: ["revision"],
    });
  }

  const updated = await prisma.reviewSchedule.update({
    where: { id: existing.id },
    data: {
      dueDate: getStudyDayRange(new Date(input.dueDate)).start,
      revision: { increment: 1 },
    },
  });
  return serializeSchedule(updated);
}

export async function pauseReviewSchedule(
  actorId: string,
  scheduleId: string,
  input: { expectedRevision: number; reason: string },
): Promise<ReviewScheduleDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  return prisma.$transaction(async (tx) => {
    await lockSchedule(tx, scheduleId);
    const existing = await tx.reviewSchedule.findFirst({
      where: { id: scheduleId, workspaceId: workspace.id },
    });
    if (!existing) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
      throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
        latest: serializeSchedule(existing),
        conflictFields: ["revision"],
      });
    }
    if (existing.status === "PAUSED") return serializeSchedule(existing);

    const updated = await tx.reviewSchedule.update({
      where: { id: existing.id },
      data: {
        status: "PAUSED",
        dueDate: null,
        pausedReason: input.reason.trim() || "paused",
        revision: { increment: 1 },
      },
    });
    return serializeSchedule(updated);
  });
}

export async function resumeReviewSchedule(
  actorId: string,
  scheduleId: string,
  input: { expectedRevision: number; dueDate: string },
): Promise<ReviewScheduleDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  return prisma.$transaction(async (tx) => {
    await lockSchedule(tx, scheduleId);
    const existing = await tx.reviewSchedule.findFirst({
      where: { id: scheduleId, workspaceId: workspace.id },
    });
    if (!existing) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
      throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
        latest: serializeSchedule(existing),
        conflictFields: ["revision"],
      });
    }
    if (existing.status === "ACTIVE") {
      throw new ApiError("REVIEW_SCHEDULE_ALREADY_ACTIVE", 409, {
        latest: serializeSchedule(existing),
        conflictFields: ["status"],
      });
    }

    const updated = await tx.reviewSchedule.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        dueDate: getStudyDayRange(new Date(input.dueDate)).start,
        pausedReason: null,
        revision: { increment: 1 },
      },
    });
    return serializeSchedule(updated);
  });
}

type ConfirmReviewInput = {
  idempotencyKey: string;
  expectedRevision: number;
  result: ReviewResult;
  durationSeconds: number;
  nextDueDate?: string;
  note?: string | null;
};

async function confirmReviewEventInTx(
  tx: Tx,
  actorId: string,
  workspaceId: string,
  scheduleId: string,
  input: ConfirmReviewInput,
): Promise<{ schedule: ReviewScheduleDto; event: ReviewEventDto; reused: boolean }> {
  if (validateReviewDurationSeconds(input.durationSeconds) !== "ok") {
    throw new ApiError("REVIEW_INVALID_DURATION", 400);
  }
  const confirmedAt = new Date();
  const learningDay = getStudyDayRange(confirmedAt);

  await lockSchedule(tx, scheduleId);
  const schedule = await tx.reviewSchedule.findFirst({
    where: { id: scheduleId, workspaceId },
  });
  if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
  const nextPass = nextConsecutivePassCount({
    current: schedule.consecutivePassCount,
    result: input.result,
  });
  const suggestedDays = suggestReviewIntervalDays({
    result: input.result,
    consecutivePassCountAfter: nextPass,
  });
  const nextDueDate = input.nextDueDate
    ? getStudyDayRange(new Date(input.nextDueDate)).start
    : addShanghaiLearningDays(learningDay.start, suggestedDays);
  const fingerprint = buildReviewRequestFingerprint({
    result: input.result,
    durationSeconds: input.durationSeconds,
    nextDueDateKey: input.nextDueDate ? getStudyDayRange(nextDueDate).key : "AUTO",
    note: input.note,
  });

  const existingEvent = await tx.reviewEvent.findUnique({
    where: {
      reviewScheduleId_idempotencyKey: {
        reviewScheduleId: scheduleId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existingEvent) {
    if (existingEvent.requestFingerprint !== fingerprint) {
      throw new ApiError("REVIEW_IDEMPOTENCY_CONFLICT", 409, {
        latest: serializeEvent(existingEvent),
        conflictFields: ["requestFingerprint"],
      });
    }
    return {
      schedule: serializeSchedule(schedule),
      event: serializeEvent(existingEvent),
      reused: true,
    };
  }

  if (
    assertExpectedRevision({
      currentRevision: schedule.revision,
      expectedRevision: input.expectedRevision,
    }) === "revision_conflict"
  ) {
    throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
      latest: serializeSchedule(schedule),
      conflictFields: ["revision"],
    });
  }

  if (schedule.status !== "ACTIVE") {
    throw new ApiError("REVIEW_SCHEDULE_PAUSED", 409, {
      latest: serializeSchedule(schedule),
      conflictFields: ["status"],
    });
  }
  await assertTargetNotArchived(tx, schedule);

  const event = await tx.reviewEvent.create({
    data: {
      reviewScheduleId: scheduleId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      expectedRevision: input.expectedRevision,
      appliedRevision: schedule.revision + 1,
      result: input.result,
      durationSeconds: input.durationSeconds,
      confirmedAt,
      learningDate: learningDay.start,
      nextDueDate,
      consecutivePassDelta: nextPass - schedule.consecutivePassCount,
      note: input.note?.trim() || null,
      actorId,
    },
  });

  const updated = await tx.reviewSchedule.update({
    where: { id: schedule.id },
    data: {
      dueDate: nextDueDate,
      consecutivePassCount: nextPass,
      revision: { increment: 1 },
    },
  });

  if (schedule.targetType === "SYLLABUS_NODE" && schedule.syllabusNodeId) {
    await createSyllabusRetest(tx, {
      syllabusNodeId: schedule.syllabusNodeId,
      result: input.result,
      nextDueDate,
      reviewEventId: event.id,
      actorId,
      confirmedAt,
    });
  }

  await refreshWorkspaceCheckInSnapshotForDate(workspaceId, learningDay.start, tx);

  await tx.auditEvent.create({
    data: {
      actorId,
      action: "REVIEW_EVENT_CONFIRMED",
      entityType: "ReviewEvent",
      entityId: event.id,
      metadata: {
        scheduleId,
        result: input.result,
        durationSeconds: input.durationSeconds,
      },
    },
  });

  return {
    schedule: serializeSchedule(updated),
    event: serializeEvent(event),
    reused: false,
  };
}

export async function confirmReviewEvent(
  actorId: string,
  scheduleId: string,
  input: ConfirmReviewInput,
): Promise<{ schedule: ReviewScheduleDto; event: ReviewEventDto; reused: boolean }> {
  if (validateReviewDurationSeconds(input.durationSeconds) !== "ok") {
    throw new ApiError("REVIEW_INVALID_DURATION", 400);
  }
  const workspace = await resolveActiveWorkspace(actorId);
  return prisma.$transaction(async (tx) =>
    confirmReviewEventInTx(tx, actorId, workspace.id, scheduleId, input),
  );
}

export async function correctReviewEvent(
  actorId: string,
  eventId: string,
  input: {
    expectedRevision: number;
    result: ReviewResult;
    nextDueDate?: string;
    note?: string | null;
    idempotencyKey: string;
  },
): Promise<{ schedule: ReviewScheduleDto; event: ReviewEventDto; reused: boolean }> {
  const workspace = await resolveActiveWorkspace(actorId);

  return prisma.$transaction(async (tx) => {
    const original = await tx.reviewEvent.findFirst({
      where: { id: eventId },
      include: { reviewSchedule: true },
    });
    if (!original || original.reviewSchedule.workspaceId !== workspace.id) {
      throw new ApiError("REVIEW_EVENT_NOT_FOUND", 404);
    }

    await lockSchedule(tx, original.reviewScheduleId);
    const schedule = await tx.reviewSchedule.findUniqueOrThrow({
      where: { id: original.reviewScheduleId },
    });

    const allEvents = await tx.reviewEvent.findMany({
      where: { reviewScheduleId: schedule.id },
      orderBy: { confirmedAt: "desc" },
    });
    const correctedIds = new Set(
      allEvents.filter((e) => e.correctedEventId).map((e) => e.correctedEventId as string),
    );
    const latestEffective = allEvents.find((e) => !correctedIds.has(e.id));
    if (!latestEffective || latestEffective.id !== original.id) {
      throw new ApiError("REVIEW_EVENT_NOT_LATEST", 409, {
        latest: latestEffective ? serializeEvent(latestEffective) : serializeSchedule(schedule),
        conflictFields: ["eventId"],
      });
    }

    const effectiveWithoutOriginal = allEvents.filter(
      (e) => !correctedIds.has(e.id) && e.id !== original.id,
    );
    let consecutive = 0;
    for (const e of [...effectiveWithoutOriginal].reverse()) {
      consecutive = nextConsecutivePassCount({ current: consecutive, result: e.result as ReviewResult });
    }
    const correctedPass = nextConsecutivePassCount({ current: consecutive, result: input.result });

    const nextDueDate = input.nextDueDate
      ? getStudyDayRange(new Date(input.nextDueDate)).start
      : addShanghaiLearningDays(
          original.learningDate,
          suggestReviewIntervalDays({
            result: input.result,
            consecutivePassCountAfter: correctedPass,
          }),
        );
    const fingerprint = buildReviewRequestFingerprint({
      result: input.result,
      durationSeconds: original.durationSeconds,
      nextDueDateKey: input.nextDueDate
        ? getStudyDayRange(nextDueDate).key
        : "AUTO",
      note: input.note,
      correctedEventId: original.id,
    });

    const existing = await tx.reviewEvent.findUnique({
      where: {
        reviewScheduleId_idempotencyKey: {
          reviewScheduleId: schedule.id,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ApiError("REVIEW_IDEMPOTENCY_CONFLICT", 409, {
          latest: serializeEvent(existing),
          conflictFields: ["requestFingerprint"],
        });
      }
      return { schedule: serializeSchedule(schedule), event: serializeEvent(existing), reused: true };
    }

    if (
      assertExpectedRevision({
        currentRevision: schedule.revision,
        expectedRevision: input.expectedRevision,
      }) === "revision_conflict"
    ) {
      throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
        latest: serializeSchedule(schedule),
        conflictFields: ["revision"],
      });
    }

    const existingCorrection = await tx.reviewEvent.findFirst({
      where: { correctedEventId: original.id },
    });
    if (existingCorrection) {
      throw new ApiError("REVIEW_CORRECTION_EXISTS", 409, {
        latest: serializeEvent(existingCorrection),
        conflictFields: ["correctedEventId"],
      });
    }

    const event = await tx.reviewEvent.create({
      data: {
        reviewScheduleId: schedule.id,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        expectedRevision: input.expectedRevision,
        appliedRevision: schedule.revision + 1,
        result: input.result,
        durationSeconds: original.durationSeconds,
        confirmedAt: new Date(),
        learningDate: original.learningDate,
        nextDueDate,
        consecutivePassDelta: correctedPass - schedule.consecutivePassCount,
        correctedEventId: original.id,
        note: input.note?.trim() || null,
        actorId,
      },
    });

    const updated = await tx.reviewSchedule.update({
      where: { id: schedule.id },
      data: {
        dueDate: schedule.status === "ACTIVE" ? nextDueDate : null,
        consecutivePassCount: correctedPass,
        revision: { increment: 1 },
      },
    });

    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, original.learningDate, tx);

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "REVIEW_EVENT_CORRECTED",
        entityType: "ReviewEvent",
        entityId: event.id,
        metadata: { originalEventId: original.id, result: input.result },
      },
    });

    return { schedule: serializeSchedule(updated), event: serializeEvent(event), reused: false };
  });
}

export async function createBridgeTask(
  actorId: string,
  input: {
    reviewScheduleId: string;
    subjectId: string;
    title: string;
    type?: string;
    estimatedMinutes?: number;
  },
): Promise<{ taskId: string; schedule: ReviewScheduleDto }> {
  const workspace = await resolveActiveWorkspace(actorId);
  const schedule = await prisma.reviewSchedule.findFirst({
    where: { id: input.reviewScheduleId, workspaceId: workspace.id },
  });
  if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
  if (schedule.status !== "ACTIVE" || !schedule.dueDate) {
    throw new ApiError("REVIEW_SCHEDULE_NOT_BRIDGABLE", 409);
  }

  try {
    const task = await prisma.studyTask.create({
      data: {
        subjectId: input.subjectId,
        title: input.title.trim(),
        type: input.type ?? "review",
        status: "TODO",
        plannedDate: schedule.dueDate,
        estimatedMinutes: input.estimatedMinutes ?? 25,
        reviewScheduleId: schedule.id,
      },
    });
    return { taskId: task.id, schedule: serializeSchedule(schedule) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError("REVIEW_BRIDGE_ALREADY_EXISTS", 409);
    }
    throw error;
  }
}

export async function completeBridgeTaskWithReview(
  actorId: string,
  taskId: string,
  input: ConfirmReviewInput,
): Promise<{ schedule: ReviewScheduleDto; event: ReviewEventDto; taskId: string }> {
  if (validateReviewDurationSeconds(input.durationSeconds) !== "ok") {
    throw new ApiError("REVIEW_INVALID_DURATION", 400);
  }
  const workspace = await resolveActiveWorkspace(actorId);

  return prisma.$transaction(async (tx) => {
    const task = await tx.studyTask.findFirst({
      where: { id: taskId },
      include: { reviewSchedule: true },
    });
    if (!task?.reviewScheduleId || !task.reviewSchedule) {
      throw new ApiError("REVIEW_BRIDGE_REQUIRED", 400);
    }
    if (task.reviewSchedule.workspaceId !== workspace.id) {
      throw new ApiError("STUDY_TASK_NOT_FOUND", 404);
    }
    if (task.status === "DONE") {
      throw new ApiError("STUDY_TASK_ALREADY_DONE", 409);
    }
    if (!["TODO", "IN_PROGRESS", "DEFERRED"].includes(task.status)) {
      throw new ApiError("TASK_STATE_CONFLICT", 409);
    }

    const confirmed = await confirmReviewEventInTx(
      tx,
      actorId,
      workspace.id,
      task.reviewScheduleId,
      input,
    );

    if (!confirmed.event.result) {
      throw new ApiError("REVIEW_BRIDGE_COMPLETE_REQUIRES_RESULT", 409);
    }

    const cas = await tx.studyTask.updateMany({
      where: {
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
        reviewScheduleId: task.reviewScheduleId,
      },
      data: {
        status: "DONE",
        debtStatus: "NONE",
        completedAt: new Date(),
      },
    });
    if (cas.count !== 1) {
      throw new ApiError("TASK_STATE_CONFLICT", 409);
    }

    return { ...confirmed, taskId: task.id };
  });
}

export async function deferBridgeTask(
  actorId: string,
  taskId: string,
  input: { expectedScheduleRevision: number; plannedDate: string },
): Promise<{ taskId: string; schedule: ReviewScheduleDto }> {
  const workspace = await resolveActiveWorkspace(actorId);
  return prisma.$transaction(async (tx) => {
    const task = await tx.studyTask.findFirst({
      where: { id: taskId },
      include: { reviewSchedule: true },
    });
    if (!task?.reviewSchedule || task.reviewSchedule.workspaceId !== workspace.id) {
      throw new ApiError("STUDY_TASK_NOT_FOUND", 404);
    }
    await lockSchedule(tx, task.reviewSchedule.id);
    const schedule = await tx.reviewSchedule.findUniqueOrThrow({ where: { id: task.reviewSchedule.id } });
    if (
      assertExpectedRevision({
        currentRevision: schedule.revision,
        expectedRevision: input.expectedScheduleRevision,
      }) === "revision_conflict"
    ) {
      throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
        latest: serializeSchedule(schedule),
        conflictFields: ["revision"],
      });
    }
    const day = getStudyDayRange(new Date(input.plannedDate)).start;
    await tx.studyTask.update({
      where: { id: task.id },
      data: { plannedDate: day, status: "DEFERRED" },
    });
    const updated = await tx.reviewSchedule.update({
      where: { id: schedule.id },
      data: { dueDate: day, revision: { increment: 1 } },
    });
    return { taskId: task.id, schedule: serializeSchedule(updated) };
  });
}

export async function abandonBridgeTask(actorId: string, taskId: string): Promise<ReviewScheduleDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const task = await prisma.studyTask.findFirst({
    where: { id: taskId },
    include: { reviewSchedule: true },
  });
  if (!task?.reviewSchedule || task.reviewSchedule.workspaceId !== workspace.id) {
    throw new ApiError("STUDY_TASK_NOT_FOUND", 404);
  }
  await prisma.studyTask.update({
    where: { id: task.id },
    data: { status: "SKIPPED", reviewScheduleId: task.reviewScheduleId },
  });
  return serializeSchedule(task.reviewSchedule);
}

export async function pauseScheduleOnTargetArchive(
  tx: Tx,
  input: {
    noteId?: string;
    mistakeId?: string;
    studyResourceId?: string;
    syllabusNodeId?: string;
  },
): Promise<void> {
  const schedule = await tx.reviewSchedule.findFirst({
    where: {
      OR: [
        input.noteId ? { noteId: input.noteId } : undefined,
        input.mistakeId ? { mistakeId: input.mistakeId } : undefined,
        input.studyResourceId ? { studyResourceId: input.studyResourceId } : undefined,
        input.syllabusNodeId ? { syllabusNodeId: input.syllabusNodeId } : undefined,
      ].filter(Boolean) as Prisma.ReviewScheduleWhereInput[],
      status: "ACTIVE",
    },
  });
  if (!schedule) return;
  await tx.reviewSchedule.update({
    where: { id: schedule.id },
    data: {
      status: "PAUSED",
      dueDate: null,
      pausedReason: "target_archived",
      revision: { increment: 1 },
    },
  });
}

async function createSyllabusRetest(
  tx: Tx,
  input: {
    syllabusNodeId: string;
    result: ReviewResult;
    nextDueDate: Date;
    reviewEventId: string;
    actorId: string;
    confirmedAt: Date;
  },
) {
  const retestResult =
    input.result === "PASSED" ? "passed" : input.result === "PARTIAL" ? "partial" : "failed";
  const retest = await tx.masteryRetest.create({
    data: {
      syllabusNodeId: input.syllabusNodeId,
      testedAt: input.confirmedAt,
      result: retestResult,
      nextReviewAt: input.nextDueDate,
      reviewEventId: input.reviewEventId,
      actorId: input.actorId,
    },
  });
  if (input.result === "PASSED") {
    await tx.masteryEvidence.create({
      data: {
        syllabusNodeId: input.syllabusNodeId,
        evidenceType: "retest",
        retestId: retest.id,
        actorId: input.actorId,
      },
    });
  }
}

async function assertTargetOwned(
  workspaceId: string,
  input: {
    targetType: ReviewTargetType;
    noteId?: string;
    mistakeId?: string;
    studyResourceId?: string;
    syllabusNodeId?: string;
  },
) {
  if (input.targetType === "NOTE" && input.noteId) {
    const note = await prisma.note.findFirst({
      where: { id: input.noteId, subject: { workspaceId } },
    });
    if (!note || note.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return;
  }
  if (input.targetType === "MISTAKE" && input.mistakeId) {
    const mistake = await prisma.mistake.findFirst({
      where: { id: input.mistakeId, subject: { workspaceId } },
    });
    if (!mistake || mistake.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return;
  }
  if (input.targetType === "STUDY_RESOURCE" && input.studyResourceId) {
    const resource = await prisma.studyResource.findFirst({
      where: { id: input.studyResourceId, workspaceId },
    });
    if (!resource || resource.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return;
  }
  if (input.targetType === "SYLLABUS_NODE" && input.syllabusNodeId) {
    const node = await prisma.syllabusNode.findFirst({
      where: { id: input.syllabusNodeId, subject: { workspaceId } },
    });
    if (!node || node.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return;
  }
  throw new ApiError("REVIEW_TARGET_INVALID", 400);
}

async function assertTargetNotArchived(tx: Tx, schedule: {
  targetType: string;
  noteId: string | null;
  mistakeId: string | null;
  studyResourceId: string | null;
  syllabusNodeId: string | null;
}) {
  if (schedule.noteId) {
    const note = await tx.note.findUnique({ where: { id: schedule.noteId } });
    if (!note || note.archivedAt) throw new ApiError("REVIEW_TARGET_ARCHIVED", 409);
  }
  if (schedule.mistakeId) {
    const mistake = await tx.mistake.findUnique({ where: { id: schedule.mistakeId } });
    if (!mistake || mistake.archivedAt) throw new ApiError("REVIEW_TARGET_ARCHIVED", 409);
  }
  if (schedule.studyResourceId) {
    const resource = await tx.studyResource.findUnique({ where: { id: schedule.studyResourceId } });
    if (!resource || resource.archivedAt) throw new ApiError("REVIEW_TARGET_ARCHIVED", 409);
  }
  if (schedule.syllabusNodeId) {
    const node = await tx.syllabusNode.findUnique({ where: { id: schedule.syllabusNodeId } });
    if (!node || node.archivedAt) throw new ApiError("REVIEW_TARGET_ARCHIVED", 409);
  }
}

async function findExistingSchedule(
  workspaceId: string,
  input: {
    noteId?: string;
    mistakeId?: string;
    studyResourceId?: string;
    syllabusNodeId?: string;
  },
) {
  return prisma.reviewSchedule.findFirst({
    where: {
      workspaceId,
      OR: [
        input.noteId ? { noteId: input.noteId } : undefined,
        input.mistakeId ? { mistakeId: input.mistakeId } : undefined,
        input.studyResourceId ? { studyResourceId: input.studyResourceId } : undefined,
        input.syllabusNodeId ? { syllabusNodeId: input.syllabusNodeId } : undefined,
      ].filter(Boolean) as Prisma.ReviewScheduleWhereInput[],
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/** @internal test helper — stable fingerprint hash */
export function hashFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
