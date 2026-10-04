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
  const invalidStatusRecord = path.join(tempDir, "maintenance-window-status.txt");
  const invalidFreshnessPassRecord = path.join(tempDir, "maintenance-window-freshness-pass.txt");
  const invalidFreshnessTimestampRecord = path.join(tempDir, "maintenance-window-freshness-timestamp.txt");
  const invalidFreshnessMaxAgeRecord = path.join(tempDir, "maintenance-window-freshness-max-age.txt");
  const invalidClaimBoundaryRecord = path.join(tempDir, "maintenance-window-claim-boundary.txt");
  const invalidSecretRecord = path.join(tempDir, "maintenance-window-secret.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidCommandRecord, createRecord().replace("pnpm residuals:review-due", "pnpm docs:readiness"));
  writeFileSync(invalidSafetyRecord, createRecord().replace("updaterApplyAttempted: no", "updaterApplyAttempted: yes"));
  writeFileSync(invalidStatusRecord, createRecord().replace("readinessOverall: warn", "readinessOverall: maybe"));
  writeFileSync(invalidFreshnessPassRecord, createRecord().replace("result: warn", "result: pass"));
  writeFileSync(invalidFreshnessTimestampRecord, createRecord().replace("latestEvidenceCheckedAt: 2026-07-10T13:45:00.000Z", "latestEvidenceCheckedAt: not-a-date"));
  writeFileSync(invalidFreshnessMaxAgeRecord, createRecord().replace("evidenceFreshnessMaxAgeSeconds: 1209600", "evidenceFreshnessMaxAgeSeconds: 12.5"));
  writeFileSync(invalidClaimBoundaryRecord, createRecord().replace([
    "claimBoundary:",
    "  doesNotProve: production health without live evidence, updater apply completion, backup/restore execution, migration execution, rollback execution, residual risk closure",
  ].join("\n"), ""));
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: AUTH_SESSION_SECRET=super-secret\n`);

  expectExit("valid maintenance window record passes", [validRecord], 0, "maintenanceWindowRecordEvidenceHash: sha256:");
  expectExit("missing residual command fails", [invalidCommandRecord], 1);
  expectExit("updater apply in maintenance window fails", [invalidSafetyRecord], 1);
  expectExit("invalid status summary fails", [invalidStatusRecord], 1);
  expectExit("pass result with unknown freshness fails", [invalidFreshnessPassRecord], 1);
  expectExit("invalid latest evidence timestamp fails", [invalidFreshnessTimestampRecord], 1);
  expectExit("fractional freshness max age fails", [invalidFreshnessMaxAgeRecord], 1);
  expectExit("missing claim boundary fails", [invalidClaimBoundaryRecord], 1);
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
    "readinessOverall: warn",
    "evidenceBundleStatus: needs_attention",
    "alertPreviewStatus: warning",
    "healthStatus: pass",
    "updateAgentStatus: unknown",
    "authenticatedSmokeStatus: warn",
    "backupStatus: unknown",
    "infrastructureStatus: pass",
    "readinessSummaryHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "evidenceBundleHash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "alertPreviewHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "residualReviewHash: sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "evidenceFreshnessStatus: unknown",
    "evidenceFreshnessMaxAgeSeconds: 1209600",
    "latestEvidenceCheckedAt: 2026-07-10T13:45:00.000Z",
    "residualReviewStatus: warn",
    "dueResidualRiskIds: AF-RISK-OPS-001,AF-RISK-SC-002,AF-RISK-UX-001",
    "claimBoundary:",
    "  doesNotProve: production health without live evidence, updater apply completion, backup/restore execution, migration execution, rollback execution, residual risk closure",
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
