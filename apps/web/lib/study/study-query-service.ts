import { prisma } from "@areaforge/db";
import { listCheckInSnapshotsInRange } from "./check-in-service";
import { getStudyDayRange } from "./date";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { getEffectiveStudyStreak } from "./study-day-metrics";
import { serializeSubject } from "./subject-serializer";
import { serializeTask } from "./task-serializer";
import type { FocusLauncherSummaryDto, StudyTaskDto, SubjectDto } from "@/lib/contracts";

export async function listStudyTasks(actorId: string): Promise<StudyTaskDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const tasks = await prisma.studyTask.findMany({
    where: { subject: { workspaceId: workspace.id } },
    include: {
      subject: true,
      syllabusNode: true,
      stageLinks: { include: { stagePlan: { select: { name: true } } } },
      knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
    },
    orderBy: [{ plannedDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  return tasks.map(serializeTask);
}

export async function listSubjects(actorId: string): Promise<SubjectDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: workspace.id, archivedAt: null },
    orderBy: { sortOrder: "asc" },
  });

  return subjects.map(serializeSubject);
}

export async function getFocusLauncherSummary(
  actorId: string,
  now = new Date(),
): Promise<FocusLauncherSummaryDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const day = getStudyDayRange(now);
  const weeklyStart = new Date(day.start.getTime() - 6 * 24 * 60 * 60 * 1000);
  const recentStart = new Date(day.start.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [todaySessions, weeklySessions, checkInSnapshots] = await Promise.all([
    prisma.studySession.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        startedAt: { gte: day.start, lt: day.end },
        status: "COMPLETED",
      },
      select: { id: true, subjectId: true, effectiveMinutes: true, startedAt: true },
      orderBy: { startedAt: "asc" },
    }),
    prisma.studySession.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        startedAt: { gte: weeklyStart, lt: day.end },
        status: "COMPLETED",
      },
      select: { id: true, subjectId: true, effectiveMinutes: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    }),
    listCheckInSnapshotsInRange(recentStart, day.end, prisma, workspace.id),
  ]);

  const subjectWeeklyStats: FocusLauncherSummaryDto["subjectWeeklyStats"] = {};
  for (const session of weeklySessions) {
    if (!subjectWeeklyStats[session.subjectId]) {
      const diffHours = Math.round((now.getTime() - session.startedAt.getTime()) / (1000 * 60 * 60));
      subjectWeeklyStats[session.subjectId] = {
        weeklyMinutes: 0,
        lastSessionMinutes: session.effectiveMinutes || null,
        lastSessionAgo: diffHours < 1
          ? "刚刚"
          : diffHours < 24
            ? `${diffHours} 小时前`
            : `${Math.floor(diffHours / 24)} 天前`,
      };
    }
    subjectWeeklyStats[session.subjectId].weeklyMinutes += session.effectiveMinutes || 0;
  }

  return {
    todayMinutes: todaySessions.reduce((total, session) => total + (session.effectiveMinutes || 0), 0),
    todaySessionsCount: todaySessions.length,
    streakDays: getEffectiveStudyStreak(
      weeklySessions.map((session) => ({ startedAt: session.startedAt })),
      checkInSnapshots,
      now,
    ),
    subjectWeeklyStats,
  };
}
