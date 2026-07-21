import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";
import { findActiveWorkspaceOrNull, resolveActiveWorkspace } from "./exam-workspace-service";
import { serializeTask } from "./task-serializer";
import type { StudyTaskDto } from "./types";

export interface PlanRollingDayDto {
  date: string;
  tasks: StudyTaskDto[];
}

export interface PlanRollingDto {
  days: PlanRollingDayDto[];
  tasks: StudyTaskDto[];
  debt: StudyTaskDto[];
  datedInboxCount: number;
  inboxEntryPath: string;
  setupRequired: boolean;
  workspaceId: string | null;
}

function addDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function getPlanRolling(
  actorId: string,
  options?: { date?: string; subjectId?: string; status?: string; q?: string },
): Promise<PlanRollingDto> {
  const workspace = await findActiveWorkspaceOrNull(actorId);
  if (!workspace) {
    return {
      days: [],
      tasks: [],
      debt: [],
      datedInboxCount: 0,
      inboxEntryPath: "/today/inbox",
      setupRequired: true,
      workspaceId: null,
    };
  }

  const anchor = options?.date ? getStudyDayRange(new Date(`${options.date}T12:00:00+08:00`)).start : getStudyDayRange().start;
  const rangeEnd = addDays(anchor, 7);
  const day = getStudyDayRange();

  const [taskRows, debtRows, inboxCount] = await Promise.all([
    prisma.studyTask.findMany({
      where: {
        subject: { workspaceId: workspace.id },
        plannedDate: { gte: anchor, lt: rangeEnd },
        ...(options?.subjectId ? { subjectId: options.subjectId } : {}),
        ...(options?.status
          ? { status: options.status.toUpperCase() as "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED" }
          : {}),
        ...(options?.q
          ? { title: { contains: options.q, mode: "insensitive" as const } }
          : {}),
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
      orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.studyTask.findMany({
      where: {
        subject: { workspaceId: workspace.id },
        status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] },
        OR: [{ plannedDate: { lt: day.start } }, { debtStatus: { not: "NONE" } }],
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
      orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.planInboxItem.count({
      where: {
        workspaceId: workspace.id,
        status: "OPEN",
        plannedDate: { not: null },
        supersededByItemId: null,
      },
    }),
  ]);

  const tasks = taskRows.map(serializeTask);
  const debt = debtRows.map(serializeTask);
  const days: PlanRollingDayDto[] = [];
  for (let i = 0; i < 7; i += 1) {
    const start = addDays(anchor, i);
    const end = addDays(anchor, i + 1);
    const key = getStudyDayRange(start).key;
    days.push({
      date: key,
      tasks: tasks.filter((task) => {
        const planned = new Date(task.plannedDate).getTime();
        return planned >= start.getTime() && planned < end.getTime();
      }),
    });
  }

  return {
    days,
    tasks,
    debt,
    datedInboxCount: inboxCount,
    inboxEntryPath: "/today/inbox",
    setupRequired: false,
    workspaceId: workspace.id,
  };
}

export async function getStudyTaskDetail(actorId: string, taskId: string): Promise<StudyTaskDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const task = await prisma.studyTask.findFirst({
    where: {
      id: taskId,
      subject: { workspaceId: workspace.id },
    },
    include: {
      subject: true,
      syllabusNode: true,
    },
  });
  if (!task) throw new ApiError("TASK_NOT_FOUND", 404);
  return serializeTask(task);
}
