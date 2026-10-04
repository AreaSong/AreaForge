import type { WorkspaceSearchJobView } from "@areaforge/core";
import { createJsonRequest, requestApiResult, type ApiResult } from "./client";
import { searchIndexJobSchema, searchIndexStatusSchema, type SearchIndexStatus } from "./search-index-schema";

export interface SearchIndexRequestIdentity { expectedGeneration: number; idempotencyKey: string }
interface JobEnvelope { job?: WorkspaceSearchJobView; error?: string }
export async function getSearchIndex(workspaceId: string): Promise<ApiResult<{ searchIndex?: SearchIndexStatus; error?: string }>> {
  const result = await requestApiResult<{ searchIndex?: SearchIndexStatus; error?: string }>(`/api/search/index?${new URLSearchParams({ workspaceId })}`, { cache: "no-store" });
  if (!result.ok) return result;
  const parsed = searchIndexStatusSchema.safeParse(result.body?.searchIndex);
  return { ...result, ok: parsed.success && parsed.data.workspaceId === workspaceId, body: parsed.success ? { searchIndex: parsed.data } : null };
}
export async function requestSearchIndex(workspaceId: string, identity: SearchIndexRequestIdentity): Promise<ApiResult<JobEnvelope>> {
  return receipt(await requestApiResult("/api/search/index", createJsonRequest("POST", { workspaceId, ...identity })), { generation: identity.expectedGeneration + 1 });
}
export async function controlSearchIndex(workspaceId: string, job: WorkspaceSearchJobView, action: WorkspaceSearchJobView["controls"][number]): Promise<ApiResult<JobEnvelope>> {
  return receipt(await requestApiResult(`/api/search/index/jobs/${encodeURIComponent(job.id)}`,
    createJsonRequest("PATCH", { workspaceId, expectedRevision: job.revision, action })), { id: job.id, generation: job.generation });
}
export function searchIndexUncertain(result: ApiResult<JobEnvelope>): boolean {
  return result.status === 0 || result.status >= 500 || (result.ok && !searchIndexJobSchema.safeParse(result.body?.job).success);
}
export function searchIndexAccessLost(result: ApiResult<{ error?: string }>): boolean {
  return result.body?.error !== "SEARCH_INDEX_DISABLED" && ([401, 403, 404].includes(result.status) || /UNAUTHORIZED|NOT_FOUND|SESSION_REVOKED/.test(result.body?.error ?? ""));
}
function receipt(result: ApiResult<JobEnvelope>, expected: { id?: string; generation: number }): ApiResult<JobEnvelope> {
  if (!result.ok) return result;
  const parsed = searchIndexJobSchema.safeParse(result.body?.job);
  const matches = parsed.success && parsed.data.generation === expected.generation && (!expected.id || parsed.data.id === expected.id);
  return { ...result, body: matches ? { job: parsed.data } : null };
}
