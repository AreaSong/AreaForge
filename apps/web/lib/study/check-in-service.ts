import {
  aggregateReviewMetrics,
  buildDailyCheckInSnapshot,
  completedMinimumActionV2,
  deriveMinimumActionSource,
  type CheckInSnapshotSummary,
  type MinimumActionSource,
  type TaskStatus,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { getStudyDayRange } from "./date";

type CheckInDbClient = PrismaClient | Prisma.TransactionClient;
type CheckInWriteClient = Prisma.TransactionClient;
type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
export const checkInLockNamespace = 1095123785;

interface CheckInRecord {
  studyDate: Date;
  completedMinimumAction: boolean;
  totalMinutes: number;
  effectiveMinutes: number;
  effectiveSessionCount: number;
  taskCompletionRate: number;
  reviewSubmitted: boolean;
  lowEfficiency: boolean;
  lowConversionCount: number;
  sourceVersion: number;
  reviewCount?: number;
  reviewSeconds?: number;
  passedCount?: number;
  partialCount?: number;
  failedCount?: number;
  minimumActionSource?: string;
}

export interface CheckInV2Dto {
  id: string;
  workspaceId: string | null;
  studyDate: string;
  completedMinimumAction: boolean;
  totalMinutes: number;
  effectiveMinutes: number;
  effectiveSessionCount: number;
  taskCompletionRate: number;
  reviewSubmitted: boolean;
  lowEfficiency: boolean;
  lowConversionCount: number;
  sourceVersion: number;
  reviewCount: number;
  reviewSeconds: number;
  passedCount: number;
  partialCount: number;
  failedCount: number;
  minimumActionSource: MinimumActionSource;
}

export async function refreshCheckInSnapshotForDate(
  targetDate: Date,
  client: CheckInWriteClient,
): Promise<CheckInSnapshotSummary> {
  const day = getStudyDayRange(targetDate);
  const sessions = await client.studySession.findMany({
    where: {
      startedAt: {
        gte: day.start,
        lt: day.end,
      },
      status: "COMPLETED",
    },
    select: {
      effectiveMinutes: true,
      isEffective: true,
      isLowConversion: true,
    },
  });
  const tasks = await client.studyTask.findMany({
    where: {
      plannedDate: {
        gte: day.start,
        lt: day.end,
      },
    },
    select: {
      status: true,
    },
  });
  const review = await client.dailyReview.findFirst({
    where: {
      reviewDate: day.start,
      workspaceId: null,
    },
    select: {
      id: true,
    },
  });
  const snapshot = buildDailyCheckInSnapshot({
    studyDate: day.key,
    sessions: sessions.map((session) => ({
      effectiveMinutes: session.effectiveMinutes,
      isEffective: session.isEffective,
      isLowConversion: session.isLowConversion,
    })),
    tasks: tasks.map((task) => ({
      status: toCoreTaskStatus(task.status),
    })),
    reviewSubmitted: Boolean(review),
  });
  const existing = await client.checkIn.findFirst({
    where: {
      studyDate: day.start,
      workspaceId: null,
    },
  });
  const record = existing
    ? await client.checkIn.update({
        where: { id: existing.id },
        data: {
          completedMinimumAction: snapshot.completedMinimumAction,
          totalMinutes: snapshot.totalMinutes,
          effectiveMinutes: snapshot.effectiveMinutes,
          effectiveSessionCount: snapshot.effectiveSessionCount,
          taskCompletionRate: snapshot.taskCompletionRate,
          reviewSubmitted: snapshot.reviewSubmitted,
          lowEfficiency: snapshot.lowEfficiency,
          lowConversionCount: snapshot.lowConversionCount,
          sourceVersion: snapshot.sourceVersion,
        },
      })
    : await client.checkIn.create({
        data: {
          studyDate: day.start,
          workspaceId: null,
          completedMinimumAction: snapshot.completedMinimumAction,
          totalMinutes: snapshot.totalMinutes,
          effectiveMinutes: snapshot.effectiveMinutes,
          effectiveSessionCount: snapshot.effectiveSessionCount,
          taskCompletionRate: snapshot.taskCompletionRate,
          reviewSubmitted: snapshot.reviewSubmitted,
          lowEfficiency: snapshot.lowEfficiency,
          lowConversionCount: snapshot.lowConversionCount,
          sourceVersion: snapshot.sourceVersion,
        },
      });

  return serializeCheckInSnapshot(record);
}

/** Workspace-scoped CheckIn v2 rebuild. Touched days upgrade to sourceVersion=2. */
export async function refreshWorkspaceCheckInSnapshotForDate(
  workspaceId: string,
  targetDate: Date,
  client: CheckInWriteClient,
): Promise<CheckInV2Dto> {
  const day = getStudyDayRange(targetDate);
  const lockKey = Number(day.key.replaceAll("-", ""));
  await client.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${checkInLockNamespace}, ${lockKey})`;

  const subjectIds = (
    await client.subject.findMany({
      where: { workspaceId },
      select: { id: true },
    })
  ).map((row) => row.id);

  const sessions = subjectIds.length
    ? await client.studySession.findMany({
        where: {
          subjectId: { in: subjectIds },
          startedAt: { gte: day.start, lt: day.end },
          status: "COMPLETED",
        },
        select: {
          effectiveMinutes: true,
          isEffective: true,
          isLowConversion: true,
        },
      })
    : [];

  const tasks = subjectIds.length
    ? await client.studyTask.findMany({
        where: {
          subjectId: { in: subjectIds },
          plannedDate: { gte: day.start, lt: day.end },
        },
        select: { status: true },
      })
    : [];

  const dailyReview = await client.dailyReview.findFirst({
    where: { reviewDate: day.start, workspaceId },
    select: { id: true },
  });

  const reviewEvents = await client.reviewEvent.findMany({
    where: {
      learningDate: day.start,
      reviewSchedule: { workspaceId },
    },
    select: {
      id: true,
      result: true,
      durationSeconds: true,
      correctedEventId: true,
    },
  });

  const sessionSnapshot = buildDailyCheckInSnapshot({
    studyDate: day.key,
    sessions: sessions.map((session) => ({
      effectiveMinutes: session.effectiveMinutes,
      isEffective: session.isEffective,
      isLowConversion: session.isLowConversion,
    })),
    tasks: tasks.map((task) => ({ status: toCoreTaskStatus(task.status) })),
    reviewSubmitted: Boolean(dailyReview),
  });

  const reviewMetrics = aggregateReviewMetrics(
    reviewEvents.map((event) => ({
      id: event.id,
      result: event.result as "PASSED" | "PARTIAL" | "FAILED",
      durationSeconds: event.durationSeconds,
      correctedEventId: event.correctedEventId,
    })),
  );

  const sessionMinimumMet =
    sessionSnapshot.effectiveSessionCount > 0 && sessionSnapshot.effectiveMinutes >= 25;
  const minimumActionSource = deriveMinimumActionSource({
    sessionMinimumMet,
    reviewSeconds: reviewMetrics.reviewSeconds,
  });
  const completedMinimumAction = completedMinimumActionV2({
    sessionMinimumMet,
    reviewSeconds: reviewMetrics.reviewSeconds,
  });

  const data = {
    completedMinimumAction,
    totalMinutes: sessionSnapshot.totalMinutes,
    effectiveMinutes: sessionSnapshot.effectiveMinutes,
    effectiveSessionCount: sessionSnapshot.effectiveSessionCount,
    taskCompletionRate: sessionSnapshot.taskCompletionRate,
    reviewSubmitted: sessionSnapshot.reviewSubmitted,
    lowEfficiency: completedMinimumAction
      ? sessionSnapshot.taskCompletionRate < 0.3 && !sessionSnapshot.reviewSubmitted
        ? true
        : sessionSnapshot.lowEfficiency && !completedMinimumAction
      : true,
    lowConversionCount: sessionSnapshot.lowConversionCount,
    sourceVersion: 2,
    reviewCount: reviewMetrics.reviewCount,
    reviewSeconds: reviewMetrics.reviewSeconds,
    passedCount: reviewMetrics.passedCount,
    partialCount: reviewMetrics.partialCount,
    failedCount: reviewMetrics.failedCount,
    minimumActionSource,
  };

  const existing = await client.checkIn.findFirst({
    where: { studyDate: day.start, workspaceId },
  });
  const record = existing
    ? await client.checkIn.update({ where: { id: existing.id }, data })
    : await client.checkIn.create({
        data: {
          studyDate: day.start,
          workspaceId,
          ...data,
        },
      });

  return serializeCheckInV2(record);
}

export async function refreshCheckInSnapshotsForDates(
  targetDates: Array<Date | null | undefined>,
  client: CheckInWriteClient,
): Promise<CheckInSnapshotSummary[]> {
  const lockTargets = getCheckInLockTargets(targetDates);
  for (const target of lockTargets) {
    await client.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${checkInLockNamespace}, ${target.lockKey})`;
  }

  const snapshots: CheckInSnapshotSummary[] = [];
  for (const target of lockTargets) {
    snapshots.push(await refreshCheckInSnapshotForDate(target.start, client));
  }

  return snapshots;
}

export function getCheckInLockTargets(
  targetDates: Array<Date | null | undefined>,
): Array<{ studyDayKey: string; start: Date; lockKey: number }> {
  const uniqueDays = new Map<number, { studyDayKey: string; start: Date; lockKey: number }>();

  for (const targetDate of targetDates) {
    if (!targetDate) continue;
    const day = getStudyDayRange(targetDate);
    uniqueDays.set(day.start.getTime(), {
      studyDayKey: day.key,
      start: day.start,
      lockKey: Number(day.key.replaceAll("-", "")),
    });
  }

  return Array.from(uniqueDays.values()).sort((left, right) => left.start.getTime() - right.start.getTime());
}

export async function findCheckInSnapshotForDate(
  targetDate: Date,
  client: CheckInDbClient = prisma,
): Promise<CheckInSnapshotSummary | null> {
  const day = getStudyDayRange(targetDate);
  const record = await client.checkIn.findFirst({
    where: {
      studyDate: day.start,
      workspaceId: null,
    },
  });

  return record ? serializeCheckInSnapshot(record) : null;
}

export async function listCheckInSnapshotsInRange(
  start: Date,
  end: Date,
  client: CheckInDbClient = prisma,
  workspaceId: string | null = null,
): Promise<Map<string, CheckInSnapshotSummary>> {
  const records = await client.checkIn.findMany({
    where: {
      studyDate: {
        gte: start,
        lt: end,
      },
      workspaceId,
    },
    orderBy: {
      studyDate: "asc",
    },
  });

  return new Map(records.map((record) => [getStudyDayRange(record.studyDate).key, serializeCheckInSnapshot(record)]));
}

export async function listWorkspaceCheckIns(
  workspaceId: string,
  from: Date,
  to: Date,
): Promise<CheckInV2Dto[]> {
  const fromDay = getStudyDayRange(from).start;
  const toDay = getStudyDayRange(to).end;
  const records = await prisma.checkIn.findMany({
    where: {
      workspaceId,
      studyDate: { gte: fromDay, lt: toDay },
    },
    orderBy: { studyDate: "asc" },
  });
  return records.map(serializeCheckInV2);
}

export function serializeCheckInSnapshot(record: CheckInRecord): CheckInSnapshotSummary {
  return {
    studyDate: getStudyDayRange(record.studyDate).key,
    completedMinimumAction: record.completedMinimumAction,
    totalMinutes: record.totalMinutes,
    effectiveMinutes: record.effectiveMinutes,
    effectiveSessionCount: record.effectiveSessionCount,
    taskCompletionRate: record.taskCompletionRate,
    reviewSubmitted: record.reviewSubmitted,
    lowEfficiency: record.lowEfficiency,
    lowConversionCount: record.lowConversionCount,
    sourceVersion: 1,
  };
}

function serializeCheckInV2(record: {
  id: string;
  workspaceId: string | null;
  studyDate: Date;
  completedMinimumAction: boolean;
  totalMinutes: number;
  effectiveMinutes: number;
  effectiveSessionCount: number;
  taskCompletionRate: number;
  reviewSubmitted: boolean;
  lowEfficiency: boolean;
  lowConversionCount: number;
  sourceVersion: number;
  reviewCount: number;
  reviewSeconds: number;
  passedCount: number;
  partialCount: number;
  failedCount: number;
  minimumActionSource: string;
}): CheckInV2Dto {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    studyDate: getStudyDayRange(record.studyDate).key,
    completedMinimumAction: record.completedMinimumAction,
    totalMinutes: record.totalMinutes,
    effectiveMinutes: record.effectiveMinutes,
    effectiveSessionCount: record.effectiveSessionCount,
    taskCompletionRate: record.taskCompletionRate,
    reviewSubmitted: record.reviewSubmitted,
    lowEfficiency: record.lowEfficiency,
    lowConversionCount: record.lowConversionCount,
    sourceVersion: record.sourceVersion,
    reviewCount: record.reviewCount,
    reviewSeconds: record.reviewSeconds,
    passedCount: record.passedCount,
    partialCount: record.partialCount,
    failedCount: record.failedCount,
    minimumActionSource: record.minimumActionSource as MinimumActionSource,
  };
}

function toCoreTaskStatus(status: DbTaskStatus): TaskStatus {
  switch (status) {
    case "TODO":
      return "todo";
    case "IN_PROGRESS":
      return "in_progress";
    case "DONE":
      return "done";
    case "SKIPPED":
      return "skipped";
    case "DEFERRED":
      return "deferred";
  }
}
