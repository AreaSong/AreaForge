import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { prisma } from "../../packages/db/src/index";
import { createStagingAttachmentName, parseSingleFileMultipart, createUploadPolicy } from "../../packages/storage/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import {
  attachmentProtocolVersion,
  createNoteAttachment,
  getAttachmentDownload,
  stagingDirectoryName,
  type AttachmentProtocolHooks,
} from "../../apps/web/lib/study/attachments-service";
import { reconcileNewProtocolAttachments } from "../../apps/web/lib/study/attachment-reconciliation-service";
import { calculateOps007ImplementationHash, calculateOps007RecordHash } from "./ops007-attachment-runtime-validate";

/**
 * OPS-007 隔离 PostgreSQL + 临时上传目录 runtime selftest。
 * 覆盖：additive migration legacy 语义、写入意图协议 kill point、补偿失败、
 * 重启 reconciliation 决策表、claim/lease CAS、唯一冲突先于文件写入、O_NOFOLLOW 下载门。
 * 仅写隔离数据库与临时目录；不触碰生产、历史 orphan 或真实上传目录。
 */

const root = process.cwd();
const migrationPath = path.join(root, "prisma/migrations/20260721010000_attachment_staging_write_intent/migration.sql");
const outputPath = readOutputPath(process.argv.slice(2));
const uploadRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "areaforge-ops007-uploads-")));
process.env.UPLOAD_DIR = uploadRoot;
process.env.MAX_UPLOAD_MB = "1";
process.env.AUTH_SESSION_SECRET = process.env.AUTH_SESSION_SECRET ?? "ops007-selftest-fixture-secret-0123456789abcdef";

const checks: RuntimeCheck[] = [];
const pngMagic = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface RuntimeCheck {
  id: string;
  status: "pass";
  details: Record<string, string | number | boolean>;
}

try {
  await assertIsolatedDatabase();
  await verifyMigrationLegacyDefaults();
  await verifyRepeatAndDuplicatePreimage();
  await resetFixture();
  await verifyHappyPathUpload();
  await resetFixture();
  await verifyStorageIdentityConflict();
  await resetFixture();
  await verifyStagingFailureCompensation();
  await resetFixture();
  await verifyCompensationFailureAuditable();
  await resetFixture();
  await verifyReadyCasConflictPreservesFinal();
  await resetFixture();
  await verifyKillPointMatrix();
  await resetFixture();
  await verifyClaimLeaseCas();
  await resetFixture();
  await verifyDownloadGate();
  await resetFixture();

  const record = createRecord();
  if (outputPath) writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log("PASS OPS-007 isolated PostgreSQL attachment selftest");
} finally {
  await prisma.$disconnect();
  rmSync(uploadRoot, { recursive: true, force: true });
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_OPS007_ISOLATED_DB !== "1") {
    throw new Error("OPS-007 runtime selftest requires the explicit isolated database guard");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!rows[0]?.current_database.includes("ops007")) {
    throw new Error("OPS-007 runtime selftest refused a database without the isolated name marker");
  }
}

async function verifyMigrationLegacyDefaults(): Promise<void> {
  const migrationSql = readFileSync(migrationPath, "utf8");
  const statusColumn = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Attachment' AND column_name = 'status'
  `;
  const protocolColumn = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Attachment' AND column_name = 'protocolVersion'
  `;
  if (!statusColumn[0]?.column_default?.includes("PENDING") || protocolColumn[0]?.column_default !== "1") {
    throw new Error("OPS-007 applied schema must default new rows to PENDING/protocolVersion=1");
  }

  // 沙箱 schema 内重放：legacy row 不经过 UPDATE 即获得 READY/protocolVersion=0。
  const sandbox = "ops007_valid_migration_fixture";
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${sandbox}" CASCADE`);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${sandbox}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${sandbox}"`);
    await tx.$executeRawUnsafe(`CREATE TABLE "Attachment" (
      "id" text PRIMARY KEY,
      "storedName" text NOT NULL,
      "uri" text NOT NULL,
      "hash" text NOT NULL,
      "sizeBytes" integer NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await tx.$executeRawUnsafe(`INSERT INTO "Attachment" ("id", "storedName", "uri", "hash", "sizeBytes")
      VALUES ('legacy-row', 'legacyname1234567890.png', 'upload://attachment/legacyname1234567890.png', 'legacyhash', 3)`);
    await tx.$executeRawUnsafe(migrationSql);
  });
  const legacy = await prisma.$queryRawUnsafe<Array<{ status: string; protocolVersion: number }>>(
    `SELECT "status"::text AS "status", "protocolVersion" FROM "${sandbox}"."Attachment" WHERE "id" = 'legacy-row'`,
  );
  if (legacy[0]?.status !== "READY" || legacy[0]?.protocolVersion !== 0) {
    throw new Error("OPS-007 migration must leave legacy rows READY/protocolVersion=0 without data UPDATE");
  }
  const insertedDefaults = await prisma.$queryRawUnsafe<Array<{ status: string; protocolVersion: number }>>(
    `INSERT INTO "${sandbox}"."Attachment" ("id", "storedName", "uri", "hash", "sizeBytes")
     VALUES ('new-row', 'newname12345678901.png', 'upload://attachment/newname12345678901.png', 'newhash', 3)
     RETURNING "status"::text AS "status", "protocolVersion"`,
  );
  if (insertedDefaults[0]?.status !== "PENDING" || insertedDefaults[0]?.protocolVersion !== 1) {
    throw new Error("OPS-007 migration must switch post-migration defaults to PENDING/protocolVersion=1");
  }
  await prisma.$executeRawUnsafe(`DROP SCHEMA "${sandbox}" CASCADE`);
  checks.push({
    id: "migration.apply_verify_legacy_defaults",
    status: "pass",
    details: {
      appliedDefaultPending: true,
      legacyRowsReadyProtocolZero: true,
      newRowsPendingProtocolOne: true,
      dataUpdateExecuted: false,
    },
  });
}

async function verifyRepeatAndDuplicatePreimage(): Promise<void> {
  const migrationSql = readFileSync(migrationPath, "utf8");

  // 已应用数据库上重复 apply 必须 fail closed（CREATE TYPE 已存在）。
  const repeat = await Promise.allSettled([prisma.$executeRawUnsafe(migrationSql)]);
  if (repeat[0]?.status !== "rejected") throw new Error("OPS-007 repeated migration apply must fail closed");

  // 重复 storedName preimage 必须让唯一索引创建失败，不做自动修复。
  const dirty = "ops007_dirty_migration_fixture";
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${dirty}" CASCADE`);
  const dirtyResult = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${dirty}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${dirty}"`);
      await tx.$executeRawUnsafe(`CREATE TABLE "Attachment" (
        "id" text PRIMARY KEY,
        "storedName" text NOT NULL,
        "uri" text NOT NULL,
        "hash" text NOT NULL,
        "sizeBytes" integer NOT NULL,
        "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await tx.$executeRawUnsafe(`INSERT INTO "Attachment" ("id", "storedName", "uri", "hash", "sizeBytes") VALUES
        ('dup-a', 'dupname123456789012.png', 'upload://attachment/a.png', 'h', 1),
        ('dup-b', 'dupname123456789012.png', 'upload://attachment/b.png', 'h', 1)`);
      await tx.$executeRawUnsafe(migrationSql);
    }),
  ]);
  if (dirtyResult[0]?.status !== "rejected") {
    throw new Error("OPS-007 migration must reject a duplicate storedName preimage");
  }
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${dirty}" CASCADE`);
  checks.push({
    id: "migration.repeat_and_duplicate_preimage_rejected",
    status: "pass",
    details: { repeatedApplyRejected: true, duplicatePreimageRejected: true, automaticRepairAttempted: false },
  });
}

async function verifyHappyPathUpload(): Promise<void> {
  const { noteId, actorId } = await createNoteFixture();
  const scan = await scanFixtureUpload(pngFile(4096));
  const dto = await createNoteAttachment({ noteId, scan }, actorId);

  const row = await prisma.attachment.findUniqueOrThrow({ where: { id: dto.id } });
  const stagingEntries = await listStagingEntries();
  const finalExists = existsSync(path.join(uploadRoot, row.storedName));
  if (
    row.status !== "READY"
    || row.protocolVersion !== attachmentProtocolVersion
    || row.stagingName !== null
    || !row.finalizedAt
    || !finalExists
    || stagingEntries.length !== 0
    || "hash" in dto
  ) {
    throw new Error("OPS-007 happy-path upload did not finish READY with a clean staging directory");
  }
  const download = await getAttachmentDownload(dto.id);
  if (download.bytes.length !== scan.sizeBytes) throw new Error("OPS-007 happy-path download bytes mismatch");
  checks.push({
    id: "upload.write_intent_happy_path",
    status: "pass",
    details: { readyCount: 1, stagingLeftoverCount: 0, dtoHashExposed: false, downloadVerified: true },
  });
}

async function verifyStorageIdentityConflict(): Promise<void> {
  const { noteId, actorId } = await createNoteFixture();
  const fixedId = randomUUID().replaceAll("-", "");
  const first = await createNoteAttachment({ noteId, scan: await scanFixtureUpload(pngFile(1024)) }, actorId, { storageId: () => fixedId });

  const filesBefore = await countUploadFiles();
  let conflictCode = "";
  try {
    await createNoteAttachment({ noteId, scan: await scanFixtureUpload(pngFile(2048)) }, actorId, { storageId: () => fixedId });
  } catch (error) {
    conflictCode = error instanceof ApiError ? error.code : "";
  }
  const filesAfter = await countUploadFiles();
  const attachmentCount = await prisma.attachment.count();
  if (conflictCode !== "ATTACHMENT_STORAGE_CONFLICT" || filesAfter !== filesBefore || attachmentCount !== 1) {
    throw new Error("OPS-007 storage identity conflict must fail before any file write");
  }
  if (!first.id) throw new Error("OPS-007 conflict fixture lost the first attachment");
  checks.push({
    id: "upload.storage_identity_conflict_before_file",
    status: "pass",
    details: { conflictBeforeFileWrite: true, newFileCount: 0, survivingReadyCount: 1 },
  });
}

async function verifyStagingFailureCompensation(): Promise<void> {
  const { noteId, actorId } = await createNoteFixture();
  const hooks: AttachmentProtocolHooks = {
    afterStagingWrite: async () => {
      throw new Error("INJECTED_STAGING_FSYNC_FAILURE");
    },
  };
  let failureCode = "";
  try {
    await createNoteAttachment({ noteId, scan: await scanFixtureUpload(pngFile(1024)) }, actorId, hooks);
  } catch (error) {
    failureCode = error instanceof ApiError ? error.code : "";
  }
  const row = await prisma.attachment.findFirstOrThrow();
  const stagingEntries = await listStagingEntries();
  if (
    failureCode !== "ATTACHMENT_WRITE_FAILED"
    || row.status !== "FAILED"
    || row.failurePhase !== "staging_write"
    || row.failureCode !== "STAGING_WRITE_FAILED"
    || stagingEntries.length !== 0
  ) {
    throw new Error("OPS-007 staging failure must mark FAILED and remove only this staging file");
  }
  checks.push({
    id: "upload.staging_failure_compensation",
    status: "pass",
    details: { failedRowRetained: true, stagingRemoved: true, stableFailureCode: true },
  });
}

async function verifyCompensationFailureAuditable(): Promise<void> {
  const { noteId, actorId } = await createNoteFixture();
  const hooks: AttachmentProtocolHooks = {
    afterStagingWrite: async () => {
      throw new Error("INJECTED_STAGING_FAILURE");
    },
    compensationUnlink: async () => {
      throw new Error("INJECTED_UNLINK_FAILURE");
    },
  };
  try {
    await createNoteAttachment({ noteId, scan: await scanFixtureUpload(pngFile(1024)) }, actorId, hooks);
  } catch {
    // 预期失败。
  }
  const row = await prisma.attachment.findFirstOrThrow();
  const stagingEntries = await listStagingEntries();
  if (
    row.status !== "FAILED"
    || row.failureCode !== "STAGING_WRITE_FAILED_STAGING_CLEANUP_FAILED"
    || stagingEntries.length !== 1
  ) {
    throw new Error("OPS-007 compensation failure must keep the staging file and a stable cleanup failure code");
  }
  checks.push({
    id: "upload.compensation_failure_auditable",
    status: "pass",
    details: { cleanupFailureCodeRetained: true, stagingFileRetained: true, errorSwallowed: false },
  });
}

async function verifyReadyCasConflictPreservesFinal(): Promise<void> {
  const { noteId, actorId } = await createNoteFixture();
  const hooks: AttachmentProtocolHooks = {
    beforeReadyCas: async () => {
      // 模拟并发 reconciliation 已经持有 claim：READY CAS 必须失败且不得删除 final 文件。
      await prisma.attachment.updateMany({
        where: { status: "PENDING" },
        data: { reconciliationClaimId: "competing-claim", reconciliationClaimedAt: new Date() },
      });
    },
  };
  let conflictCode = "";
  try {
    await createNoteAttachment({ noteId, scan: await scanFixtureUpload(pngFile(1024)) }, actorId, hooks);
  } catch (error) {
    conflictCode = error instanceof ApiError ? error.code : "";
  }
  const row = await prisma.attachment.findFirstOrThrow();
  const finalExists = existsSync(path.join(uploadRoot, row.storedName));
  if (conflictCode !== "ATTACHMENT_RECONCILIATION_REQUIRED" || row.status !== "PENDING" || !finalExists) {
    throw new Error("OPS-007 READY CAS conflict must preserve PENDING row and final file for reconciliation");
  }
  checks.push({
    id: "upload.ready_cas_conflict_preserves_final",
    status: "pass",
    details: { pendingRetained: true, finalFileRetained: true, silentDeleteAttempted: false },
  });
}

async function verifyKillPointMatrix(): Promise<void> {
  const { noteId } = await createNoteFixture();
  const old = new Date(Date.now() - 60 * 60_000);

  // kill A：intent 先于文件（无 staging/final）→ FAILED/MISSING_FILE_AFTER_INTENT。
  const missing = await createPendingRow(noteId, "killmissing1234567", pngFile(64), { createdAt: old, updatedAt: old });
  // kill B：staging 写完后崩溃 → rename + verify + READY。
  const staged = await createPendingRow(noteId, "killstaged12345678", pngFile(128), { createdAt: old, updatedAt: old, writeStaging: true });
  // kill C：final 已就位但 READY CAS 未执行 → verify + READY。
  const finalized = await createPendingRow(noteId, "killfinal123456789", pngFile(256), { createdAt: old, updatedAt: old, writeFinal: true });
  // dual：staging 与 final 同时存在 → blocked，保留双文件。
  const dual = await createPendingRow(noteId, "killdual1234567890", pngFile(512), { createdAt: old, updatedAt: old, writeStaging: true, writeFinal: true });
  // mismatch：final 内容与 intent hash 不符 → FAILED/INTEGRITY_MISMATCH，文件保留。
  const mismatch = await createPendingRow(noteId, "killbadhash1234567", pngFile(1024), {
    createdAt: old,
    updatedAt: old,
    writeFinal: true,
    corruptFinal: true,
  });

  const summary = await reconcileNewProtocolAttachments({ minIntentAgeMs: 0 });
  const rows = new Map(
    (await prisma.attachment.findMany({ select: { id: true, status: true, failureCode: true, stagingName: true } }))
      .map((row) => [row.id, row]),
  );

  const dualRow = rows.get(dual.id);
  const dualStagingKept = existsSync(path.join(uploadRoot, stagingDirectoryName, createStagingAttachmentName(dual.storedName)));
  const dualFinalKept = existsSync(path.join(uploadRoot, dual.storedName));
  const mismatchFinalKept = existsSync(path.join(uploadRoot, mismatch.storedName));
  if (
    rows.get(missing.id)?.status !== "FAILED"
    || rows.get(missing.id)?.failureCode !== "MISSING_FILE_AFTER_INTENT"
    || rows.get(staged.id)?.status !== "READY"
    || rows.get(finalized.id)?.status !== "READY"
    || dualRow?.status !== "PENDING"
    || !dualStagingKept
    || !dualFinalKept
    || rows.get(mismatch.id)?.status !== "FAILED"
    || rows.get(mismatch.id)?.failureCode !== "INTEGRITY_MISMATCH"
    || !mismatchFinalKept
    || summary.counts.finalizedFromStagingCount !== 1
    || summary.counts.readyFromFinalCount !== 1
    || summary.counts.failedMissingFileCount !== 1
    || summary.counts.failedIntegrityMismatchCount !== 1
    || summary.counts.blockedDualFileCount !== 1
  ) {
    throw new Error(`OPS-007 kill-point reconciliation matrix failed: ${JSON.stringify({ summary: summary.counts })}`);
  }
  // 重启后重复运行必须幂等：dual 仍 blocked，其他不再变化。
  const repeat = await reconcileNewProtocolAttachments({ minIntentAgeMs: 0 });
  if (repeat.counts.blockedDualFileCount !== 1 || repeat.counts.finalizedFromStagingCount !== 0 || repeat.counts.readyFromFinalCount !== 0) {
    throw new Error("OPS-007 repeated reconciliation run must be idempotent");
  }
  const stagedDownload = await getAttachmentDownload(staged.id);
  if (stagedDownload.bytes.length === 0) throw new Error("OPS-007 reconciled staging attachment must be downloadable");
  checks.push({
    id: "reconciliation.kill_point_matrix",
    status: "pass",
    details: {
      finalizedFromStagingCount: 1,
      readyFromFinalCount: 1,
      failedMissingFileCount: 1,
      failedIntegrityMismatchCount: 1,
      blockedDualFileCount: 1,
      dualFileDeleted: false,
      repeatedRunIdempotent: true,
    },
  });
}

async function verifyClaimLeaseCas(): Promise<void> {
  const { noteId } = await createNoteFixture();
  const old = new Date(Date.now() - 60 * 60_000);

  // 年轻 intent 不 claim。
  const young = await createPendingRow(noteId, "claimyoung1234567", pngFile(64), {});
  // 活跃 lease 不重复 claim（raw SQL 以保留 aged updatedAt，不触发 @updatedAt）。
  const leased = await createPendingRow(noteId, "claimleased123456", pngFile(64), { createdAt: old, updatedAt: old, writeFinal: true });
  await prisma.$executeRaw`
    UPDATE "Attachment"
    SET "reconciliationClaimId" = 'active-claim',
        "reconciliationClaimedAt" = NOW(),
        "reconciliationLeaseExpiresAt" = NOW() + interval '10 minutes',
        "updatedAt" = ${old}
    WHERE "id" = ${leased.id}
  `;
  // 过期 lease 可被新的维护运行 reclaim，旧 claimId 的提交必须失败。
  const expired = await createPendingRow(noteId, "claimexpired12345", pngFile(64), { createdAt: old, updatedAt: old, writeFinal: true });
  const staleClaimId = "stale-claim";
  await prisma.$executeRaw`
    UPDATE "Attachment"
    SET "reconciliationClaimId" = ${staleClaimId},
        "reconciliationClaimedAt" = NOW() - interval '30 minutes',
        "reconciliationLeaseExpiresAt" = NOW() - interval '20 minutes',
        "reconciliationAttempt" = 1,
        "updatedAt" = ${old}
    WHERE "id" = ${expired.id}
  `;

  const summary = await reconcileNewProtocolAttachments({ minIntentAgeMs: 15 * 60_000 });
  const youngRow = await prisma.attachment.findUniqueOrThrow({ where: { id: young.id } });
  const leasedRow = await prisma.attachment.findUniqueOrThrow({ where: { id: leased.id } });
  const expiredRow = await prisma.attachment.findUniqueOrThrow({ where: { id: expired.id } });

  // 旧 worker 用过期 claimId 提交 READY：必须 0 行命中。
  const staleCommit = await prisma.attachment.updateMany({
    where: { id: expired.id, status: "PENDING", reconciliationClaimId: staleClaimId },
    data: { status: "READY" },
  });

  if (
    summary.counts.skippedYoungIntentCount < 1
    || summary.counts.skippedActiveLeaseCount !== 1
    || youngRow.status !== "PENDING"
    || leasedRow.status !== "PENDING"
    || leasedRow.reconciliationClaimId !== "active-claim"
    || expiredRow.status !== "READY"
    || expiredRow.reconciliationAttempt !== 2
    || staleCommit.count !== 0
  ) {
    throw new Error(`OPS-007 claim/lease CAS failed: ${JSON.stringify({ summary: summary.counts })}`);
  }
  checks.push({
    id: "reconciliation.claim_lease_cas",
    status: "pass",
    details: { staleClaimCommitCount: 0, expiredLeaseReclaimed: true, youngIntentSkipped: true, activeLeasePreserved: true },
  });
}

async function verifyDownloadGate(): Promise<void> {
  const { noteId, actorId } = await createNoteFixture();
  const ready = await createNoteAttachment({ noteId, scan: await scanFixtureUpload(pngFile(2048)) }, actorId);
  const readyRow = await prisma.attachment.findUniqueOrThrow({ where: { id: ready.id } });

  // PENDING / FAILED 拒绝。
  const pendingRow = await createPendingRow(noteId, "gatepending123456", pngFile(64), { writeFinal: true });
  const pendingRejected = await expectApiError(() => getAttachmentDownload(pendingRow.id), "ATTACHMENT_NOT_READY");
  await prisma.attachment.update({ where: { id: pendingRow.id }, data: { status: "FAILED", failureCode: "X", failurePhase: "x" } });
  const failedRejected = await expectApiError(() => getAttachmentDownload(pendingRow.id), "ATTACHMENT_NOT_READY");

  // symlink 替换 final 文件：O_NOFOLLOW 拒绝。
  const symlinkTarget = path.join(uploadRoot, "outside-secret.txt");
  await writeFile(symlinkTarget, "outside");
  const finalPath = path.join(uploadRoot, readyRow.storedName);
  rmSync(finalPath);
  await symlink(symlinkTarget, finalPath);
  const symlinkRejected = await expectApiError(() => getAttachmentDownload(ready.id), "ATTACHMENT_FILE_MISMATCH");

  // hash mismatch 拒绝（report-only：不改 row）。
  rmSync(finalPath);
  await writeFile(finalPath, pngFile(2048).map((byte, index) => (index === 100 ? byte ^ 0xff : byte)));
  const hashMismatchRejected = await expectApiError(() => getAttachmentDownload(ready.id), "ATTACHMENT_FILE_MISMATCH");
  const readyRowAfter = await prisma.attachment.findUniqueOrThrow({ where: { id: ready.id } });

  // legacy READY/protocolVersion=0 行仍可通过 same-handle 校验读取。
  const legacyBytes = pngFile(512);
  const legacyStored = `legacyread12345678.png`;
  await writeFile(path.join(uploadRoot, legacyStored), legacyBytes);
  const legacy = await prisma.attachment.create({
    data: {
      noteId,
      originalName: "legacy.png",
      storedName: legacyStored,
      mimeType: "image/png",
      sizeBytes: legacyBytes.length,
      hash: createHash("sha256").update(legacyBytes).digest("hex"),
      uri: `upload://attachment/${legacyStored}`,
      status: "READY",
      protocolVersion: 0,
    },
    select: { id: true },
  });
  const legacyDownload = await getAttachmentDownload(legacy.id);

  if (!pendingRejected || !failedRejected || !symlinkRejected || !hashMismatchRejected || readyRowAfter.status !== "READY" || legacyDownload.bytes.length !== legacyBytes.length) {
    throw new Error("OPS-007 download gate did not enforce READY + O_NOFOLLOW + same-handle verification");
  }
  checks.push({
    id: "download.o_nofollow_and_status_gate",
    status: "pass",
    details: {
      symlinkRejected: true,
      pendingRejected: true,
      failedRejected: true,
      hashMismatchRejected: true,
      legacyReadCompatible: true,
      historicalRowMutated: false,
    },
  });
}

interface PendingRowOptions {
  createdAt?: Date;
  updatedAt?: Date;
  writeStaging?: boolean;
  writeFinal?: boolean;
  corruptFinal?: boolean;
}

async function createPendingRow(
  noteId: string,
  idBase: string,
  bytes: Uint8Array,
  options: PendingRowOptions,
): Promise<{ id: string; storedName: string }> {
  const randomSuffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const storedName = `${idBase}${randomSuffix}.png`.replaceAll(/[^a-zA-Z0-9_.-]/g, "");
  const stagingName = createStagingAttachmentName(storedName);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const row = await prisma.attachment.create({
    data: {
      noteId,
      originalName: "kill.png",
      storedName,
      mimeType: "image/png",
      sizeBytes: bytes.length,
      hash,
      uri: `upload://attachment/${storedName}`,
      status: "PENDING",
      protocolVersion: attachmentProtocolVersion,
      stagingName,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
    select: { id: true, storedName: true },
  });
  if (options.updatedAt) {
    await prisma.$executeRaw`UPDATE "Attachment" SET "updatedAt" = ${options.updatedAt} WHERE "id" = ${row.id}`;
  }
  if (options.writeStaging) {
    await mkdir(path.join(uploadRoot, stagingDirectoryName), { recursive: true });
    await writeFile(path.join(uploadRoot, stagingDirectoryName, stagingName), bytes);
  }
  if (options.writeFinal) {
    const finalBytes = options.corruptFinal ? bytes.map((byte, index) => (index === 8 ? byte ^ 0xff : byte)) : bytes;
    await writeFile(path.join(uploadRoot, storedName), finalBytes);
  }
  return row;
}

async function createNoteFixture(): Promise<{ noteId: string; actorId: string }> {
  const user = await prisma.user.create({
    data: { email: `ops007-${randomUUID().slice(0, 12)}@example.invalid`, passwordHash: "fixture" },
  });
  const subject = await prisma.subject.create({
    data: { code: "MATH", name: "OPS-007 fixture", color: "#111111" },
  });
  const note = await prisma.note.create({
    data: { subjectId: subject.id, title: "ops007", content: "fixture" },
    select: { id: true },
  });
  return { noteId: note.id, actorId: user.id };
}

function pngFile(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(pngMagic);
  for (let index = pngMagic.length; index < size; index += 1) bytes[index] = index % 251;
  return bytes;
}

async function scanFixtureUpload(bytes: Uint8Array) {
  const boundary = "----ops007-selftest";
  const encoder = new TextEncoder();
  const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n`);
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  async function* iterate(): AsyncIterable<Uint8Array> {
    for (let index = 0; index < body.length; index += 8192) {
      yield body.subarray(index, Math.min(index + 8192, body.length));
    }
  }
  return parseSingleFileMultipart(iterate(), `multipart/form-data; boundary=${boundary}`, createUploadPolicy(1));
}

async function listStagingEntries(): Promise<string[]> {
  try {
    return await readdir(path.join(uploadRoot, stagingDirectoryName));
  } catch {
    return [];
  }
}

async function countUploadFiles(): Promise<number> {
  const entries = await readdir(uploadRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

async function expectApiError(run: () => Promise<unknown>, code: string): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (error) {
    return error instanceof ApiError && error.code === code;
  }
}

async function resetFixture(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Attachment", "AuditEvent", "Note", "Subject", "User" CASCADE`);
  const entries = await readdir(uploadRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    rmSync(path.join(uploadRoot, entry.name), { recursive: true, force: true });
  }
}

function createRecord() {
  const record = {
    schemaVersion: 1,
    mode: "isolated_postgresql_ops007_attachment_selftest",
    generatedAt: new Date().toISOString(),
    status: "pass",
    source: {
      database: "isolated_local_postgresql",
      uploadDirectory: "temporary_isolated_upload_directory",
      migration: path.relative(root, migrationPath),
      migrationSha256: sha256(readFileSync(migrationPath)),
      implementationSha256: calculateOps007ImplementationHash(root),
    },
    checks,
    doesNotProve: [
      "production migration safety",
      "production attachment write safety",
      "historical orphan cleanup",
      "backup or restore success",
      "signed Release readiness",
      "AF-RISK-OPS-007 residual closure",
    ],
    safetyFacts: {
      isolatedDatabaseRequired: true,
      isolatedDatabaseWriteAttempted: true,
      temporaryUploadDirectoryUsed: true,
      productionWriteAttempted: false,
      historicalOrphanMutated: false,
      readyAttachmentDeleted: false,
      serverCommandAttempted: false,
      secretValuePrinted: false,
      businessTextIncluded: false,
      objectIdentifiersIncluded: false,
    },
  };
  return { ...record, recordHash: calculateOps007RecordHash(record) };
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readOutputPath(args: string[]): string | null {
  const index = args.indexOf("--output");
  if (index < 0) return null;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error("--output requires a path");
  return path.resolve(root, value);
}
