import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename } from "node:fs/promises";
import { parseAttachmentUri } from "@areaforge/storage";
import { prisma } from "@areaforge/db";
import { getAuthEnv } from "@/lib/auth/env";
import {
  attachmentProtocolVersion,
  fsyncDirectory,
  getSafeAttachmentPath,
  getSafeStagingPath,
  isSymlinkRejection,
} from "./attachments-service";

/**
 * OPS-007 新协议有界 reconciliation：只处理 protocolVersion>=1 的 PENDING 记录，
 * claim/lease CAS 防止并发或旧 worker 提交，决策表见 ops-007 设计文档。
 * 只能由显式维护命令触发；不删除任何文件，不修改历史 READY/legacy 行。
 */

export interface AttachmentReconciliationOptions {
  /** 单次运行处理的最大记录数（按 createdAt,id 稳定排序）。 */
  limit?: number;
  /** intent 最小年龄；更年轻的 PENDING 视为可能仍在进行的上传，不 claim。 */
  minIntentAgeMs?: number;
  /** claim lease 时长；过期 lease 可被新的维护运行 CAS reclaim。 */
  leaseMs?: number;
  now?: Date;
  hooks?: AttachmentReconciliationHooks;
}

/** 测试注入点：仅隔离 selftest 使用。 */
export interface AttachmentReconciliationHooks {
  afterClaim?: (attachmentId: string, claimId: string) => Promise<void>;
  beforeFinalizeCas?: (attachmentId: string) => Promise<void>;
}

export interface AttachmentReconciliationSummaryCounts {
  scannedCount: number;
  claimedCount: number;
  finalizedFromStagingCount: number;
  readyFromFinalCount: number;
  failedMissingFileCount: number;
  failedIntegrityMismatchCount: number;
  blockedDualFileCount: number;
  lostClaimCount: number;
  skippedYoungIntentCount: number;
  skippedActiveLeaseCount: number;
  retryLaterCount: number;
  reportOnlyFailedCount: number;
}

export interface AttachmentReconciliationRunSummary {
  schemaVersion: 1;
  mode: "bounded_attachment_reconciliation_run";
  generatedAt: string;
  action: "explicit_maintenance_command";
  counts: AttachmentReconciliationSummaryCounts;
  doesNotProve: string[];
  safetyFacts: {
    newProtocolPendingOnly: true;
    historicalRowMutated: false;
    readyRowMutated: false;
    fileDeleted: false;
    fileContentIncluded: false;
    absolutePathIncluded: false;
    objectIdentifiersIncluded: false;
  };
}

const defaultLimit = 100;
const defaultMinIntentAgeMs = 15 * 60_000;
const defaultLeaseMs = 10 * 60_000;

export async function reconcileNewProtocolAttachments(
  options: AttachmentReconciliationOptions = {},
): Promise<AttachmentReconciliationRunSummary> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? defaultLimit, 1000));
  const minIntentAgeMs = options.minIntentAgeMs ?? defaultMinIntentAgeMs;
  const leaseMs = options.leaseMs ?? defaultLeaseMs;
  const uploadDir = getAuthEnv().UPLOAD_DIR;

  const counts: AttachmentReconciliationSummaryCounts = {
    scannedCount: 0,
    claimedCount: 0,
    finalizedFromStagingCount: 0,
    readyFromFinalCount: 0,
    failedMissingFileCount: 0,
    failedIntegrityMismatchCount: 0,
    blockedDualFileCount: 0,
    lostClaimCount: 0,
    skippedYoungIntentCount: 0,
    skippedActiveLeaseCount: 0,
    retryLaterCount: 0,
    reportOnlyFailedCount: 0,
  };

  counts.reportOnlyFailedCount = await prisma.attachment.count({
    where: { status: "FAILED", protocolVersion: { gte: attachmentProtocolVersion } },
  });

  const candidates = await prisma.attachment.findMany({
    where: { status: "PENDING", protocolVersion: { gte: attachmentProtocolVersion } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      uri: true,
      hash: true,
      sizeBytes: true,
      stagingName: true,
      createdAt: true,
      updatedAt: true,
      reconciliationLeaseExpiresAt: true,
    },
  });

  for (const candidate of candidates) {
    counts.scannedCount += 1;

    if (now.getTime() - candidate.updatedAt.getTime() < minIntentAgeMs) {
      counts.skippedYoungIntentCount += 1;
      continue;
    }
    if (candidate.reconciliationLeaseExpiresAt && candidate.reconciliationLeaseExpiresAt.getTime() > now.getTime()) {
      counts.skippedActiveLeaseCount += 1;
      continue;
    }

    const claimId = randomUUID().replaceAll("-", "");
    const claimed = await prisma.attachment.updateMany({
      where: {
        id: candidate.id,
        status: "PENDING",
        protocolVersion: { gte: attachmentProtocolVersion },
        updatedAt: candidate.updatedAt,
        OR: [
          { reconciliationLeaseExpiresAt: null },
          { reconciliationLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        reconciliationClaimId: claimId,
        reconciliationClaimedAt: now,
        reconciliationLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        reconciliationAttempt: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      counts.lostClaimCount += 1;
      continue;
    }
    counts.claimedCount += 1;
    await options.hooks?.afterClaim?.(candidate.id, claimId);

    await reconcileClaimedIntent({
      attachment: candidate,
      claimId,
      uploadDir,
      minIntentAgeMs,
      now,
      counts,
      hooks: options.hooks,
    });
  }

  return {
    schemaVersion: 1,
    mode: "bounded_attachment_reconciliation_run",
    generatedAt: now.toISOString(),
    action: "explicit_maintenance_command",
    counts,
    doesNotProve: [
      "historical orphan cleanup",
      "legacy READY attachment integrity",
      "backup or restore success",
      "production attachment safety",
    ],
    safetyFacts: {
      newProtocolPendingOnly: true,
      historicalRowMutated: false,
      readyRowMutated: false,
      fileDeleted: false,
      fileContentIncluded: false,
      absolutePathIncluded: false,
      objectIdentifiersIncluded: false,
    },
  };
}

interface ClaimedIntentContext {
  attachment: {
    id: string;
    uri: string;
    hash: string;
    sizeBytes: number;
    stagingName: string | null;
    createdAt: Date;
  };
  claimId: string;
  uploadDir: string;
  minIntentAgeMs: number;
  now: Date;
  counts: AttachmentReconciliationSummaryCounts;
  hooks?: AttachmentReconciliationHooks;
}

async function reconcileClaimedIntent(context: ClaimedIntentContext): Promise<void> {
  const { attachment, claimId, uploadDir, counts } = context;

  const storedName = parseAttachmentUri(attachment.uri);
  if (!storedName) {
    await markFailedWithClaim(attachment.id, claimId, "INTEGRITY_MISMATCH", "reconciliation_invalid_uri");
    counts.failedIntegrityMismatchCount += 1;
    return;
  }

  const finalPath = getSafeAttachmentPath(uploadDir, storedName);
  const stagingPath = attachment.stagingName ? getSafeStagingPath(uploadDir, attachment.stagingName) : null;
  const finalProbe = await probeFile(finalPath.filePath, attachment.hash, attachment.sizeBytes);
  const stagingProbe = stagingPath
    ? await probeFile(stagingPath.filePath, attachment.hash, attachment.sizeBytes)
    : { present: false as const, matches: false as const };

  if (finalProbe.present && stagingProbe.present) {
    // 决策表：PENDING + staging + final 同时存在 -> blocked/AMBIGUOUS_DUAL_FILE，人工复核，不删除。
    await releaseClaim(attachment.id, claimId);
    counts.blockedDualFileCount += 1;
    return;
  }

  if (!finalProbe.present && !stagingProbe.present) {
    if (context.now.getTime() - attachment.createdAt.getTime() < context.minIntentAgeMs) {
      await releaseClaim(attachment.id, claimId);
      counts.skippedYoungIntentCount += 1;
      return;
    }
    await markFailedWithClaim(attachment.id, claimId, "MISSING_FILE_AFTER_INTENT", "reconciliation_missing_file");
    counts.failedMissingFileCount += 1;
    return;
  }

  if (stagingProbe.present && !finalProbe.present) {
    if (!stagingProbe.matches || !stagingPath) {
      await markFailedWithClaim(attachment.id, claimId, "INTEGRITY_MISMATCH", "reconciliation_staging_verify");
      counts.failedIntegrityMismatchCount += 1;
      return;
    }
    try {
      await rename(stagingPath.filePath, finalPath.filePath);
      await fsyncDirectory(finalPath.uploadRoot);
    } catch {
      // rename 失败保留 PENDING 与 staging 文件，释放 claim 等待下一次显式维护运行。
      await releaseClaim(attachment.id, claimId);
      counts.retryLaterCount += 1;
      return;
    }
    const verified = await probeFile(finalPath.filePath, attachment.hash, attachment.sizeBytes);
    if (!verified.present || !verified.matches) {
      await markFailedWithClaim(attachment.id, claimId, "INTEGRITY_MISMATCH", "reconciliation_post_rename_verify");
      counts.failedIntegrityMismatchCount += 1;
      return;
    }
    if (await finalizeReadyWithClaim(context, attachment.id, claimId)) {
      counts.finalizedFromStagingCount += 1;
    } else {
      counts.lostClaimCount += 1;
    }
    return;
  }

  // final 存在、staging 不存在。
  if (!finalProbe.matches) {
    await markFailedWithClaim(attachment.id, claimId, "INTEGRITY_MISMATCH", "reconciliation_final_verify");
    counts.failedIntegrityMismatchCount += 1;
    return;
  }
  if (await finalizeReadyWithClaim(context, attachment.id, claimId)) {
    counts.readyFromFinalCount += 1;
  } else {
    counts.lostClaimCount += 1;
  }
}

async function finalizeReadyWithClaim(
  context: ClaimedIntentContext,
  attachmentId: string,
  claimId: string,
): Promise<boolean> {
  await context.hooks?.beforeFinalizeCas?.(attachmentId);
  const updated = await prisma.attachment.updateMany({
    where: { id: attachmentId, status: "PENDING", reconciliationClaimId: claimId },
    data: {
      status: "READY",
      finalizedAt: new Date(),
      stagingName: null,
      failureCode: null,
      failurePhase: null,
      reconciliationClaimId: null,
      reconciliationClaimedAt: null,
      reconciliationLeaseExpiresAt: null,
    },
  });
  return updated.count === 1;
}

async function markFailedWithClaim(
  attachmentId: string,
  claimId: string,
  failureCode: string,
  failurePhase: string,
): Promise<void> {
  await prisma.attachment.updateMany({
    where: { id: attachmentId, status: "PENDING", reconciliationClaimId: claimId },
    data: {
      status: "FAILED",
      failureCode,
      failurePhase,
      reconciliationClaimId: null,
      reconciliationClaimedAt: null,
      reconciliationLeaseExpiresAt: null,
    },
  });
}

async function releaseClaim(attachmentId: string, claimId: string): Promise<void> {
  await prisma.attachment.updateMany({
    where: { id: attachmentId, status: "PENDING", reconciliationClaimId: claimId },
    data: {
      reconciliationClaimId: null,
      reconciliationClaimedAt: null,
      reconciliationLeaseExpiresAt: null,
    },
  });
}

async function probeFile(
  filePath: string,
  expectedHash: string,
  expectedSize: number,
): Promise<{ present: boolean; matches: boolean }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) return { present: true, matches: false };
    const bytes = await handle.readFile();
    const matches = stat.size === expectedSize
      && createHash("sha256").update(bytes).digest("hex") === expectedHash;
    return { present: true, matches };
  } catch (error) {
    if (isSymlinkRejection(error)) return { present: true, matches: false };
    return { present: false, matches: false };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
