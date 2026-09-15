import { RankingRebuildError, rankingRevision } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";

/** 调用方先持有挑战行锁；包括取消/失败任务，不能复活较早一代。 */
export async function latestRankingGeneration(tx: Prisma.TransactionClient, challengeId: string): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ generation: string | null }>>`
    SELECT MAX(("resultJson"->>'generation')::bigint)::text AS generation FROM "DataJob"
    WHERE kind='RANKING_REBUILD' AND "queueVersion"=1 AND "resultJson"->>'challengeId'=${challengeId}`;
  if (row?.generation == null) return 0;
  return rankingRevision(Number(row.generation));
}

export async function assertLatestRankingGeneration(tx: Prisma.TransactionClient, challengeId: string, generation: number) {
  if (await latestRankingGeneration(tx, challengeId) !== generation) throw new RankingRebuildError("RANKING_REBUILD_SUPERSEDED");
}
