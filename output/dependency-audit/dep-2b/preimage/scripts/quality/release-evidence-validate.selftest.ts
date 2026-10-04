import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildReleaseEvidenceBundleHash,
  releaseEvidenceRedactedRecordContract,
  resolveReleaseEvidenceValidationArgs,
} from "./release-evidence-validate";
import { buildAttachmentReconciliationSummary } from "./attachment-reconciliation-summary";
import { parseIndentedKeyValueRecord } from "./record-validator-common";

const root = process.cwd();

async function main(): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-release-evidence-"));
  try {
  const validRecord = path.join(tempDir, "release-record.txt");
  const validCsv = path.join(tempDir, "attachment-reconciliation.csv");
  const validSummary = path.join(tempDir, "attachment-reconciliation-summary.json");
  const mismatchSummary = path.join(tempDir, "attachment-reconciliation-summary-mismatch.json");
  const uploadDir = path.join(tempDir, "uploads");
  const invalidSecretRecord = path.join(tempDir, "release-record-secret.txt");
  const invalidEnumRecord = path.join(tempDir, "release-record-enum.txt");
  const invalidRunnerRecord = path.join(tempDir, "release-record-runner.txt");
  const invalidBundleHashRecord = path.join(tempDir, "release-record-bundle-hash.txt");
  const invalidCsv = path.join(tempDir, "attachment-reconciliation-invalid.csv");
  const mismatchCsv = path.join(tempDir, "attachment-reconciliation-mismatch.csv");
  const notApplicableRecord = path.join(tempDir, "release-record-not-applicable.txt");
  const notApplicableCsv = path.join(tempDir, "attachment-reconciliation-not-applicable.csv");
  const notApplicableSummary = path.join(tempDir, "attachment-reconciliation-not-applicable-summary.json");
  const emptyUploadDir = path.join(tempDir, "empty-uploads");
  const mismatchRecord = path.join(tempDir, "release-record-mismatch.txt");

  mkdirSync(uploadDir);
  writeFileSync(path.join(uploadDir, "abcdefghijklmnop.pdf"), "x");
  const validCsvBody = createCsv("report_only");
  writeFileSync(validCsv, validCsvBody);
  const validSummaryBody = await buildAttachmentReconciliationSummary(uploadDir, validCsvBody);
  writeFileSync(validSummary, JSON.stringify(validSummaryBody));
  const validRecordBody = createRecord(validCsvBody, validSummaryBody.summaryHash);
  writeFileSync(validRecord, validRecordBody);
  writeFileSync(invalidSecretRecord, `${validRecordBody}\nleaked: DATABASE_URL=postgresql://user:pass@db:5432/prod\n`);
  writeFileSync(invalidEnumRecord, createRecordFromBody(createRecordBody().replace("migrationApplied: yes", "migrationApplied: maybe"), validCsvBody, validSummaryBody.summaryHash));
  writeFileSync(invalidRunnerRecord, createRecordFromBody(createRecordBody().replace("migrationRunner: controlled_release_workdir", "migrationRunner: not-applicable"), validCsvBody, validSummaryBody.summaryHash));
  writeFileSync(invalidBundleHashRecord, validRecordBody.replace(/releaseEvidenceBundleHash: sha256:[a-f0-9]{64}/i, `releaseEvidenceBundleHash: sha256:${"0".repeat(64)}`));
  writeFileSync(invalidCsv, createCsv("delete"));
  writeFileSync(mismatchCsv, createCsv("report_only", "false"));
  writeFileSync(path.join(uploadDir, "qrstuvwxyzABCDEF.png"), "orphan");
  const mismatchSummaryBody = await buildAttachmentReconciliationSummary(uploadDir, validCsvBody);
  writeFileSync(mismatchSummary, JSON.stringify(mismatchSummaryBody));
  writeFileSync(mismatchRecord, createRecordFromBody(createRecordBody().replace("attachmentHashMatched: yes", "attachmentHashMatched: no"), validCsvBody, mismatchSummaryBody.summaryHash, "mismatch"));

  mkdirSync(emptyUploadDir);
  const headerOnlyCsv = `${validCsvBody.split("\n")[0]}\n`;
  const notApplicableSummaryBody = await buildAttachmentReconciliationSummary(emptyUploadDir, headerOnlyCsv);
  writeFileSync(notApplicableCsv, headerOnlyCsv);
  writeFileSync(notApplicableSummary, JSON.stringify(notApplicableSummaryBody));
  writeFileSync(notApplicableRecord, createRecordFromBody(createRecordBody().replace("attachmentHashMatched: yes", "attachmentHashMatched: not-applicable"), headerOnlyCsv, notApplicableSummaryBody.summaryHash));

  assert(resolveReleaseEvidenceValidationArgs(validRecord).length === 3, "release evidence consumers should resolve sibling CSV and summary paths from the record");
  const summaryOnlyRecord = writeFixture(
    tempDir,
    "release-record-summary-only.txt",
    validRecordBody.replace("attachmentReconciliationCsvPath: attachment-reconciliation.csv", "attachmentReconciliationCsvPath: not-copied"),
  );
  assert(resolveReleaseEvidenceValidationArgs(summaryOnlyRecord).length === 1, "summary without CSV must not be shifted into the CLI CSV argument");

  expectExit("valid record, CSV, and bidirectional summary pass", [validRecord, validCsv, validSummary], 0, "releaseEvidenceBundleHash: sha256:");
  expectExit("yes claim without reconciliation summary fails", [validRecord, validCsv], 1);
  expectExit("secret-like values fail", [invalidSecretRecord, validCsv, validSummary], 1);
  expectExit("invalid enum values fail", [invalidEnumRecord, validCsv, validSummary], 1);
  expectExit("missing migration runner fails when migration applied", [invalidRunnerRecord, validCsv, validSummary], 1);
  expectExit("incorrect release evidence bundle hash fails", [invalidBundleHashRecord, validCsv, validSummary], 1);
  expectExit("duplicate fields fail", [writeFixture(tempDir, "release-record-duplicate.txt", `${validRecordBody}releaseTag: v9.9.9\n`), validCsv, validSummary], 1);
  expectExit("unknown fields fail", [writeFixture(tempDir, "release-record-unknown.txt", `${validRecordBody}businessTitle: private note\n`), validCsv, validSummary], 1);
  expectExit("malformed indentation fails", [writeFixture(tempDir, "release-record-indent.txt", validRecordBody.replace("  pnpmCheck: PASS", " pnpmCheck: PASS")), validCsv, validSummary], 1);
  const redactedMetadata = [
    `releaseEvidenceRedactedRecordMode: ${releaseEvidenceRedactedRecordContract.mode}`,
    "releaseEvidenceRedactedRecordCheckedAt: 2026-07-18T12:00:00.000Z",
    `releaseEvidenceRedactedRecordDoesNotProve: ${releaseEvidenceRedactedRecordContract.doesNotProve}`,
    "releaseEvidenceRedactedRecordClosesResidual: no",
    "releaseEvidenceRedactedRecordResidualLedgerUpdated: no",
    `releaseEvidenceRedactedRecordSafetyFacts: ${releaseEvidenceRedactedRecordContract.safetyFacts}`,
    `releaseEvidenceRedactedExportHash: sha256:${"a".repeat(64)}`,
    `releaseEvidenceRedactedUpdateRecordHash: sha256:${"b".repeat(64)}`,
  ].join("\n") + "\n";
  const redactedRecord = writeFixture(tempDir, "release-record-redacted.txt", `${validRecordBody}${redactedMetadata}`);
  expectExit("complete redacted export metadata passes", [redactedRecord, validCsv, validSummary], 0);
  expectExit("redacted export metadata cannot claim residual closure", [
    writeFixture(tempDir, "release-record-redacted-closes.txt", `${validRecordBody}${redactedMetadata.replace("releaseEvidenceRedactedRecordClosesResidual: no", "releaseEvidenceRedactedRecordClosesResidual: yes")}`),
    validCsv,
    validSummary,
  ], 1);
  expectExit("non-report_only reconciliation fails", [validRecord, invalidCsv, validSummary], 1);
  expectExit("CSV mismatch fails a yes claim", [validRecord, mismatchCsv, validSummary], 1);
  expectExit("orphan summary fails a yes claim", [validRecord, validCsv, mismatchSummary], 1);
  expectExit("mismatch summary supports an explicit no claim", [mismatchRecord, validCsv, mismatchSummary], 0);
  expectExit("empty bidirectional evidence supports not-applicable", [notApplicableRecord, notApplicableCsv, notApplicableSummary], 0);

  console.log("release evidence validator selftest passed.");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/release-evidence-validate.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected exit ${expectedStatus}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
  if (expectedStdout && !result.stdout.includes(expectedStdout)) {
    console.error(`FAIL ${label}: expected stdout to include ${expectedStdout}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function writeFixture(tempDir: string, name: string, content: string): string {
  const file = path.join(tempDir, name);
  writeFileSync(file, content);
  return file;
}

function createCsv(action: string, matches = "true"): string {
  const hash = "a".repeat(64);
  return [
    "attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action",
    `att1,note1,upload://attachment/abcdefghijklmnop.pdf,${hash},${hash},1,1,true,${matches},${matches},${action}`,
    "",
  ].join("\n");
}

await main();

function createRecord(csv: string, summaryHash: string): string {
  return createRecordFromBody(createRecordBody(), csv, summaryHash);
}

function createRecordFromBody(record: string, csv: string, summaryHash: string, status = "pass"): string {
  const boundRecord = record.replace(
    "followUpTasks: none",
    [
      "attachmentReconciliationCsvPath: attachment-reconciliation.csv",
      `attachmentReconciliationCsvSha256: sha256:${createHash("sha256").update(csv).digest("hex")}`,
      "attachmentReconciliationSummaryPath: attachment-reconciliation-summary.json",
      `attachmentReconciliationSummaryHash: ${summaryHash}`,
      `attachmentReconciliationStatus: ${status}`,
      "followUpTasks: none",
    ].join("\n"),
  );
  const hash = buildReleaseEvidenceBundleHash(parseIndentedKeyValueRecord(boundRecord));
  return boundRecord.replace("followUpTasks: none", `releaseEvidenceBundleHash: ${hash}\nfollowUpTasks: none`);
}

function createRecordBody(): string {
  return [
    "releaseId: rel-20260708-001",
    "releasedAt: 2026-07-08T10:00:00+08:00",
    "operator: areasong",
    "gitCommit: 0123456789abcdef0123456789abcdef01234567",
    "releaseTag: v1.0.0",
    "AREAFORGE_IMAGE: areaforge-web:1.0.0",
    "imageDigest: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "composeHash: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "nginxConfigHash: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "previousImage: areaforge-web:0.9.0",
    "previousAppVersion: 0.9.0",
    "databaseBackupPath: /backups/db.dump",
    "databaseBackupSha256: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "uploadsBackupPath: /backups/uploads.tar.gz",
    "uploadsBackupSha256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "envBackupPath: /backups/env.age",
    "envBackupSha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "composeConfigBackupPath: /backups/docker-compose.prod.yml",
    "nginxConfigBackupPath: /backups/forge.areasong.top.conf",
    "migrationVersion: 20260708010000",
    "migrationApplied: yes",
    "migrationRunner: controlled_release_workdir",
    "preflight:",
    "  pnpmCheck: PASS",
    "  composeConfig: PASS",
    "  prodComposeConfig: PASS",
    "restoreDrill:",
    "  databaseImported: yes",
    "  uploadsRestored: yes",
    "  attachmentHashMatched: yes",
    "postReleaseSmoke:",
    "  health: PASS",
    "  login: PASS",
    "  dashboard: PASS",
    "  taskTimerReview: PASS",
    "  syllabusNotesAnalyticsReports: PASS",
    "  attachmentSmoke: PASS",
    "  aiFallbackOrProvider: PASS",
    "rollbackDecision: not needed",
    "rollbackPlan: switch AREAFORGE_IMAGE back to previousImage and restart web",
    "rollbackDrillResult: command path rehearsed without touching production data",
    "rollbackDurationMinutes: 0",
    "databaseRestoreRequired: no",
    "uploadsRestoreRequired: no",
    "rollbackFailureReason: none",
    "residualRisk: none for this rehearsal",
    "followUpTasks: none",
    "expectedFailureOrStopConditions:",
    "  migrationFailed: stop",
    "  smokeFailed: rollback",
    "  logLeakDetected: stop",
    "  attachmentHashMismatch: stop",
    "  backupMissing: stop",
    "",
  ].join("\n");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
