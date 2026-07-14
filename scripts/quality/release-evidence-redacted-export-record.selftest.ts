import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { computeAttachmentReconciliationSummaryHash } from "./attachment-reconciliation-summary";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-release-evidence-redacted-record-"));

try {
  const exportDir = path.join(tempDir, "areaforge-release-evidence-redacted-fixture");
  const releaseRecord = path.join(tempDir, "release-v0.1.7-record.md");
  const outputRecord = path.join(tempDir, "release-v0.1.7-record.generated.md");
  const mismatchOutputRecord = path.join(tempDir, "release-v0.1.7-record.mismatch.md");
  const mismatchReleaseRecord = path.join(tempDir, "release-mismatch.md");
  const reconciliationCsv = path.join(tempDir, "attachment-reconciliation.csv");
  const reconciliationSummary = path.join(tempDir, "attachment-reconciliation-summary.json");

  writeFixtureExport(exportDir);
  writeAttachmentEvidence(reconciliationCsv, reconciliationSummary);
  writeFileSync(releaseRecord, releaseRecordFixture("v0.1.7"));
  writeFileSync(mismatchReleaseRecord, releaseRecordFixture("v0.1.8"));

  expectExit("generate redacted release record", [
    "release:evidence:redacted-export:record",
    exportDir,
    releaseRecord,
    outputRecord,
    reconciliationCsv,
    reconciliationSummary,
  ], 0, "generatedReleaseEvidenceBundleHash: sha256:");

  assert(existsSync(outputRecord), "generated release record should exist");
  const generated = readFileSync(outputRecord, "utf8");
  assert(generated.includes("databaseBackupSha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "database backup hash should be copied");
  assert(generated.includes("uploadsBackupSha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "uploads backup hash should be copied");
  assert(generated.includes("envBackupSha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"), "env backup hash should be copied");
  assert(generated.includes("databaseBackupPath: <redacted-root-only-path>"), "database backup path should remain redacted");
  assert(generated.includes("releaseEvidenceRedactedExportHash: sha256:"), "redacted export hash should be recorded");
  assert(generated.includes("releaseEvidenceRedactedRecordMode: repo-visible-draft-from-validated-redacted-export"), "draft mode should be recorded");
  assert(generated.includes("releaseEvidenceRedactedRecordDoesNotProve: production smoke completion, backup/restore execution, migration execution, updater apply execution, residual risk closure, secret disclosure absence beyond validator scan"), "doesNotProve boundary should be recorded");
  assert(generated.includes("releaseEvidenceRedactedRecordClosesResidual: no"), "draft should not close residuals");
  assert(generated.includes("releaseEvidenceRedactedRecordResidualLedgerUpdated: no"), "draft should not update residual ledger");
  assert(generated.includes("releaseEvidenceRedactedRecordSafetyFacts: serverCommandAttempted=false, productionWriteAttempted=false, secretValuePrinted=false, residualLedgerUpdated=false, originalReleaseRecordOverwritten=false"), "draft safety facts should be recorded");
  assert(/releaseEvidenceBundleHash: sha256:[a-f0-9]{64}/i.test(generated), "release evidence bundle hash should be written");
  assert(!generated.includes("pending-run-pnpm-release-evidence-validate-on-this-record"), "release evidence bundle hash should not remain pending");
  assert(generated.includes("extraSmokeChecks: health, login, update-status"), "extra smoke check summary should be recorded");
  assert(generated.includes("attachmentReconciliationStatus: pass"), "attachment reconciliation status should be bound");
  assert(generated.includes("attachmentReconciliationCsvSha256: sha256:"), "attachment reconciliation CSV hash should be bound");
  assert(generated.includes("attachmentReconciliationSummaryHash: sha256:"), "attachment reconciliation summary hash should be bound");
  assert(!generated.includes("/opt/areaforge/backups"), "generated record must not include root-only backup paths");
  assert(!generated.includes("DATABASE_URL"), "generated record must not include secret-like lines");

  expectExit("generated release record validates", [
    "release:evidence:validate",
    outputRecord,
    reconciliationCsv,
    reconciliationSummary,
  ], 0, "releaseEvidenceBundleHash: sha256:");

  expectExit("mismatched release tag fails", [
    "release:evidence:redacted-export:record",
    exportDir,
    mismatchReleaseRecord,
    mismatchOutputRecord,
    reconciliationCsv,
    reconciliationSummary,
  ], 1, "releaseTag");
  assert(!existsSync(mismatchOutputRecord), "mismatched release tag should not write output");

  const original = readFileSync(releaseRecord, "utf8");
  assert(original.includes("databaseBackupSha256: not-copied-root-only-update-record"), "source release record should not be overwritten");

  console.log("release evidence redacted export record selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function writeFixtureExport(exportDir: string): void {
  mkdirSync(exportDir, { recursive: true });
  const safeFields = [
    "releaseId: github-0.1.7-20260712112325",
    "updatedAt: 2026-07-12T11:23:25Z",
    "status: success",
    "githubRepo: AreaSong/AreaForge",
    "releaseTag: v0.1.7",
    "targetVersion: 0.1.7",
    "targetChannel: stable",
    "gitCommit: c1a25e4f897330fea493ad4c6dd889b62ef8f63a",
    "previousAppVersion: 0.1.5",
    "previousImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9",
    "targetWebImage: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    "targetWebImageDigest: sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    "migrationApplied: true",
    "migrationImageDigest: sha256:c2c27da7ed85be0796d4f6535557d3759bc14975a0238b725b99c1c0e232e654",
    "sbomAsset: areaforge-sbom.spdx.json",
    "sbomSha256: 4dd56f6c72db5e32528df4d2d443fe8e2510df9fe7be20a3d8c8c4d3cff24303",
    "provenanceAsset: areaforge-provenance.json",
    "provenanceSha256: 69f93bd9e4b7f6b8b9390ae2f0e3fa80650796ce3ac2451858e2ca8bd57c692f",
    "composeUpdated: false",
    "databaseBackupPath: <redacted-root-only-path>",
    "databaseBackupSha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "uploadsBackupPath: <redacted-root-only-path>",
    "uploadsBackupSha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "envBackupPath: <redacted-root-only-path>",
    "envBackupSha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "composeConfigBackupPath: <redacted-root-only-path>",
    "composeHash: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "nginxConfigBackupPath: <redacted-root-only-path>",
    "smokeHealth: PASS",
    "extraSmoke: PASS",
    "extraSmokeLogPath: <redacted-root-only-path>",
    "rollbackAttempted: no",
    "databaseRestoreAttempted: no",
    "uploadsRestoreAttempted: no",
    "failureReason: none",
    "releaseNotesUrl: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7",
    "",
  ].join("\n");
  const status = JSON.stringify({
    currentVersion: "0.1.7",
    currentImage: "ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    releaseUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7",
    latestVersion: "0.1.7",
    updateAvailable: false,
    autoApply: "none",
    signatureRequired: true,
    timerEnabled: true,
    timerActive: true,
    lastCheckedAt: "2026-07-12T11:23:25Z",
    blocker: null,
    rollback: {
      available: true,
      targetVersion: "0.1.5",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9",
    },
    statusUpdatedAt: "2026-07-12T11:23:25Z",
    safetyFacts: {
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      updaterApplyAttempted: false,
    },
  }, null, 2);
  const smoke = [
    "PASS health: ok (10ms)",
    "PASS login: ok (20ms)",
    "PASS update-status: ok (30ms)",
    '{"ok":true,"baseUrl":"https://forge.areasong.top","checkedAt":"2026-07-12T11:25:00Z","checks":[{"name":"health","ok":true,"durationMs":10},{"name":"login","ok":true,"durationMs":20},{"name":"update-status","ok":true,"durationMs":30}]}',
    "",
  ].join("\n");
  const summary = [
    "mode: release-evidence-redacted-export-no-secret-read",
    "outputDir: <redacted-tmp-output-dir>",
    "sourceUpdateRecord: <redacted-root-only-update-record-path>",
    "sourceStatus: <redacted-root-only-status-path>",
    "sourceSmokeLog: <redacted-smoke-log-path>",
    `releaseUpdateSafeFields: sha256:${hash(safeFields)}`,
    `redactedUpdateStatusRecord: sha256:${hash(status)}`,
    `prodReadonlySmokeOutput: sha256:${hash(smoke)}`,
    "updateRecordSha256: sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "safetyFacts:",
    "  updaterApplyAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  rollbackAttempted: no",
    "  productionWriteAttempted: no",
    "  secretFileReadAttempted: no",
    "  secretValuePrinted: no",
    "  smokePasswordFileReadAttempted: no",
    "  residualLedgerUpdated: no",
    "",
  ].join("\n");

  writeFileSync(path.join(exportDir, "release-update-safe-fields.txt"), safeFields, { flag: "w" });
  writeFileSync(path.join(exportDir, "redacted-update-status.json"), status, { flag: "w" });
  writeFileSync(path.join(exportDir, "prod-readonly-smoke-output.log"), smoke, { flag: "w" });
  writeFileSync(path.join(exportDir, "remote-summary.txt"), summary, { flag: "w" });
}

function releaseRecordFixture(releaseTag: string): string {
  return [
    "releaseId: release-v0.1.7",
    "releasedAt: 2026-07-12T11:23:25Z",
    "operator: Codex user-confirmed production updater apply",
    "gitCommit: c1a25e4f897330fea493ad4c6dd889b62ef8f63a",
    "releaseTag: " + releaseTag,
    "AREAFORGE_IMAGE: ghcr.io/areasong/areaforge-web:v0.1.7",
    "imageDigest: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    "webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    "migrationImageDigest: ghcr.io/areasong/areaforge-migration:v0.1.7@sha256:c2c27da7ed85be0796d4f6535557d3759bc14975a0238b725b99c1c0e232e654",
    "composeHash: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "nginxConfigHash: 34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46",
    "previousImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9",
    "previousAppVersion: 0.1.5",
    "databaseBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo",
    "databaseBackupSha256: not-copied-root-only-update-record",
    "uploadsBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo",
    "uploadsBackupSha256: not-copied-root-only-update-record",
    "envBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo",
    "envBackupSha256: not-copied-root-only-update-record",
    "composeConfigBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo",
    "nginxConfigBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo",
    "migrationVersion: prisma migrate deploy via v0.1.7 migration image; no pending migrations",
    "migrationApplied: yes",
    "migrationRunner: one_off_migration_job",
    "releaseEvidenceBundleHash: pending-redacted-root-only-backup-hash-copy",
    "operationalEvidenceBundleHash: sha256:58dc87bcfe7505a2ef3837aa85c24681ed8d4b52c2cf7881d5e89a39904b69c9",
    "alertPreviewStatus: warning",
    "preflight:",
    "  pnpmCheck: PASS",
    "  composeConfig: PASS",
    "  prodComposeConfig: PASS",
    "restoreDrill:",
    "  databaseImported: no",
    "  uploadsRestored: no",
    "  attachmentHashMatched: not-applicable",
    "postReleaseSmoke:",
    "  health: PASS",
    "  login: PASS",
    "  dashboard: PASS",
    "  taskTimerReview: FAIL",
    "  syllabusNotesAnalyticsReports: PASS",
    "  attachmentSmoke: FAIL",
    "  aiFallbackOrProvider: FAIL",
    "rollbackDecision: no rollback needed for scoped updater apply",
    "rollbackPlan: use server-side updater rollback to return app image and APP_VERSION to 0.1.5",
    "rollbackDrillResult: not-applicable-no-rollback-attempted",
    "rollbackDurationMinutes: 0",
    "databaseRestoreRequired: no",
    "uploadsRestoreRequired: no",
    "rollbackFailureReason: none-no-rollback-attempted",
    "residualRisk: v0.1.7 is applied in production and public health passes. Backup hashes and full update-record fields are retained on the production host and were not copied into the repo because the current closure scope excludes secret/backups copying; post-update OPS-001 still needs evidence.",
    "residualRiskIds: AF-RISK-OPS-001,AF-RISK-OPS-002",
    "followUpTasks: docs/development/residual-risk-ledger.md,tasks/indexes/residuals.md",
    "expectedFailureOrStopConditions:",
    "  migrationFailed: stop",
    "  smokeFailed: rollback",
    "  logLeakDetected: stop",
    "  attachmentHashMismatch: stop",
    "  backupMissing: stop",
    "",
  ].join("\n");
}

function writeAttachmentEvidence(csvPath: string, summaryPath: string): void {
  const csv = "attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action\n";
  const summaryWithoutHash = {
    schemaVersion: 1 as const,
    mode: "read_only_attachment_reconciliation_summary" as const,
    generatedAt: "2026-07-12T11:25:00.000Z",
    status: "pass" as const,
    action: "report_only" as const,
    source: {
      reconciliationCsvSha256: `sha256:${hash(csv)}`,
      uploadDirectory: "configured_private_upload_directory" as const,
    },
    counts: {
      databaseRecordCount: 0,
      uploadFileCount: 0,
      dbOnlyCount: 0,
      fileOnlyCount: 0,
      hashMismatchCount: 0,
      sizeMismatchCount: 0,
      invalidUriCount: 0,
      duplicateReferenceCount: 0,
      unsafeEntryCount: 0,
      unexpectedEntryCount: 0,
    },
    fileOnlyEntryHashes: [],
    unsafeEntryHashes: [],
    doesNotProve: [
      "automatic orphan cleanup",
      "attachment metadata repair",
      "backup restore success outside the scanned directory",
      "production health",
    ],
    safetyFacts: {
      readOnly: true as const,
      databaseWriteAttempted: false as const,
      uploadWriteAttempted: false as const,
      fileDeleted: false as const,
      fileMoved: false as const,
      metadataRepaired: false as const,
      fileContentIncluded: false as const,
      absolutePathIncluded: false as const,
      secretValuePrinted: false as const,
    },
  };
  const summary = {
    ...summaryWithoutHash,
    summaryHash: computeAttachmentReconciliationSummaryHash(summaryWithoutHash),
  };
  writeFileSync(csvPath, csv);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedOutput?: string): void {
  const result = spawnSync("pnpm", args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected ${expectedStatus}, got ${String(result.status)}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
  const combined = `${result.stdout}\n${result.stderr}`;
  if (expectedOutput && !combined.includes(expectedOutput)) {
    console.error(`FAIL ${label}: expected output to include ${expectedOutput}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}
