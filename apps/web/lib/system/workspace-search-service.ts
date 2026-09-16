import { WorkspaceSearchError, workspaceSearchIndexEnabled } from "@areaforge/core";
import { captureSearchScope, isDataJobScopeBusy, queryWorkspaceSearch, prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { WorkspaceSearchResponseDto } from "@/lib/contracts/search";
import { throwSearchIndexApiError } from "./workspace-search-index-service";

/** 源直查与持久索引共用事务权限/冻结边界，GET 不登记或启动任何后台任务。 */
export async function searchWorkspace(actorId: string, workspaceId: string, queryInput: string, limit = 30, sessionId?: string): Promise<WorkspaceSearchResponseDto> {
  const query = queryInput.trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError("WORKSPACE_SEARCH_QUERY_INVALID", 400);
  const enabled = workspaceSearchIndexEnabled(process.env);
  const read = (sourceOnly: boolean) => prisma.$transaction(async tx => {
      const scope = await captureSearchScope(tx, actorId, workspaceId, { env: process.env, sessionId, sourceOnly });
      return { contractVersion: "workspace-search-v2" as const, workspaceId, query,
        ...await queryWorkspaceSearch(tx, scope, query, limit, process.env),
        ...(sourceOnly && enabled ? { indexState: "STALE" as const } : {}) };
    }, { isolationLevel: "Serializable", timeout: 15000 });
  try {
    try { return await read(!enabled); }
    catch (error) {
      if (!enabled || !canUseSourceFallback(error)) throw error;
      // NOWAIT 失败已使原事务终止；新事务必须重新验证身份、grant 和删除屏障。
      return await read(true);
    }
  } catch (error) { return throwSearchIndexApiError(error); }
}

function canUseSourceFallback(error: unknown): boolean {
  return isDataJobScopeBusy(error) || (error instanceof WorkspaceSearchError
    && ["SEARCH_INDEX_SCOPE_BUSY", "SEARCH_INDEX_GRANT_LIMIT", "SEARCH_INDEX_VISIBILITY_LIMIT", "SEARCH_INDEX_DOCUMENT_LIMIT"].includes(error.code));
}
