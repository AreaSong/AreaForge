import {
  assertExpectedRevision,
  buildActiveSwitchPlan,
  canActivateWorkspace,
  classifyLegacyOwnership,
  summarizeTakeoverPreview,
  type LegacyOwnershipVerdict,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";

export const workspaceLockNamespace = 2026072112;

export interface ExamWorkspaceDto {
  id: string;
  stableKey: string;
  name: string;
  targetExamDate: string | null;
  stageSummary: string | null;
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectGroupDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  name: string;
  sortOrder: number;
  archivedAt: string | null;
}

export interface WorkspaceSubjectDto {
  id: string;
  workspaceId: string | null;
  groupId: string | null;
  stableKey: string;
  legacyCode: string | null;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: string | null;
  legacyScope: boolean;
}

export interface TakeoverPreviewDto {
  eligibleCount: number;
  unresolvedCount: number;
  crossOwnerBlockedCount: number;
  affectedDateCount: number;
  affectedPeriodCount: number;
  eligibleSubjectIds: string[];
  unresolvedSubjectIds: string[];
}

function serializeWorkspace(row: {
  id: string;
  stableKey: string;
  name: string;
  targetExamDate: Date | null;
  stageSummary: string | null;
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ExamWorkspaceDto {
  return {
    id: row.id,
    stableKey: row.stableKey,
    name: row.name,
    targetExamDate: row.targetExamDate?.toISOString() ?? null,
    stageSummary: row.stageSummary,
    status: row.status,
    revision: row.revision,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findActiveWorkspaceOrNull(actorId: string) {
  return prisma.examWorkspace.findFirst({
    where: { userId: actorId, status: "ACTIVE" },
  });
}

export async function resolveActiveWorkspace(actorId: string) {
  const workspace = await findActiveWorkspaceOrNull(actorId);
  if (!workspace) {
    throw new ApiError("ACTIVE_WORKSPACE_NOT_FOUND", 404);
  }
  return workspace;
}

export async function listExamWorkspaces(actorId: string): Promise<ExamWorkspaceDto[]> {
  const rows = await prisma.examWorkspace.findMany({
    where: { userId: actorId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeWorkspace);
}

export async function createExamWorkspace(
  actorId: string,
  input: {
    stableKey: string;
    name: string;
    targetExamDate?: string | null;
    stageSummary?: string | null;
    activate?: boolean;
  },
): Promise<ExamWorkspaceDto> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${workspaceLockNamespace}, ${hashLockKey(actorId)})`;

    const activate = input.activate !== false;
    if (activate) {
      await tx.examWorkspace.updateMany({
        where: { userId: actorId, status: "ACTIVE" },
        data: {
          status: "ARCHIVED",
          archivedAt: new Date(),
          archivedByUserId: actorId,
          revision: { increment: 1 },
        },
      });
    }

    const created = await tx.examWorkspace.create({
      data: {
        userId: actorId,
        stableKey: input.stableKey.trim(),
        name: input.name.trim(),
        targetExamDate: input.targetExamDate ? new Date(input.targetExamDate) : null,
        stageSummary: input.stageSummary ?? null,
        status: activate ? "ACTIVE" : "ARCHIVED",
        archivedAt: activate ? null : new Date(),
        archivedByUserId: activate ? null : actorId,
      },
    });

    await tx.subjectGroup.create({
      data: {
        workspaceId: created.id,
        stableKey: "408",
        name: "408",
        sortOrder: 40,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "EXAM_WORKSPACE_CREATED",
        entityType: "ExamWorkspace",
        entityId: created.id,
      },
    });

    return serializeWorkspace(created);
  });
}

export async function activateExamWorkspace(
  actorId: string,
  workspaceId: string,
  expectedRevision: number,
): Promise<ExamWorkspaceDto> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${workspaceLockNamespace}, ${hashLockKey(actorId)})`;

    const target = await tx.examWorkspace.findFirst({
      where: { id: workspaceId, userId: actorId },
    });
    if (!target) throw new ApiError("WORKSPACE_NOT_FOUND", 404);

    if (assertExpectedRevision({ currentRevision: target.revision, expectedRevision }) === "revision_conflict") {
      throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, {
        latest: serializeWorkspace(target),
        conflictFields: ["revision"],
      });
    }

    const activeSession = await tx.studySession.findFirst({
      where: { status: { in: ["RUNNING", "PAUSED"] } },
      select: { id: true },
    });
    const gate = canActivateWorkspace({
      targetStatus: target.status,
      hasActiveSession: Boolean(activeSession),
    });
    if (gate === "already_active") return serializeWorkspace(target);
    if (gate === "active_session_blocks_switch") {
      throw new ApiError("ACTIVE_SESSION_BLOCKS_WORKSPACE_SWITCH", 409);
    }

    const currentActive = await tx.examWorkspace.findFirst({
      where: { userId: actorId, status: "ACTIVE" },
    });
    const plan = buildActiveSwitchPlan({
      currentActiveId: currentActive?.id ?? null,
      targetId: target.id,
    });

    for (const archiveId of plan.archiveIds) {
      await tx.examWorkspace.update({
        where: { id: archiveId },
        data: {
          status: "ARCHIVED",
          archivedAt: new Date(),
          archivedByUserId: actorId,
          revision: { increment: 1 },
        },
      });
    }

    const activated = await tx.examWorkspace.update({
      where: { id: plan.activateId },
      data: {
        status: "ACTIVE",
        archivedAt: null,
        archivedByUserId: null,
        revision: { increment: 1 },
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "EXAM_WORKSPACE_ACTIVATED",
        entityType: "ExamWorkspace",
        entityId: activated.id,
      },
    });

    return serializeWorkspace(activated);
  });
}

export async function previewWorkspaceTakeover(actorId: string): Promise<TakeoverPreviewDto> {
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: null },
    include: {
      tasks: { select: { id: true }, take: 1 },
      sessions: { select: { id: true }, take: 1 },
      notes: { select: { id: true }, take: 1 },
      mistakes: { select: { id: true }, take: 1 },
      syllabusNodes: { select: { id: true }, take: 1 },
    },
  });

  const rows: Array<{
    subjectId: string;
    verdict: LegacyOwnershipVerdict;
    affectedDates: number;
    affectedPeriods: number;
  }> = [];

  for (const subject of subjects) {
    const hasRefs =
      subject.tasks.length > 0 ||
      subject.sessions.length > 0 ||
      subject.notes.length > 0 ||
      subject.mistakes.length > 0 ||
      subject.syllabusNodes.length > 0;

    const verdict = classifyLegacyOwnership({
      subjectOwnerCandidates: [actorId],
      referencedOwnerCandidates: [actorId],
      hasOrphanSubject: !subject.legacyCode && !hasRefs,
      hasCrossOwnerReference: false,
      hasMissingOwner: false,
    });

    rows.push({
      subjectId: subject.id,
      verdict,
      affectedDates: hasRefs ? 1 : 0,
      affectedPeriods: 0,
    });
  }

  const summary = summarizeTakeoverPreview(rows);
  return {
    ...summary,
    eligibleSubjectIds: rows.filter((row) => row.verdict === "TAKEOVER_ELIGIBLE").map((row) => row.subjectId),
    unresolvedSubjectIds: rows.filter((row) => row.verdict === "UNRESOLVED_LEGACY").map((row) => row.subjectId),
  };
}

export async function applyWorkspaceTakeover(
  actorId: string,
  input: { workspaceId: string; subjectIds: string[]; expectedRevision: number },
): Promise<{ workspace: ExamWorkspaceDto; takenOverSubjectIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${workspaceLockNamespace}, ${hashLockKey(actorId)})`;

    const workspace = await tx.examWorkspace.findFirst({
      where: { id: input.workspaceId, userId: actorId, status: "ACTIVE" },
    });
    if (!workspace) throw new ApiError("ACTIVE_WORKSPACE_NOT_FOUND", 404);
    if (assertExpectedRevision({ currentRevision: workspace.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
      throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, {
        latest: serializeWorkspace(workspace),
        conflictFields: ["revision"],
      });
    }

    const preview = await previewWorkspaceTakeover(actorId);
    const eligibleSet = new Set(preview.eligibleSubjectIds);
    const requested = Array.from(new Set(input.subjectIds));
    if (requested.some((id) => !eligibleSet.has(id))) {
      throw new ApiError("TAKEOVER_SUBJECT_NOT_ELIGIBLE", 409, {
        latest: preview,
        conflictFields: ["subjectIds"],
      });
    }

    if (requested.length === 0) {
      return { workspace: serializeWorkspace(workspace), takenOverSubjectIds: [] };
    }

    const group408 = await tx.subjectGroup.findFirst({
      where: { workspaceId: workspace.id, stableKey: "408" },
    });

    for (const subjectId of requested) {
      const subject = await tx.subject.findFirst({ where: { id: subjectId, workspaceId: null } });
      if (!subject) throw new ApiError("TAKEOVER_SUBJECT_NOT_ELIGIBLE", 409);

      const is408 =
        subject.legacyCode === "DATA_STRUCTURE" ||
        subject.legacyCode === "COMPUTER_ORGANIZATION" ||
        subject.legacyCode === "OPERATING_SYSTEM" ||
        subject.legacyCode === "COMPUTER_NETWORK";

      await tx.subject.update({
        where: { id: subject.id },
        data: {
          workspaceId: workspace.id,
          groupId: is408 ? group408?.id ?? null : null,
        },
      });
    }

    const updatedWorkspace = await tx.examWorkspace.update({
      where: { id: workspace.id },
      data: { revision: { increment: 1 } },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "EXAM_WORKSPACE_TAKEOVER_APPLIED",
        entityType: "ExamWorkspace",
        entityId: workspace.id,
        metadata: { subjectIds: requested } as Prisma.InputJsonValue,
      },
    });

    return { workspace: serializeWorkspace(updatedWorkspace), takenOverSubjectIds: requested };
  });
}

export async function listSubjectGroups(actorId: string, workspaceId: string): Promise<SubjectGroupDto[]> {
  await assertOwnedWorkspace(actorId, workspaceId);
  const rows = await prisma.subjectGroup.findMany({
    where: { workspaceId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    stableKey: row.stableKey,
    name: row.name,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  }));
}

export async function listWorkspaceSubjects(actorId: string, workspaceId: string): Promise<WorkspaceSubjectDto[]> {
  await assertOwnedWorkspace(actorId, workspaceId);
  const rows = await prisma.subject.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    groupId: row.groupId,
    stableKey: row.stableKey,
    legacyCode: row.legacyCode,
    name: row.name,
    color: row.color,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    legacyScope: false,
  }));
}

export async function createWorkspaceSubject(
  actorId: string,
  workspaceId: string,
  input: {
    stableKey: string;
    name: string;
    color: string;
    sortOrder?: number;
    groupId?: string | null;
  },
): Promise<WorkspaceSubjectDto> {
  await assertOwnedWorkspace(actorId, workspaceId);
  if (input.groupId) {
    const group = await prisma.subjectGroup.findFirst({ where: { id: input.groupId, workspaceId } });
    if (!group) throw new ApiError("SUBJECT_GROUP_NOT_FOUND", 404);
  }

  const created = await prisma.subject.create({
    data: {
      workspaceId,
      groupId: input.groupId ?? null,
      stableKey: input.stableKey.trim(),
      name: input.name.trim(),
      color: input.color,
      sortOrder: input.sortOrder ?? 100,
      legacyCode: null,
    },
  });

  return {
    id: created.id,
    workspaceId: created.workspaceId,
    groupId: created.groupId,
    stableKey: created.stableKey,
    legacyCode: created.legacyCode,
    name: created.name,
    color: created.color,
    sortOrder: created.sortOrder,
    archivedAt: created.archivedAt?.toISOString() ?? null,
    legacyScope: false,
  };
}

async function assertOwnedWorkspace(actorId: string, workspaceId: string) {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { id: workspaceId, userId: actorId },
    select: { id: true },
  });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
}

function hashLockKey(actorId: string): number {
  let hash = 0;
  for (let i = 0; i < actorId.length; i += 1) {
    hash = (hash * 31 + actorId.charCodeAt(i)) | 0;
  }
  return hash;
}
