import { requestApiResult, type ApiResult } from "@/lib/api/client";
import type { WorkspaceSearchResponseDto } from "@/lib/contracts";

export interface WorkspaceSearchEnvelope {
  search?: WorkspaceSearchResponseDto;
  error?: string;
}

export function searchWorkspaceApi(
  workspaceId: string,
  query: string,
  limit = 20,
): Promise<ApiResult<WorkspaceSearchEnvelope>> {
  const params = new URLSearchParams({ workspaceId, q: query, limit: String(limit) });
  return requestApiResult(`/api/search?${params.toString()}`, { cache: "no-store" });
}

export function isWorkspaceSearchResponse(value: unknown): value is WorkspaceSearchResponseDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceSearchResponseDto>;
  return candidate.contractVersion === "workspace-search-v1"
    && typeof candidate.workspaceId === "string"
    && typeof candidate.query === "string"
    && candidate.indexed === false
    && typeof candidate.truncated === "boolean"
    && Array.isArray(candidate.results)
    && candidate.results.every(isWorkspaceSearchResult);
}

function isWorkspaceSearchResult(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const candidate = item as Record<string, unknown>;
  return typeof candidate.id === "string" && candidate.id.length > 0 && candidate.id.length <= 191
    && typeof candidate.label === "string" && candidate.label.length > 0 && candidate.label.length <= 240
    && typeof candidate.href === "string" && candidate.href.startsWith("/") && !candidate.href.startsWith("//")
    && !candidate.href.includes("\\") && !/[\r\n]/.test(candidate.href)
    && ["SUBJECT", "TASK", "KNOWLEDGE_POINT", "NOTE", "MISTAKE", "RESOURCE"].includes(String(candidate.kind))
    && ["WORKSPACE", "OWNER", "SHARED"].includes(String(candidate.visibility));
}
