import {
  buildDailyCheckInSnapshot,
  type CheckInSnapshotSummary,
  type TaskStatus,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { getStudyDayRange } from "./date";

type CheckInDbClient = PrismaClient | Prisma.TransactionClient;
type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";

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
}

export async function refreshCheckInSnapshotForDate(
  targetDate: Date,
  client: CheckInDbClient = prisma,
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
  const review = await client.dailyReview.findUnique({
    where: {
      reviewDate: day.start,
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
  const record = await client.checkIn.upsert({
    where: {
      studyDate: day.start,
    },
    create: {
      studyDate: day.start,
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
    update: {
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

export async function refreshCheckInSnapshotsForDates(
  targetDates: Array<Date | null | undefined>,
  client: CheckInDbClient = prisma,
): Promise<CheckInSnapshotSummary[]> {
  const uniqueDates = new Map<number, Date>();

  for (const targetDate of targetDates) {
    if (!targetDate) continue;
    const dayStart = getStudyDayRange(targetDate).start;
    uniqueDates.set(dayStart.getTime(), dayStart);
  }

  const snapshots: CheckInSnapshotSummary[] = [];
  for (const targetDate of uniqueDates.values()) {
    snapshots.push(await refreshCheckInSnapshotForDate(targetDate, client));
  }

  return snapshots;
}

export async function findCheckInSnapshotForDate(
  targetDate: Date,
  client: CheckInDbClient = prisma,
): Promise<CheckInSnapshotSummary | null> {
  const day = getStudyDayRange(targetDate);
  const record = await client.checkIn.findUnique({
    where: {
      studyDate: day.start,
    },
  });

  return record ? serializeCheckInSnapshot(record) : null;
}

export async function listCheckInSnapshotsInRange(
  start: Date,
  end: Date,
  client: CheckInDbClient = prisma,
): Promise<Map<string, CheckInSnapshotSummary>> {
  const records = await client.checkIn.findMany({
    where: {
      studyDate: {
        gte: start,
        lt: end,
      },
    },
    orderBy: {
      studyDate: "asc",
    },
  });

  return new Map(records.map((record) => [getStudyDayRange(record.studyDate).key, serializeCheckInSnapshot(record)]));
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
