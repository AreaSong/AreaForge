import { randomUUID } from "node:crypto";
import {
  transitionRankingAppealStatus,
  validateRankingAppealReason,
  type RankingAppealAction,
  type RankingAppealStatus,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import type { RankingAppealDto } from "./contracts";
import { requireRankingFeature } from "./feature-gate";
import { requireChallengeMember, writeRankingAudit } from "./service-support";

const APPEAL_ENTITY_TYPE = "RankingAppeal" as const;
const APPEAL_CONTRACT_VERSION = "ranking-appeal-v1" as const;

interface AppealEventMetadata {
  contractVersion: typeof APPEAL_CONTRACT_VERSION;
  appealId: string;
  challengeId: string;
  participantId: string;
  status: RankingAppealStatus;
  revision: number;
  submittedByUserId: string;
  reason?: string | null;
  projectionFingerprint?: string | null;
}

interface AppealEventRow {
  id: string;
  actorId: string | null;
  action: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface RankingAppealAuditEventInput {
  id: string;
  metadata: unknown;
  createdAt: Date;
}

export interface SubmitRankingAppealInput {
  participantId: string;
  reason: string;
  projectionFingerprint?: string;
}

export interface TransitionRankingAppealInput {
  action: RankingAppealAction;
  expectedRevision?: number;
}

export async function listRankingAppeals(actorId: string, challengeId: string): Promise<RankingAppealDto[]> {
  requireRankingFeature({ multiUser: true });
  const challenge = await requireChallengeMember(prisma, actorId, challengeId);
  const rows = await readAppealEvents(challengeId);
  return [...reduceAppeals(rows).values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((appeal) => redactAppeal(appeal, actorId, challenge.ownerUserId));
}

export async function getRankingAppeal(actorId: string, challengeId: string, appealId: string): Promise<RankingAppealDto> {
  requireRankingFeature({ multiUser: true });
  const challenge = await requireChallengeMember(prisma, actorId, challengeId);
  const appeal = [...reduceAppeals(await readAppealEvents(challengeId)).values()]
    .find((candidate) => candidate.appealId === appealId);
  if (!appeal) throw new ApiError("RANKING_APPEAL_NOT_FOUND", 404);
  return redactAppeal(appeal, actorId, challenge.ownerUserId);
}

export async function submitRankingAppeal(
  actor: CurrentUser,
  challengeId: string,
  input: SubmitRankingAppealInput,
): Promise<RankingAppealDto> {
  requireRankingFeature({ multiUser: true });
  const reason = validateReason(input.reason);
  return prisma.$transaction(async (tx) => {
    const challenge = await requireChallengeMember(tx, actor.id, challengeId);
    const participant = challenge.participants.find((row) => row.id === input.participantId);
    if (!participant || participant.userId !== actor.id || participant.status !== "ACTIVE") {
      throw new ApiError("RANKING_APPEAL_PARTICIPANT_INVALID", 404);
    }
    const projection = await tx.rankingProjection.findUnique({ where: { participantId: participant.id } });
    if (!projection) throw new ApiError("RANKING_APPEAL_PROJECTION_NOT_FOUND", 409);
    if (input.projectionFingerprint && projection.sourceFingerprint !== input.projectionFingerprint) {
      throw new ApiError("RANKING_APPEAL_PROJECTION_STALE", 409);
    }
    const existing = [...reduceAppeals(await readAppealEvents(challengeId, tx)).values()]
      .find((appeal) => appeal.participantId === participant.id && !isTerminalAppealStatus(appeal.status));
    if (existing) throw new ApiError("RANKING_APPEAL_ALREADY_OPEN", 409);
    const appealId = randomUUID();
    const now = new Date();
    const metadata: AppealEventMetadata = {
      contractVersion: APPEAL_CONTRACT_VERSION,
      appealId,
      challengeId,
      participantId: participant.id,
      status: "OPEN",
      revision: 1,
      submittedByUserId: actor.id,
      reason,
      projectionFingerprint: input.projectionFingerprint ?? projection.sourceFingerprint,
    };
    await writeAppealEvent(tx, actor.id, "RANKING_APPEAL_SUBMITTED", challengeId, metadata);
    return serializeAppeal({
      appealId,
      challengeId,
      participantId: participant.id,
      status: "OPEN",
      reason,
      projectionFingerprint: input.projectionFingerprint ?? projection.sourceFingerprint,
      revision: 1,
      submittedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    });
  }, { isolationLevel: "Serializable" });
}

export async function transitionRankingAppeal(
  actor: CurrentUser,
  challengeId: string,
  appealId: string,
  input: TransitionRankingAppealInput,
): Promise<RankingAppealDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const challenge = await requireChallengeMember(tx, actor.id, challengeId);
    const appeal = [...reduceAppeals(await readAppealEvents(challengeId, tx)).values()]
      .find((candidate) => candidate.appealId === appealId);
    if (!appeal) throw new ApiError("RANKING_APPEAL_NOT_FOUND", 404);
    if (input.expectedRevision !== undefined && input.expectedRevision !== appeal.revision) {
      throw new ApiError("RANKING_APPEAL_CONFLICT", 409);
    }
    const ownerAction = input.action === "review" || input.action === "accept" || input.action === "reject";
    const canManage = challenge.ownerUserId === actor.id;
    const canWithdraw = appeal.submittedByUserId === actor.id;
    if ((ownerAction && !canManage) || (input.action === "withdraw" && !canWithdraw && !canManage)) {
      throw new ApiError("RANKING_APPEAL_FORBIDDEN", 403);
    }
    let status: RankingAppealStatus;
    try {
      status = transitionRankingAppealStatus(appeal.status, input.action);
    } catch (error) {
      if (error instanceof Error && "code" in error && typeof error.code === "string") {
        throw new ApiError(error.code, 409);
      }
      throw error;
    }
    const metadata: AppealEventMetadata = {
      contractVersion: APPEAL_CONTRACT_VERSION,
      appealId,
      challengeId,
      participantId: appeal.participantId,
      status,
      revision: appeal.revision + 1,
      submittedByUserId: appeal.submittedByUserId,
      reason: appeal.reason,
      projectionFingerprint: appeal.projectionFingerprint,
    };
    await writeAppealEvent(tx, actor.id, `RANKING_APPEAL_${input.action.toUpperCase()}`, challengeId, metadata);
    const now = new Date();
    return serializeAppeal({
      ...appeal,
      status,
      revision: appeal.revision + 1,
      createdAt: new Date(appeal.createdAt),
      updatedAt: now,
    });
  }, { isolationLevel: "Serializable" });
}

/** 用于读侧重放和隔离测试的纯函数入口；不会执行数据库写入。 */
export function replayRankingAppealEvents(rows: readonly RankingAppealAuditEventInput[]): RankingAppealDto[] {
  return [...reduceAppeals(rows.map((row) => ({
    ...row,
    actorId: null,
    action: "",
    entityId: null,
  }))).values()];
}

async function readAppealEvents(
  challengeId: string,
  client: Pick<Prisma.TransactionClient, "auditEvent"> = prisma,
): Promise<AppealEventRow[]> {
  return client.auditEvent.findMany({
    where: { entityType: APPEAL_ENTITY_TYPE, entityId: challengeId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, actorId: true, action: true, entityId: true, metadata: true, createdAt: true },
  });
}

function reduceAppeals(rows: readonly AppealEventRow[]): Map<string, RankingAppealDto> {
  const result = new Map<string, RankingAppealDto>();
  for (const row of rows) {
    const metadata = parseAppealMetadata(row.metadata);
    if (!metadata) continue;
    const previous = result.get(metadata.appealId);
    if (previous && metadata.revision <= previous.revision) continue;
    const createdAt = previous ? new Date(previous.createdAt) : row.createdAt;
    result.set(metadata.appealId, serializeAppeal({
      appealId: metadata.appealId,
      challengeId: metadata.challengeId,
      participantId: metadata.participantId,
      status: metadata.status,
      reason: metadata.reason ?? previous?.reason ?? null,
      projectionFingerprint: metadata.projectionFingerprint ?? previous?.projectionFingerprint ?? null,
      revision: metadata.revision,
      submittedByUserId: metadata.submittedByUserId,
      createdAt,
      updatedAt: row.createdAt,
    }));
  }
  return result;
}

function parseAppealMetadata(value: unknown): AppealEventMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (metadata.contractVersion !== APPEAL_CONTRACT_VERSION
    || typeof metadata.appealId !== "string"
    || typeof metadata.challengeId !== "string"
    || typeof metadata.participantId !== "string"
    || typeof metadata.submittedByUserId !== "string"
    || !isAppealStatus(metadata.status)
    || typeof metadata.revision !== "number"
    || !Number.isInteger(metadata.revision)
    || metadata.revision < 1) return null;
  return {
    contractVersion: APPEAL_CONTRACT_VERSION,
    appealId: metadata.appealId,
    challengeId: metadata.challengeId,
    participantId: metadata.participantId,
    status: metadata.status,
    revision: metadata.revision,
    submittedByUserId: metadata.submittedByUserId,
    reason: typeof metadata.reason === "string" ? metadata.reason : null,
    projectionFingerprint: typeof metadata.projectionFingerprint === "string" ? metadata.projectionFingerprint : null,
  };
}

function serializeAppeal(input: Omit<RankingAppealDto, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date }): RankingAppealDto {
  return { ...input, createdAt: input.createdAt.toISOString(), updatedAt: input.updatedAt.toISOString() };
}

function redactAppeal(appeal: RankingAppealDto, actorId: string, ownerId: string | null): RankingAppealDto {
  return actorId === appeal.submittedByUserId || actorId === ownerId ? appeal : { ...appeal, reason: null };
}

function isTerminalAppealStatus(status: RankingAppealStatus): boolean {
  return status === "ACCEPTED" || status === "REJECTED" || status === "WITHDRAWN";
}

function isAppealStatus(value: unknown): value is RankingAppealStatus {
  return value === "OPEN" || value === "UNDER_REVIEW" || value === "ACCEPTED" || value === "REJECTED" || value === "WITHDRAWN";
}

function validateReason(value: string): string {
  try {
    return validateRankingAppealReason(value);
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") throw new ApiError(error.code, 400);
    throw error;
  }
}

function writeAppealEvent(
  client: Pick<Prisma.TransactionClient, "auditEvent">,
  actorId: string,
  action: string,
  challengeId: string,
  metadata: AppealEventMetadata,
) {
  return writeRankingAudit(client, actorId, action, APPEAL_ENTITY_TYPE, challengeId, metadata as unknown as Record<string, unknown>);
}
