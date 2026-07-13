import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildReleaseEvidenceBundleHash } from "./release-evidence-validate";
import { parseIndentedKeyValueRecord } from "./record-validator-common";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-release-evidence-"));

try {
  const validRecord = path.join(tempDir, "release-record.txt");
  const validCsv = path.join(tempDir, "attachment-reconciliation.csv");
  const invalidSecretRecord = path.join(tempDir, "release-record-secret.txt");
  const invalidEnumRecord = path.join(tempDir, "release-record-enum.txt");
  const invalidRunnerRecord = path.join(tempDir, "release-record-runner.txt");
  const invalidBundleHashRecord = path.join(tempDir, "release-record-bundle-hash.txt");
  const invalidCsv = path.join(tempDir, "attachment-reconciliation-invalid.csv");

  writeFileSync(validRecord, createRecord());
  writeFileSync(validCsv, createCsv("report_only"));
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: DATABASE_URL=postgresql://user:pass@db:5432/prod\n`);
  writeFileSync(invalidEnumRecord, createRecordFromBody(createRecordBody().replace("migrationApplied: yes", "migrationApplied: maybe")));
  writeFileSync(invalidRunnerRecord, createRecordFromBody(createRecordBody().replace("migrationRunner: controlled_release_workdir", "migrationRunner: not-applicable")));
  writeFileSync(invalidBundleHashRecord, createRecord().replace(/releaseEvidenceBundleHash: sha256:[a-f0-9]{64}/i, `releaseEvidenceBundleHash: sha256:${"0".repeat(64)}`));
  writeFileSync(invalidCsv, createCsv("delete"));

  expectExit("valid record and report_only CSV pass", [validRecord, validCsv], 0, "releaseEvidenceBundleHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord, validCsv], 1);
  expectExit("invalid enum values fail", [invalidEnumRecord, validCsv], 1);
  expectExit("missing migration runner fails when migration applied", [invalidRunnerRecord, validCsv], 1);
  expectExit("incorrect release evidence bundle hash fails", [invalidBundleHashRecord, validCsv], 1);
  expectExit("non-report_only reconciliation fails", [validRecord, invalidCsv], 1);

  console.log("release evidence validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
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

function createCsv(action: string): string {
  return [
    "attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action",
    `att1,note1,upload://attachment/demo,abc,abc,1,1,true,true,true,${action}`,
    "",
  ].join("\n");
}

function createRecord(): string {
  return createRecordFromBody(createRecordBody());
}

function createRecordFromBody(record: string): string {
  const hash = buildReleaseEvidenceBundleHash(parseIndentedKeyValueRecord(record));
  return record.replace("followUpTasks: none", `releaseEvidenceBundleHash: ${hash}\nfollowUpTasks: none`);
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
