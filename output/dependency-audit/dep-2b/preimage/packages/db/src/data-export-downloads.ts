import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DataExportError } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";
import type { DataQueueClient } from "./data-job-queue-types";
import { requirePublishedDataExport } from "./data-export-artifacts";
import { exportDatabaseError } from "./data-export-scope";
import { requireDataExportEnabled } from "./data-export-jobs";
import { queueClock } from "./data-job-queue-store";

const clearReservation = { reservationId: null, reservedAt: null, reservationExpiresAt: null };
export interface ExportDownloadActor { requesterId: string; sessionId: string }
export interface ReservedExportDownload {
  grantId: string; reservationId: string; jobId: string; packageId: string;
  key: string; fileName: string; sizeBytes: number; sha256: string;
}

export async function issueDataExportDownloadGrant(tx: Prisma.TransactionClient, jobId: string, requesterId: string) {
  requireDataExportEnabled();
  const { pkg } = await requirePublishedDataExport(tx, jobId, requesterId);
  const now = await queueClock(tx);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Math.min(pkg.expiresAt.getTime(), now.getTime() + 900_000));
  await tx.dataExportDownloadGrant.updateMany({ where: { packageId: pkg.id, requestedByUserId: requesterId, consumedAt: null, revokedAt: null }, data: { revokedAt: now, ...clearReservation } });
  const grant = await tx.dataExportDownloadGrant.create({ data: { packageId: pkg.id, requestedByUserId: requesterId, tokenHash: tokenHash(token), expiresAt } });
  await audit(tx, requesterId, "DATA_EXPORT_DOWNLOAD_GRANT_CREATED", jobId);
  requireDataExportEnabled();
  return { id: grant.id, jobId, token, expiresAt: expiresAt.toISOString() };
}

export async function reserveDataExportDownload(client: DataQueueClient, actor: ExportDownloadActor, token: string): Promise<ReservedExportDownload> {
  requireDataExportEnabled();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) unavailable();
  try {
    return await client.$transaction(async tx => {
      const grant = await tx.dataExportDownloadGrant.findFirst({ where: { tokenHash: tokenHash(token), requestedByUserId: actor.requesterId }, select: { id: true, exportPackage: { select: { jobId: true } } } });
      if (!grant) unavailable();
      const { pkg, payload } = await requirePublishedDataExport(tx, grant.exportPackage.jobId, actor.requesterId);
      await assertDownloadSession(tx, actor, payload.authorization.authRevision);
      await tx.$queryRaw`SELECT id FROM "DataExportDownloadGrant" WHERE id = ${grant.id} FOR UPDATE NOWAIT`;
      const current = await tx.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: grant.id } });
      const now = await queueClock(tx);
      if (current.packageId !== pkg.id || current.consumedAt || current.revokedAt || current.expiresAt <= now) unavailable();
      if (current.reservationId && current.reservationExpiresAt && current.reservationExpiresAt > now) throw new DataExportError("DATA_EXPORT_DOWNLOAD_BUSY", true);
      const reservationId = randomUUID();
      await tx.dataExportDownloadGrant.update({ where: { id: current.id }, data: { reservationId, reservedAt: now,
        reservationExpiresAt: new Date(Math.min(now.getTime() + 120_000, current.expiresAt.getTime())) } });
      requireDataExportEnabled();
      return { grantId: current.id, reservationId, jobId: pkg.jobId, packageId: pkg.id, key: pkg.objectKey,
        fileName: pkg.fileName, sizeBytes: Number(pkg.sizeBytes), sha256: pkg.archiveSha256 };
    });
  } catch (error) { exportDatabaseError(error); }
}

export async function consumeDataExportDownload(client: DataQueueClient, actor: ExportDownloadActor, reserved: ReservedExportDownload): Promise<void> {
  requireDataExportEnabled();
  try {
    await client.$transaction(async tx => {
      const { pkg, payload } = await requirePublishedDataExport(tx, reserved.jobId, actor.requesterId);
      await assertDownloadSession(tx, actor, payload.authorization.authRevision);
      if (pkg.id !== reserved.packageId || pkg.objectKey !== reserved.key || pkg.archiveSha256 !== reserved.sha256) unavailable();
      const now = await queueClock(tx);
      const changed = await tx.dataExportDownloadGrant.updateMany({ where: { id: reserved.grantId, packageId: pkg.id,
        requestedByUserId: actor.requesterId, reservationId: reserved.reservationId, reservationExpiresAt: { gt: now },
        consumedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now, ...clearReservation } });
      if (changed.count !== 1) unavailable();
      // 这里只表示获准开始传输，不冒充客户端已经收齐文件。
      await audit(tx, actor.requesterId, "DATA_EXPORT_DOWNLOAD_STARTED", pkg.jobId);
      requireDataExportEnabled();
    });
  } catch (error) { exportDatabaseError(error); }
}

export async function releaseDataExportDownload(client: DataQueueClient, actor: ExportDownloadActor, reserved: ReservedExportDownload): Promise<void> {
  await client.$transaction(tx => tx.dataExportDownloadGrant.updateMany({ where: { id: reserved.grantId, requestedByUserId: actor.requesterId,
    reservationId: reserved.reservationId, consumedAt: null }, data: clearReservation }));
}

export async function revokeDataExportDownloads(tx: Prisma.TransactionClient, jobId: string, requesterId: string): Promise<number> {
  const job = await tx.dataJob.findFirst({ where: { id: jobId, requestedByUserId: requesterId, queueVersion: 1, kind: "EXPORT" }, select: { id: true } });
  if (!job) unavailable();
  const now = await queueClock(tx);
  const revoked = await tx.dataExportDownloadGrant.updateMany({ where: { requestedByUserId: requesterId,
    exportPackage: { jobId }, consumedAt: null, revokedAt: null }, data: { revokedAt: now, ...clearReservation } });
  await audit(tx, requesterId, "DATA_EXPORT_DOWNLOAD_GRANTS_REVOKED", jobId);
  return revoked.count;
}

async function assertDownloadSession(tx: Prisma.TransactionClient, actor: ExportDownloadActor, authRevision: number) {
  await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${actor.sessionId} AND "userId" = ${actor.requesterId} FOR SHARE NOWAIT`;
  const session = await tx.authSession.findFirst({ where: { id: actor.sessionId, userId: actor.requesterId, authRevision,
    revokedAt: null, expiresAt: { gt: await queueClock(tx) } }, select: { id: true } });
  if (!session) unavailable();
}
function tokenHash(token: string): string { return createHash("sha256").update(`areaforge:data-export-download:v2:${token}`).digest("hex"); }
function unavailable(): never { throw new DataExportError("DATA_EXPORT_DOWNLOAD_NOT_FOUND"); }
async function audit(tx: Prisma.TransactionClient, actorId: string, action: string, jobId: string) {
  await tx.auditEvent.create({ data: { actorId, action, entityType: "DataJob", entityId: jobId } });
}
