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

export interface SubmitRankingAppealInput {
  participantId: string;
  reason: string;
  projectionFingerprint?: string;
}

export interface TransitionRankingAppealInput {
  action: RankingAppealAction;
  expectedRevision: number;
}

type RankingAppealRow = {
  id: string;
  challengeId: string;
  participantId: string;
  submittedByUserId: string;
  status: string;
  reason: string;
  projectionFingerprint: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function listRankingAppeals(actorId: string, challengeId: string): Promise<RankingAppealDto[]> {
  requireRankingFeature({ multiUser: true });
  const challenge = await requireActiveAppealMember(prisma, actorId, challengeId);
  const rows = await prisma.rankingAppeal.findMany({
    where: {
      challengeId,
      ...(challenge.ownerUserId === actorId ? {} : { submittedByUserId: actorId }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(serializeAppeal);
}

export async function getRankingAppeal(actorId: string, challengeId: string, appealId: string): Promise<RankingAppealDto> {
  requireRankingFeature({ multiUser: true });
  const challenge = await requireActiveAppealMember(prisma, actorId, challengeId);
  const appeal = await prisma.rankingAppeal.findFirst({
    where: {
      id: appealId,
      challengeId,
      ...(challenge.ownerUserId === actorId ? {} : { submittedByUserId: actorId }),
    },
  });
  if (!appeal) throw new ApiError("RANKING_APPEAL_NOT_FOUND", 404);
  return serializeAppeal(appeal);
}

export async function submitRankingAppeal(
  actor: CurrentUser,
  challengeId: string,
  input: SubmitRankingAppealInput,
): Promise<RankingAppealDto> {
  requireRankingFeature({ multiUser: true });
  const reason = validateReason(input.reason);
  try {
    return await prisma.$transaction(async (tx) => {
      const challenge = await requireActiveAppealMember(tx, actor.id, challengeId);
      const participant = challenge.participants.find((row) => row.id === input.participantId);
      if (!participant || participant.userId !== actor.id || participant.status !== "ACTIVE") {
        throw new ApiError("RANKING_APPEAL_PARTICIPANT_INVALID", 404);
      }
      const projection = await tx.rankingProjection.findUnique({ where: { participantId: participant.id } });
      if (!projection) throw new ApiError("RANKING_APPEAL_PROJECTION_NOT_FOUND", 409);
      if (input.projectionFingerprint && projection.sourceFingerprint !== input.projectionFingerprint) {
        throw new ApiError("RANKING_APPEAL_PROJECTION_STALE", 409);
      }
      const appeal = await tx.rankingAppeal.create({
        data: {
          challengeId,
          participantId: participant.id,
          submittedByUserId: actor.id,
          reason,
          projectionFingerprint: projection.sourceFingerprint,
        },
      });
      await writeAppealAudit(tx, actor.id, "RANKING_APPEAL_SUBMITTED", appeal);
      return serializeAppeal(appeal);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) throw new ApiError("RANKING_APPEAL_ALREADY_OPEN", 409);
    if (hasPrismaCode(error, "P2034")) throw new ApiError("RANKING_APPEAL_CONFLICT", 409);
    throw error;
  }
}

export async function transitionRankingAppeal(
  actor: CurrentUser,
  challengeId: string,
  appealId: string,
  input: TransitionRankingAppealInput,
): Promise<RankingAppealDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const challenge = await requireActiveAppealMember(tx, actor.id, challengeId);
    const appeal = await tx.rankingAppeal.findFirst({ where: { id: appealId, challengeId } });
    if (!appeal) throw new ApiError("RANKING_APPEAL_NOT_FOUND", 404);
    const ownerAction = input.action === "review" || input.action === "accept" || input.action === "reject";
    if ((ownerAction && challenge.ownerUserId !== actor.id)
      || (input.action === "withdraw" && appeal.submittedByUserId !== actor.id)) {
      throw new ApiError("RANKING_APPEAL_NOT_FOUND", 404);
    }
    let status: RankingAppealStatus;
    try {
      status = transitionRankingAppealStatus(appeal.status as RankingAppealStatus, input.action);
    } catch (error) {
      if (error instanceof Error && "code" in error && typeof error.code === "string") {
        throw new ApiError(error.code, 409);
      }
      throw error;
    }
    const now = new Date();
    const changed = await tx.rankingAppeal.updateMany({
      where: { id: appealId, challengeId, revision: input.expectedRevision, status: appeal.status },
      data: {
        status,
        revision: { increment: 1 },
        reviewedByUserId: ownerAction ? actor.id : null,
        reviewedAt: ownerAction ? now : null,
      },
    });
    if (changed.count !== 1) throw new ApiError("RANKING_APPEAL_CONFLICT", 409);
    const updated = await tx.rankingAppeal.findUniqueOrThrow({ where: { id: appealId } });
    await writeAppealAudit(tx, actor.id, `RANKING_APPEAL_${input.action.toUpperCase()}`, updated);
    return serializeAppeal(updated);
  }, { isolationLevel: "Serializable" });
}

async function requireActiveAppealMember(
  client: Parameters<typeof requireChallengeMember>[0],
  actorId: string,
  challengeId: string,
) {
  const challenge = await requireChallengeMember(client, actorId, challengeId);
  const participant = challenge.participants.find((row) => row.userId === actorId);
  if (challenge.ownerUserId !== actorId && participant?.status !== "ACTIVE") {
    throw new ApiError("RANKING_CHALLENGE_NOT_FOUND", 404);
  }
  return challenge;
}

function serializeAppeal(row: RankingAppealRow): RankingAppealDto {
  return {
    appealId: row.id,
    challengeId: row.challengeId,
    participantId: row.participantId,
    status: row.status as RankingAppealStatus,
    reason: row.reason,
    projectionFingerprint: row.projectionFingerprint,
    revision: row.revision,
    submittedByUserId: row.submittedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateReason(value: string): string {
  try {
    return validateRankingAppealReason(value);
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") throw new ApiError(error.code, 400);
    throw error;
  }
}

function writeAppealAudit(
  client: Pick<Prisma.TransactionClient, "auditEvent">,
  actorId: string,
  action: string,
  appeal: Pick<RankingAppealRow, "id" | "challengeId" | "participantId" | "status" | "revision" | "submittedByUserId">,
  metadata: Record<string, unknown> = {},
) {
  return writeRankingAudit(client, actorId, action, "RankingAppeal", appeal.id, {
    appealId: appeal.id,
    challengeId: appeal.challengeId,
    participantId: appeal.participantId,
    status: appeal.status,
    revision: appeal.revision,
    submittedByUserId: appeal.submittedByUserId,
    ...metadata,
  });
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === code);
}
