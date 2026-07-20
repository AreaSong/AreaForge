import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-incident-record-"));

try {
  const validRecord = path.join(tempDir, "incident-record.txt");
  const invalidSecretRecord = path.join(tempDir, "incident-secret.txt");
  const invalidConfirmationRecord = path.join(tempDir, "incident-confirmation.txt");
  const invalidResidualRecord = path.join(tempDir, "incident-residual.txt");
  const invalidTimezoneRecord = path.join(tempDir, "incident-timezone.txt");
  const invalidResidualIdRecord = path.join(tempDir, "incident-residual-id.txt");
  const invalidFollowUpRecord = path.join(tempDir, "incident-follow-up.txt");
  const unknownResidualRecord = path.join(tempDir, "incident-unknown-residual.txt");
  const closedResidualRecord = path.join(tempDir, "incident-closed-residual.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: DATABASE_URL=postgresql://user:pass@example/db\n`);
  writeFileSync(invalidConfirmationRecord, createRecord()
    .replace("highRiskConfirmation: yes", "highRiskConfirmation: no"));
  writeFileSync(invalidResidualRecord, createRecord()
    .replace("status: mitigated", "status: open")
    .replace("residualRiskIds: AF-RISK-OPS-004", "residualRiskIds: none"));
  writeFileSync(invalidTimezoneRecord, createRecord().replace("detectedAt: 2026-07-10T21:30:00+08:00", "detectedAt: 2026-07-10T21:30:00"));
  writeFileSync(invalidResidualIdRecord, createRecord().replace("residualRiskIds: AF-RISK-OPS-004", "residualRiskIds: AF-RISK-OPS-004, typo-risk-id"));
  writeFileSync(invalidFollowUpRecord, createRecord().replace("followUpTasks: tasks/indexes/residuals.md", "followUpTasks: private operator notes"));
  writeFileSync(unknownResidualRecord, createRecord().replace("AF-RISK-OPS-004", "AF-RISK-OPS-999"));
  writeFileSync(closedResidualRecord, createRecord().replace("AF-RISK-OPS-004", "AF-RISK-SC-003"));

  expectExit("valid incident record passes", [validRecord], 0, "incidentRecordEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("missing high-risk confirmation fails", [invalidConfirmationRecord], 1);
  expectExit("unresolved incident without residual fails", [invalidResidualRecord], 1);
  expectExit("timestamp without timezone fails", [invalidTimezoneRecord], 1);
  expectExit("partial invalid residual id list fails", [invalidResidualIdRecord], 1);
  expectExit("free-text follow-up fails", [invalidFollowUpRecord], 1);
  expectExit("unknown residual id fails", [unknownResidualRecord], 1);
  expectExit("active incident cannot bind only closed evidence", [closedResidualRecord], 1);

  console.log("incident record validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/incident-record-validate.ts", ...args], {
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
    "incidentId: incident-20260710-update-agent",
    "detectedAt: 2026-07-10T21:30:00+08:00",
    "recordedAt: 2026-07-10T22:10:00+08:00",
    "operator: areasong",
    "environment: production",
    "severity: p2",
    "status: mitigated",
    "incidentType: update",
    "source: pnpm ops:evidence:bundle plus operator observation",
    "evidenceClass: production",
    "publicHealthStatus: pass",
    "userImpact: update request blocked while public app stayed healthy",
    "containmentAction: held updater apply and preserved current release",
    "recoveryAction: cleared stale request after confirmation and verified health",
    "rollbackDecision: not-needed",
    "readinessSummaryHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "evidenceBundleHash: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "alertPreviewHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "highRiskConfirmation: yes",
    "residualRiskIds: AF-RISK-OPS-004",
    "followUpTasks: tasks/indexes/residuals.md",
    "postIncidentReview: no",
    "safetyFacts:",
    "  productionWriteAttempted: yes",
    "  serverCommandAttempted: yes",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  updaterApplyAttempted: no",
    "  rollbackAttempted: no",
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "",
  ].join("\n");
}
