import { createHash } from "node:crypto";
import { stableStringify, type PrivateChallengeStatus } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { RankingDeletionPreviewDto } from "./contracts";

export interface RankingDeletionPreviewInput {
  userId: string;
  workspaceId?: string;
}

/**
 * Read-only lifecycle hook for DATA-DELETE. It intentionally remains callable
 * while the ranking feature flag is off, so disabling the projection cannot
 * hide blockers from an account-deletion preview.
 */
export async function previewRankingDeletion(
  input: RankingDeletionPreviewInput,
  client: Pick<Prisma.TransactionClient, "privateChallenge" | "privateChallengeParticipant" | "rankingPreference" | "rankingProjection">
    & Partial<Pick<Prisma.TransactionClient, "examWorkspace">> = prisma,
): Promise<RankingDeletionPreviewDto> {
  if (input.workspaceId && client.examWorkspace) {
    const workspace = await client.examWorkspace.findFirst({
      where: {
        id: input.workspaceId,
        status: "ACTIVE",
        memberships: { some: { userId: input.userId, status: "ACTIVE", user: { status: "ACTIVE" } } },
      },
      select: { id: true },
    });
    if (!workspace) throw new ApiError("RANKING_WORKSPACE_NOT_FOUND", 404);
  }
  const scopeFilter = input.workspaceId ? { workspaceId: input.workspaceId } : {};
  const [owned, participations, preferenceCount, projectionCount] = await Promise.all([
    client.privateChallenge.findMany({
      where: { ownerUserId: input.userId, ...scopeFilter },
      select: { id: true, status: true, revision: true },
      orderBy: { id: "asc" },
    }),
    client.privateChallengeParticipant.findMany({
      where: { userId: input.userId, ...(input.workspaceId ? { challenge: { workspaceId: input.workspaceId } } : {}) },
      select: { id: true, challengeId: true, status: true, revision: true },
      orderBy: { id: "asc" },
    }),
    client.rankingPreference.count({ where: { userId: input.userId, ...scopeFilter } }),
    client.rankingProjection.count({
      where: { participant: { userId: input.userId, ...(input.workspaceId ? { challenge: { workspaceId: input.workspaceId } } : {}) } },
    }),
  ]);
  const blockers = owned
    .filter((challenge) => challenge.status !== "DISSOLVED")
    .map((challenge) => ({ challengeId: challenge.id, status: challenge.status as PrivateChallengeStatus }));
  const cleanupRequired = projectionCount > 0;
  const blocked = blockers.length > 0 || cleanupRequired;
  const reason = blockers.length > 0
    ? "owned_challenges_require_transfer_or_dissolve"
    : cleanupRequired ? "ranking_projection_cleanup_required" : "ready";
  const preimageFingerprint = createHash("sha256").update(stableStringify({
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    owned,
    participations,
    preferenceCount,
    projectionCount,
    cleanupRequired,
  })).digest("hex");
  return {
    contractVersion: "ranking-delete-preview-v1",
    scope: input.workspaceId ? "WORKSPACE" : "ACCOUNT",
    workspaceId: input.workspaceId ?? null,
    blocked,
    canProceed: !blocked,
    reason,
    blockers,
    ownedDissolvedChallengeCount: owned.length - blockers.length,
    participationCount: participations.length,
    projectionCount,
    preferenceCount,
    cleanupRequired,
    consistency: cleanupRequired ? "CLEANUP_REQUIRED" : "CLEAN",
    preimageFingerprint,
    action: "preview_only",
  };
}

export const previewRankingDeletionForAccount = previewRankingDeletion;
