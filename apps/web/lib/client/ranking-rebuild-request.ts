import type { RankingRebuildIdentity } from "@/lib/api/ranking-rebuild";

export function createRankingRebuildIdentity(expectedRevision: number): RankingRebuildIdentity {
  return { expectedRevision, idempotencyKey: crypto.randomUUID() };
}
