import { createHash } from "node:crypto";
import {
  calculatePrivateChallengeScore,
  evaluateRankingAntiCheat,
  rankPrivateChallengeScores,
  stableStringify,
  type RankingAnomaly,
  type RankingSessionInput,
  type RankingShareField,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import type { RankingProjectionDto, RankingProjectionViewDto } from "./contracts";
import { requireRankingFeature } from "./feature-gate";
import {
  intersectFieldsOrApiError,
  requireChallengeMember,
  writeRankingAudit,
} from "./service-support";

export async function getChallengeProjection(
  actorId: string,
  challengeId: string,
): Promise<RankingProjectionViewDto> {
  requireRankingFeature({ multiUser: true, projection: true });
  const challenge = await requireChallengeMember(prisma, actorId, challengeId);
  const actorParticipant = challenge.participants.find((participant) => participant.userId === actorId);
  if (actorParticipant?.status !== "ACTIVE") throw new ApiError("RANKING_PARTICIPANT_NOT_ACTIVE", 409);
  const [projections, preferences] = await Promise.all([
    prisma.rankingProjection.findMany({
      where: { challengeId, participant: { status: "ACTIVE" } },
      include: { participant: true },
      orderBy: [{ score: "desc" }, { participantId: "asc" }],
    }),
    prisma.rankingPreference.findMany({
      where: {
        workspaceId: challenge.workspaceId,
        enabled: true,
        userId: { in: challenge.participants.filter((row) => row.status === "ACTIVE").map((row) => row.userId) },
      },
      select: { userId: true, authorizedFields: true },
    }),
  ]);
  const activeParticipantIds = new Set(challenge.participants.filter((row) => row.status === "ACTIVE").map((row) => row.id));
  const stale = projections.length !== activeParticipantIds.size
    || preferences.length !== activeParticipantIds.size
    || projections.some((projection) =>
      projection.scoreVersion !== challenge.scoreVersion || projection.rulesVersion !== challenge.rulesVersion);
  if (stale) return emptyProjection(challenge.id, challenge.scoreVersion, challenge.rulesVersion, true);
  return buildProjectionView(challenge, projections, preferences);
}

export async function rebuildChallengeProjection(
  actor: CurrentUser,
  challengeId: string,
  expectedRevision?: number,
): Promise<RankingProjectionViewDto> {
  requireRankingFeature({ multiUser: true, projection: true });
  return prisma.$transaction(async (tx) => {
    const challenge = await requireOwnedRebuildableChallenge(tx, actor.id, challengeId, expectedRevision);
    const participants = challenge.participants.filter((participant) => participant.status === "ACTIVE");
    const preferences = await tx.rankingPreference.findMany({
      where: {
        workspaceId: challenge.workspaceId,
        enabled: true,
        userId: { in: participants.map((participant) => participant.userId) },
      },
      select: { userId: true, authorizedFields: true },
    });
    if (preferences.length !== participants.length) throw new ApiError("RANKING_PARTICIPANT_OPT_IN_REQUIRED", 409);

    const generatedAt = new Date();
    const calculated = await Promise.all(participants.map(async (participant) => {
      const sessions = await loadSafeRankingSessions(tx, challenge.workspaceId, participant.userId, challenge.startDate, challenge.endDate);
      const score = calculatePrivateChallengeScore({
        timezone: challenge.timezone,
        window: { startDate: challenge.startDate, endDate: challenge.endDate },
        targetEffectiveMinutesPerDay: challenge.targetEffectiveMinutesPerDay,
        sessions,
      });
      const antiCheat = evaluateRankingAntiCheat({ anomalies: score.anomalies });
      return { participant, sessions, score, antiCheat };
    }));

    const eligibleParticipants = calculated.filter((row) => row.antiCheat.eligible).map((row) => row.participant.id);
    if (eligibleParticipants.length === 0) {
      await tx.rankingProjection.deleteMany({ where: { challengeId } });
    } else {
      await tx.rankingProjection.deleteMany({
        where: { challengeId, participantId: { notIn: eligibleParticipants } },
      });
    }
    for (const row of calculated) {
      if (!row.antiCheat.eligible) continue;
      const sourceFingerprint = projectionSourceFingerprint(challenge, row.participant.id, row.sessions);
      await tx.rankingProjection.upsert({
        where: { participantId: row.participant.id },
        create: {
          challengeId,
          participantId: row.participant.id,
          scoreVersion: row.score.scoreVersion,
          rulesVersion: challenge.rulesVersion,
          sourceFingerprint,
          score: row.score.score,
          effectiveMinutes: row.score.aggregate.effectiveMinutes,
          activeDays: row.score.aggregate.activeDays,
          minimumActionDays: row.score.aggregate.minimumActionDays,
          anomalyCount: row.score.anomalies.length,
          anomalies: serializeAnomalySummary(row.score.anomalies),
          generatedAt,
        },
        update: {
          scoreVersion: row.score.scoreVersion,
          rulesVersion: challenge.rulesVersion,
          sourceFingerprint,
          score: row.score.score,
          effectiveMinutes: row.score.aggregate.effectiveMinutes,
          activeDays: row.score.aggregate.activeDays,
          minimumActionDays: row.score.aggregate.minimumActionDays,
          anomalyCount: row.score.anomalies.length,
          anomalies: serializeAnomalySummary(row.score.anomalies),
          generatedAt,
        },
      });
    }
    await writeRankingAudit(tx, actor.id, "RANKING_PROJECTION_REBUILT", "PrivateChallenge", challengeId, {
      workspaceId: challenge.workspaceId,
      scoreVersion: challenge.scoreVersion,
      rulesVersion: challenge.rulesVersion,
      participantCount: participants.length,
      eligibleParticipantCount: calculated.filter((row) => row.antiCheat.eligible).length,
      excludedParticipantCount: calculated.filter((row) => row.antiCheat.shouldExclude).length,
      generatedAt: generatedAt.toISOString(),
    });
    const projections = await tx.rankingProjection.findMany({
      where: { challengeId, participant: { status: "ACTIVE" } },
      include: { participant: true },
      orderBy: [{ score: "desc" }, { participantId: "asc" }],
    });
    return buildProjectionView(challenge, projections, preferences);
  }, { isolationLevel: "Serializable" });
}

/** Stable names for lifecycle workers and future DataJob adapters. */
export const rebuildRankingProjection = rebuildChallengeProjection;
export const getRankingProjection = getChallengeProjection;

async function requireOwnedRebuildableChallenge(
  tx: Prisma.TransactionClient,
  actorId: string,
  challengeId: string,
  expectedRevision?: number,
) {
  const challenge = await tx.privateChallenge.findFirst({
    where: {
      id: challengeId,
      ownerUserId: actorId,
      status: { in: ["ACTIVE", "ENDED", "CLOSED"] },
      workspace: {
        status: "ACTIVE",
        memberships: { some: { userId: actorId, status: "ACTIVE", user: { status: "ACTIVE" } } },
      },
    },
    include: { participants: { orderBy: { createdAt: "asc" } } },
  });
  if (!challenge) throw new ApiError("RANKING_CHALLENGE_NOT_FOUND", 404);
  if (!challenge.participants.some((participant) => participant.userId === actorId && participant.status === "ACTIVE")) {
    throw new ApiError("RANKING_PARTICIPANT_NOT_ACTIVE", 409);
  }
  if (expectedRevision !== undefined && expectedRevision !== challenge.revision) {
    throw new ApiError("RANKING_CHALLENGE_CONFLICT", 409);
  }
  return challenge;
}

async function loadSafeRankingSessions(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  startDate: string,
  endDate: string,
): Promise<RankingSessionInput[]> {
  const rows = await tx.studySession.findMany({
    where: {
      workspaceId,
      userId,
      status: "COMPLETED",
      endedAt: { not: null },
      startedAt: { gte: expandedUtcBoundary(startDate, -2), lt: expandedUtcBoundary(endDate, 2) },
    },
    // This exact allowlist is a privacy boundary. Do not add task/note/review,
    // title, emotion, motivation, attachment, AI or other content fields.
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      effectiveMinutes: true,
      isEffective: true,
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((row) => row.endedAt ? [{
    id: row.id,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    effectiveSeconds: row.effectiveMinutes * 60,
    minimumActionCompleted: row.isEffective === true,
  }] : []);
}

function buildProjectionView(
  challenge: { id: string; scoreVersion: string; rulesVersion: number; publishedFields: string[] },
  projections: Array<{
    participantId: string;
    scoreVersion: string;
    rulesVersion: number;
    score: number;
    effectiveMinutes: number;
    activeDays: number;
    minimumActionDays: number;
    anomalyCount: number;
    generatedAt: Date;
    participant: { userId: string; nickname: string | null; authorizedFields: string[] };
  }>,
  preferences: Array<{ userId: string; authorizedFields: string[] }>,
): RankingProjectionViewDto {
  const preferenceFields = new Map(preferences.map((preference) => [preference.userId, preference.authorizedFields]));
  const visibleProjections = projections.filter((projection) => preferenceFields.has(projection.participant.userId));
  const ranked = rankPrivateChallengeScores(visibleProjections.map((row) => ({ participantKey: row.participantId, score: row.score })));
  const rankByParticipant = new Map(ranked.map((row) => [row.participantKey, row]));
  const entries = visibleProjections.flatMap((projection): RankingProjectionDto[] => {
    const preference = preferenceFields.get(projection.participant.userId);
    if (!preference) return [];
    const participantFields = intersectFieldsOrApiError(challenge.publishedFields, projection.participant.authorizedFields);
    const fields = intersectFieldsOrApiError(participantFields, preference);
    const rank = rankByParticipant.get(projection.participantId);
    if (!rank) return [];
    return [{
      participantId: projection.participantId,
      displayName: projection.participant.nickname || "匿名参与者",
      rank: rank.rank,
      tieGroup: rank.tieGroup,
      tied: rank.tied,
      scoreVersion: projection.scoreVersion,
      generatedAt: projection.generatedAt.toISOString(),
      fields: projectAllowedFields(projection, fields),
    }];
  });
  return { challengeId: challenge.id, scoreVersion: challenge.scoreVersion, rulesVersion: challenge.rulesVersion, stale: false, entries };
}

function projectAllowedFields(
  projection: { score: number; effectiveMinutes: number; activeDays: number; minimumActionDays: number; anomalyCount: number },
  fields: readonly RankingShareField[],
): Partial<Record<RankingShareField, number>> {
  const values: Record<RankingShareField, number> = {
    score: projection.score,
    effective_minutes: projection.effectiveMinutes,
    active_days: projection.activeDays,
    minimum_action_days: projection.minimumActionDays,
    anomaly_count: projection.anomalyCount,
  };
  return Object.fromEntries(fields.map((field) => [field, values[field]]));
}

function projectionSourceFingerprint(
  challenge: { id: string; scoreVersion: string; rulesVersion: number; timezone: string; startDate: string; endDate: string; targetEffectiveMinutesPerDay: number },
  participantId: string,
  sessions: readonly RankingSessionInput[],
): string {
  return createHash("sha256").update(stableStringify({
    challengeId: challenge.id,
    participantId,
    scoreVersion: challenge.scoreVersion,
    rulesVersion: challenge.rulesVersion,
    timezone: challenge.timezone,
    window: { startDate: challenge.startDate, endDate: challenge.endDate },
    targetEffectiveMinutesPerDay: challenge.targetEffectiveMinutesPerDay,
    sessions: sessions.map((session) => ({
      id: session.id,
      startedAt: timestampText(session.startedAt),
      endedAt: timestampText(session.endedAt),
      effectiveSeconds: session.effectiveSeconds,
      minimumActionCompleted: session.minimumActionCompleted === true,
    })),
  })).digest("hex");
}

function serializeAnomalySummary(anomalies: readonly RankingAnomaly[]): Prisma.InputJsonArray {
  return anomalies.map((anomaly) => ({ code: anomaly.code, window: anomaly.window })) as Prisma.InputJsonArray;
}

function expandedUtcBoundary(date: string, days: number): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000);
}

function timestampText(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function emptyProjection(challengeId: string, scoreVersion: string, rulesVersion: number, stale: boolean): RankingProjectionViewDto {
  return { challengeId, scoreVersion, rulesVersion, stale, entries: [] };
}
