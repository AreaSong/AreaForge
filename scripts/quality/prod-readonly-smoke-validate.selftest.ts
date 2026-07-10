import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-prod-readonly-smoke-"));

try {
  const validRecord = path.join(tempDir, "prod-readonly-smoke.txt");
  const invalidSecretRecord = path.join(tempDir, "prod-readonly-smoke-secret.txt");
  const invalidMissingCheckRecord = path.join(tempDir, "prod-readonly-smoke-missing-check.txt");
  const invalidWriteRecord = path.join(tempDir, "prod-readonly-smoke-write.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: AREAFORGE_SMOKE_PASSWORD=super-secret-value\n`);
  writeFileSync(invalidMissingCheckRecord, createRecord().replace(",update-status", ""));
  writeFileSync(invalidWriteRecord, createRecord().replace("productionWriteAttempted: no", "productionWriteAttempted: yes"));

  expectExit("valid production readonly smoke record passes", [validRecord], 0, "prodReadonlySmokeEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("missing required smoke check fails", [invalidMissingCheckRecord], 1);
  expectExit("production write safety violation fails", [invalidWriteRecord], 1);

  console.log("production readonly smoke validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/prod-readonly-smoke-validate.ts", ...args], {
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
  return [
    "recordId: prod-readonly-smoke-20260710",
    "checkedAt: 2026-07-10T22:20:00+08:00",
    "environment: production",
    "baseUrl: https://forge.areasong.top",
    "expectedVersion: 0.1.5",
    "releaseTag: v0.1.5",
    "webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "migrationImageDigest: ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "smokeCommand: pnpm smoke:prod-readonly",
    "smokeStatus: pass",
    "smokeResultHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "checks: health,login,auth/me,dashboard,notes,syllabus,analytics,reports,long-term-risks,update-status",
    "smokePasswordSource: AREAFORGE_SMOKE_PASSWORD_FILE=<redacted path>",
    "smokePasswordReadFromFile: yes",
    "updateStatusIncluded: yes",
    "updaterEnvSummary: AREAFORGE_EXTRA_SMOKE_COMMAND configured and password file path redacted",
    "updateRecordSummary: update-record hash sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "residualRiskIds: AF-RISK-OPS-001",
    "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  productionWriteAttempted: no",
    "  secretValuePrinted: no",
    "  passwordValuePrinted: no",
    "  writeSmokeAttempted: no",
    "",
  ].join("\n");
}
