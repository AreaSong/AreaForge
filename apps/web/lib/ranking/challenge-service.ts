import {
  assertChallengeRulesMutable,
  assertParticipantCanLeave,
  transitionPrivateChallengeParticipant,
  transitionPrivateChallengeStatus,
  type PrivateChallengeAction,
  type PrivateChallengeParticipantAction,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { requireFreshAccountSession } from "@/lib/auth/account-service";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import { requireRankingFeature } from "./feature-gate";
import type {
  PrivateChallengeDto,
  RankingParticipantDto,
} from "./contracts";
import {
  intersectFieldsOrApiError,
  normalizeFieldsOrApiError,
  requireActiveRankingMember,
  requireChallengeMember,
  serializeChallenge,
  serializeParticipant,
  validateDateWindowOrApiError,
  writeRankingAudit,
} from "./service-support";

export interface CreatePrivateChallengeInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  targetEffectiveMinutesPerDay: number;
  publishedFields: readonly string[];
}

export interface UpdatePrivateChallengeInput {
  expectedRevision: number;
  name?: string;
  description?: string | null;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  targetEffectiveMinutesPerDay?: number;
  publishedFields?: readonly string[];
}

export interface InvitePrivateChallengeParticipantInput {
  userId: string;
  nickname?: string | null;
  authorizedFields?: readonly string[];
}

export interface UpdatePrivateChallengeParticipantInput {
  expectedRevision: number;
  nickname?: string | null;
  authorizedFields?: readonly string[];
}

export async function listPrivateChallenges(actorId: string, workspaceId?: string): Promise<PrivateChallengeDto[]> {
  requireRankingFeature({ multiUser: true });
  const rows = await prisma.privateChallenge.findMany({
    where: {
      status: { not: "DISSOLVED" },
      ...(workspaceId ? { workspaceId } : {}),
      workspace: {
        status: "ACTIVE",
        memberships: { some: { userId: actorId, status: "ACTIVE", user: { status: "ACTIVE" } } },
      },
      participants: { some: { userId: actorId, status: { in: ["ACTIVE", "INVITED"] } } },
    },
    include: { participants: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => serializeChallenge({
    ...row,
    participants: visibleParticipants(row.participants, actorId, row.ownerUserId),
  }));
}

export async function getPrivateChallenge(actorId: string, challengeId: string): Promise<PrivateChallengeDto> {
  requireRankingFeature({ multiUser: true });
  const row = await requireChallengeMember(prisma, actorId, challengeId);
  return serializeChallenge({
    ...row,
    participants: visibleParticipants(row.participants, actorId, row.ownerUserId),
  });
}

export async function createPrivateChallenge(
  actor: CurrentUser,
  input: CreatePrivateChallengeInput,
): Promise<PrivateChallengeDto> {
  requireRankingFeature({ multiUser: true });
  const publishedFields = normalizeFieldsOrApiError(input.publishedFields);
  validateDateWindowOrApiError(input);
  return prisma.$transaction(async (tx) => {
    await requireActiveRankingMember(tx, actor.id, input.workspaceId);
    await requireEnabledPreference(tx, actor.id, input.workspaceId);
    const challenge = await tx.privateChallenge.create({
      data: {
        workspaceId: input.workspaceId,
        ownerUserId: actor.id,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        timezone: input.timezone.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        targetEffectiveMinutesPerDay: input.targetEffectiveMinutesPerDay,
        publishedFields,
      },
    });
    const preference = await tx.rankingPreference.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: actor.id } },
    });
    const participant = await tx.privateChallengeParticipant.create({
      data: {
        challengeId: challenge.id,
        userId: actor.id,
        invitedByUserId: actor.id,
        status: "ACTIVE",
        nickname: null,
        authorizedFields: intersectFieldsOrApiError(publishedFields, preference.authorizedFields),
        joinedAt: new Date(),
      },
    });
    await writeRankingAudit(tx, actor.id, "RANKING_CHALLENGE_CREATED", "PrivateChallenge", challenge.id, {
      workspaceId: input.workspaceId,
      scoreVersion: challenge.scoreVersion,
      rulesVersion: challenge.rulesVersion,
      publishedFieldCount: publishedFields.length,
    });
    return serializeChallenge({ ...challenge, participants: [participant] });
  }, { isolationLevel: "Serializable" });
}

export async function updatePrivateChallenge(
  actor: CurrentUser,
  challengeId: string,
  input: UpdatePrivateChallengeInput,
): Promise<PrivateChallengeDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const existing = await ownedChallenge(tx, actor.id, challengeId);
    try {
      assertChallengeRulesMutable(existing.status);
    } catch (error) {
      throwRankingPolicy(error);
    }
    if (existing.revision !== input.expectedRevision) throw new ApiError("RANKING_CHALLENGE_CONFLICT", 409);
    const next = {
      timezone: input.timezone ?? existing.timezone,
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate ?? existing.endDate,
      targetEffectiveMinutesPerDay: input.targetEffectiveMinutesPerDay ?? existing.targetEffectiveMinutesPerDay,
    };
    validateDateWindowOrApiError(next);
    const publishedFields = input.publishedFields === undefined
      ? existing.publishedFields
      : normalizeFieldsOrApiError(input.publishedFields);
    const changed = await tx.privateChallenge.updateMany({
      where: { id: challengeId, ownerUserId: actor.id, revision: input.expectedRevision, status: existing.status },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.description === undefined ? {} : { description: input.description?.trim() || null }),
        timezone: next.timezone.trim(),
        startDate: next.startDate,
        endDate: next.endDate,
        targetEffectiveMinutesPerDay: next.targetEffectiveMinutesPerDay,
        publishedFields,
        revision: { increment: 1 },
        rulesVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ApiError("RANKING_CHALLENGE_CONFLICT", 409);
    const updated = await tx.privateChallenge.findUniqueOrThrow({
      where: { id: challengeId },
      include: { participants: { orderBy: { createdAt: "asc" } } },
    });
    await tx.rankingProjection.deleteMany({ where: { challengeId } });
    await writeRankingAudit(tx, actor.id, "RANKING_CHALLENGE_UPDATED", "PrivateChallenge", challengeId, {
      revision: updated.revision,
      rulesVersion: updated.rulesVersion,
    });
    return serializeChallenge({ ...updated, participants: visibleParticipants(updated.participants, actor.id, updated.ownerUserId) });
  }, { isolationLevel: "Serializable" });
}

export async function transitionPrivateChallenge(
  actor: CurrentUser,
  challengeId: string,
  action: PrivateChallengeAction,
  expectedRevision?: number,
): Promise<PrivateChallengeDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const existing = await ownedChallenge(tx, actor.id, challengeId);
    if (expectedRevision !== undefined && expectedRevision !== existing.revision) {
      throw new ApiError("RANKING_CHALLENGE_CONFLICT", 409);
    }
    let nextStatus: string;
    try {
      nextStatus = transitionPrivateChallengeStatus(existing.status, action);
    } catch (error) {
      throwRankingPolicy(error);
      throw error;
    }
    if (action === "start") await assertAllParticipantsOptedIn(tx, existing.id, existing.workspaceId);
    const now = new Date();
    if (action === "dissolve") {
      await tx.rankingProjection.deleteMany({ where: { challengeId } });
      await tx.privateChallengeParticipant.updateMany({
        where: { challengeId, status: { in: ["ACTIVE", "INVITED"] } },
        data: { status: "REMOVED", removedAt: now, revision: { increment: 1 } },
      });
    }
    const changed = await tx.privateChallenge.updateMany({
      where: { id: challengeId, ownerUserId: actor.id, revision: existing.revision, status: existing.status },
      data: {
        status: nextStatus as "ACTIVE" | "ENDED" | "CLOSED" | "DISSOLVED",
        revision: { increment: 1 },
        ...(action === "start" ? { startedAt: now } : {}),
        ...(action === "end" ? { endedAt: now } : {}),
        ...(action === "close" ? { closedAt: now } : {}),
        ...(action === "dissolve" ? { dissolvedAt: now } : {}),
      },
    });
    if (changed.count !== 1) throw new ApiError("RANKING_CHALLENGE_CONFLICT", 409);
    const updated = await tx.privateChallenge.findUniqueOrThrow({
      where: { id: challengeId },
      include: { participants: { orderBy: { createdAt: "asc" } } },
    });
    await writeRankingAudit(tx, actor.id, `RANKING_CHALLENGE_${action.toUpperCase()}`, "PrivateChallenge", challengeId, {
      fromStatus: existing.status,
      toStatus: updated.status,
      revision: updated.revision,
    });
    return serializeChallenge({ ...updated, participants: visibleParticipants(updated.participants, actor.id, updated.ownerUserId) });
  }, { isolationLevel: "Serializable" });
}

export async function invitePrivateChallengeParticipant(
  actor: CurrentUser,
  challengeId: string,
  input: InvitePrivateChallengeParticipantInput,
): Promise<RankingParticipantDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const challenge = await ownedChallenge(tx, actor.id, challengeId);
    if (challenge.status === "ENDED" || challenge.status === "CLOSED" || challenge.status === "DISSOLVED") {
      throw new ApiError("RANKING_CHALLENGE_NOT_INVITABLE", 409);
    }
    if (input.userId === actor.id) throw new ApiError("RANKING_PARTICIPANT_INVALID", 400);
    await requireActiveRankingMember(tx, input.userId, challenge.workspaceId);
    const preference = await tx.rankingPreference.findUnique({ where: { workspaceId_userId: { workspaceId: challenge.workspaceId, userId: input.userId } } });
    const fields = intersectFieldsOrApiError(challenge.publishedFields, input.authorizedFields ?? preference?.authorizedFields ?? ["score"]);
    const existing = await tx.privateChallengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId: input.userId } } });
    if (existing) {
      if (existing.status === "ACTIVE") return serializeParticipant(existing);
      const changed = await tx.privateChallengeParticipant.updateMany({
        where: { id: existing.id, revision: existing.revision },
        data: { status: "INVITED", nickname: normalizeNickname(input.nickname), authorizedFields: fields, leftAt: null, removedAt: null, revision: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ApiError("RANKING_PARTICIPANT_CONFLICT", 409);
      const invited = await tx.privateChallengeParticipant.findUniqueOrThrow({ where: { id: existing.id } });
      await writeRankingAudit(tx, actor.id, "RANKING_PARTICIPANT_INVITED", "PrivateChallengeParticipant", invited.id, { challengeId });
      return serializeParticipant(invited);
    }
    const participant = await tx.privateChallengeParticipant.create({
      data: {
        challengeId,
        userId: input.userId,
        invitedByUserId: actor.id,
        status: "INVITED",
        nickname: normalizeNickname(input.nickname),
        authorizedFields: fields,
      },
    });
    await writeRankingAudit(tx, actor.id, "RANKING_PARTICIPANT_INVITED", "PrivateChallengeParticipant", participant.id, { challengeId });
    return serializeParticipant(participant);
  }, { isolationLevel: "Serializable" });
}

export async function updatePrivateChallengeParticipant(
  actor: CurrentUser,
  challengeId: string,
  participantId: string,
  input: UpdatePrivateChallengeParticipantInput,
): Promise<RankingParticipantDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const challenge = await requireChallengeMember(tx, actor.id, challengeId);
    const participant = challenge.participants.find((candidate) => candidate.id === participantId);
    if (!participant) throw new ApiError("RANKING_PARTICIPANT_NOT_FOUND", 404);
    if (participant.userId !== actor.id && challenge.ownerUserId !== actor.id) throw new ApiError("RANKING_PARTICIPANT_NOT_FOUND", 404);
    if (participant.status === "REMOVED") throw new ApiError("RANKING_PARTICIPANT_NOT_FOUND", 404);
    const fields = input.authorizedFields === undefined
      ? participant.authorizedFields
      : intersectFieldsOrApiError(challenge.publishedFields, input.authorizedFields);
    if (input.authorizedFields !== undefined) await requireEnabledPreference(tx, participant.userId, challenge.workspaceId);
    const changed = await tx.privateChallengeParticipant.updateMany({
      where: { id: participantId, revision: input.expectedRevision },
      data: {
        ...(input.nickname === undefined ? {} : { nickname: normalizeNickname(input.nickname) }),
        authorizedFields: fields,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ApiError("RANKING_PARTICIPANT_CONFLICT", 409);
    await tx.rankingProjection.deleteMany({ where: { participantId } });
    const residualProjection = await tx.rankingProjection.count({ where: { participantId } });
    if (residualProjection > 0) throw new ApiError("RANKING_PARTICIPANT_EXIT_INCOMPLETE", 409);
    const updated = await tx.privateChallengeParticipant.findUniqueOrThrow({ where: { id: participantId } });
    await writeRankingAudit(tx, actor.id, "RANKING_PARTICIPANT_UPDATED", "PrivateChallengeParticipant", participantId, { challengeId });
    return serializeParticipant(updated);
  }, { isolationLevel: "Serializable" });
}

export async function transitionPrivateChallengeParticipantForActor(
  actor: CurrentUser,
  challengeId: string,
  action: Extract<PrivateChallengeParticipantAction, "join" | "leave">,
): Promise<RankingParticipantDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const challenge = await requireChallengeMember(tx, actor.id, challengeId);
    if (challenge.status === "ENDED" || challenge.status === "CLOSED" || challenge.status === "DISSOLVED") {
      throw new ApiError("RANKING_CHALLENGE_NOT_JOINABLE", 409);
    }
    const participant = challenge.participants.find((candidate) => candidate.userId === actor.id);
    if (!participant) throw new ApiError("RANKING_PARTICIPANT_NOT_FOUND", 404);
    if (action === "join") {
      await requireEnabledPreference(tx, actor.id, challenge.workspaceId);
    } else if (challenge.ownerUserId === actor.id) {
      const ownedCount = await tx.privateChallenge.count({ where: { ownerUserId: actor.id, status: { not: "DISSOLVED" } } });
      try {
        assertParticipantCanLeave({ isOwner: true, activeChallengeCount: ownedCount });
      } catch (error) {
        throwRankingPolicy(error);
      }
    }
    let nextStatus: string;
    try {
      nextStatus = transitionPrivateChallengeParticipant(participant.status, action);
    } catch (error) {
      throwRankingPolicy(error);
      throw error;
    }
    const preference = action === "join"
      ? await tx.rankingPreference.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: challenge.workspaceId, userId: actor.id } } })
      : null;
    const fields = preference ? intersectFieldsOrApiError(challenge.publishedFields, intersectFieldsOrApiError(participant.authorizedFields, preference.authorizedFields)) : participant.authorizedFields;
    const now = new Date();
    const changed = await tx.privateChallengeParticipant.updateMany({
      where: { id: participant.id, revision: participant.revision },
      data: {
        status: nextStatus as "ACTIVE" | "LEFT",
        authorizedFields: fields,
        ...(action === "join" ? { joinedAt: participant.joinedAt ?? now, leftAt: null, removedAt: null } : { leftAt: now }),
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ApiError("RANKING_PARTICIPANT_CONFLICT", 409);
    if (action === "leave") {
      await tx.rankingProjection.deleteMany({ where: { participantId: participant.id } });
      const residualProjection = await tx.rankingProjection.count({ where: { participantId: participant.id } });
      if (residualProjection > 0) throw new ApiError("RANKING_PARTICIPANT_EXIT_INCOMPLETE", 409);
    }
    const updated = await tx.privateChallengeParticipant.findUniqueOrThrow({ where: { id: participant.id } });
    await writeRankingAudit(tx, actor.id, `RANKING_PARTICIPANT_${action.toUpperCase()}`, "PrivateChallengeParticipant", participant.id, { challengeId });
    return serializeParticipant(updated);
  }, { isolationLevel: "Serializable" });
}

export async function removePrivateChallengeParticipant(
  actor: CurrentUser,
  challengeId: string,
  participantId: string,
): Promise<RankingParticipantDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    const challenge = await ownedChallenge(tx, actor.id, challengeId);
    const participant = await tx.privateChallengeParticipant.findFirst({ where: { id: participantId, challengeId } });
    if (!participant || participant.userId === actor.id) throw new ApiError("RANKING_PARTICIPANT_NOT_FOUND", 404);
    let nextStatus: string;
    try {
      nextStatus = transitionPrivateChallengeParticipant(participant.status, "remove");
    } catch (error) {
      throwRankingPolicy(error);
      throw error;
    }
    const changed = await tx.privateChallengeParticipant.updateMany({
      where: { id: participantId, revision: participant.revision },
      data: { status: nextStatus as "REMOVED", removedAt: new Date(), revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("RANKING_PARTICIPANT_CONFLICT", 409);
    await tx.rankingProjection.deleteMany({ where: { participantId } });
    const updated = await tx.privateChallengeParticipant.findUniqueOrThrow({ where: { id: participantId } });
    await writeRankingAudit(tx, actor.id, "RANKING_PARTICIPANT_REMOVED", "PrivateChallengeParticipant", participantId, { challengeId, ownerUserId: challenge.ownerUserId });
    return serializeParticipant(updated);
  }, { isolationLevel: "Serializable" });
}

export async function transferPrivateChallengeOwnership(
  actor: CurrentUser,
  challengeId: string,
  targetParticipantId: string,
  expectedRevision: number,
): Promise<PrivateChallengeDto> {
  requireRankingFeature({ multiUser: true });
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    const challenge = await ownedChallenge(tx, actor.id, challengeId);
    if (challenge.revision !== expectedRevision) throw new ApiError("RANKING_CHALLENGE_CONFLICT", 409);
    const target = await tx.privateChallengeParticipant.findFirst({ where: { id: targetParticipantId, challengeId, status: "ACTIVE" } });
    if (!target || target.userId === actor.id) throw new ApiError("RANKING_TRANSFER_TARGET_INVALID", 409);
    await requireEnabledPreference(tx, target.userId, challenge.workspaceId);
    const changed = await tx.privateChallenge.updateMany({
      where: { id: challengeId, ownerUserId: actor.id, revision: expectedRevision },
      data: { ownerUserId: target.userId, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("RANKING_CHALLENGE_CONFLICT", 409);
    const updated = await tx.privateChallenge.findUniqueOrThrow({ where: { id: challengeId }, include: { participants: { orderBy: { createdAt: "asc" } } } });
    await writeRankingAudit(tx, actor.id, "RANKING_CHALLENGE_OWNERSHIP_TRANSFERRED", "PrivateChallenge", challengeId, {
      previousOwnerUserId: actor.id,
      nextOwnerUserId: target.userId,
      targetParticipantId,
      revision: updated.revision,
    });
    return serializeChallenge({ ...updated, participants: visibleParticipants(updated.participants, actor.id, updated.ownerUserId) });
  }, { isolationLevel: "Serializable" });
}

async function ownedChallenge(tx: Prisma.TransactionClient, actorId: string, challengeId: string) {
  const challenge = await tx.privateChallenge.findFirst({
    where: {
      id: challengeId,
      ownerUserId: actorId,
      status: { not: "DISSOLVED" },
      workspace: { status: "ACTIVE", memberships: { some: { userId: actorId, status: "ACTIVE", user: { status: "ACTIVE" } } } },
    },
    include: { participants: { orderBy: { createdAt: "asc" } } },
  });
  if (!challenge) throw new ApiError("RANKING_CHALLENGE_NOT_FOUND", 404);
  return challenge;
}

async function requireEnabledPreference(tx: Prisma.TransactionClient, userId: string, workspaceId: string) {
  const preference = await tx.rankingPreference.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!preference?.enabled) throw new ApiError("RANKING_OPT_IN_REQUIRED", 409);
  return preference;
}

async function assertAllParticipantsOptedIn(tx: Prisma.TransactionClient, challengeId: string, workspaceId: string): Promise<void> {
  const participants = await tx.privateChallengeParticipant.findMany({ where: { challengeId, status: "ACTIVE" }, select: { userId: true } });
  const optedIn = await tx.rankingPreference.findMany({ where: { workspaceId, userId: { in: participants.map((row) => row.userId) }, enabled: true }, select: { userId: true } });
  if (optedIn.length !== participants.length) throw new ApiError("RANKING_PARTICIPANT_OPT_IN_REQUIRED", 409);
}

function visibleParticipants<T extends { userId: string; status: string }>(
  rows: T[],
  actorId: string,
  ownerId: string | null,
): Array<Omit<T, "userId"> & { userId: string | null }> {
  return rows
    .filter((row) => ownerId === actorId || row.status === "ACTIVE" || row.status === "INVITED" || row.userId === actorId)
    .map((row) => ({ ...row, userId: ownerId === actorId || row.userId === actorId ? row.userId : null }));
}

function normalizeNickname(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, 80) : null;
}

function throwRankingPolicy(error: unknown): never {
  if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("RANKING_")) {
    throw new ApiError(error.code, 400);
  }
  throw error;
}
