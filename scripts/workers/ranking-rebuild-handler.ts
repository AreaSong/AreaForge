import { RankingRebuildError } from "../../packages/core/src/index";
import { prepareRankingRebuild, commitRankingRebuild, type DataQueueClient } from "../../packages/db/src/index";
import { DataJobHandlerError, type DataJobHandler } from "./data-job-handler";

/** 准备结果只是候选；事务提交始终重新读取持久 payload、权限与来源。 */
export function createRankingRebuildHandler(client: DataQueueClient,
  env: Readonly<Record<string, string | undefined>> = process.env): DataJobHandler {
  return { kind: "RANKING_REBUILD", prepare: async context => {
    try {
      context.signal.throwIfAborted();
      const snapshot = await prepareRankingRebuild(client, context.lease, env);
      context.signal.throwIfAborted();
      await context.heartbeat(0.5);
      return async (tx, row) => {
        try { await commitRankingRebuild(tx, row, snapshot, env); }
        catch (error) { throw handlerError(error); }
      };
    } catch (error) { throw handlerError(error); }
  } };
}

function handlerError(error: unknown): unknown {
  return error instanceof RankingRebuildError ? new DataJobHandlerError(error.code, error.retryable) : error;
}
