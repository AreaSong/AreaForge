import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { WeeklyBudgetDto, WeeklyBudgetSubjectDto } from "@/lib/contracts";
import { getStudyWeekRange, parseStudyDayKey } from "./date";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";

const WEEKLY_BUDGET_INTENT = "weekly-subject-budget:v1";
const weeklyBudgetLockNamespace = 2026090301;

type BudgetClient = Prisma.TransactionClient | typeof prisma;

export async function getWeeklyBudget(
  actorId: string,
  requestedWeekStart?: string | null,
): Promise<WeeklyBudgetDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const requestedDate = requestedWeekStart ? parseStudyDayKey(requestedWeekStart) : null;
  if (requestedWeekStart && !requestedDate) throw new ApiError("WEEKLY_BUDGET_WEEK_INVALID", 400);
  return buildWeeklyBudget(prisma, actorId, workspace.id, requestedDate ?? new Date());
}

export async function patchWeeklyBudget(
  actorId: string,
  input: {
    weekStart: string;
    subjectId: string;
    targetMinutes: number;
    expectedRevision: number;
  },
): Promise<WeeklyBudgetDto> {
  const requestedDate = parseStudyDayKey(input.weekStart);
  if (!requestedDate) throw new ApiError("WEEKLY_BUDGET_WEEK_INVALID", 400);
  const week = getStudyWeekRange(requestedDate);

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(
      ${weeklyBudgetLockNamespace},
      hashtext(${`${workspace.id}:${input.subjectId}:${week.key}`})
    )`;
    const subject = await tx.subject.findFirst({
      where: { id: input.subjectId, workspaceId: workspace.id, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!subject) throw new ApiError("WEEKLY_BUDGET_SUBJECT_NOT_FOUND", 404, { workbench: "/roadmap" });

    const existing = await tx.learningArrangement.findFirst({
      where: {
        userId: actorId,
        workspaceId: workspace.id,
        subjectId: subject.id,
        intent: WEEKLY_BUDGET_INTENT,
        startDate: week.start,
        endDate: week.end,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ApiError("WEEKLY_BUDGET_REVISION_CONFLICT", 409, {
        latest: await buildWeeklyBudget(tx, actorId, workspace.id, week.start),
        conflictFields: ["targetMinutes", "revision"],
        workbench: "/roadmap",
      });
    }

    if (existing) {
      const updated = await tx.learningArrangement.updateMany({
        where: { id: existing.id, revision: input.expectedRevision },
        data: {
          title: `周投入预算 · ${subject.name}`,
          status: input.targetMinutes > 0 ? "PLANNED" : "CANCELED",
          estimatedMin: input.targetMinutes > 0 ? input.targetMinutes : null,
          estimatedMax: input.targetMinutes > 0 ? input.targetMinutes : null,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ApiError("WEEKLY_BUDGET_REVISION_CONFLICT", 409, {
          latest: await buildWeeklyBudget(tx, actorId, workspace.id, week.start),
          conflictFields: ["targetMinutes", "revision"],
          workbench: "/roadmap",
        });
      }
    } else {
      await tx.learningArrangement.create({
        data: {
          userId: actorId,
          workspaceId: workspace.id,
          subjectId: subject.id,
          title: `周投入预算 · ${subject.name}`,
          intent: WEEKLY_BUDGET_INTENT,
          startDate: week.start,
          endDate: week.end,
          status: input.targetMinutes > 0 ? "PLANNED" : "CANCELED",
          estimatedMin: input.targetMinutes > 0 ? input.targetMinutes : null,
          estimatedMax: input.targetMinutes > 0 ? input.targetMinutes : null,
          revision: 1,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorId,
        action: input.targetMinutes > 0 ? "WEEKLY_BUDGET_SET" : "WEEKLY_BUDGET_CLEARED",
        entityType: "LearningArrangement",
        entityId: subject.id,
        metadata: {
          workspaceId: workspace.id,
          subjectId: subject.id,
          weekStart: week.key,
          targetMinutes: input.targetMinutes,
        },
      },
    });

    return buildWeeklyBudget(tx, actorId, workspace.id, week.start);
  });
}

async function buildWeeklyBudget(
  client: BudgetClient,
  actorId: string,
  workspaceId: string,
  date: Date,
): Promise<WeeklyBudgetDto> {
  const week = getStudyWeekRange(date);
  const [subjects, arrangements, sessions] = await Promise.all([
    client.subject.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, color: true },
    }),
    client.learningArrangement.findMany({
      where: {
        userId: actorId,
        workspaceId,
        intent: WEEKLY_BUDGET_INTENT,
        startDate: week.start,
        endDate: week.end,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { subjectId: true, status: true, estimatedMin: true, revision: true },
    }),
    client.studySession.findMany({
      where: {
        workspaceId,
        status: "COMPLETED",
        startedAt: { gte: week.start, lt: week.end },
      },
      select: { subjectId: true, effectiveMinutes: true, isEffective: true },
    }),
  ]);

  const latestBySubject = new Map<string, typeof arrangements[number]>();
  for (const arrangement of arrangements) {
    if (arrangement.subjectId && !latestBySubject.has(arrangement.subjectId)) {
      latestBySubject.set(arrangement.subjectId, arrangement);
    }
  }
  const actualBySubject = new Map<string, number>();
  const effectiveBySubject = new Map<string, number>();
  for (const session of sessions) {
    actualBySubject.set(session.subjectId, (actualBySubject.get(session.subjectId) ?? 0) + session.effectiveMinutes);
    if (session.isEffective) {
      effectiveBySubject.set(session.subjectId, (effectiveBySubject.get(session.subjectId) ?? 0) + session.effectiveMinutes);
    }
  }

  const items: WeeklyBudgetSubjectDto[] = subjects.map((subject) => {
    const arrangement = latestBySubject.get(subject.id);
    return {
      subjectId: subject.id,
      subjectName: subject.name,
      subjectColor: subject.color,
      targetMinutes: arrangement?.status === "CANCELED" ? null : arrangement?.estimatedMin ?? null,
      actualMinutes: actualBySubject.get(subject.id) ?? 0,
      effectiveMinutes: effectiveBySubject.get(subject.id) ?? 0,
      revision: arrangement?.revision ?? 0,
    };
  });

  return {
    workspaceId,
    weekStart: week.key,
    weekEnd: new Date(week.end.getTime() - 1).toISOString().slice(0, 10),
    configuredSubjectCount: items.filter((item) => item.targetMinutes !== null).length,
    totalTargetMinutes: items.reduce((sum, item) => sum + (item.targetMinutes ?? 0), 0),
    totalActualMinutes: items.reduce((sum, item) => sum + item.actualMinutes, 0),
    totalEffectiveMinutes: items.reduce((sum, item) => sum + item.effectiveMinutes, 0),
    subjects: items,
  };
}
