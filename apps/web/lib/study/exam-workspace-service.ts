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
import type { ExamWorkspaceDto, SubjectGroupDto, TakeoverPreviewDto, WorkspaceSubjectDto } from "@/lib/contracts/workspace";

export const workspaceLockNamespace = 2026072112;

export type { ExamWorkspaceDto, SubjectGroupDto, TakeoverPreviewDto, WorkspaceSubjectDto } from "@/lib/contracts/workspace";

type MoveDirection = "UP" | "DOWN";

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

type WorkspaceDbClient = Pick<Prisma.TransactionClient, "examWorkspace">;

export async function lockActorWorkspaceScope(
  tx: Prisma.TransactionClient,
  actorId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${workspaceLockNamespace}, ${hashLockKey(actorId)})`;
}

export async function lockActiveWorkspaceForWrite(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  await lockActorWorkspaceScope(tx, actorId);
  return resolveActiveWorkspace(actorId, tx);
}

export async function findActiveWorkspaceOrNull(
  actorId: string,
  client: WorkspaceDbClient = prisma,
) {
  return client.examWorkspace.findFirst({
    where: { userId: actorId, status: "ACTIVE" },
  });
}

export async function resolveActiveWorkspace(
  actorId: string,
  client: WorkspaceDbClient = prisma,
) {
  const workspace = await findActiveWorkspaceOrNull(actorId, client);
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
    subjects?: Array<{
      stableKey: string;
      name: string;
      color: string;
      sortOrder?: number;
      groupStableKey?: "408" | null;
    }>;
    takeoverSubjectIds?: string[];
  },
): Promise<ExamWorkspaceDto> {
  return prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, actorId);

    const activate = input.activate !== false;
    const stableKeys = input.subjects?.map((subject) => subject.stableKey.trim()) ?? [];
    if (new Set(stableKeys).size !== stableKeys.length) {
      throw new ApiError("SUBJECT_STABLE_KEY_DUPLICATE", 400);
    }
    const requestedTakeover = Array.from(new Set(input.takeoverSubjectIds ?? []));
    if (requestedTakeover.length > 0) {
      const preview = await previewWorkspaceTakeoverWithClient(actorId, tx);
      const eligibleSet = new Set(preview.eligibleSubjectIds);
      if (requestedTakeover.some((id) => !eligibleSet.has(id))) {
        throw new ApiError("TAKEOVER_SUBJECT_NOT_ELIGIBLE", 409, {
          latest: preview,
          conflictFields: ["takeoverSubjectIds"],
        });
      }
      const takeoverSubjects = await tx.subject.findMany({
        where: { id: { in: requestedTakeover }, workspaceId: null },
        select: { stableKey: true },
      });
      const takeoverStableKeys = new Set(takeoverSubjects.map((subject) => subject.stableKey));
      const conflictingKeys = stableKeys.filter((stableKey) => takeoverStableKeys.has(stableKey));
      if (conflictingKeys.length > 0) {
        throw new ApiError("SUBJECT_STABLE_KEY_CONFLICT_WITH_TAKEOVER", 409, {
          conflictFields: ["subjects", "takeoverSubjectIds"],
        });
      }
    }
    if (activate) {
      await assertWorkspaceSwitchHasNoActiveSession(tx, actorId);
      const current = await tx.examWorkspace.findFirst({ where: { userId: actorId, status: "ACTIVE" } });
      if (current) await archiveWorkspaceForSwitch(tx, current.id, actorId, new Date());
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

    const group408 = await tx.subjectGroup.create({
      data: {
        workspaceId: created.id,
        stableKey: "408",
        name: "408",
        sortOrder: 40,
      },
    });

    if (input.subjects?.length) {
      await tx.subject.createMany({
        data: input.subjects.map((subject, index) => ({
          workspaceId: created.id,
          groupId: subject.groupStableKey === "408" ? group408.id : null,
          stableKey: subject.stableKey.trim(),
          name: subject.name.trim(),
          color: subject.color,
          sortOrder: subject.sortOrder ?? (index + 1) * 10,
          legacyCode: null,
        })),
      });
    }

    if (requestedTakeover.length > 0) {
      await applyEligibleLegacySubjects(tx, created.id, group408.id, requestedTakeover);
      await applyEligibleLegacyRoots(tx, actorId, created.id);
    }

    if (activate) {
      const activeSubjectCount = await tx.subject.count({
        where: { workspaceId: created.id, archivedAt: null },
      });
      if (activeSubjectCount === 0) {
        throw new ApiError("WORKSPACE_ACTIVE_SUBJECT_REQUIRED", 400);
      }
    }

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "EXAM_WORKSPACE_CREATED",
        entityType: "ExamWorkspace",
        entityId: created.id,
        metadata: {
          subjectCount: input.subjects?.length ?? 0,
          takeoverSubjectCount: requestedTakeover.length,
        } as Prisma.InputJsonValue,
      },
    });

    return serializeWorkspace(created);
  });
}

export async function updateExamWorkspace(
  actorId: string,
  workspaceId: string,
  input: { expectedRevision: number; name?: string; targetExamDate?: string | null; stageSummary?: string | null },
): Promise<ExamWorkspaceDto> {
  return prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, actorId);
    const workspace = await tx.examWorkspace.findFirst({ where: { id: workspaceId, userId: actorId, status: "ACTIVE" } });
    if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
    if (workspace.revision !== input.expectedRevision) {
      throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, { latest: serializeWorkspace(workspace), conflictFields: ["revision"] });
    }
    const changed = await tx.examWorkspace.updateMany({
      where: { id: workspaceId, userId: actorId, status: "ACTIVE", revision: input.expectedRevision },
      data: {
        name: input.name?.trim(),
        targetExamDate: input.targetExamDate === undefined ? undefined : input.targetExamDate ? new Date(input.targetExamDate) : null,
        stageSummary: input.stageSummary === undefined ? undefined : input.stageSummary,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, { conflictFields: ["revision"] });
    const updated = await tx.examWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    await tx.auditEvent.create({ data: { actorId, action: "EXAM_WORKSPACE_UPDATED", entityType: "ExamWorkspace", entityId: workspaceId } });
    return serializeWorkspace(updated);
  });
}

export async function activateExamWorkspace(
  actorId: string,
  workspaceId: string,
  expectedRevision: number,
): Promise<ExamWorkspaceDto> {
  return prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, actorId);

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

    const activeSession = await findWorkspaceSwitchBlockingSession(tx, actorId);
    const gate = canActivateWorkspace({
      targetStatus: target.status,
      hasActiveSession: Boolean(activeSession),
    });
    if (gate === "already_active") return serializeWorkspace(target);
    if (gate === "active_session_blocks_switch") {
      throw new ApiError("ACTIVE_SESSION_BLOCKS_WORKSPACE_SWITCH", 409);
    }

    const activeSubjectCount = await tx.subject.count({
      where: { workspaceId: target.id, archivedAt: null },
    });
    if (activeSubjectCount === 0) {
      throw new ApiError("WORKSPACE_ACTIVE_SUBJECT_REQUIRED", 409);
    }

    const currentActive = await tx.examWorkspace.findFirst({
      where: { userId: actorId, status: "ACTIVE" },
    });
    const plan = buildActiveSwitchPlan({
      currentActiveId: currentActive?.id ?? null,
      targetId: target.id,
    });

    for (const archiveId of plan.archiveIds) {
      await archiveWorkspaceForSwitch(tx, archiveId, actorId, new Date());
    }

    const activation = await tx.examWorkspace.updateMany({
      where: {
        id: plan.activateId,
        userId: actorId,
        status: "ARCHIVED",
        revision: expectedRevision,
      },
      data: { status: "ACTIVE", archivedAt: null, archivedByUserId: null, revision: { increment: 1 } },
    });
    if (activation.count !== 1) throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, { conflictFields: ["revision", "status"] });
    const activated = await tx.examWorkspace.findUniqueOrThrow({ where: { id: plan.activateId } });

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
  return previewWorkspaceTakeoverWithClient(actorId, prisma);
}

type TakeoverDbClient = Pick<Prisma.TransactionClient, "subject" | "user" | "auditEvent">;

async function previewWorkspaceTakeoverWithClient(
  actorId: string,
  client: TakeoverDbClient,
): Promise<TakeoverPreviewDto> {
  const subjects = await client.subject.findMany({
    where: { workspaceId: null },
    include: {
      tasks: { select: { id: true, plannedDate: true } },
      sessions: { select: { id: true, startedAt: true } },
      notes: { select: { id: true, studyDate: true } },
      mistakes: { select: { id: true } },
      syllabusNodes: { select: { id: true } },
    },
  });
  const users = await client.user.findMany({ select: { id: true }, take: 2 });
  const soleOwnerId = users.length === 1 ? users[0]?.id ?? null : null;

  const rows: Array<{
    subjectId: string;
    stableKey: string;
    legacyCode: WorkspaceSubjectDto["legacyCode"];
    name: string;
    verdict: LegacyOwnershipVerdict;
    affectedDates: number;
    affectedPeriods: number;
    crossOwnerBlocked: boolean;
  }> = [];

  for (const subject of subjects) {
    const referencedIds = [
      ...subject.tasks.map((row) => row.id),
      ...subject.sessions.map((row) => row.id),
      ...subject.notes.map((row) => row.id),
      ...subject.mistakes.map((row) => row.id),
      ...subject.syllabusNodes.map((row) => row.id),
    ];
    const auditOwners = await client.auditEvent.findMany({
      where: {
        entityId: { in: [subject.id, ...referencedIds] },
        actorId: { not: null },
      },
      select: { entityId: true, actorId: true },
    });
    const ownersByEntity = new Map<string, Set<string>>();
    for (const row of auditOwners) {
      if (!row.actorId || !row.entityId) continue;
      const owners = ownersByEntity.get(row.entityId) ?? new Set<string>();
      owners.add(row.actorId);
      ownersByEntity.set(row.entityId, owners);
    }
    const subjectOwnerCandidates = Array.from(ownersByEntity.get(subject.id) ?? []);
    if (subjectOwnerCandidates.length === 0 && soleOwnerId && subject.legacyCode) {
      subjectOwnerCandidates.push(soleOwnerId);
    }
    const referencedOwnerCandidates = Array.from(new Set(
      referencedIds.flatMap((id) => {
        const owners = Array.from(ownersByEntity.get(id) ?? []);
        return owners.length ? owners : soleOwnerId ? [soleOwnerId] : [];
      }),
    ));
    const hasMissingReferencedOwner = referencedIds.some((id) =>
      (ownersByEntity.get(id)?.size ?? 0) === 0 && !soleOwnerId,
    );
    const allOwners = new Set([...subjectOwnerCandidates, ...referencedOwnerCandidates]);
    const crossOwnerBlocked = allOwners.size > 1;
    const affectedDates = new Set([
      ...subject.tasks.map((row) => row.plannedDate.toISOString().slice(0, 10)),
      ...subject.sessions.map((row) => row.startedAt.toISOString().slice(0, 10)),
      ...subject.notes.flatMap((row) => row.studyDate ? [row.studyDate.toISOString().slice(0, 10)] : []),
    ]).size;

    const classified = classifyLegacyOwnership({
      subjectOwnerCandidates,
      referencedOwnerCandidates,
      hasOrphanSubject: !subject.legacyCode && referencedIds.length === 0,
      hasCrossOwnerReference: crossOwnerBlocked,
      hasMissingOwner: subjectOwnerCandidates.length === 0 || hasMissingReferencedOwner,
    });
    const verdict = classified === "TAKEOVER_ELIGIBLE" && subjectOwnerCandidates[0] === actorId
      ? classified
      : "UNRESOLVED_LEGACY";

    rows.push({
      subjectId: subject.id,
      stableKey: subject.stableKey,
      legacyCode: subject.legacyCode,
      name: subject.name,
      verdict,
      affectedDates,
      affectedPeriods: 0,
      crossOwnerBlocked,
    });
  }

  const summary = summarizeTakeoverPreview(rows);
  return {
    ...summary,
    crossOwnerBlockedCount: rows.filter((row) => row.crossOwnerBlocked).length,
    eligibleSubjectIds: rows.filter((row) => row.verdict === "TAKEOVER_ELIGIBLE").map((row) => row.subjectId),
    unresolvedSubjectIds: rows.filter((row) => row.verdict === "UNRESOLVED_LEGACY").map((row) => row.subjectId),
    eligibleSubjects: rows
      .filter((row) => row.verdict === "TAKEOVER_ELIGIBLE")
      .map((row) => ({
        id: row.subjectId,
        stableKey: row.stableKey,
        legacyCode: row.legacyCode,
        name: row.name,
      })),
  };
}

export async function applyWorkspaceTakeover(
  actorId: string,
  input: { workspaceId: string; subjectIds: string[]; expectedRevision: number },
): Promise<{ workspace: ExamWorkspaceDto; takenOverSubjectIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, actorId);

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

    const preview = await previewWorkspaceTakeoverWithClient(actorId, tx);
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
    await applyEligibleLegacySubjects(tx, workspace.id, group408?.id ?? null, requested);
    await applyEligibleLegacyRoots(tx, actorId, workspace.id);

    const changed = await tx.examWorkspace.updateMany({
      where: { id: workspace.id, userId: actorId, status: "ACTIVE", revision: input.expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, { conflictFields: ["revision"] });
    const updatedWorkspace = await tx.examWorkspace.findUniqueOrThrow({ where: { id: workspace.id } });

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

async function applyEligibleLegacySubjects(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  group408Id: string | null,
  subjectIds: string[],
): Promise<void> {
  for (const subjectId of subjectIds) {
    const subject = await tx.subject.findFirst({ where: { id: subjectId, workspaceId: null } });
    if (!subject) throw new ApiError("TAKEOVER_SUBJECT_NOT_ELIGIBLE", 409);

    const is408 =
      subject.legacyCode === "DATA_STRUCTURE" ||
      subject.legacyCode === "COMPUTER_ORGANIZATION" ||
      subject.legacyCode === "OPERATING_SYSTEM" ||
      subject.legacyCode === "COMPUTER_NETWORK";

    const changed = await tx.subject.updateMany({
      where: { id: subject.id, workspaceId: null },
      data: {
        workspaceId,
        groupId: is408 ? group408Id : null,
      },
    });
    if (changed.count !== 1) throw new ApiError("TAKEOVER_SUBJECT_NOT_ELIGIBLE", 409);
  }
}

async function applyEligibleLegacyRoots(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
): Promise<void> {
  const users = await tx.user.findMany({ select: { id: true }, take: 2 });
  const isSoleOwner = users.length === 1 && users[0]?.id === actorId;

  await tx.periodicReportDecision.updateMany({
    where: { workspaceId: null, ...(isSoleOwner ? {} : { actorId }) },
    data: { workspaceId },
  });
  await tx.stageAdjustmentDraft.updateMany({
    where: { workspaceId: null, ...(isSoleOwner ? {} : { actorId }) },
    data: { workspaceId },
  });
  await tx.recoveryState.updateMany({
    where: {
      workspaceId: null,
      ...(isSoleOwner ? {} : { OR: [{ userId: actorId }, { actorId }] }),
    },
    data: { workspaceId, userId: actorId },
  });

  if (!isSoleOwner) return;
  await tx.stagePlan.updateMany({ where: { workspaceId: null }, data: { workspaceId } });
  await tx.dailyReview.updateMany({ where: { workspaceId: null }, data: { workspaceId } });
  await tx.checkIn.updateMany({ where: { workspaceId: null }, data: { workspaceId } });
  await tx.simulationExam.updateMany({ where: { workspaceId: null }, data: { workspaceId } });
}

async function findWorkspaceSwitchBlockingSession(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  return tx.studySession.findFirst({
    where: {
      status: { in: ["RUNNING", "PAUSED", "CLOSING"] },
      subject: { workspace: { userId: actorId, status: "ACTIVE" } },
    },
    select: { id: true },
  });
}

async function assertWorkspaceSwitchHasNoActiveSession(
  tx: Prisma.TransactionClient,
  actorId: string,
): Promise<void> {
  if (await findWorkspaceSwitchBlockingSession(tx, actorId)) {
    throw new ApiError("ACTIVE_SESSION_BLOCKS_WORKSPACE_SWITCH", 409);
  }
}

async function archiveWorkspaceForSwitch(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  await tx.reviewSchedule.updateMany({
    where: { workspaceId, status: "ACTIVE" },
    data: {
      status: "PAUSED",
      dueDate: null,
      pausedReason: "WORKSPACE_ARCHIVED",
      revision: { increment: 1 },
    },
  });
  await tx.recoveryState.updateMany({
    where: { workspaceId, status: "ACTIVE" },
    data: {
      status: "CANCELED",
      endedAt: now,
      exitCondition: "workspace_archived",
      revision: { increment: 1 },
    },
  });
  await tx.recoveryState.updateMany({
    where: { workspaceId, status: "active" },
    data: {
      status: "canceled",
      endedAt: now,
      exitCondition: "workspace_archived",
      revision: { increment: 1 },
    },
  });
  const archived = await tx.examWorkspace.updateMany({
    where: { id: workspaceId, userId: actorId, status: "ACTIVE" },
    data: {
      status: "ARCHIVED",
      archivedAt: now,
      archivedByUserId: actorId,
      revision: { increment: 1 },
    },
  });
  if (archived.count !== 1) {
    throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, { conflictFields: ["status"] });
  }
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
    expectedWorkspaceRevision: number;
  },
): Promise<WorkspaceSubjectDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const workspace = await lockOwnedWorkspaceRevision(tx, actorId, workspaceId, input.expectedWorkspaceRevision);
      if (input.groupId) {
        const group = await tx.subjectGroup.findFirst({ where: { id: input.groupId, workspaceId, archivedAt: null } });
        if (!group) throw new ApiError("SUBJECT_GROUP_NOT_FOUND", 404);
      }
      const created = await tx.subject.create({
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
      await bumpWorkspaceRevision(tx, workspace.id, workspace.revision);
      await tx.auditEvent.create({ data: { actorId, action: "SUBJECT_CREATED", entityType: "Subject", entityId: created.id } });
      return serializeSubject(created);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError("SUBJECT_STABLE_KEY_ALREADY_EXISTS", 409);
    }
    throw error;
  }
}

export async function updateWorkspaceSubject(
  actorId: string,
  workspaceId: string,
  subjectId: string,
  input: {
    expectedWorkspaceRevision: number;
    name?: string;
    color?: string;
    sortOrder?: number;
    groupId?: string | null;
    archived?: boolean;
    move?: MoveDirection;
  },
): Promise<{ subject: WorkspaceSubjectDto; workspace: ExamWorkspaceDto }> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockOwnedWorkspaceRevision(tx, actorId, workspaceId, input.expectedWorkspaceRevision);
    const subject = await tx.subject.findFirst({ where: { id: subjectId, workspaceId } });
    if (!subject) throw new ApiError("SUBJECT_NOT_FOUND", 404);
    if (input.move) {
      assertMoveOnly(input, ["name", "color", "sortOrder", "groupId", "archived"]);
      if (subject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);
      const moved = await reorderWorkspaceSubjects(tx, workspaceId, subject.id, input.move);
      if (!moved) return { subject: serializeSubject(subject), workspace: serializeWorkspace(workspace) };
      const reordered = await tx.subject.findUniqueOrThrow({ where: { id: subject.id } });
      const updatedWorkspace = await bumpWorkspaceRevision(tx, workspace.id, workspace.revision);
      await tx.auditEvent.create({ data: { actorId, action: "SUBJECT_REORDERED", entityType: "Subject", entityId: subject.id } });
      return { subject: serializeSubject(reordered), workspace: serializeWorkspace(updatedWorkspace) };
    }
    if (input.groupId) {
      const group = await tx.subjectGroup.findFirst({ where: { id: input.groupId, workspaceId, archivedAt: null } });
      if (!group) throw new ApiError("SUBJECT_GROUP_NOT_FOUND", 404);
    }
    if (input.archived === true && subject.archivedAt === null) {
      const remaining = await tx.subject.count({
        where: { workspaceId, archivedAt: null, id: { not: subject.id } },
      });
      if (remaining === 0) throw new ApiError("WORKSPACE_ACTIVE_SUBJECT_REQUIRED", 409);
      const activeSession = await tx.studySession.findFirst({
        where: { subjectId: subject.id, status: { in: ["RUNNING", "PAUSED", "CLOSING"] } },
        select: { id: true },
      });
      if (activeSession) throw new ApiError("ACTIVE_SESSION_BLOCKS_SUBJECT_ARCHIVE", 409);

      await tx.reviewSchedule.updateMany({
        where: {
          workspaceId,
          status: "ACTIVE",
          OR: [
            { note: { subjectId: subject.id } },
            { mistake: { subjectId: subject.id } },
            { studyResource: { subjectId: subject.id } },
            { syllabusNode: { subjectId: subject.id } },
          ],
        },
        data: {
          status: "PAUSED",
          dueDate: null,
          pausedReason: "SUBJECT_ARCHIVED",
          revision: { increment: 1 },
        },
      });
    }
    const updated = await tx.subject.update({
      where: { id: subject.id },
      data: {
        name: input.name?.trim(),
        color: input.color,
        sortOrder: input.sortOrder,
        groupId: input.groupId,
        archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null,
      },
    });
    const updatedWorkspace = await bumpWorkspaceRevision(tx, workspace.id, workspace.revision);
    await tx.auditEvent.create({ data: { actorId, action: input.archived === true ? "SUBJECT_ARCHIVED" : input.archived === false ? "SUBJECT_RESTORED" : "SUBJECT_UPDATED", entityType: "Subject", entityId: subject.id } });
    return { subject: serializeSubject(updated), workspace: serializeWorkspace(updatedWorkspace) };
  });
}

export async function createSubjectGroup(
  actorId: string,
  workspaceId: string,
  input: { expectedWorkspaceRevision: number; stableKey: string; name: string; sortOrder?: number },
): Promise<{ group: SubjectGroupDto; workspace: ExamWorkspaceDto }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const workspace = await lockOwnedWorkspaceRevision(tx, actorId, workspaceId, input.expectedWorkspaceRevision);
      const group = await tx.subjectGroup.create({ data: { workspaceId, stableKey: input.stableKey.trim(), name: input.name.trim(), sortOrder: input.sortOrder ?? 100 } });
      const updatedWorkspace = await bumpWorkspaceRevision(tx, workspace.id, workspace.revision);
      await tx.auditEvent.create({ data: { actorId, action: "SUBJECT_GROUP_CREATED", entityType: "SubjectGroup", entityId: group.id } });
      return { group: serializeSubjectGroup(group), workspace: serializeWorkspace(updatedWorkspace) };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError("SUBJECT_GROUP_STABLE_KEY_ALREADY_EXISTS", 409);
    }
    throw error;
  }
}

export async function updateSubjectGroup(
  actorId: string,
  workspaceId: string,
  groupId: string,
  input: { expectedWorkspaceRevision: number; name?: string; sortOrder?: number; archived?: boolean; move?: MoveDirection },
): Promise<{ group: SubjectGroupDto; workspace: ExamWorkspaceDto }> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockOwnedWorkspaceRevision(tx, actorId, workspaceId, input.expectedWorkspaceRevision);
    const group = await tx.subjectGroup.findFirst({ where: { id: groupId, workspaceId } });
    if (!group) throw new ApiError("SUBJECT_GROUP_NOT_FOUND", 404);
    if (input.move) {
      assertMoveOnly(input, ["name", "sortOrder", "archived"]);
      if (group.archivedAt) throw new ApiError("SUBJECT_GROUP_ARCHIVED", 409);
      const moved = await reorderSubjectGroups(tx, workspaceId, group.id, input.move);
      if (!moved) return { group: serializeSubjectGroup(group), workspace: serializeWorkspace(workspace) };
      const reordered = await tx.subjectGroup.findUniqueOrThrow({ where: { id: group.id } });
      const updatedWorkspace = await bumpWorkspaceRevision(tx, workspace.id, workspace.revision);
      await tx.auditEvent.create({ data: { actorId, action: "SUBJECT_GROUP_REORDERED", entityType: "SubjectGroup", entityId: group.id } });
      return { group: serializeSubjectGroup(reordered), workspace: serializeWorkspace(updatedWorkspace) };
    }
    const updated = await tx.subjectGroup.update({
      where: { id: group.id },
      data: { name: input.name?.trim(), sortOrder: input.sortOrder, archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null },
    });
    const updatedWorkspace = await bumpWorkspaceRevision(tx, workspace.id, workspace.revision);
    await tx.auditEvent.create({ data: { actorId, action: input.archived === true ? "SUBJECT_GROUP_ARCHIVED" : input.archived === false ? "SUBJECT_GROUP_RESTORED" : "SUBJECT_GROUP_UPDATED", entityType: "SubjectGroup", entityId: group.id } });
    return { group: serializeSubjectGroup(updated), workspace: serializeWorkspace(updatedWorkspace) };
  });
}

async function lockOwnedWorkspaceRevision(tx: Prisma.TransactionClient, actorId: string, workspaceId: string, expectedRevision: number) {
  await lockActorWorkspaceScope(tx, actorId);
  const workspace = await tx.examWorkspace.findFirst({ where: { id: workspaceId, userId: actorId, status: "ACTIVE" } });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  if (workspace.revision !== expectedRevision) {
    throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, { latest: serializeWorkspace(workspace), conflictFields: ["revision"] });
  }
  return workspace;
}

async function bumpWorkspaceRevision(tx: Prisma.TransactionClient, workspaceId: string, expectedRevision: number) {
  const changed = await tx.examWorkspace.updateMany({ where: { id: workspaceId, revision: expectedRevision }, data: { revision: { increment: 1 } } });
  if (changed.count !== 1) throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, { conflictFields: ["revision"] });
  return tx.examWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
}

function serializeSubject(row: { id: string; workspaceId: string | null; groupId: string | null; stableKey: string; legacyCode: WorkspaceSubjectDto["legacyCode"]; name: string; color: string; sortOrder: number; archivedAt: Date | null }): WorkspaceSubjectDto {
  return { id: row.id, workspaceId: row.workspaceId, groupId: row.groupId, stableKey: row.stableKey, legacyCode: row.legacyCode, name: row.name, color: row.color, sortOrder: row.sortOrder, archivedAt: row.archivedAt?.toISOString() ?? null, legacyScope: false };
}

function serializeSubjectGroup(row: { id: string; workspaceId: string; stableKey: string; name: string; sortOrder: number; archivedAt: Date | null }): SubjectGroupDto {
  return { id: row.id, workspaceId: row.workspaceId, stableKey: row.stableKey, name: row.name, sortOrder: row.sortOrder, archivedAt: row.archivedAt?.toISOString() ?? null };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function assertMoveOnly(input: Record<string, unknown>, patchFields: string[]): void {
  if (patchFields.some((field) => input[field] !== undefined)) {
    throw new ApiError("MOVE_PATCH_CONFLICT", 400);
  }
}

async function reorderWorkspaceSubjects(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  subjectId: string,
  move: MoveDirection,
): Promise<boolean> {
  const rows = await tx.subject.findMany({
    where: { workspaceId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const reordered = swapWithNeighbor(rows, subjectId, move);
  if (!reordered) return false;
  for (const [index, row] of reordered.entries()) {
    await tx.subject.update({ where: { id: row.id }, data: { sortOrder: (index + 1) * 10 } });
  }
  return true;
}

async function reorderSubjectGroups(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  groupId: string,
  move: MoveDirection,
): Promise<boolean> {
  const rows = await tx.subjectGroup.findMany({
    where: { workspaceId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const reordered = swapWithNeighbor(rows, groupId, move);
  if (!reordered) return false;
  for (const [index, row] of reordered.entries()) {
    await tx.subjectGroup.update({ where: { id: row.id }, data: { sortOrder: (index + 1) * 10 } });
  }
  return true;
}

function swapWithNeighbor<T extends { id: string }>(
  rows: T[],
  rowId: string,
  move: MoveDirection,
): T[] | null {
  const index = rows.findIndex((row) => row.id === rowId);
  const targetIndex = move === "UP" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return null;
  const reordered = [...rows];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!];
  return reordered;
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
