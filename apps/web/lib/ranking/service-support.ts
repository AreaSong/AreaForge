import {
  RankingPolicyError,
  intersectRankingShareFields,
  normalizeRankingShareFields,
  validatePrivateChallengeScoreInput,
  type PrivateChallengeParticipantStatus,
  type RankingShareField,
} from "@areaforge/core";
import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { PrivateChallengeDto, RankingParticipantDto } from "./contracts";

export type RankingClient = Pick<Prisma.TransactionClient,
  "examWorkspace" | "workspaceMembership" | "rankingPreference" | "privateChallenge" | "privateChallengeParticipant" | "rankingProjection" | "auditEvent" | "studySession" | "user">;

export function mapRankingPolicyError(error: unknown): never | void {
  if (error instanceof RankingPolicyError) {
    throw new ApiError(error.code, 400);
  }
}

export async function requireActiveRankingMember(
  client: RankingClient,
  actorId: string,
  workspaceId: string,
) {
  const membership = await client.workspaceMembership.findFirst({
    where: {
      workspaceId,
      userId: actorId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      workspace: { status: "ACTIVE" },
    },
    select: { id: true, role: true },
  });
  if (!membership) throw new ApiError("RANKING_WORKSPACE_NOT_FOUND", 404);
  return membership;
}

export async function requireChallengeMember(
  client: RankingClient,
  actorId: string,
  challengeId: string,
  options: { includeEnded?: boolean } = {},
) {
  const challenge = await client.privateChallenge.findFirst({
    where: {
      id: challengeId,
      ...(options.includeEnded ? {} : { status: { not: "DISSOLVED" } }),
      workspace: {
        status: "ACTIVE",
        memberships: { some: { userId: actorId, status: "ACTIVE", user: { status: "ACTIVE" } } },
      },
      participants: { some: { userId: actorId, status: { in: ["ACTIVE", "INVITED"] } } },
    },
    include: { participants: { orderBy: { createdAt: "asc" } } },
  });
  if (!challenge) throw new ApiError("RANKING_CHALLENGE_NOT_FOUND", 404);
  return challenge;
}

export function normalizeFieldsOrApiError(fields: readonly string[] | null | undefined): RankingShareField[] {
  try {
    return normalizeRankingShareFields(fields);
  } catch (error) {
    mapRankingPolicyError(error);
    throw error;
  }
}

export function intersectFieldsOrApiError(
  challengeFields: readonly string[],
  participantFields: readonly string[] | null | undefined,
): RankingShareField[] {
  try {
    return intersectRankingShareFields(challengeFields, participantFields);
  } catch (error) {
    mapRankingPolicyError(error);
    throw error;
  }
}

export function serializeParticipant(row: {
  id: string;
  userId: string | null;
  nickname: string | null;
  status: string;
  authorizedFields: string[];
  revision: number;
  joinedAt: Date | null;
  leftAt: Date | null;
  removedAt: Date | null;
}): RankingParticipantDto {
  return {
    id: row.id,
    userId: row.userId,
    nickname: row.nickname,
    status: row.status as PrivateChallengeParticipantStatus,
    authorizedFields: normalizeFieldsOrApiError(row.authorizedFields),
    revision: row.revision,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    leftAt: row.leftAt?.toISOString() ?? null,
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}

export function serializeChallenge(row: {
  id: string;
  workspaceId: string;
  ownerUserId: string | null;
  name: string;
  description: string | null;
  status: string;
  timezone: string;
  startDate: string;
  endDate: string;
  targetEffectiveMinutesPerDay: number;
  scoreVersion: string;
  rulesVersion: number;
  publishedFields: string[];
  revision: number;
  startedAt: Date | null;
  endedAt: Date | null;
  closedAt: Date | null;
  dissolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  participants?: Array<Parameters<typeof serializeParticipant>[0]>;
}): PrivateChallengeDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    description: row.description,
    status: row.status as PrivateChallengeDto["status"],
    timezone: row.timezone,
    startDate: row.startDate,
    endDate: row.endDate,
    targetEffectiveMinutesPerDay: row.targetEffectiveMinutesPerDay,
    scoreVersion: row.scoreVersion,
    rulesVersion: row.rulesVersion,
    publishedFields: normalizeFieldsOrApiError(row.publishedFields),
    revision: row.revision,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    dissolvedAt: row.dissolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.participants ? { participants: row.participants.map(serializeParticipant) } : {}),
  };
}

export function writeRankingAudit(
  client: Pick<Prisma.TransactionClient, "auditEvent">,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  return client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      metadata: metadata as Prisma.InputJsonObject,
    },
  });
}

export function validateDateWindowOrApiError(input: {
  timezone: string;
  startDate: string;
  endDate: string;
  targetEffectiveMinutesPerDay: number;
}): void {
  // Delayed import keeps the source of truth in @areaforge/core while letting
  // API code expose a stable ApiError contract.
  try {
    validatePrivateChallengeScoreInput({
      timezone: input.timezone,
      window: { startDate: input.startDate, endDate: input.endDate },
      targetEffectiveMinutesPerDay: input.targetEffectiveMinutesPerDay,
      sessions: [],
    });
  } catch (error) {
    mapRankingPolicyError(error);
    if (error instanceof Error && error.message.includes("TIMEZONE_INVALID")) throw new ApiError("RANKING_TIMEZONE_INVALID", 400);
    if (error instanceof Error && error.message.includes("WINDOW")) throw new ApiError("RANKING_WINDOW_INVALID", 400);
    if (error instanceof Error && error.message.includes("TARGET_INVALID")) throw new ApiError("RANKING_TARGET_INVALID", 400);
    throw error;
  }
}
