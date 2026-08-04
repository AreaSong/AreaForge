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
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { refreshWorkspaceCheckInSnapshotForDate } from "./check-in-service";
import { applyRecoveryV2CheckInProgressInTx } from "./recovery-v2-service";

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

export interface BridgedReviewScheduleDto {
  schedule: ReviewScheduleDto;
  target: ReviewQueueTargetDto;
  canonicalTask: {
    id: string;
    title: string;
    status: "TODO" | "IN_PROGRESS" | "DEFERRED";
    href: string;
  };
}

export interface RecentReviewEventDto extends ReviewEventDto {
  schedule: Pick<ReviewScheduleDto, "id" | "targetType">;
  target: ReviewQueueTargetDto;
}

export interface ReviewQueueTargetDto {
  title: string;
  subtitle: string;
  canonicalHref: string;
}

export interface ReviewQueueItemDto {
  schedule: ReviewScheduleDto;
  target: ReviewQueueTargetDto;
}

export interface ReviewWorkbenchSummaryDto {
  overdueCount: number;
  dueTodayCount: number;
  completedTodayCount: number;
  completedTodaySeconds: number;
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
  options?: { status?: "ACTIVE" | "PAUSED"; dueBefore?: Date; excludeBridged?: boolean },
): Promise<ReviewScheduleDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.reviewSchedule.findMany({
    where: {
      workspaceId: workspace.id,
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.dueBefore
        ? { dueDate: { lte: options.dueBefore }, status: "ACTIVE" }
        : {}),
      ...(options?.excludeBridged
        ? { bridgeTasks: { none: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } } } }
        : {}),
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeSchedule);
}

export async function listReviewQueueItems(
  actorId: string,
  options?: { status?: "ACTIVE" | "PAUSED"; dueBefore?: Date; excludeBridged?: boolean },
): Promise<ReviewQueueItemDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.reviewSchedule.findMany({
    where: {
      workspaceId: workspace.id,
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.dueBefore ? { dueDate: { lte: options.dueBefore }, status: "ACTIVE" } : {}),
      ...(options?.excludeBridged
        ? { bridgeTasks: { none: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } } } }
        : {}),
    },
    include: reviewQueueTargetInclude,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({ schedule: serializeSchedule(row), target: serializeQueueTarget(row) }));
}

export async function getReviewWorkbenchSummary(
  actorId: string,
  now = new Date(),
): Promise<ReviewWorkbenchSummaryDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const today = getStudyDayRange(now);
  const executableWhere: Prisma.ReviewScheduleWhereInput = {
    workspaceId: workspace.id,
    status: "ACTIVE",
    bridgeTasks: { none: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } } },
  };
  const [overdueCount, dueTodayCount, completed] = await Promise.all([
    prisma.reviewSchedule.count({ where: { ...executableWhere, dueDate: { lt: today.start } } }),
    prisma.reviewSchedule.count({ where: { ...executableWhere, dueDate: { gte: today.start, lte: today.end } } }),
    prisma.reviewEvent.aggregate({
      where: {
        reviewSchedule: { workspaceId: workspace.id },
        confirmedAt: { gte: today.start, lte: today.end },
      },
      _count: { id: true },
      _sum: { durationSeconds: true },
    }),
  ]);
  return {
    overdueCount,
    dueTodayCount,
    completedTodayCount: completed._count.id,
    completedTodaySeconds: completed._sum.durationSeconds ?? 0,
  };
}

export async function listBridgedReviewSchedules(actorId: string): Promise<BridgedReviewScheduleDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.reviewSchedule.findMany({
    where: {
      workspaceId: workspace.id,
      bridgeTasks: { some: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } } },
    },
    include: {
      ...reviewQueueTargetInclude,
      bridgeTasks: {
        where: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } },
        select: { id: true, title: true, status: true },
        orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  return rows.flatMap((row) => row.bridgeTasks.map((task) => ({
    schedule: serializeSchedule(row),
    target: serializeQueueTarget(row),
    canonicalTask: {
      id: task.id,
      title: task.title,
      status: task.status as "TODO" | "IN_PROGRESS" | "DEFERRED",
      href: `/roadmap/arrangements/tasks/${task.id}`,
    },
  })));
}

export async function listRecentReviewEvents(actorId: string, limit = 12): Promise<RecentReviewEventDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.reviewEvent.findMany({
    where: { reviewSchedule: { workspaceId: workspace.id } },
    include: { reviewSchedule: { include: reviewQueueTargetInclude } },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(limit, 30)),
  });
  return rows.map((row) => ({
    ...serializeEvent(row),
    schedule: { id: row.reviewSchedule.id, targetType: row.reviewSchedule.targetType as ReviewScheduleDto["targetType"] },
    target: serializeQueueTarget(row.reviewSchedule),
  }));
}

const reviewQueueTargetInclude = {
  note: { select: { id: true, title: true, kind: true, subject: { select: { name: true } } } },
  mistake: { select: { id: true, title: true, subject: { select: { name: true } } } },
  studyResource: { select: { id: true, title: true, category: true, subject: { select: { name: true } } } },
  syllabusNode: { select: { id: true, title: true, kind: true, subject: { select: { name: true } } } },
} as const;

function serializeQueueTarget(row: {
  targetType: string;
  note: { id: string; title: string; kind: string; subject: { name: string } } | null;
  mistake: { id: string; title: string; subject: { name: string } } | null;
  studyResource: { id: string; title: string; category: string; subject: { name: string } | null } | null;
  syllabusNode: { id: string; title: string; kind: string; subject: { name: string } } | null;
}): ReviewQueueTargetDto {
  if (row.targetType === "NOTE" && row.note) {
    return { title: row.note.title, subtitle: `${row.note.subject.name} · 知识卡片`, canonicalHref: `/knowledge/notes/${row.note.id}` };
  }
  if (row.targetType === "MISTAKE" && row.mistake) {
    return { title: row.mistake.title, subtitle: `${row.mistake.subject.name} · 错题复测`, canonicalHref: `/knowledge/mistakes/${row.mistake.id}` };
  }
  if (row.targetType === "STUDY_RESOURCE" && row.studyResource) {
    return { title: row.studyResource.title, subtitle: `${row.studyResource.subject?.name ?? "未分科"} · 学习资料`, canonicalHref: `/knowledge/resources/${row.studyResource.id}` };
  }
  if (row.targetType === "SYLLABUS_NODE" && row.syllabusNode) {
    return { title: row.syllabusNode.title, subtitle: `${row.syllabusNode.subject.name} · 考纲节点`, canonicalHref: `/knowledge/syllabus/${row.syllabusNode.id}` };
  }
  return { title: "复习对象不可用", subtitle: "对象可能已归档或移除", canonicalHref: "/knowledge/reviews" };
}

export async function getNextDueReviewScheduleId(
  actorId: string,
  currentScheduleId: string,
): Promise<string | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const today = getStudyDayRange(new Date());
  const next = await prisma.reviewSchedule.findFirst({
    where: {
      workspaceId: workspace.id,
      id: { not: currentScheduleId },
      status: "ACTIVE",
      dueDate: { lte: today.end },
      bridgeTasks: { none: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return next?.id ?? null;
}

export async function getReviewSchedule(actorId: string, scheduleId: string): Promise<ReviewScheduleDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const row = await prisma.reviewSchedule.findFirst({
    where: { id: scheduleId, workspaceId: workspace.id },
  });
  if (!row) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
  return serializeSchedule(row);
}

export async function listReviewEvents(actorId: string, scheduleId: string): Promise<ReviewEventDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const schedule = await prisma.reviewSchedule.findFirst({
    where: { id: scheduleId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
  const rows = await prisma.reviewEvent.findMany({
    where: { reviewScheduleId: schedule.id },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(serializeEvent);
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
  const dueDate = getStudyDayRange(new Date(input.dueDate)).start;
  try {
    return await materializeReviewScheduleLocked(actorId, input, dueDate);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return materializeReviewScheduleLocked(actorId, input, dueDate);
    }
    throw error;
  }
}

async function materializeReviewScheduleLocked(
  actorId: string,
  input: {
    targetType: ReviewTargetType;
    noteId?: string;
    mistakeId?: string;
    studyResourceId?: string;
    syllabusNodeId?: string;
  },
  dueDate: Date,
): Promise<ReviewScheduleDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await assertTargetOwned(tx, workspace.id, input);
    const existing = await findExistingSchedule(tx, workspace.id, input);
    if (!existing) {
      const created = await tx.reviewSchedule.create({
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
    }
    if (existing.status === "ACTIVE" || existing.pausedReason !== "TARGET_ARCHIVED") {
      return serializeSchedule(existing);
    }

    await lockSchedule(tx, existing.id);
    const current = await tx.reviewSchedule.findFirst({
      where: { id: existing.id, workspaceId: workspace.id },
    });
    if (!current) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    if (current.status === "ACTIVE") return serializeSchedule(current);
    if (current.pausedReason !== "TARGET_ARCHIVED") {
      throw new ApiError("REVIEW_SCHEDULE_PAUSED", 409, {
        latest: serializeSchedule(current),
        conflictFields: ["status", "pausedReason"],
      });
    }
    await assertTargetNotArchived(tx, current);
    const resumed = await tx.reviewSchedule.update({
      where: { id: current.id },
      data: { status: "ACTIVE", dueDate, pausedReason: null, revision: { increment: 1 } },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "REVIEW_SCHEDULE_RESUMED_AFTER_TARGET_RESTORE",
        entityType: "ReviewSchedule",
        entityId: resumed.id,
        metadata: { targetType: resumed.targetType },
      },
    });
    return serializeSchedule(resumed);
  });
}

export async function rescheduleReview(
  actorId: string,
  scheduleId: string,
  input: { expectedRevision: number; dueDate: string },
): Promise<ReviewScheduleDto> {
  const dueDate = getStudyDayRange(new Date(input.dueDate)).start;
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await lockSchedule(tx, scheduleId);
    const existing = await tx.reviewSchedule.findFirst({
      where: { id: scheduleId, workspaceId: workspace.id },
    });
    if (!existing) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    await assertTargetNotArchived(tx, existing);
    if (existing.status !== "ACTIVE") {
      throw new ApiError("REVIEW_SCHEDULE_PAUSED", 409, {
        latest: serializeSchedule(existing),
        conflictFields: ["status"],
      });
    }
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
      throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
        latest: serializeSchedule(existing),
        conflictFields: ["revision"],
      });
    }

    const updated = await tx.reviewSchedule.update({
      where: { id: existing.id },
      data: { dueDate, revision: { increment: 1 } },
    });
    return serializeSchedule(updated);
  });
}

export async function pauseReviewSchedule(
  actorId: string,
  scheduleId: string,
  input: { expectedRevision: number; reason: string },
): Promise<ReviewScheduleDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await lockSchedule(tx, scheduleId);
    const existing = await tx.reviewSchedule.findFirst({
      where: { id: scheduleId, workspaceId: workspace.id },
    });
    if (!existing) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    await assertTargetNotArchived(tx, existing);
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
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
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
    await assertTargetNotArchived(tx, existing);

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
        latest: { schedule: serializeSchedule(schedule), event: serializeEvent(existingEvent) },
        conflictFields: ["idempotencyKey", "requestFingerprint"],
      });
    }
    return {
      schedule: serializeSchedule(schedule),
      event: serializeEvent(existingEvent),
      reused: true,
    };
  }

  await assertTargetNotArchived(tx, schedule);

  const activeSession = await tx.studySession.findFirst({
    where: {
      subject: { workspaceId },
      status: { in: ["RUNNING", "PAUSED", "CLOSING"] },
    },
    select: { id: true, status: true },
  });
  if (activeSession) {
    throw new ApiError("ACTIVE_SESSION_BLOCKS_QUICK_REVIEW", 409, {
      latest: activeSession,
      conflictFields: ["activity"],
      workbench: `/focus`,
    });
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
  await assertReviewTargetComplete(tx, schedule);

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

  const checkIn = await refreshWorkspaceCheckInSnapshotForDate(workspaceId, learningDay.start, tx);
  await applyRecoveryV2CheckInProgressInTx(tx, actorId, workspaceId, {
    studyDate: learningDay.start,
    effectiveSessionMinutes: checkIn.effectiveMinutes,
    confirmedReviewSeconds: checkIn.reviewSeconds,
    now: confirmedAt,
  });

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
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    return confirmReviewEventInTx(tx, actorId, workspace.id, scheduleId, input);
  });
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
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
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

    const requestedNextDueDate = input.nextDueDate
      ? getStudyDayRange(new Date(input.nextDueDate))
      : null;
    const fingerprint = buildReviewRequestFingerprint({
      result: input.result,
      durationSeconds: original.durationSeconds,
      nextDueDateKey: requestedNextDueDate?.key ?? "AUTO",
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
          latest: { schedule: serializeSchedule(schedule), event: serializeEvent(existing) },
          conflictFields: ["idempotencyKey", "requestFingerprint"],
        });
      }
      return { schedule: serializeSchedule(schedule), event: serializeEvent(existing), reused: true };
    }

    await assertTargetNotArchived(tx, schedule);

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
        latest: {
          schedule: serializeSchedule(schedule),
          event: latestEffective ? serializeEvent(latestEffective) : null,
        },
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

    const nextDueDate = requestedNextDueDate
      ? requestedNextDueDate.start
      : addShanghaiLearningDays(
          original.learningDate,
          suggestReviewIntervalDays({
            result: input.result,
            consecutivePassCountAfter: correctedPass,
          }),
        );
    if (
      assertExpectedRevision({
        currentRevision: schedule.revision,
        expectedRevision: input.expectedRevision,
      }) === "revision_conflict"
    ) {
      throw new ApiError("REVIEW_SCHEDULE_REVISION_CONFLICT", 409, {
        latest: { schedule: serializeSchedule(schedule), event: serializeEvent(original) },
        conflictFields: ["revision"],
      });
    }

    const existingCorrection = await tx.reviewEvent.findFirst({
      where: { correctedEventId: original.id },
    });
    if (existingCorrection) {
      throw new ApiError("REVIEW_CORRECTION_EXISTS", 409, {
        latest: { schedule: serializeSchedule(schedule), event: serializeEvent(existingCorrection) },
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
  try {
    return await prisma.$transaction(async (tx) => {
      const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
      const schedule = await getBridgableReviewScheduleInTx(
        tx,
        workspace.id,
        input.reviewScheduleId,
        input.subjectId,
      );
      const task = await tx.studyTask.create({
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
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError("REVIEW_BRIDGE_ALREADY_EXISTS", 409);
    }
    throw error;
  }
}

export async function getBridgableReviewScheduleInTx(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  reviewScheduleId: string,
  subjectId: string,
) {
  const schedule = await tx.reviewSchedule.findFirst({
    where: { id: reviewScheduleId, workspaceId },
    include: {
      note: { select: { subjectId: true, archivedAt: true } },
      mistake: { select: { subjectId: true, archivedAt: true } },
      studyResource: { select: { subjectId: true, archivedAt: true } },
      syllabusNode: { select: { subjectId: true, archivedAt: true } },
    },
  });
  if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
  if (schedule.status !== "ACTIVE" || !schedule.dueDate) {
    throw new ApiError("REVIEW_SCHEDULE_NOT_BRIDGABLE", 409);
  }

  const targets = [schedule.note, schedule.mistake, schedule.studyResource, schedule.syllabusNode]
    .filter((target): target is { subjectId: string | null; archivedAt: Date | null } => Boolean(target));
  if (targets.length !== 1 || targets[0]?.archivedAt || !targets[0]?.subjectId) {
    throw new ApiError("REVIEW_SCHEDULE_NOT_BRIDGABLE", 409);
  }
  if (targets[0].subjectId !== subjectId) {
    throw new ApiError("REVIEW_SCHEDULE_SUBJECT_MISMATCH", 409, {
      conflictFields: ["reviewScheduleId", "subjectId"],
    });
  }
  const subject = await tx.subject.findFirst({
    where: { id: subjectId, workspaceId, archivedAt: null },
    select: { id: true },
  });
  if (!subject) throw new ApiError("REVIEW_SCHEDULE_SUBJECT_MISMATCH", 409);
  return { ...schedule, dueDate: schedule.dueDate };
}

export async function completeBridgeTaskWithReview(
  actorId: string,
  taskId: string,
  input: ConfirmReviewInput,
): Promise<{ schedule: ReviewScheduleDto; event: ReviewEventDto; taskId: string; reused: boolean }> {
  if (validateReviewDurationSeconds(input.durationSeconds) !== "ok") {
    throw new ApiError("REVIEW_INVALID_DURATION", 400);
  }
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
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
    const existingEvent = await tx.reviewEvent.findUnique({
      where: {
        reviewScheduleId_idempotencyKey: {
          reviewScheduleId: task.reviewScheduleId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (task.status === "DONE" && !existingEvent) {
      throw new ApiError("STUDY_TASK_ALREADY_DONE", 409);
    }
    if (task.status !== "DONE" && !["TODO", "IN_PROGRESS", "DEFERRED"].includes(task.status)) {
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

    if (task.status === "DONE") {
      if (!confirmed.reused) {
        throw new ApiError("STUDY_TASK_ALREADY_DONE", 409);
      }
      return { ...confirmed, taskId: task.id };
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
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const task = await tx.studyTask.findFirst({
      where: { id: taskId },
      include: { reviewSchedule: true },
    });
    if (!task?.reviewSchedule || task.reviewSchedule.workspaceId !== workspace.id) {
      throw new ApiError("STUDY_TASK_NOT_FOUND", 404);
    }
    if (!["TODO", "IN_PROGRESS", "DEFERRED"].includes(task.status)) {
      throw new ApiError("TASK_STATE_CONFLICT", 409);
    }
    await lockSchedule(tx, task.reviewSchedule.id);
    const schedule = await tx.reviewSchedule.findUniqueOrThrow({ where: { id: task.reviewSchedule.id } });
    await assertTargetNotArchived(tx, schedule);
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
    const taskCas = await tx.studyTask.updateMany({
      where: {
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
        reviewScheduleId: task.reviewScheduleId,
      },
      data: { plannedDate: day, status: "DEFERRED" },
    });
    if (taskCas.count !== 1) throw new ApiError("TASK_STATE_CONFLICT", 409);
    const updated = await tx.reviewSchedule.update({
      where: { id: schedule.id },
      data: { dueDate: day, revision: { increment: 1 } },
    });
    return { taskId: task.id, schedule: serializeSchedule(updated) };
  });
}

export async function abandonBridgeTask(actorId: string, taskId: string): Promise<ReviewScheduleDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const task = await tx.studyTask.findFirst({
      where: { id: taskId },
      include: { reviewSchedule: true },
    });
    if (!task?.reviewSchedule || task.reviewSchedule.workspaceId !== workspace.id) {
      throw new ApiError("STUDY_TASK_NOT_FOUND", 404);
    }
    if (!["TODO", "IN_PROGRESS", "DEFERRED"].includes(task.status)) {
      throw new ApiError("TASK_STATE_CONFLICT", 409);
    }
    await assertTargetNotArchived(tx, task.reviewSchedule);
    const taskCas = await tx.studyTask.updateMany({
      where: {
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
        reviewScheduleId: task.reviewScheduleId,
      },
      data: { status: "SKIPPED", reviewScheduleId: task.reviewScheduleId },
    });
    if (taskCas.count !== 1) throw new ApiError("TASK_STATE_CONFLICT", 409);
    return serializeSchedule(task.reviewSchedule);
  });
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
      pausedReason: "TARGET_ARCHIVED",
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
  client: Tx,
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
    const note = await client.note.findFirst({
      where: { id: input.noteId, subject: { workspaceId } },
      select: { archivedAt: true, subject: { select: { archivedAt: true } } },
    });
    if (!note || note.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    if (note.subject.archivedAt) throw subjectArchivedReviewError();
    return;
  }
  if (input.targetType === "MISTAKE" && input.mistakeId) {
    const mistake = await client.mistake.findFirst({
      where: { id: input.mistakeId, subject: { workspaceId } },
      select: {
        archivedAt: true,
        cause: true,
        correctIdea: true,
        subject: { select: { archivedAt: true } },
      },
    });
    if (!mistake || mistake.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    if (mistake.subject.archivedAt) throw subjectArchivedReviewError();
    if (mistake.cause === "UNKNOWN" || !mistake.correctIdea?.trim()) {
      throw new ApiError("REVIEW_TARGET_INCOMPLETE", 409, { conflictFields: ["cause", "correctIdea"] });
    }
    return;
  }
  if (input.targetType === "STUDY_RESOURCE" && input.studyResourceId) {
    const resource = await client.studyResource.findFirst({
      where: { id: input.studyResourceId, workspaceId },
      select: { archivedAt: true, subject: { select: { archivedAt: true } } },
    });
    if (!resource || resource.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    if (resource.subject?.archivedAt) throw subjectArchivedReviewError();
    return;
  }
  if (input.targetType === "SYLLABUS_NODE" && input.syllabusNodeId) {
    const node = await client.syllabusNode.findFirst({
      where: { id: input.syllabusNodeId, subject: { workspaceId } },
      select: { archivedAt: true, subject: { select: { archivedAt: true } } },
    });
    if (!node || node.archivedAt) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    if (node.subject.archivedAt) throw subjectArchivedReviewError();
    return;
  }
  throw new ApiError("REVIEW_TARGET_INVALID", 400);
}

async function assertTargetNotArchived(
  tx: Tx,
  schedule: Parameters<typeof serializeSchedule>[0],
) {
  const archivedError = () => new ApiError("REVIEW_TARGET_ARCHIVED", 409, {
    latest: { schedule: serializeSchedule(schedule), target: { archived: true } },
    conflictFields: ["target.archivedAt"],
  });
  if (schedule.noteId) {
    const note = await tx.note.findUnique({
      where: { id: schedule.noteId },
      select: { archivedAt: true, subject: { select: { archivedAt: true } } },
    });
    if (!note || note.archivedAt) throw archivedError();
    if (note.subject.archivedAt) throw subjectArchivedReviewError(schedule);
  }
  if (schedule.mistakeId) {
    const mistake = await tx.mistake.findUnique({
      where: { id: schedule.mistakeId },
      select: { archivedAt: true, subject: { select: { archivedAt: true } } },
    });
    if (!mistake || mistake.archivedAt) throw archivedError();
    if (mistake.subject.archivedAt) throw subjectArchivedReviewError(schedule);
  }
  if (schedule.studyResourceId) {
    const resource = await tx.studyResource.findUnique({
      where: { id: schedule.studyResourceId },
      select: { archivedAt: true, subject: { select: { archivedAt: true } } },
    });
    if (!resource || resource.archivedAt) throw archivedError();
    if (resource.subject?.archivedAt) throw subjectArchivedReviewError(schedule);
  }
  if (schedule.syllabusNodeId) {
    const node = await tx.syllabusNode.findUnique({
      where: { id: schedule.syllabusNodeId },
      select: { archivedAt: true, subject: { select: { archivedAt: true } } },
    });
    if (!node || node.archivedAt) throw archivedError();
    if (node.subject.archivedAt) throw subjectArchivedReviewError(schedule);
  }
}

function subjectArchivedReviewError(
  schedule?: Parameters<typeof serializeSchedule>[0],
): ApiError {
  return new ApiError("SUBJECT_ARCHIVED", 409, {
    latest: schedule
      ? { schedule: serializeSchedule(schedule), target: { subjectArchived: true } }
      : { target: { subjectArchived: true } },
    conflictFields: ["subject.archivedAt"],
    workbench: "/knowledge/reviews",
  });
}

async function assertReviewTargetComplete(
  tx: Tx,
  schedule: Parameters<typeof serializeSchedule>[0],
): Promise<void> {
  if (!schedule.mistakeId) return;
  const mistake = await tx.mistake.findUnique({
    where: { id: schedule.mistakeId },
    select: { cause: true, correctIdea: true },
  });
  if (!mistake || mistake.cause === "UNKNOWN" || !mistake.correctIdea?.trim()) {
    throw new ApiError("REVIEW_TARGET_INCOMPLETE", 409, {
      latest: {
        schedule: serializeSchedule(schedule),
        target: { targetType: "MISTAKE", canPass: false },
      },
      conflictFields: ["cause", "correctIdea"],
    });
  }
}

async function findExistingSchedule(
  client: Tx,
  workspaceId: string,
  input: {
    noteId?: string;
    mistakeId?: string;
    studyResourceId?: string;
    syllabusNodeId?: string;
  },
) {
  return client.reviewSchedule.findFirst({
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
