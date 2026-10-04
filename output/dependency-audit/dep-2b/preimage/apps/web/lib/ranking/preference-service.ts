import {
  DEFAULT_RANKING_SHARE_FIELDS,
  type RankingShareField,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import { requireRankingFeature } from "./feature-gate";
import { type RankingPreferenceDto } from "./contracts";
import {
  normalizeFieldsOrApiError,
  requireActiveRankingMember,
  writeRankingAudit,
} from "./service-support";

export interface UpdateRankingPreferenceInput {
  enabled: boolean;
  timezone: string;
  authorizedFields: readonly string[];
  expectedRevision?: number;
}

export async function getRankingPreference(actorId: string, workspaceId: string): Promise<RankingPreferenceDto> {
  requireRankingFeature();
  await requireActiveRankingMember(prisma, actorId, workspaceId);
  const row = await prisma.rankingPreference.findUnique({ where: { workspaceId_userId: { workspaceId, userId: actorId } } });
  return row ? serializePreference(row) : defaultPreference(workspaceId, actorId);
}

export async function updateRankingPreference(
  actor: CurrentUser,
  workspaceId: string,
  input: UpdateRankingPreferenceInput,
): Promise<RankingPreferenceDto> {
  requireRankingFeature();
  const fields = normalizeFieldsOrApiError(input.authorizedFields);
  validateTimezone(input.timezone);

  return prisma.$transaction(async (tx) => {
    await requireActiveRankingMember(tx, actor.id, workspaceId);
    const existing = await tx.rankingPreference.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actor.id } },
    });
    if (existing && input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) {
      throw new ApiError("RANKING_PREFERENCE_CONFLICT", 409);
    }

    if (!input.enabled) {
      await ensureCanOptOut(tx, actor.id, workspaceId);
      const now = new Date();
      await tx.privateChallengeParticipant.updateMany({
        where: { userId: actor.id, status: { in: ["ACTIVE", "INVITED"] }, challenge: { workspaceId, status: { not: "DISSOLVED" } } },
        data: { status: "LEFT", leftAt: now, revision: { increment: 1 } },
      });
      await tx.rankingProjection.deleteMany({ where: { participant: { userId: actor.id, challenge: { workspaceId } } } });
      const residualParticipation = await tx.privateChallengeParticipant.count({
        where: { userId: actor.id, status: { in: ["ACTIVE", "INVITED"] }, challenge: { workspaceId, status: { not: "DISSOLVED" } } },
      });
      const residualProjection = await tx.rankingProjection.count({
        where: { participant: { userId: actor.id, challenge: { workspaceId } } },
      });
      if (residualParticipation > 0 || residualProjection > 0) {
        throw new ApiError("RANKING_OPT_OUT_INCOMPLETE", 409);
      }
    }

    const row = existing
      ? await tx.rankingPreference.updateMany({
          where: { id: existing.id, revision: existing.revision },
          data: {
            enabled: input.enabled,
            timezone: input.timezone.trim(),
            authorizedFields: fields,
            revision: { increment: 1 },
            optedInAt: input.enabled ? (existing.optedInAt ?? new Date()) : existing.optedInAt,
            optedOutAt: input.enabled ? null : new Date(),
          },
        }).then(async (changed) => {
          if (changed.count !== 1) throw new ApiError("RANKING_PREFERENCE_CONFLICT", 409);
          return tx.rankingPreference.findUniqueOrThrow({ where: { id: existing.id } });
        })
      : await tx.rankingPreference.create({
          data: {
            workspaceId,
            userId: actor.id,
            enabled: input.enabled,
            timezone: input.timezone.trim(),
            authorizedFields: fields,
            optedInAt: input.enabled ? new Date() : null,
            optedOutAt: input.enabled ? null : new Date(),
          },
        });
    await writeRankingAudit(tx, actor.id, input.enabled ? "RANKING_OPT_IN" : "RANKING_OPT_OUT", "RankingPreference", row.id, {
      workspaceId,
      enabled: input.enabled,
      authorizedFieldCount: fields.length,
      revision: row.revision,
    });
    return serializePreference(row);
  }, { isolationLevel: "Serializable" });
}

async function ensureCanOptOut(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
): Promise<void> {
  const owned = await tx.privateChallenge.findMany({
    where: { workspaceId, ownerUserId: actorId, status: { not: "DISSOLVED" } },
    select: { id: true },
    take: 1,
  });
  if (owned.length > 0) throw new ApiError("RANKING_OPT_OUT_OWNER_BLOCKED", 409);
}

function serializePreference(row: {
  id: string;
  workspaceId: string;
  userId: string;
  enabled: boolean;
  timezone: string;
  authorizedFields: string[];
  revision: number;
  optedInAt: Date | null;
  optedOutAt: Date | null;
  updatedAt: Date;
}): RankingPreferenceDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    enabled: row.enabled,
    timezone: row.timezone,
    authorizedFields: normalizeFieldsOrApiError(row.authorizedFields),
    revision: row.revision,
    optedInAt: row.optedInAt?.toISOString() ?? null,
    optedOutAt: row.optedOutAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function defaultPreference(workspaceId: string, userId: string): RankingPreferenceDto {
  return {
    id: null,
    workspaceId,
    userId,
    enabled: false,
    timezone: "UTC",
    authorizedFields: [...DEFAULT_RANKING_SHARE_FIELDS] as RankingShareField[],
    revision: 0,
    optedInAt: null,
    optedOutAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function validateTimezone(value: string): void {
  const timezone = value.trim();
  if (!timezone) throw new ApiError("RANKING_TIMEZONE_INVALID", 400);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ApiError("RANKING_TIMEZONE_INVALID", 400);
  }
}
