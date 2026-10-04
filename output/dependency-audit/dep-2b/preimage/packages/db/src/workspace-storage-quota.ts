import { isVerifiedStorageRelease, readWorkspaceStorageQuotaPolicy, workspaceStorageQuotaRejection, WorkspaceStorageQuotaError,
  type StorageQuotaEnvironment, type StorageReleaseRecord } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { isDataJobScopeBusy } from "./data-job-derived-guard";
import { DELETE_FENCE_LOCK } from "./data-delete-intents";

export type StorageQuotaTransaction = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
export type StorageQuotaFileClaim = Pick<StorageReleaseRecord, "id" | "storedName" | "uri" | "hash" | "sizeBytes" | "stagingName" | "storageReleasedAt" | "storageReleaseProof">;
export function storageQuotaTransactionOptions(env: StorageQuotaEnvironment = process.env) {
  return env.WORKSPACE_STORAGE_QUOTA_ENABLED === "true"
    ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 } : undefined;
}

export async function checkWorkspaceStorageQuotaAdmission(tx: StorageQuotaTransaction, input: { workspaceId: string; requestedBytes: number },
  options: { env?: StorageQuotaEnvironment; verifyInventory: (tx: StorageQuotaTransaction) => Promise<void> }): Promise<void> {
  const policy = readWorkspaceStorageQuotaPolicy(options.env ?? process.env);
  if (!policy) return;
  const [isolation] = await tx.$queryRaw<Array<{ value: string }>>`SELECT current_setting('transaction_isolation') AS value`;
  if (isolation?.value !== "serializable") throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_ISOLATION_UNSUPPORTED");
  await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
  await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
  const key = "areaforge:workspace-storage-quota:v1";
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key},0)) AS acquired`;
  if (lock?.acquired !== true) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_BUSY");
  const usage = await readStorageUsage(tx, input.workspaceId);
  await assertReleasedStorageRows(tx, input.workspaceId);
  const rejection = workspaceStorageQuotaRejection(policy, usage, input.requestedBytes);
  if (rejection) throw new WorkspaceStorageQuotaError(rejection);
  await options.verifyInventory(tx);
}

async function readStorageUsage(tx: StorageQuotaTransaction, workspaceId: string): Promise<bigint> {
  // 原始行不受冻结/可见性过滤；旧行只接受唯一且同 owner 的业务归属，不改写历史。
  const [row] = await tx.$queryRaw<Array<{ used: bigint; unknown: bigint }>>`
    WITH inventory AS (
      SELECT a.*,
        COALESCE(a."storageWorkspaceId", CASE
          WHEN a."noteId" IS NOT NULL AND r.id IS NULL AND n."ownerUserId"=a."ownerUserId" THEN s."workspaceId"
          WHEN a."noteId" IS NULL AND r.id IS NOT NULL AND r."ownerUserId"=a."ownerUserId" THEN r."workspaceId"
          ELSE NULL END) AS bucket,
        (a."storageWorkspaceId" IS NULL AND
          ((a."noteId" IS NOT NULL AND r.id IS NOT NULL)
          OR (a."noteId" IS NOT NULL AND (n.id IS NULL OR n."ownerUserId"<>a."ownerUserId"))
          OR (r.id IS NOT NULL AND r."ownerUserId"<>a."ownerUserId"))) AS inconsistent
      FROM "Attachment" a LEFT JOIN "Note" n ON n.id=a."noteId"
        LEFT JOIN "Subject" s ON s.id=n."subjectId" LEFT JOIN "StudyResource" r ON r."attachmentId"=a.id
    )
    SELECT COALESCE(SUM("sizeBytes") FILTER (WHERE bucket=${workspaceId} AND "storageReleasedAt" IS NULL),0)::bigint AS used,
      COUNT(*) FILTER (WHERE "storageReleasedAt" IS NULL AND
        (bucket IS NULL OR inconsistent OR "sizeBytes"<=0 OR "protocolVersion"<0 OR hash !~ '^[a-f0-9]{64}$'
          OR "storedName" !~ '^[A-Za-z0-9_-]{16,}[.](png|jpg|webp|pdf|zip|md)$'
          OR uri <> 'upload://attachment/' || "storedName")) AS unknown
    FROM inventory
  `;
  if (!row || row.unknown !== BigInt(0)) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN");
  return row.used;
}

async function assertReleasedStorageRows(tx: StorageQuotaTransaction, workspaceId: string): Promise<void> {
  let cursor = "";
  for (;;) {
    const rows = await tx.$queryRaw<StorageReleaseRecord[]>`SELECT id,"ownerUserId","storageWorkspaceId","storedName",uri,hash,
      "sizeBytes","protocolVersion",status,"stagingName","storageReleasedAt","storageReleaseProof"
      FROM "Attachment" WHERE "storageReleasedAt" IS NOT NULL AND ("storageWorkspaceId"=${workspaceId} OR "storageWorkspaceId" IS NULL)
        AND id>${cursor} ORDER BY id LIMIT 256`;
    if (!rows.length) return;
    for (const row of rows) if (!isVerifiedStorageRelease(row)) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN");
    cursor = rows.at(-1)!.id;
  }
}

export async function readStorageQuotaFileClaims(tx: StorageQuotaTransaction, storedNames: readonly string[]): Promise<StorageQuotaFileClaim[]> {
  if (!storedNames.length || storedNames.length > 256) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN");
  return tx.$queryRaw<StorageQuotaFileClaim[]>(Prisma.sql`SELECT id,"storedName",uri,hash,"sizeBytes","stagingName","storageReleasedAt","storageReleaseProof"
    FROM "Attachment" WHERE "storedName" IN (${Prisma.join([...storedNames])})
      OR "stagingName" IN (${Prisma.join(storedNames.map(name => name + ".staging"))})`);
}

export async function lockAttachmentFileOperation(tx: StorageQuotaTransaction, attachmentId: string): Promise<void> {
  await guardAttachmentStorageTransaction(tx);
  const key = "areaforge:attachment-files:v1:" + attachmentId;
  const [row] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key},0)) AS acquired`;
  if (row?.acquired !== true) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_BUSY");
  const [frozen] = await tx.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (
    SELECT 1 FROM "Attachment" a JOIN "DataDeletionFence" f ON
      (f.model='Attachment' AND f."keyJson"->>'id'=a.id)
      OR (f.model='Note' AND f."keyJson"->>'id'=a."noteId")
      OR (f.model='User' AND f."keyJson"->>'id'=a."ownerUserId")
    WHERE a.id=${attachmentId}) AS blocked`;
  if (!frozen || frozen.blocked) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_BUSY");
}

export async function guardAttachmentStorageTransaction(tx: StorageQuotaTransaction): Promise<void> {
  const [row] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock_shared(${DELETE_FENCE_LOCK}) AS acquired`;
  if (row?.acquired !== true) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_BUSY");
}

export function isWorkspaceStorageQuotaBusy(error: unknown): boolean {
  return isDataJobScopeBusy(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028");
}
