import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-alert-drill-"));

try {
  const validRecord = path.join(tempDir, "alert-drill-record.txt");
  const invalidSecretRecord = path.join(tempDir, "alert-drill-secret.txt");
  const invalidGithubTokenRecord = path.join(tempDir, "alert-drill-github-token.txt");
  const invalidReceiverRecord = path.join(tempDir, "alert-drill-receiver.txt");
  const invalidResidualRecord = path.join(tempDir, "alert-drill-residual.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: AI_API_KEY=sk-testtesttesttesttest\n`);
  writeFileSync(invalidGithubTokenRecord, `${createRecord()}\nleaked: github_pat_testtesttesttesttest\n`);
  writeFileSync(invalidReceiverRecord, createRecord().replace("receiverConfigured: yes", "receiverConfigured: no"));
  writeFileSync(invalidResidualRecord, createRecord().replace("residualRiskIds: AF-RISK-OPS-004", "residualRiskIds: none"));

  expectExit("valid alert drill record passes", [validRecord], 0, "alertDrillEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("GitHub token-like values fail", [invalidGithubTokenRecord], 1);
  expectExit("unconfigured receiver fails", [invalidReceiverRecord], 1);
  expectExit("missing OPS-004 residual fails", [invalidResidualRecord], 1);

  console.log("alert drill validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/alert-drill-validate.ts", ...args], {
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
    "drillId: alert-drill-20260710",
    "drilledAt: 2026-07-10T21:30:00+08:00",
    "operator: areasong",
    "environment: production",
    "scope: daily",
    "scenario: backup_stale",
    "alertPreviewCommand: pnpm ops:alert:preview",
    "alertPreviewStatus: warning",
    "alertPreviewWouldNotify: yes",
    "alertPreviewEvidenceHash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "alertReceiverType: manual-window",
    "receiverConfigured: yes",
    "receiverAck: yes",
    "detectionResult: PASS",
    "recoveryResult: PASS",
    "recoveryAction: operator acknowledged stale backup warning and recorded next backup check",
    "residualRiskIds: AF-RISK-OPS-004",
    "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:",
    "  notificationSent: no",
    "  externalAlertReceiverCalled: no",
    "  serverCommandAttempted: no",
    "  productionWriteAttempted: no",
    "  secretValuePrinted: no",
    "",
  ].join("\n");
}
