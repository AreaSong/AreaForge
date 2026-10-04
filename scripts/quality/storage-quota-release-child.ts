import assert from "node:assert/strict";
import { prisma, type Prisma } from "../../packages/db/src/index";
import { isVerifiedStorageRelease } from "../../packages/core/src/index";
import { cleanupDiscardedAttachmentFiles, markUnboundAttachmentDiscarded } from "../../apps/web/lib/study/attachments-service";
import type { StorageProcessRequest } from "./storage-quota-process-control";

export interface ReleaseReceipt {
  result: boolean; unlinkAttempts: number; unlinks: number; cleanupProofs: number; cas: number; verified: number; committed: number;
}
export interface ReleaseObservation extends ReleaseReceipt {
  backendPid: number; transactionId: string; releaseAt: string; releaseProof: string; stagingName: null; usedBytes: string;
}

/** 只在已核验的测试子进程内装配；观察使用事务本身，不伪造 CAS 或绕过锁。 */
export async function runStorageReleaseProcess(request: StorageProcessRequest,
  barrier: (point: string, observation?: unknown, force?: boolean) => Promise<void>): Promise<ReleaseReceipt> {
  assert.ok(request.attachmentId);
  const cleanup = await markUnboundAttachmentDiscarded(request.ownerId, request.attachmentId); assert.ok(cleanup);
  const counts: ReleaseReceipt = { result: false, unlinkAttempts: 0, unlinks: 0, cleanupProofs: 0, cas: 0, verified: 0, committed: 0 };
  await barrier("prepared", undefined, true);
  const observe = async (tx: Prisma.TransactionClient, point: string) => {
    const row = await tx.attachment.findUniqueOrThrow({ where: { id: cleanup.attachmentId } });
    assert.equal(isVerifiedStorageRelease(row), true); assert.equal(row.stagingName, null);
    const [state] = await tx.$queryRaw<Array<{ backendPid: number; transactionId: string; usedBytes: string }>>`
      SELECT pg_backend_pid() AS "backendPid", txid_current()::text AS "transactionId",
        (SELECT COALESCE(SUM("sizeBytes"),0)::text FROM "Attachment"
         WHERE "storageWorkspaceId"=${row.storageWorkspaceId} AND "storageReleasedAt" IS NULL) AS "usedBytes"`;
    await barrier(point, { ...counts, ...state!, releaseAt: row.storageReleasedAt!.toISOString(),
      releaseProof: row.storageReleaseProof!, stagingName: row.stagingName } satisfies ReleaseObservation);
  };
  counts.result = await cleanupDiscardedAttachmentFiles(cleanup, {
    beforeUnlink: async () => { counts.unlinkAttempts++; }, afterUnlink: async () => { counts.unlinks++; },
    beforeReleaseCommit: async () => { counts.cleanupProofs++; },
    afterReleaseCas: async tx => { counts.cas++; await observe(tx, "cas-precommit"); },
    afterVerifiedRelease: async tx => { counts.verified++; await observe(tx, "verified-release"); },
    afterReleaseCommit: async () => { counts.committed++; },
  });
  return counts;
}
