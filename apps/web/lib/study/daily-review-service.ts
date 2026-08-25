import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { refreshWorkspaceCheckInSnapshotForDate } from "./check-in-service";
import { getStudyDayKey, getStudyDayRange } from "./date";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { createPlanInboxItemWithResult } from "./plan-inbox-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
  type PersistentCreateCommand,
} from "./persistent-idempotency";
import { parseDailyReviewSnapshot, serializeDailyReview } from "./daily-review-serializer";
import { audit, type StudyDbClient } from "./study-audit";
import type {
  ReviewContentInput,
  SaveReviewInput,
  SaveTodayReviewInput,
  UpdateReviewInput,
} from "./study-service-contracts";
import type { DailyReviewDto } from "@/lib/contracts";

export async function getTodayReview(actorId: string): Promise<DailyReviewDto | null> {
  return getDailyReview(actorId, new Date());
}

export async function getDailyReview(actorId: string, targetDate: Date): Promise<DailyReviewDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const day = getStudyDayRange(targetDate);
  const review = await prisma.dailyReview.findFirst({
    where: { reviewDate: day.start, workspaceId: workspace.id },
  });

  return review ? serializeDailyReview(review) : null;
}

export async function saveTodayReview(input: SaveTodayReviewInput, actorId: string): Promise<DailyReviewDto> {
  const day = getStudyDayRange(new Date());
  const idempotencyKey = input.idempotencyKey === undefined
    ? null
    : normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = idempotencyKey
    ? buildPersistentCreateFingerprint("daily-review-save-today-v1", {
        reviewDate: day.start.toISOString(),
        ...dailyReviewCommandPayload(input),
      })
    : null;

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = idempotencyKey && requestFingerprint
      ? dailyReviewCommand(actorId, workspace.id, "DAILY_REVIEW_TODAY_SAVED", idempotencyKey, requestFingerprint)
      : null;
    if (command) {
      const replay = await replayDailyReviewCommand(tx, command, async () => {
        const latest = await tx.dailyReview.findFirst({
          where: { reviewDate: day.start, workspaceId: workspace.id },
        });
        return latest ? serializeDailyReview(latest) : null;
      });
      if (replay) return replay;
    }

    const existing = await tx.dailyReview.findFirst({
      where: { reviewDate: day.start, workspaceId: workspace.id },
    });
    const metrics = await getTodaySessionMetrics(day.start, day.end, workspace.id, tx);
    const savedReview = existing
      ? await updateTodayReview(tx, workspace.id, existing, input, metrics)
      : await tx.dailyReview.create({
          data: { reviewDate: day.start, workspaceId: workspace.id, ...createReviewData(input, metrics) },
        });
    await syncReviewMinimumInbox(tx, workspace.id, actorId, savedReview, day.end, input.tomorrowMinimum);
    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, day.start, tx);
    const result = serializeDailyReview(savedReview);
    if (command) {
      await recordDailyReviewCommandResult(tx, command, result);
    } else {
      await audit(actorId, existing ? "DAILY_REVIEW_UPDATED" : "DAILY_REVIEW_SAVED", "DailyReview", savedReview.id, tx);
    }
    return result;
  });
}

export async function createDailyReview(
  input: SaveReviewInput,
  actorId: string,
  targetDate = new Date(),
): Promise<DailyReviewDto> {
  const day = getStudyDayRange(targetDate);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("daily-review-create-v1", {
    reviewDate: day.start.toISOString(),
    ...dailyReviewCommandPayload(input),
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = dailyReviewCommand(actorId, workspace.id, "DAILY_REVIEW_SAVED", idempotencyKey, requestFingerprint);
    const replay = await replayDailyReviewCommand(tx, command, async () => {
      const latest = await tx.dailyReview.findFirst({
        where: { reviewDate: day.start, workspaceId: workspace.id },
      });
      return latest ? serializeDailyReview(latest) : null;
    });
    if (replay) return replay;
    const existing = await tx.dailyReview.findFirst({
      where: { reviewDate: day.start, workspaceId: workspace.id },
    });
    if (existing) {
      throw new ApiError("DAILY_REVIEW_ALREADY_EXISTS", 409, {
        latest: serializeDailyReview(existing),
        conflictFields: ["reviewDate"],
        workbench: "/roadmap/reviews/daily",
      });
    }
    const metrics = await getTodaySessionMetrics(day.start, day.end, workspace.id, tx);
    const savedReview = await tx.dailyReview.create({
      data: { reviewDate: day.start, workspaceId: workspace.id, ...createReviewData(input, metrics) },
    });
    await syncReviewMinimumInbox(tx, workspace.id, actorId, savedReview, day.end, input.tomorrowMinimum);
    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, day.start, tx);
    const result = serializeDailyReview(savedReview);
    await recordDailyReviewCommandResult(tx, command, result);
    return result;
  });
}

export async function updateDailyReview(
  id: string,
  input: UpdateReviewInput,
  actorId: string,
): Promise<DailyReviewDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("daily-review-update-v1", {
    id,
    expectedRevision: input.expectedRevision,
    ...dailyReviewCommandPayload(input),
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = dailyReviewCommand(actorId, workspace.id, "DAILY_REVIEW_UPDATED", idempotencyKey, requestFingerprint);
    const replay = await replayDailyReviewCommand(tx, command, async () => {
      const latest = await tx.dailyReview.findFirst({ where: { id, workspaceId: workspace.id } });
      return latest ? serializeDailyReview(latest) : null;
    });
    if (replay) return replay;
    const existing = await tx.dailyReview.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) throw new ApiError("DAILY_REVIEW_NOT_FOUND", 404, { workbench: "/roadmap/reviews/daily" });
    if (existing.revision !== input.expectedRevision) {
      throw new ApiError("DAILY_REVIEW_REVISION_CONFLICT", 409, {
        latest: serializeDailyReview(existing),
        conflictFields: ["revision"],
        workbench: "/roadmap/reviews/daily",
      });
    }
    const day = getStudyDayRange(existing.reviewDate);
    const metrics = await getTodaySessionMetrics(day.start, day.end, workspace.id, tx);
    const updated = await tx.dailyReview.updateMany({
      where: { id, workspaceId: workspace.id, revision: input.expectedRevision },
      data: { ...createReviewData(input, metrics), revision: { increment: 1 } },
    });
    if (updated.count !== 1) {
      const latest = await tx.dailyReview.findFirst({ where: { id, workspaceId: workspace.id } });
      throw new ApiError("DAILY_REVIEW_REVISION_CONFLICT", 409, {
        latest: latest ? serializeDailyReview(latest) : undefined,
        conflictFields: ["revision"],
        workbench: "/roadmap/reviews/daily",
      });
    }
    const savedReview = await tx.dailyReview.findUniqueOrThrow({ where: { id } });
    await syncReviewMinimumInbox(tx, workspace.id, actorId, savedReview, day.end, input.tomorrowMinimum);
    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, day.start, tx);
    const result = serializeDailyReview(savedReview);
    await recordDailyReviewCommandResult(tx, command, result);
    return result;
  });
}

async function getTodaySessionMetrics(
  start: Date,
  end: Date,
  workspaceId: string,
  client: StudyDbClient = prisma,
): Promise<{ totalMinutes: number; effectiveMinutes: number }> {
  const sessions = await client.studySession.findMany({
    where: { subject: { workspaceId }, startedAt: { gte: start, lt: end }, status: "COMPLETED" },
    select: { effectiveMinutes: true, isEffective: true },
  });
  return {
    totalMinutes: sessions.reduce((total, session) => total + session.effectiveMinutes, 0),
    effectiveMinutes: sessions.filter((session) => session.isEffective).reduce((total, session) => total + session.effectiveMinutes, 0),
  };
}

function createReviewData(input: ReviewContentInput, metrics: { totalMinutes: number; effectiveMinutes: number }) {
  return {
    totalMinutes: metrics.totalMinutes,
    effectiveMinutes: metrics.effectiveMinutes,
    summary: input.summary,
    lostControl: input.lostControl,
    keepAction: input.keepAction,
    tomorrowMinimum: input.tomorrowMinimum,
    mood: input.mood,
  };
}

function dailyReviewCommandPayload(input: ReviewContentInput) {
  return {
    summary: input.summary,
    lostControl: input.lostControl ?? null,
    keepAction: input.keepAction,
    tomorrowMinimum: input.tomorrowMinimum,
    mood: input.mood ?? null,
  };
}

function dailyReviewCommand(
  actorId: string,
  workspaceId: string,
  action: string,
  idempotencyKey: string,
  requestFingerprint: string,
): PersistentCreateCommand {
  return {
    actorId,
    workspaceId,
    action,
    entityType: "DailyReview",
    idempotencyKey,
    requestFingerprint,
    conflictCode: "DAILY_REVIEW_IDEMPOTENCY_CONFLICT",
  };
}

async function replayDailyReviewCommand(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
  readLatest: () => Promise<DailyReviewDto | null>,
): Promise<DailyReviewDto | null> {
  try {
    const replay = await findPersistentCreateReplay(tx, command);
    if (!replay) return null;
    const snapshot = parseDailyReviewSnapshot(replay.resultSnapshot);
    if (snapshot) return snapshot;
    const existingResult = await tx.dailyReview.findFirst({ where: { id: replay.resultId, workspaceId: command.workspaceId } });
    if (!existingResult) throw new ApiError("DAILY_REVIEW_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
    return serializeDailyReview(existingResult);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    throw new ApiError(error.code, 409, {
      latest: await readLatest(),
      conflictFields: error.details?.conflictFields ?? ["idempotencyKey"],
      workbench: "/roadmap/reviews/daily",
    });
  }
}

async function updateTodayReview(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  existing: { id: string; revision: number },
  input: ReviewContentInput,
  metrics: { totalMinutes: number; effectiveMinutes: number },
) {
  const updated = await tx.dailyReview.updateMany({
    where: { id: existing.id, workspaceId, revision: existing.revision },
    data: { ...createReviewData(input, metrics), revision: { increment: 1 } },
  });
  if (updated.count !== 1) {
    const latest = await tx.dailyReview.findFirst({ where: { id: existing.id, workspaceId } });
    throw new ApiError("DAILY_REVIEW_REVISION_CONFLICT", 409, {
      latest: latest ? serializeDailyReview(latest) : null,
      conflictFields: ["revision"],
      workbench: "/roadmap/reviews/daily",
    });
  }
  return tx.dailyReview.findUniqueOrThrow({ where: { id: existing.id } });
}

async function recordDailyReviewCommandResult(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
  result: DailyReviewDto,
): Promise<void> {
  await recordPersistentCreateResult(tx, command, result.id, {
    resultSnapshot: result as unknown as Prisma.InputJsonObject,
  });
}

async function syncReviewMinimumInbox(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  review: { id: string; revision: number; reviewDate: Date },
  plannedDate: Date,
  tomorrowMinimum: string,
): Promise<void> {
  const originKey = `daily-review:${getStudyDayKey(review.reviewDate)}:minimum`;
  await createPlanInboxItemWithResult(tx, workspaceId, actorId, {
    stableKey: `${originKey}:v${review.revision}`,
    originKey,
    originVersion: review.revision,
    originType: "DAILY_REVIEW_MINIMUM",
    originSnapshot: {
      dailyReviewId: review.id,
      reviewDate: review.reviewDate.toISOString(),
      reviewRevision: review.revision,
    },
    title: tomorrowMinimum.trim(),
    plannedDate: plannedDate.toISOString(),
    estimatedMinutes: 25,
    priority: "MEDIUM",
    type: "focus",
  });
}
