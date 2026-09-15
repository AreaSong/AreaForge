import { RankingRebuildError, rankingRebuildQueueEnabled } from "@areaforge/core";
import { enqueueRankingRebuild, listRankingRebuildJobs, controlRankingRebuild, DataJobQueueError, isDataJobScopeBusy,
  prisma, type DataJobQueueControl } from "@areaforge/db";
import { z } from "zod";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import { requireRankingFeature } from "./feature-gate";

export const rankingRebuildRequestSchema = z.object({ expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/) }).strict();
export const rankingRebuildControlSchema = z.object({ expectedRevision: z.number().int().nonnegative(),
  action: z.enum(["PAUSE", "RESUME", "CANCEL", "REPLAY"]) }).strict();

export async function requestRankingRebuild(actor: CurrentUser, challengeId: string, input: z.infer<typeof rankingRebuildRequestSchema>) {
  requireRankingFeature({ multiUser: true, projection: true });
  try { return await enqueueRankingRebuild(prisma, { ...input, actorId: actor.id, sessionId: actor.sessionId, challengeId }); }
  catch (error) { return throwRankingRebuildApiError(error); }
}

export async function getRankingRebuildJobs(actor: CurrentUser, challengeId: string) {
  requireRankingFeature({ multiUser: true, projection: true });
  try { return { enabled: rankingRebuildQueueEnabled(process.env), jobs: await listRankingRebuildJobs(prisma, actor.id, challengeId) }; }
  catch (error) { return throwRankingRebuildApiError(error); }
}

export async function changeRankingRebuild(actor: CurrentUser, challengeId: string, jobId: string,
  input: { expectedRevision: number; action: DataJobQueueControl }) {
  requireRankingFeature({ multiUser: true, projection: true });
  try { return await controlRankingRebuild(prisma, { ...input, actorId: actor.id, sessionId: actor.sessionId, challengeId, jobId }); }
  catch (error) { return throwRankingRebuildApiError(error); }
}

export function throwRankingRebuildApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof RankingRebuildError) {
    const status = error.code === "RANKING_REBUILD_SESSION_REVOKED" ? 401
      : /NOT_FOUND|DISABLED/.test(error.code) ? 404 : /PAYLOAD_INVALID/.test(error.code) ? 400 : error.retryable ? 503 : 409;
    throw new ApiError(error.code, status);
  }
  if (error instanceof DataJobQueueError) throw new ApiError(error.code, error.code === "DATA_JOB_QUEUE_NOT_FOUND" ? 404 : error.code === "DATA_JOB_SCOPE_BUSY" ? 503 : 409);
  if (isDataJobScopeBusy(error)) throw new ApiError("RANKING_REBUILD_SCOPE_BUSY", 503);
  throw new ApiError("RANKING_REBUILD_UNAVAILABLE", 503);
}
