import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEvidenceHash, parseIndentedKeyValueRecord } from "./record-validator-common";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-restore-drill-"));

try {
  const validRecord = path.join(tempDir, "restore-drill-record.txt");
  const invalidProductionRecord = path.join(tempDir, "restore-drill-production.txt");
  const invalidDeleteRecord = path.join(tempDir, "restore-drill-delete.txt");
  const invalidResidualRecord = path.join(tempDir, "restore-drill-residual.txt");
  const invalidEvidenceHashRecord = path.join(tempDir, "restore-drill-hash.txt");
  const incompleteRestoreRecord = path.join(tempDir, "restore-drill-incomplete.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidProductionRecord, createRecord().replace("environment: temporary", "environment: production"));
  writeFileSync(invalidDeleteRecord, createRecord().replace("backupDeleted: no", "backupDeleted: yes"));
  writeFileSync(invalidResidualRecord, createRecord()
    .replace("databaseRestoreResult: PASS", "databaseRestoreResult: FAIL")
    .replace("residualRiskIds: none", "residualRiskIds: none"));
  writeFileSync(invalidEvidenceHashRecord, createRecord().replace("operator: areasong", "operator: changed-after-hash"));
  writeFileSync(incompleteRestoreRecord, withEvidenceHash(createRecordWithoutHash().replace("uploadsRestoreResult: PASS", "uploadsRestoreResult: not-applicable")));

  expectExit("valid restore drill record passes", [validRecord], 0, "restoreDrillRecordEvidenceHash: sha256:");
  expectExit("production restore misuse fails", [invalidProductionRecord], 1);
  expectExit("backup deletion fails", [invalidDeleteRecord], 1);
  expectExit("failed drill without residual fails", [invalidResidualRecord], 1);
  expectExit("record changed after evidence hash fails", [invalidEvidenceHashRecord], 1);
  expectExit("incomplete restore result cannot claim success", [incompleteRestoreRecord], 1);

  console.log("restore drill validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/restore-drill-validate.ts", ...args], {
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

function createRecord(): string {
  return withEvidenceHash(createRecordWithoutHash());
}

function createRecordWithoutHash(): string {
  return [
    "drillId: restore-drill-20260710",
    "drilledAt: 2026-07-10T21:30:00+08:00",
    "operator: areasong",
    "environment: temporary",
    "scope: monthly",
    "sourceBackupVersion: v0.1.5",
    "databaseBackupHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "uploadsBackupHash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "envConfigBackupHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "restoreTarget: temporary postgres and temporary upload directory",
    "restoreCommandSummary: restored redacted backup copies into temporary environment only",
    "databaseRestoreResult: PASS",
    "uploadsRestoreResult: PASS",
    "attachmentHashMatched: PASS",
    "homeReadResult: PASS",
    "loginResult: PASS",
    "appHealthAfterRestore: PASS",
    "rollbackDecision: not-needed",
    "drillEvidenceHash: HASH_PLACEHOLDER",
    "residualRiskIds: none",
    "followUpTasks: none",
    "safetyFacts:",
    "  productionRestoreAttempted: no",
    "  productionWriteAttempted: no",
    "  destructiveActionAttempted: no",
    "  serverCommandAttempted: no",
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "  backupDeleted: no",
    "  uploadDeleted: no",
    "",
  ].join("\n");
}

function withEvidenceHash(record: string): string {
  const fields = parseIndentedKeyValueRecord(record);
  const keys = [...fields.keys()].filter((key) => key !== "drillEvidenceHash" && fields.get(key) !== "");
  const hash = buildEvidenceHash(fields, keys);
  return record.replace("HASH_PLACEHOLDER", hash);
}
