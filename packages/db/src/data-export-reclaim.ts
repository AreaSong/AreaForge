import { DataExportError } from "@areaforge/core";
import type { DataQueueClient } from "./data-job-queue-types";
import { queueClock } from "./data-job-queue-store";
import { exportDatabaseError } from "./data-export-scope";

export async function listReclaimableDataExports(client: DataQueueClient, limit = 20): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DataExportError("DATA_EXPORT_LIMIT_EXCEEDED");
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT a.id FROM "DataExportArtifact" a JOIN "DataJob" j ON j.id = a."jobId"
    WHERE j."queueVersion" = 1 AND j.kind = 'EXPORT' AND a.state <> 'RECLAIMED'
      AND (a.state = 'RECLAIMING' OR a."expiresAt" <= clock_timestamp()
        OR (a.state = 'STAGING' AND (j."leaseVersion" <> a."leaseVersion" OR j.status NOT IN ('RUNNING', 'CANCEL_REQUESTED') OR j."leaseExpiresAt" <= clock_timestamp())))
    ORDER BY a."updatedAt", a.id LIMIT ${limit}
  `;
  return rows.map(row => row.id);
}

export async function beginDataExportReclaim(client: DataQueueClient, artifactId: string) {
  try {
    return await client.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "DataExportArtifact" WHERE id = ${artifactId} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return null;
      const artifact = await tx.dataExportArtifact.findUniqueOrThrow({ where: { id: artifactId }, include: { job: true } });
      const now = await queueClock(tx);
      if (artifact.job.queueVersion !== 1 || artifact.job.kind !== "EXPORT") throw new DataExportError("DATA_EXPORT_ARTIFACT_BINDING_INVALID");
      const activeWriter = artifact.state === "STAGING" && artifact.leaseVersion === artifact.job.leaseVersion
        && ["RUNNING", "CANCEL_REQUESTED"].includes(artifact.job.status) && artifact.job.leaseExpiresAt && artifact.job.leaseExpiresAt > now;
      if ((activeWriter || artifact.state === "PUBLISHED") && artifact.expiresAt > now) return null;
      if (artifact.state === "RECLAIMED") return { id: artifact.id, objectKey: artifact.objectKey, alreadyReclaimed: true };
      await tx.dataExportArtifact.update({ where: { id: artifact.id }, data: { state: "RECLAIMING", reclaimErrorCode: null, updatedAt: now } });
      await tx.dataExportDownloadGrant.updateMany({ where: { exportPackage: { sourceArtifactId: artifact.id }, consumedAt: null, revokedAt: null },
        data: { revokedAt: now, reservationId: null, reservedAt: null, reservationExpiresAt: null } });
      return { id: artifact.id, objectKey: artifact.objectKey, alreadyReclaimed: false };
    });
  } catch (error) { exportDatabaseError(error); }
}

export async function finishDataExportReclaim(client: DataQueueClient, artifactId: string, errorCode?: string) {
  if (errorCode && !/^DATA_EXPORT_[A-Z_]{1,70}$/.test(errorCode)) throw new DataExportError("DATA_EXPORT_RECLAIM_ERROR_INVALID");
  await client.$transaction(async tx => {
    if (errorCode) {
      // 失败也持久推进尝试时间，让坏文件在进程重启后仍不垄断有界批次。
      await tx.dataExportArtifact.updateMany({ where: { id: artifactId }, data: { reclaimErrorCode: errorCode, updatedAt: await queueClock(tx) } });
      return;
    }
    await tx.dataExportArtifact.updateMany({ where: { id: artifactId, state: "RECLAIMING" },
      data: { state: "RECLAIMED", reclaimedAt: await queueClock(tx), reclaimErrorCode: null } });
  });
}

export async function listReclaimedDataExports(client: DataQueueClient, afterId?: string) {
  return client.$transaction(tx => tx.dataExportArtifact.findMany({ where: { state: "RECLAIMED", ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "asc" }, take: 5, select: { id: true, objectKey: true } }));
}
