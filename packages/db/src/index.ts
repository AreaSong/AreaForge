import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { withDeletionVisibility } from "./data-delete-visibility";

type Queryable = {
  queryRaw: (...args: unknown[]) => Promise<unknown>;
  executeRaw: (...args: unknown[]) => Promise<unknown>;
};

type Adapter = object & {
  startTransaction?: (...args: unknown[]) => Promise<Queryable>;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  deletionControlPrisma?: PrismaClient;
};

let processPrisma = globalForPrisma.prisma;

export function createPrismaClient(connectionString = process.env.DATABASE_URL, pool: { max?: number; connectionTimeoutMillis?: number } = {}): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create PrismaClient.");
  }

  const adapter = createSerializedPrismaPg(connectionString, pool);
  return new PrismaClient({ adapter });
}

function createSerializedPrismaPg(connectionString: string, pool: { max?: number; connectionTimeoutMillis?: number }): PrismaPg {
  const factory = new PrismaPg({ connectionString, ...pool });

  return new Proxy(factory, {
    get(target, property, receiver) {
      if (property === "connect" || property === "connectToShadowDb") {
        const connect = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<Adapter>;
        return async (...args: unknown[]) => serializeAdapter(await connect.apply(target, args));
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function serializeAdapter<T extends Adapter>(adapter: T): T {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "startTransaction") {
        const startTransaction = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<Queryable>;
        return async (...args: unknown[]) => serializeQueryable(await startTransaction.apply(target, args));
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function serializeQueryable<T extends Queryable>(queryable: T): T {
  let tail: Promise<void> = Promise.resolve();

  function enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return new Proxy(queryable, {
    get(target, property, receiver) {
      if (property === "queryRaw" || property === "executeRaw") {
        const query = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<unknown>;
        return (...args: unknown[]) => enqueue(() => query.apply(target, args));
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma ?? processPrisma) return (globalForPrisma.prisma ?? processPrisma)!;
  const raw = createPrismaClient();
  globalForPrisma.deletionControlPrisma = raw;
  const client = withDeletionVisibility(raw);

  processPrisma = client;
  globalForPrisma.prisma = client;

  return client;
}

/** 仅供带本人权限检查的数据生命周期控制面使用，不用于普通学习查询。 */
export function getDeletionControlClient(): PrismaClient {
  getPrismaClient();
  if (!globalForPrisma.deletionControlPrisma) throw new Error("DATA_DELETE_CONTROL_CLIENT_UNAVAILABLE");
  return globalForPrisma.deletionControlPrisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type { PrismaClient };
export * from "./controlled-operation-protocol";
export * from "./controlled-operation-store";
export { Prisma } from "../generated/prisma/client";
export * from "./data-job-queue-types";
export { isDataJobScopeBusy, isDerivedQueueKind } from "./data-job-derived-guard";
export { enqueueWorkspaceSearchIndex, getWorkspaceSearchIndexStatus, controlWorkspaceSearchIndex,
  prepareWorkspaceSearchIndex, commitWorkspaceSearchIndex } from "./workspace-search-jobs";
export { captureSearchScope, searchDatabaseError } from "./workspace-search-scope";
export { queryWorkspaceSearch } from "./workspace-search-index";
export { enqueueDataJob, enqueueDataJobInTransaction, claimQueuedDataJob } from "./data-job-queue";
export { heartbeatQueuedDataJob, commitQueuedDataJob, failQueuedDataJob } from "./data-job-queue-lease";
export { controlQueuedDataJob, controlQueuedDataJobInTransaction, type DataJobQueueControl } from "./data-job-queue-control";
export { recoverQueuedDataJobs, getDataJobQueueSnapshot } from "./data-job-queue-recovery";
export { enqueueRankingNotificationJob, deliverRankingNotificationJob, writeRankingNotificationDirect } from "./ranking-notification-queue";
export { collectDataExportRecords, streamDataExportRecords, type DataExportInventoryInput } from "./data-export-inventory";
export { dataExportEnabled, requireDataExportEnabled, enqueueDataExportJob } from "./data-export-jobs";
export { readDataExportAuthorization, assertDataExportAuthorization, exportDatabaseError } from "./data-export-scope";
export { beginDataExportArtifact, publishDataExportPackage, requirePublishedDataExport, type DataExportArchiveReceipt } from "./data-export-artifacts";
export { issueDataExportDownloadGrant, reserveDataExportDownload, consumeDataExportDownload, releaseDataExportDownload, revokeDataExportDownloads, type ExportDownloadActor, type ReservedExportDownload } from "./data-export-downloads";
export { listReclaimableDataExports, beginDataExportReclaim, finishDataExportReclaim, listReclaimedDataExports } from "./data-export-reclaim";
export { dataExportAttachmentSource } from "./data-export-file-sources";
export { previewDatabaseDeletion, createDatabaseDeletion, controlDatabaseDeletion, listDatabaseDeletions, readDeletionReceipt, type DeleteActor } from "./data-delete-intents";
export { listDeletionCandidates } from "./data-delete-candidates";
export { queryDeletionVisibleRows } from "./data-delete-visibility";
export { enqueueRankingRebuild, listRankingRebuildJobs, controlRankingRebuild, prepareRankingRebuild, commitRankingRebuild,
  getSafeRankingProjection, rankingRebuildJobView, validatedRankingJob } from "./ranking-rebuild-jobs";
