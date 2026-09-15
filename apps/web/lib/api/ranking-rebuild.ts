import type { RankingRebuildJobView } from "@areaforge/core";
import { createJsonRequest, requestApiResult, type ApiResult } from "./client";
import { rankingRebuildJobViewSchema } from "./ranking-rebuild-schema";

export interface RankingRebuildIdentity { expectedRevision: number; idempotencyKey: string }
interface JobResponse { job?: RankingRebuildJobView; error?: string }
interface JobsResponse { jobs?: RankingRebuildJobView[]; enabled?: boolean; error?: string }

export async function requestRankingRebuild(challengeId: string, input: RankingRebuildIdentity): Promise<ApiResult<JobResponse>> {
  return validateReceipt(await requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/projection`, createJsonRequest("POST", input)));
}
export async function listRankingRebuildJobs(challengeId: string): Promise<ApiResult<JobsResponse>> {
  const result = await requestApiResult<JobsResponse>(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/rebuilds`);
  if (!result.ok) return result;
  const jobs = rankingRebuildJobViewSchema.array().safeParse(result.body?.jobs);
  if (!jobs.success || typeof result.body?.enabled !== "boolean") return { ...result, ok: false, body: null };
  return { ...result, body: { jobs: jobs.data, enabled: result.body.enabled } };
}
export async function controlRankingRebuild(challengeId: string, job: RankingRebuildJobView, action: RankingRebuildJobView["controls"][number]): Promise<ApiResult<JobResponse>> {
  return validateReceipt(await requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/rebuilds/${encodeURIComponent(job.id)}`,
    createJsonRequest("PATCH", { expectedRevision: job.revision, action })));
}
export function rankingRebuildResponseUncertain(result: ApiResult<JobResponse>): boolean {
  return result.status === 0 || result.status >= 500 || (result.ok && !rankingRebuildJobViewSchema.safeParse(result.body?.job).success);
}
export function rankingRebuildAccessLost(result: ApiResult<{ error?: string }>): boolean {
  if (result.body?.error === "RANKING_REBUILD_DISABLED") return false;
  return [401, 403, 404].includes(result.status) || /UNAUTHORIZED|FORBIDDEN|NOT_FOUND|SESSION_REVOKED/.test(result.body?.error ?? "");
}
function validateReceipt(result: ApiResult<JobResponse>): ApiResult<JobResponse> {
  if (!result.ok) return result;
  const job = rankingRebuildJobViewSchema.safeParse(result.body?.job);
  return { ...result, body: job.success ? { job: job.data } : null };
}
