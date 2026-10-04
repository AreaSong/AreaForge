import { WorkspaceSearchError } from "../../packages/core/src/index";
import { commitWorkspaceSearchIndex, prepareWorkspaceSearchIndex, type DataQueueClient } from "../../packages/db/src/index";
import { DataJobHandlerError, type DataJobHandler } from "./data-job-handler";

export function createWorkspaceSearchHandler(client: DataQueueClient, env: Readonly<Record<string, string | undefined>>): DataJobHandler {
  return { kind: "SEARCH_INDEX_REBUILD", prepare: async context => {
    try {
      context.signal.throwIfAborted();
      const fingerprint = await prepareWorkspaceSearchIndex(client, context.lease, env);
      context.signal.throwIfAborted(); await context.heartbeat(0.5);
      return async (tx, row) => {
        try { await commitWorkspaceSearchIndex(tx, row, fingerprint, env); }
        catch (error) { throw searchHandlerError(error); }
      };
    } catch (error) { throw searchHandlerError(error); }
  } };
}

function searchHandlerError(error: unknown): unknown {
  return error instanceof WorkspaceSearchError ? new DataJobHandlerError(error.code, error.retryable) : error;
}
