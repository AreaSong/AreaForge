import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-maintenance-window-"));

try {
  const validRecord = path.join(tempDir, "maintenance-window-record.txt");
  const invalidCommandRecord = path.join(tempDir, "maintenance-window-command.txt");
  const invalidSafetyRecord = path.join(tempDir, "maintenance-window-safety.txt");
  const invalidSecretRecord = path.join(tempDir, "maintenance-window-secret.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidCommandRecord, createRecord().replace("pnpm residuals:review-due", "pnpm docs:readiness"));
  writeFileSync(invalidSafetyRecord, createRecord().replace("updaterApplyAttempted: no", "updaterApplyAttempted: yes"));
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: AUTH_SESSION_SECRET=super-secret\n`);

  expectExit("valid maintenance window record passes", [validRecord], 0, "maintenanceWindowRecordEvidenceHash: sha256:");
  expectExit("missing residual command fails", [invalidCommandRecord], 1);
  expectExit("updater apply in maintenance window fails", [invalidSafetyRecord], 1);
  expectExit("secret-like value fails", [invalidSecretRecord], 1);

  console.log("maintenance window validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/maintenance-window-record-validate.ts", ...args], {
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
    "windowId: maintenance-window-20260710-weekly",
    "startedAt: 2026-07-10T21:30:00+08:00",
    "finishedAt: 2026-07-10T21:45:00+08:00",
    "operator: areasong",
    "cadence: weekly",
    "environment: production",
    "commandsRun: pnpm enterprise:operability:preflight, pnpm maintenance:cadence:preflight, pnpm residuals:review-due, pnpm ops:readiness:summary, pnpm ops:evidence:bundle, pnpm ops:alert:preview",
    "readinessSummaryHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "evidenceBundleHash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "alertPreviewHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "residualReviewHash: sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "residualReviewStatus: warn",
    "dueResidualRiskIds: AF-RISK-OPS-001,AF-RISK-SC-002,AF-RISK-UX-001",
    "decisions: no production write; keep residuals under review",
    "followUpTasks: tasks/indexes/residuals.md",
    "result: warn",
    "residualRiskIds: AF-RISK-OPS-001,AF-RISK-SC-002,AF-RISK-UX-001",
    "safetyFacts:",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  updaterApplyAttempted: no",
    "  rollbackAttempted: no",
    "  secretValuePrinted: no",
    "",
  ].join("\n");
}
