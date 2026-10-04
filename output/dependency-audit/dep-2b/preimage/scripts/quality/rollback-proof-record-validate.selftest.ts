import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-rollback-proof-"));

try {
  const valid = write("valid.txt", record());
  const noSmoke = write("no-smoke.txt", record().replace("postRollbackAuthenticatedSmoke: pass", "postRollbackAuthenticatedSmoke: fail"));
  const autoApply = write("auto-apply.txt", record().replace("autoApplyPolicy: none", "autoApplyPolicy: patch"));
  const recordsDeleted = write("records-deleted.txt", record().replace("historicalRecordsPreserved: yes", "historicalRecordsPreserved: no"));
  const unsafe = write("unsafe.txt", `${record()}\nleak: DATABASE_URL=postgresql://user:pass@example/db\n`);
  const keepClosed = write("keep-closed.txt", record()
    .replace("reopenDecision: ready-for-human-review", "reopenDecision: keep-closed")
    .replace("postRollbackAuthenticatedSmoke: pass", "postRollbackAuthenticatedSmoke: fail")
    .replace("autoApplyPolicy: none", "autoApplyPolicy: patch"));

  expect("valid rollback proof", valid, 0, "rollbackProofEvidenceHash: sha256:");
  expect("failed smoke blocks reopen review", noSmoke, 1);
  expect("auto apply blocks reopen review", autoApply, 1);
  expect("deleted history blocks reopen review", recordsDeleted, 1);
  expect("secret-like content fails", unsafe, 1);
  expect("keep-closed may preserve failed signals", keepClosed, 0);
  console.log("rollback proof record validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function write(name: string, value: string): string {
  const target = path.join(tempDir, name);
  writeFileSync(target, value);
  return target;
}

function expect(label: string, recordPath: string, expected: number, stdoutToken?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/rollback-proof-record-validate.ts", recordPath], { cwd: root, encoding: "utf8" });
  if (result.status !== expected || (stdoutToken && !result.stdout.includes(stdoutToken))) {
    console.error(`FAIL ${label}: expected ${expected}, got ${String(result.status)}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function record(): string {
  return [
    "rollbackProofId: rollback-proof-v0.1.7-to-v0.1.5-20260713",
    "recordedAt: 2026-07-13T06:00:00Z",
    "rollbackStartedAt: 2026-07-13T05:55:00Z",
    "rollbackFinishedAt: 2026-07-13T05:59:00Z",
    "operator: areasong",
    "environment: production",
    "evidenceClass: production",
    "rollbackSource: updater",
    "highRiskConfirmation: yes",
    "sourceVersion: 0.1.7",
    `sourceImage: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`,
    "targetVersion: 0.1.5",
    `targetImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:${"b".repeat(64)}`,
    `sourceUpdateRecordHash: sha256:${"c".repeat(64)}`,
    `rollbackOperationRecordHash: sha256:${"d".repeat(64)}`,
    `postRollbackUpdateRecordHash: sha256:${"e".repeat(64)}`,
    `postRollbackEvidenceBundleHash: sha256:${"f".repeat(64)}`,
    `postRollbackSmokeRecordHash: sha256:${"1".repeat(64)}`,
    "postRollbackHealth: pass",
    "postRollbackAuthenticatedSmoke: pass",
    "databaseAccessible: pass",
    "uploadsAccessible: pass",
    "attachmentAccess: pass",
    "autoApplyPolicy: none",
    "updateAgentBlocker: none",
    "historicalRecordsPreserved: yes",
    "databaseRestoreAttempted: no",
    "uploadsRestoreAttempted: no",
    "rollbackDurationMinutes: 4",
    "reopenDecision: ready-for-human-review",
    "reopenConditions: signed target release, current backups, passing authenticated smoke, and explicit maintainer approval",
    "residualRiskIds: AF-RISK-OPS-001",
    "doesNotProve: future production health, production restore readiness, residual risk closure, automatic update-channel reopen",
    "safetyFacts:",
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "  residualLedgerUpdated: no",
    "  updateChannelReopened: no",
    "",
  ].join("\n");
}
