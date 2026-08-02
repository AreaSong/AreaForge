import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";

export type KnowledgeMasteryStateDto = "UNTOUCHED" | "LEARNING" | "INITIAL_MASTERY" | "STABLE_MASTERY" | "NEEDS_RETEST";

export interface KnowledgePointDto {
  id: string;
  stableKey: string;
  title: string;
  boundary: string | null;
  masteryState: KnowledgeMasteryStateDto;
  nextRetestAt: string | null;
  revision: number;
  subject: { id: string; name: string; color: string; stableKey: string };
  primaryGroup: { id: string; title: string; stableKey: string } | null;
  relatedSubjects: Array<{ id: string; name: string; color: string; stableKey: string }>;
  counts: {
    syllabusLinks: number;
    stageTargets: number;
    arrangements: number;
    sessions: number;
    retests: number;
    evidence: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePointDetailDto extends KnowledgePointDto {
  syllabusLinks: Array<{ id: string; role: string; node: { id: string; title: string; kind: string; status: string } }>;
  stageTargets: Array<{ id: string; targetState: KnowledgeMasteryStateDto; importance: number; stage: { id: string; name: string; status: string } | null }>;
  arrangements: Array<{ id: string; title: string; startDate: string; endDate: string; status: string }>;
  recentSessions: Array<{ id: string; status: string; startedAt: string; endedAt: string | null; effectiveMinutes: number; understanding: string | null }>;
  evidence: Array<{ id: string; sourceType: string; summary: string | null; confidence: number | null; occurredAt: string }>;
}

export interface CreateKnowledgePointInput {
  idempotencyKey: string;
  subjectId: string;
  primaryGroupId?: string | null;
  stableKey?: string;
  title: string;
  boundary?: string | null;
  relatedSubjectIds?: string[];
}

export interface UpdateKnowledgePointInput {
  expectedRevision: number;
  title?: string;
  boundary?: string | null;
  primaryGroupId?: string | null;
  masteryState?: KnowledgeMasteryStateDto;
  nextRetestAt?: string | null;
}

const baseInclude = {
  primarySubject: { select: { id: true, name: true, color: true, stableKey: true } },
  primaryGroup: { select: { id: true, title: true, stableKey: true } },
  relatedSubjects: {
    include: { subject: { select: { id: true, name: true, color: true, stableKey: true } } },
    orderBy: { createdAt: "asc" },
  },
  _count: { select: { syllabusLinks: true, stageTargets: true, arrangementLinks: true, sessionLinks: true, retestLinks: true, evidence: true } },
} satisfies Prisma.KnowledgePointInclude;

const detailInclude = {
  ...baseInclude,
  syllabusLinks: {
    include: { syllabusNode: { select: { id: true, title: true, kind: true, status: true } } },
    orderBy: { createdAt: "asc" },
  },
  stageTargets: {
    include: { stagePlan: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: "desc" },
  },
  arrangementLinks: {
    include: { arrangement: { select: { id: true, title: true, startDate: true, endDate: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  },
  sessionLinks: {
    include: { session: { select: { id: true, status: true, startedAt: true, endedAt: true, effectiveMinutes: true, closeout: { select: { understanding: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  },
  evidence: {
    select: { id: true, sourceType: true, summary: true, confidence: true, occurredAt: true },
    orderBy: { occurredAt: "desc" },
    take: 30,
  },
} satisfies Prisma.KnowledgePointInclude;

type BaseRow = Prisma.KnowledgePointGetPayload<{ include: typeof baseInclude }>;
type DetailRow = Prisma.KnowledgePointGetPayload<{ include: typeof detailInclude }>;

export async function listKnowledgePoints(
  actorId: string,
  options?: { subjectId?: string; q?: string; masteryState?: KnowledgeMasteryStateDto },
): Promise<KnowledgePointDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const query = options?.q?.trim().slice(0, 120) || undefined;
  const rows = await prisma.knowledgePoint.findMany({
    where: {
      workspaceId: workspace.id,
      archivedAt: null,
      ...(options?.subjectId ? { primarySubjectId: options.subjectId } : {}),
      ...(options?.masteryState ? { masteryState: options.masteryState } : {}),
      ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}),
    },
    include: baseInclude,
    orderBy: [{ masteryState: "asc" }, { updatedAt: "desc" }],
    take: 300,
  });
  return rows.map(serializeBase);
}

export async function getKnowledgePoint(actorId: string, id: string): Promise<KnowledgePointDetailDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const row = await prisma.knowledgePoint.findFirst({
    where: { id, workspaceId: workspace.id, archivedAt: null },
    include: detailInclude,
  });
  return row ? serializeDetail(row) : null;
}

export async function createKnowledgePoint(actorId: string, input: CreateKnowledgePointInput): Promise<KnowledgePointDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const title = input.title.trim();
  const relatedSubjectIds = Array.from(new Set(input.relatedSubjectIds ?? [])).filter((id) => id !== input.subjectId);
  const requestFingerprint = buildPersistentCreateFingerprint("knowledge-point-create-v1", {
    subjectId: input.subjectId,
    primaryGroupId: input.primaryGroupId ?? null,
    stableKey: input.stableKey ?? null,
    title,
    boundary: input.boundary ?? null,
    relatedSubjectIds,
  });

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "KNOWLEDGE_POINT_CREATED",
      entityType: "KnowledgePoint",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "KNOWLEDGE_POINT_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parsePointSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const stored = await tx.knowledgePoint.findFirst({ where: { id: replay.resultId, workspaceId: workspace.id, archivedAt: null }, include: baseInclude });
      if (!stored) throw new ApiError("KNOWLEDGE_POINT_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
      return serializeBase(stored);
    }

    await assertSubject(tx, input.subjectId, workspace.id);
    if (input.primaryGroupId) await assertGroup(tx, input.primaryGroupId, workspace.id);
    await assertRelatedSubjects(tx, relatedSubjectIds, workspace.id);

    const stableKey = normalizeStableKey(input.stableKey, input.subjectId, title);
    const duplicate = await tx.knowledgePoint.findFirst({ where: { workspaceId: workspace.id, stableKey } });
    if (duplicate) throw new ApiError("KNOWLEDGE_POINT_STABLE_KEY_CONFLICT", 409, { conflictFields: ["stableKey"] });

    const created = await tx.knowledgePoint.create({
      data: {
        userId: actorId,
        workspaceId: workspace.id,
        primarySubjectId: input.subjectId,
        primaryGroupId: input.primaryGroupId ?? null,
        stableKey,
        title,
        boundary: input.boundary?.trim() || null,
        relatedSubjects: relatedSubjectIds.length ? { create: relatedSubjectIds.map((subjectId) => ({ subjectId })) } : undefined,
      },
      include: baseInclude,
    });
    const result = serializeBase(created);
    await recordPersistentCreateResult(tx, command, created.id, {
      subjectId: created.primarySubjectId,
      stableKey: created.stableKey,
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

export async function updateKnowledgePoint(actorId: string, id: string, input: UpdateKnowledgePointInput): Promise<KnowledgePointDetailDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await tx.knowledgePoint.findFirst({ where: { id, workspaceId: workspace.id, archivedAt: null }, include: detailInclude });
    if (!existing) throw new ApiError("KNOWLEDGE_POINT_NOT_FOUND", 404);
    if (existing.revision !== input.expectedRevision) {
      throw new ApiError("KNOWLEDGE_POINT_REVISION_CONFLICT", 409, { latest: serializeDetail(existing), conflictFields: ["revision"] });
    }
    if (input.primaryGroupId) await assertGroup(tx, input.primaryGroupId, workspace.id);

    const changed = await tx.knowledgePoint.updateMany({
      where: { id, workspaceId: workspace.id, archivedAt: null, revision: input.expectedRevision },
      data: {
        title: input.title?.trim(),
        boundary: input.boundary === undefined ? undefined : input.boundary?.trim() || null,
        primaryGroupId: input.primaryGroupId,
        masteryState: input.masteryState,
        nextRetestAt: input.nextRetestAt === undefined ? undefined : input.nextRetestAt ? new Date(input.nextRetestAt) : null,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ApiError("KNOWLEDGE_POINT_REVISION_CONFLICT", 409, { latest: serializeDetail(await findDetail(tx, id, workspace.id)), conflictFields: ["revision"] });

    const updated = await findDetail(tx, id, workspace.id);
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "KNOWLEDGE_POINT_UPDATED",
        entityType: "KnowledgePoint",
        entityId: id,
        metadata: { expectedRevision: input.expectedRevision, masteryState: input.masteryState ?? null },
      },
    });
    return serializeDetail(updated);
  });
}

async function findDetail(client: Prisma.TransactionClient, id: string, workspaceId: string): Promise<DetailRow> {
  const row = await client.knowledgePoint.findFirst({ where: { id, workspaceId, archivedAt: null }, include: detailInclude });
  if (!row) throw new ApiError("KNOWLEDGE_POINT_NOT_FOUND", 404);
  return row;
}

async function assertSubject(client: Pick<Prisma.TransactionClient, "subject">, subjectId: string, workspaceId: string): Promise<void> {
  const subject = await client.subject.findFirst({ where: { id: subjectId, workspaceId, archivedAt: null }, select: { id: true } });
  if (!subject) throw new ApiError("SUBJECT_NOT_FOUND", 404);
}

async function assertGroup(client: Pick<Prisma.TransactionClient, "knowledgeGroup">, groupId: string, workspaceId: string): Promise<void> {
  const group = await client.knowledgeGroup.findFirst({ where: { id: groupId, workspaceId, archivedAt: null }, select: { id: true } });
  if (!group) throw new ApiError("KNOWLEDGE_GROUP_NOT_FOUND", 404);
}

async function assertRelatedSubjects(client: Pick<Prisma.TransactionClient, "subject">, subjectIds: string[], workspaceId: string): Promise<void> {
  if (!subjectIds.length) return;
  const count = await client.subject.count({ where: { id: { in: subjectIds }, workspaceId, archivedAt: null } });
  if (count !== subjectIds.length) throw new ApiError("SUBJECT_NOT_FOUND", 404);
}

function normalizeStableKey(value: string | undefined, subjectId: string, title: string): string {
  const explicit = value?.trim();
  if (explicit) return explicit;
  const digest = createHash("sha256").update(`${subjectId}:${title.toLocaleLowerCase("zh-CN")}`).digest("hex").slice(0, 24);
  return `kp-${digest}`;
}

function serializeBase(row: BaseRow): KnowledgePointDto {
  return {
    id: row.id,
    stableKey: row.stableKey,
    title: row.title,
    boundary: row.boundary,
    masteryState: row.masteryState as KnowledgeMasteryStateDto,
    nextRetestAt: row.nextRetestAt?.toISOString() ?? null,
    revision: row.revision,
    subject: row.primarySubject,
    primaryGroup: row.primaryGroup,
    relatedSubjects: row.relatedSubjects.map(({ subject }) => subject),
    counts: {
      syllabusLinks: row._count.syllabusLinks,
      stageTargets: row._count.stageTargets,
      arrangements: row._count.arrangementLinks,
      sessions: row._count.sessionLinks,
      retests: row._count.retestLinks,
      evidence: row._count.evidence,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeDetail(row: DetailRow): KnowledgePointDetailDto {
  return {
    ...serializeBase(row),
    syllabusLinks: row.syllabusLinks.map((link) => ({ id: link.id, role: link.role, node: link.syllabusNode })),
    stageTargets: row.stageTargets.map((target) => ({ id: target.id, targetState: target.targetState as KnowledgeMasteryStateDto, importance: target.importance, stage: target.stagePlan })),
    arrangements: row.arrangementLinks.map(({ arrangement }) => ({ ...arrangement, startDate: arrangement.startDate.toISOString(), endDate: arrangement.endDate.toISOString() })),
    recentSessions: row.sessionLinks.map(({ session }) => ({ ...session, startedAt: session.startedAt.toISOString(), endedAt: session.endedAt?.toISOString() ?? null, understanding: session.closeout?.understanding ?? null })),
    evidence: row.evidence.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString() })),
  };
}

function parsePointSnapshot(value: Prisma.JsonValue | undefined): KnowledgePointDto | null {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" && typeof value.title === "string"
    ? value as unknown as KnowledgePointDto
    : null;
}
