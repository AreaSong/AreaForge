import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-release-evidence-"));

try {
  const validRecord = path.join(tempDir, "release-record.txt");
  const validCsv = path.join(tempDir, "attachment-reconciliation.csv");
  const invalidSecretRecord = path.join(tempDir, "release-record-secret.txt");
  const invalidEnumRecord = path.join(tempDir, "release-record-enum.txt");
  const invalidCsv = path.join(tempDir, "attachment-reconciliation-invalid.csv");

  writeFileSync(validRecord, createRecord());
  writeFileSync(validCsv, createCsv("report_only"));
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: DATABASE_URL=postgresql://user:pass@db:5432/prod\n`);
  writeFileSync(invalidEnumRecord, createRecord().replace("migrationApplied: yes", "migrationApplied: maybe"));
  writeFileSync(invalidCsv, createCsv("delete"));

  expectExit("valid record and report_only CSV pass", [validRecord, validCsv], 0);
  expectExit("secret-like values fail", [invalidSecretRecord, validCsv], 1);
  expectExit("invalid enum values fail", [invalidEnumRecord, validCsv], 1);
  expectExit("non-report_only reconciliation fails", [validRecord, invalidCsv], 1);

  console.log("release evidence validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number): void {
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
}

function createCsv(action: string): string {
  return [
    "attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action",
    `att1,note1,upload://attachment/demo,abc,abc,1,1,true,true,true,${action}`,
    "",
  ].join("\n");
}

function createRecord(): string {
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
    "migrationVersion: 20260708010000",
    "migrationApplied: yes",
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
