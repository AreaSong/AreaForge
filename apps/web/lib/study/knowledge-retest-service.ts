import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { masteryStateForRetest } from "./knowledge-mastery";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";

export type KnowledgeRetestStatusDto = "DRAFT" | "IN_PROGRESS" | "PENDING_REVIEW" | "CLOSED" | "VOIDED";
export type KnowledgeRetestResultDto = "PASSED" | "PARTIAL" | "FAILED";

export interface KnowledgeRetestPointDto {
  id: string;
  knowledgePointId: string;
  title: string;
  result: KnowledgeRetestResultDto | null;
  score: number | null;
  understanding: number | null;
  note: string | null;
}

export interface KnowledgeRetestListItemDto {
  id: string;
  revision: number;
  title: string;
  method: string;
  status: KnowledgeRetestStatusDto;
  result: KnowledgeRetestResultDto | null;
  scheduledAt: string | null;
  testedAt: string | null;
  nextDueAt: string | null;
  summary: string | null;
  pointCount: number;
  pointTitles: string[];
}

export interface KnowledgeRetestDetailDto extends KnowledgeRetestListItemDto {
  reviewText: string | null;
  revision: number;
  points: KnowledgeRetestPointDto[];
}

export interface CreateKnowledgeRetestInput {
  idempotencyKey: string;
  title: string;
  method: string;
  scheduledAt?: string | null;
  knowledgePointIds: string[];
}

export interface SubmitKnowledgeRetestInput {
  idempotencyKey: string;
  expectedRevision: number;
  points: Array<{
    pointId: string;
    result: KnowledgeRetestResultDto;
    score?: number | null;
    understanding?: number | null;
    note?: string | null;
  }>;
  summary: string;
  reviewText: string;
}

export interface KnowledgeRetestCommandInput {
  idempotencyKey: string;
  expectedRevision: number;
}

const pointInclude = {
  knowledgePoint: { select: { id: true, title: true, masteryState: true } },
} satisfies Prisma.KnowledgeRetestPointInclude;

export async function listKnowledgeRetests(actorId: string): Promise<KnowledgeRetestListItemDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.knowledgeRetest.findMany({
    where: { userId: actorId, workspaceId: workspace.id },
    include: { points: { include: pointInclude, orderBy: { id: "asc" }, take: 12 }, _count: { select: { points: true } } },
    orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });

  return rows.map((row) => ({
    id: row.id,
    revision: row.revision,
    title: row.title,
    method: row.method,
    status: row.status as KnowledgeRetestStatusDto,
    result: row.result as KnowledgeRetestResultDto | null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    testedAt: row.testedAt?.toISOString() ?? null,
    nextDueAt: row.nextDueAt?.toISOString() ?? null,
    summary: row.summary,
    pointCount: row._count.points,
    pointTitles: row.points.map((point) => point.knowledgePoint.title),
  }));
}

export async function getKnowledgeRetest(actorId: string, id: string): Promise<KnowledgeRetestDetailDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const row = await prisma.knowledgeRetest.findFirst({
    where: { id, userId: actorId, workspaceId: workspace.id },
    include: { points: { include: pointInclude, orderBy: { id: "asc" } }, _count: { select: { points: true } } },
  });
  return row ? serializeDetail(row) : null;
}

export async function createKnowledgeRetest(actorId: string, input: CreateKnowledgeRetestInput): Promise<KnowledgeRetestDetailDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const pointIds = Array.from(new Set(input.knowledgePointIds));
  if (!pointIds.length) throw new ApiError("KNOWLEDGE_RETEST_POINTS_REQUIRED", 400);
  const title = input.title.trim();
  const method = input.method.trim();
  if (!title || !method) throw new ApiError("KNOWLEDGE_RETEST_TITLE_METHOD_REQUIRED", 400);
  const fingerprint = buildPersistentCreateFingerprint("knowledge-retest-create-v1", {
    title,
    method,
    scheduledAt: input.scheduledAt ?? null,
    pointIds,
  });

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "KNOWLEDGE_RETEST_CREATED",
      entityType: "KnowledgeRetest",
      idempotencyKey,
      requestFingerprint: fingerprint,
      conflictCode: "KNOWLEDGE_RETEST_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const existing = await findDetail(tx, replay.resultId, actorId, workspace.id);
      return serializeDetail(existing);
    }

    const points = await tx.knowledgePoint.findMany({
      where: { id: { in: pointIds }, userId: actorId, workspaceId: workspace.id, archivedAt: null },
      select: { id: true },
    });
    if (points.length !== pointIds.length) throw new ApiError("KNOWLEDGE_RETEST_POINT_NOT_FOUND", 404);
    const created = await tx.knowledgeRetest.create({
      data: {
        userId: actorId,
        workspaceId: workspace.id,
        title,
        method,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        points: { create: pointIds.map((knowledgePointId) => ({ knowledgePointId, result: null })) },
      },
      include: { points: { include: pointInclude, orderBy: { id: "asc" } }, _count: { select: { points: true } } },
    });
    await recordPersistentCreateResult(tx, command, created.id, { pointCount: pointIds.length });
    return serializeDetail(created);
  });
}

export async function startKnowledgeRetest(
  actorId: string,
  id: string,
  input: KnowledgeRetestCommandInput,
): Promise<KnowledgeRetestDetailDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const fingerprint = buildPersistentCreateFingerprint("knowledge-retest-start-v1", { id, expectedRevision: input.expectedRevision });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = retestCommand(actorId, workspace.id, id, "STARTED", idempotencyKey, fingerprint);
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) return replayRetest(tx, replay.resultId, actorId, workspace.id, replay.resultSnapshot);
    const existing = await findDetail(tx, id, actorId, workspace.id);
    assertExpectedRevision(existing, input.expectedRevision, "KNOWLEDGE_RETEST_START_REVISION_CONFLICT");
    if (existing.status !== "DRAFT") {
      throw new ApiError("KNOWLEDGE_RETEST_START_INVALID_STATE", 409, { latest: serializeDetail(existing), conflictFields: ["status"] });
    }
    await tx.knowledgeRetest.update({ where: { id }, data: { status: "IN_PROGRESS", revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "KNOWLEDGE_RETEST_STARTED", entityType: "KnowledgeRetest", entityId: id } });
    const result = serializeDetail(await findDetail(tx, id, actorId, workspace.id));
    await recordPersistentCreateResult(tx, command, id, { resultSnapshot: result as unknown as Prisma.InputJsonObject });
    return result;
  });
}

export async function submitKnowledgeRetest(actorId: string, id: string, input: SubmitKnowledgeRetestInput): Promise<KnowledgeRetestDetailDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const fingerprint = buildPersistentCreateFingerprint("knowledge-retest-submit-v1", {
    id,
    expectedRevision: input.expectedRevision,
    points: input.points,
    summary: input.summary,
    reviewText: input.reviewText,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = retestCommand(actorId, workspace.id, id, "SUBMITTED", idempotencyKey, fingerprint);
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) return replayRetest(tx, replay.resultId, actorId, workspace.id, replay.resultSnapshot);
    const existing = await findDetail(tx, id, actorId, workspace.id);
    assertExpectedRevision(existing, input.expectedRevision, "KNOWLEDGE_RETEST_SUBMIT_REVISION_CONFLICT");
    if (existing.status !== "IN_PROGRESS") throw new ApiError("KNOWLEDGE_RETEST_SUBMIT_INVALID_STATE", 409, { latest: serializeDetail(existing), conflictFields: ["status"] });
    if (!input.summary.trim() || !input.reviewText.trim()) throw new ApiError("KNOWLEDGE_RETEST_REVIEW_REQUIRED", 400);
    const submitted = new Map(input.points.map((point) => [point.pointId, point]));
    if (submitted.size !== existing.points.length || existing.points.some((point) => !submitted.has(point.id))) {
      throw new ApiError("KNOWLEDGE_RETEST_RESULT_INCOMPLETE", 400, { conflictFields: ["points"] });
    }
    const incompletePointIds = existing.points
      .filter((point) => {
        const result = submitted.get(point.id);
        return !result
          || !result.result
          || result.score == null
          || !result.note?.trim();
      })
      .map((point) => point.id);
    if (incompletePointIds.length > 0) {
      throw new ApiError("KNOWLEDGE_RETEST_POINT_FEEDBACK_REQUIRED", 400, {
        conflictFields: ["points", "points.score", "points.note"],
      });
    }
    for (const point of existing.points) {
      const result = submitted.get(point.id)!;
      await tx.knowledgeRetestPoint.update({
        where: { id: point.id },
        data: {
          result: result.result,
          score: result.score ?? null,
          understanding: result.understanding ?? null,
          note: result.note?.trim() || null,
        },
      });
    }
    const values = Array.from(submitted.values());
    const overallResult = values.every((point) => point.result === "PASSED")
      ? "PASSED"
      : values.every((point) => point.result === "FAILED")
        ? "FAILED"
        : "PARTIAL";
    await tx.knowledgeRetest.update({
      where: { id },
      data: {
        status: "PENDING_REVIEW",
        result: overallResult,
        testedAt: new Date(),
        summary: input.summary.trim(),
        reviewText: input.reviewText.trim(),
        revision: { increment: 1 },
      },
    });
    await tx.auditEvent.create({ data: { actorId, action: "KNOWLEDGE_RETEST_SUBMITTED", entityType: "KnowledgeRetest", entityId: id } });
    const result = serializeDetail(await findDetail(tx, id, actorId, workspace.id));
    await recordPersistentCreateResult(tx, command, id, { resultSnapshot: result as unknown as Prisma.InputJsonObject });
    return result;
  });
}

export async function confirmKnowledgeRetest(
  actorId: string,
  id: string,
  input: KnowledgeRetestCommandInput,
): Promise<KnowledgeRetestDetailDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const fingerprint = buildPersistentCreateFingerprint("knowledge-retest-confirm-v1", { id, expectedRevision: input.expectedRevision });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = retestCommand(actorId, workspace.id, id, "CONFIRMED", idempotencyKey, fingerprint);
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) return replayRetest(tx, replay.resultId, actorId, workspace.id, replay.resultSnapshot);
    const existing = await findDetail(tx, id, actorId, workspace.id);
    assertExpectedRevision(existing, input.expectedRevision, "KNOWLEDGE_RETEST_CONFIRM_REVISION_CONFLICT");
    if (existing.status !== "PENDING_REVIEW" || !existing.reviewText?.trim()) {
      if (existing.status === "CLOSED") return serializeDetail(existing);
      throw new ApiError("KNOWLEDGE_RETEST_CONFIRM_REQUIRES_REVIEW", 409, { latest: serializeDetail(existing), conflictFields: ["status", "reviewText"] });
    }
    const nextDueAt = new Date(Date.now() + dueDays(existing.result));
    const testedAt = existing.testedAt ? new Date(existing.testedAt) : new Date();
    const pointIds = existing.points.map((point) => point.knowledgePointId);
    const previousEvidence = await tx.knowledgeEvidence.findMany({
      where: { workspaceId: workspace.id, sourceType: "RETEST", knowledgePointId: { in: pointIds } },
      select: { knowledgePointId: true, occurredAt: true, dimensions: true },
    });
    for (const point of existing.points) {
      const evidence = previousEvidence.filter((item) => item.knowledgePointId === point.knowledgePointId);
      const state = masteryStateForRetest({
        result: point.result,
        currentState: point.knowledgePoint.masteryState,
        testedAt,
        previousEvidence: evidence,
        method: existing.method,
      });
      await tx.knowledgePoint.update({
        where: { id: point.knowledgePointId },
        data: { masteryState: state, nextRetestAt: nextDueAt, revision: { increment: 1 } },
      });
      await tx.knowledgeEvidence.create({
        data: {
          userId: actorId,
          workspaceId: workspace.id,
          knowledgePointId: point.knowledgePointId,
          sourceType: "RETEST",
          retestPointId: point.id,
          summary: point.note ?? existing.reviewText,
          dimensions: {
            result: point.result,
            score: point.score,
            understanding: point.understanding,
            retestId: existing.id,
            method: existing.method,
          } as Prisma.InputJsonObject,
          confidence: confidenceForResult(point.result),
          occurredAt: testedAt,
        },
      });
    }
    await tx.knowledgeRetest.update({ where: { id }, data: { status: "CLOSED", nextDueAt, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "KNOWLEDGE_RETEST_CONFIRMED", entityType: "KnowledgeRetest", entityId: id } });
    const result = serializeDetail(await findDetail(tx, id, actorId, workspace.id));
    await recordPersistentCreateResult(tx, command, id, { resultSnapshot: result as unknown as Prisma.InputJsonObject });
    return result;
  });
}

export async function voidKnowledgeRetest(
  actorId: string,
  id: string,
  input: KnowledgeRetestCommandInput,
): Promise<KnowledgeRetestDetailDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const fingerprint = buildPersistentCreateFingerprint("knowledge-retest-void-v1", { id, expectedRevision: input.expectedRevision });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = retestCommand(actorId, workspace.id, id, "VOIDED", idempotencyKey, fingerprint);
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) return replayRetest(tx, replay.resultId, actorId, workspace.id, replay.resultSnapshot);
    const existing = await findDetail(tx, id, actorId, workspace.id);
    assertExpectedRevision(existing, input.expectedRevision, "KNOWLEDGE_RETEST_VOID_REVISION_CONFLICT");
    if (existing.status === "VOIDED") return serializeDetail(existing);
    if (existing.status === "CLOSED") {
      throw new ApiError("KNOWLEDGE_RETEST_VOID_INVALID_STATE", 409, {
        latest: serializeDetail(existing),
        conflictFields: ["status"],
      });
    }
    await tx.knowledgeRetest.update({
      where: { id },
      data: { status: "VOIDED", revision: { increment: 1 } },
    });
    await tx.auditEvent.create({ data: { actorId, action: "KNOWLEDGE_RETEST_VOIDED", entityType: "KnowledgeRetest", entityId: id } });
    const result = serializeDetail(await findDetail(tx, id, actorId, workspace.id));
    await recordPersistentCreateResult(tx, command, id, { resultSnapshot: result as unknown as Prisma.InputJsonObject });
    return result;
  });
}

function retestCommand(
  actorId: string,
  workspaceId: string,
  entityId: string,
  action: "STARTED" | "SUBMITTED" | "CONFIRMED" | "VOIDED",
  idempotencyKey: string,
  requestFingerprint: string,
) {
  return {
    actorId,
    workspaceId,
    action: `KNOWLEDGE_RETEST_${action}`,
    entityType: "KnowledgeRetest",
    idempotencyKey,
    requestFingerprint,
    conflictCode: `KNOWLEDGE_RETEST_${action}_IDEMPOTENCY_CONFLICT`,
    entityId,
  };
}

function assertExpectedRevision(existing: { revision: number }, expectedRevision: number, code: string): void {
  if (existing.revision !== expectedRevision) {
    throw new ApiError(code, 409, { conflictFields: ["revision"] });
  }
}

async function replayRetest(
  tx: Prisma.TransactionClient,
  id: string,
  actorId: string,
  workspaceId: string,
  snapshot: Prisma.JsonValue | undefined,
): Promise<KnowledgeRetestDetailDto> {
  const parsed = parseRetestSnapshot(snapshot);
  if (parsed) return parsed;
  return serializeDetail(await findDetail(tx, id, actorId, workspaceId));
}

function parseRetestSnapshot(value: Prisma.JsonValue | undefined): KnowledgeRetestDetailDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<KnowledgeRetestDetailDto>;
  return typeof candidate.id === "string"
    && typeof candidate.revision === "number"
    && typeof candidate.title === "string"
    && Array.isArray(candidate.points)
    ? candidate as KnowledgeRetestDetailDto
    : null;
}

async function findDetail(tx: Prisma.TransactionClient, id: string, actorId: string, workspaceId: string) {
  const row = await tx.knowledgeRetest.findFirst({
    where: { id, userId: actorId, workspaceId },
    include: { points: { include: pointInclude, orderBy: { id: "asc" } }, _count: { select: { points: true } } },
  });
  if (!row) throw new ApiError("KNOWLEDGE_RETEST_NOT_FOUND", 404);
  return row;
}

function serializeDetail(row: {
  id: string;
  title: string;
  method: string;
  status: string;
  result: string | null;
  scheduledAt: Date | null;
  testedAt: Date | null;
  nextDueAt: Date | null;
  summary: string | null;
  reviewText: string | null;
  revision: number;
  points: Array<{ id: string; knowledgePointId: string; result: string | null; score: number | null; understanding: number | null; note: string | null; knowledgePoint: { id: string; title: string; masteryState: string } }>;
  _count: { points: number };
}): KnowledgeRetestDetailDto {
  return {
    id: row.id,
    title: row.title,
    method: row.method,
    status: row.status as KnowledgeRetestStatusDto,
    result: row.result as KnowledgeRetestResultDto | null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    testedAt: row.testedAt?.toISOString() ?? null,
    nextDueAt: row.nextDueAt?.toISOString() ?? null,
    summary: row.summary,
    reviewText: row.reviewText,
    revision: row.revision,
    pointCount: row._count.points,
    pointTitles: row.points.map((point) => point.knowledgePoint.title),
    points: row.points.map((point) => ({
      id: point.id,
      knowledgePointId: point.knowledgePointId,
      title: point.knowledgePoint.title,
      result: point.result as KnowledgeRetestResultDto | null,
      score: point.score,
      understanding: point.understanding,
      note: point.note,
    })),
  };
}

function confidenceForResult(result: KnowledgeRetestResultDto | null): number {
  return result === "PASSED" ? 0.9 : result === "PARTIAL" ? 0.6 : 0.2;
}

function dueDays(result: KnowledgeRetestResultDto | null): number {
  const days = result === "PASSED" ? 14 : result === "PARTIAL" ? 3 : 1;
  return days * 24 * 60 * 60 * 1000;
}
