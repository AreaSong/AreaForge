import { randomUUID } from "node:crypto";
import { DATA_EXPORT_ARCHIVE_PROTOCOL, DATA_EXPORT_ARCHIVE_VERSION, DATA_EXPORT_MAX_BYTES, DATA_EXPORT_MAX_ENTRIES, DATA_EXPORT_POLICY_VERSION, DataExportError } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";
import type { DataJobLease, DataQueueClient, QueuedDataJob } from "./data-job-queue-types";
import { assertQueueLease, lockQueuedDataJob, queueClock } from "./data-job-queue-store";
import { assertDataExportAuthorization, exportDatabaseError } from "./data-export-scope";
import { requireDataExportEnabled } from "./data-export-jobs";

export interface DataExportArchiveReceipt {
  sizeBytes: number;
  sha256: string;
  manifestSha256: string;
  recordCount: number;
  attachmentCount: number;
  omittedFieldCount: number;
  snapshotAt: string;
}

export async function beginDataExportArtifact(client: DataQueueClient, lease: DataJobLease, env: Readonly<Record<string, string | undefined>> = process.env) {
  requireDataExportEnabled(env);
  try {
    return await client.$transaction(async tx => {
      const job = await lockQueuedDataJob(tx, lease.jobId);
      const now = await queueClock(tx); assertQueueLease(job, lease, now);
      if (job.status !== "RUNNING" || job.pauseRequested) throw new DataExportError("DATA_EXPORT_CONTROL_REQUESTED", true);
      const { payload } = await assertDataExportAuthorization(tx, job, true);
      const artifact = await tx.dataExportArtifact.create({ data: { jobId: job.id, leaseVersion: lease.leaseVersion,
        objectKey: `export-${randomUUID()}`, expiresAt: job.expiresAt } });
      requireDataExportEnabled(env);
      return { job, payload, artifact };
    });
  } catch (error) { exportDatabaseError(error); }
}

export async function publishDataExportPackage(tx: Prisma.TransactionClient, job: QueuedDataJob, input: { artifactId: string; leaseVersion: number; receipt: DataExportArchiveReceipt }, env: Readonly<Record<string, string | undefined>> = process.env) {
  requireDataExportEnabled(env);
  const { payload } = await assertDataExportAuthorization(tx, job, true);
  await tx.$queryRaw`SELECT id FROM "DataExportArtifact" WHERE id = ${input.artifactId} FOR UPDATE NOWAIT`;
  const artifact = await tx.dataExportArtifact.findUnique({ where: { id: input.artifactId } });
  const now = await queueClock(tx);
  if (!artifact || artifact.state !== "STAGING" || artifact.jobId !== job.id || artifact.leaseVersion !== job.leaseVersion
    || artifact.leaseVersion !== input.leaseVersion || artifact.expiresAt.getTime() !== job.expiresAt.getTime() || job.expiresAt <= now) {
    throw new DataExportError("DATA_EXPORT_ARTIFACT_BINDING_INVALID");
  }
  const receipt = input.receipt;
  if (!Number.isSafeInteger(receipt.sizeBytes) || receipt.sizeBytes < 1 || receipt.sizeBytes > DATA_EXPORT_MAX_BYTES
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.sha256) || !/^sha256:[a-f0-9]{64}$/.test(receipt.manifestSha256)
    || [receipt.recordCount, receipt.attachmentCount, receipt.omittedFieldCount].some(value => !Number.isSafeInteger(value) || value < 0)
    || receipt.attachmentCount > receipt.recordCount || receipt.recordCount + receipt.attachmentCount + 1 > DATA_EXPORT_MAX_ENTRIES
    || !Number.isFinite(Date.parse(receipt.snapshotAt)) || new Date(receipt.snapshotAt).toISOString() !== receipt.snapshotAt
    || Date.parse(receipt.snapshotAt) < Date.parse(payload.requestedAt) || Date.parse(receipt.snapshotAt) > now.getTime()) throw new DataExportError("DATA_EXPORT_RECEIPT_INVALID");
  const summary = { policyVersion: DATA_EXPORT_POLICY_VERSION, snapshotAt: receipt.snapshotAt, scope: payload.scope,
    recordCount: receipt.recordCount, attachmentCount: receipt.attachmentCount, omittedFieldCount: receipt.omittedFieldCount };
  await tx.dataExportPackage.create({ data: { jobId: job.id, sourceArtifactId: artifact.id, protocol: DATA_EXPORT_ARCHIVE_PROTOCOL,
    schemaVersion: DATA_EXPORT_ARCHIVE_VERSION, manifest: summary, manifestSha256: receipt.manifestSha256,
    objectKey: artifact.objectKey, archiveSha256: receipt.sha256, sizeBytes: BigInt(receipt.sizeBytes), contentType: "application/zip",
    fileName: `areaforge-${payload.scope.toLowerCase()}-${job.id}.zip`, recordCount: receipt.recordCount,
    attachmentCount: receipt.attachmentCount, expiresAt: artifact.expiresAt } });
  await tx.dataExportArtifact.update({ where: { id: artifact.id }, data: { state: "PUBLISHED", publishedAt: now, snapshotAt: new Date(receipt.snapshotAt) } });
  await tx.auditEvent.create({ data: { actorId: job.requestedByUserId, action: "DATA_EXPORT_PUBLISHED", entityType: "DataJob", entityId: job.id,
    metadata: { recordCount: receipt.recordCount, attachmentCount: receipt.attachmentCount } } });
}

export async function requirePublishedDataExport(tx: Prisma.TransactionClient, jobId: string, requesterId: string, lock = true) {
  requireDataExportEnabled();
  const job = await tx.dataJob.findFirst({ where: { id: jobId, requestedByUserId: requesterId, queueVersion: 1, kind: "EXPORT" } });
  if (!job) throw new DataExportError("DATA_EXPORT_DOWNLOAD_NOT_FOUND");
  if (job.status !== "SUCCEEDED") throw new DataExportError("DATA_EXPORT_NOT_READY");
  const { payload } = await assertDataExportAuthorization(tx, job, lock);
  const pkg = await tx.dataExportPackage.findUnique({ where: { jobId }, include: { sourceArtifact: true } });
  const artifact = pkg?.sourceArtifact;
  const now = await queueClock(tx);
  const summary = pkg?.manifest as { policyVersion?: string; snapshotAt?: string } | null;
  if (!pkg || !artifact || artifact.state !== "PUBLISHED" || artifact.jobId !== job.id || artifact.leaseVersion !== job.leaseVersion
    || pkg.objectKey !== artifact.objectKey || pkg.protocol !== DATA_EXPORT_ARCHIVE_PROTOCOL || pkg.schemaVersion !== DATA_EXPORT_ARCHIVE_VERSION
    || pkg.expiresAt <= now || job.expiresAt <= now || artifact.expiresAt <= now || pkg.expiresAt.getTime() !== job.expiresAt.getTime()
    || pkg.sizeBytes < BigInt(1) || pkg.sizeBytes > BigInt(DATA_EXPORT_MAX_BYTES) || pkg.contentType !== "application/zip"
    || pkg.fileName !== `areaforge-${payload.scope.toLowerCase()}-${job.id}.zip` || pkg.recordCount < 0 || pkg.attachmentCount < 0
    || !/^sha256:[a-f0-9]{64}$/.test(pkg.archiveSha256) || !/^sha256:[a-f0-9]{64}$/.test(pkg.manifestSha256)
    || pkg.recordCount + pkg.attachmentCount + 1 > DATA_EXPORT_MAX_ENTRIES || pkg.attachmentCount > pkg.recordCount
    || summary?.policyVersion !== DATA_EXPORT_POLICY_VERSION || summary?.snapshotAt !== artifact.snapshotAt?.toISOString()
    || !artifact.snapshotAt || artifact.snapshotAt > now || artifact.snapshotAt.getTime() < Date.parse(payload.requestedAt)) {
    throw new DataExportError("DATA_EXPORT_NOT_READY");
  }
  if (lock) {
    await tx.$queryRaw`SELECT id FROM "DataExportArtifact" WHERE id = ${artifact.id} FOR SHARE NOWAIT`;
    const current = await tx.dataExportArtifact.findUniqueOrThrow({ where: { id: artifact.id } });
    if (current.state !== "PUBLISHED") throw new DataExportError("DATA_EXPORT_NOT_READY");
  }
  return { job, pkg, artifact, payload };
}
