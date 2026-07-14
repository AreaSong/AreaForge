import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-residual-closure-review-"));

try {
  const validCloseRecord = path.join(tempDir, "valid-close.txt");
  const validKeepOpenRecord = path.join(tempDir, "valid-keep-open.txt");
  const invalidUnsafeUriRecord = path.join(tempDir, "invalid-unsafe-uri.txt");
  const invalidDoesNotProveRecord = path.join(tempDir, "invalid-does-not-prove.txt");
  const invalidSafetyRecord = path.join(tempDir, "invalid-safety.txt");
  const invalidDecisionRecord = path.join(tempDir, "invalid-decision.txt");
  const invalidSecretRecord = path.join(tempDir, "invalid-secret.txt");

  writeFileSync(validCloseRecord, createRecord());
  writeFileSync(validKeepOpenRecord, createRecord()
    .replace("reviewDecision: close", "reviewDecision: keep-open")
    .replace("residualLedgerAction: requires-separate-ledger-update", "residualLedgerAction: none")
    .replace("result: ready-for-ledger-update", "result: keep-open"));
  writeFileSync(invalidUnsafeUriRecord, createRecord()
    .replace("evidenceUris: docs/development/release-supply-chain-v0.1.7.md, docs/development/release-v0.1.7-record.md", "evidenceUris: /etc/areaforge/updater.env"));
  writeFileSync(invalidDoesNotProveRecord, createRecord()
    .replace("doesNotProve: residual ledger closure, production health, updater apply, backup/restore, migration, rollback, secret disclosure absence beyond validator scan", "doesNotProve: none"));
  writeFileSync(invalidSafetyRecord, createRecord()
    .replace("  residualLedgerUpdated: no", "  residualLedgerUpdated: yes"));
  writeFileSync(invalidDecisionRecord, createRecord()
    .replace("residualLedgerAction: requires-separate-ledger-update", "residualLedgerAction: none"));
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: GITHUB_TOKEN=abcdef1234567890abcdef1234567890\n`);

  expectExit("valid close review passes", validCloseRecord, 0, "residualClosureReviewEvidenceHash: sha256:");
  expectExit("valid keep-open review passes", validKeepOpenRecord, 0);
  expectExit("unsafe evidence URI fails", invalidUnsafeUriRecord, 1);
  expectExit("missing does-not-prove terms fails", invalidDoesNotProveRecord, 1);
  expectExit("residual ledger update safety flag fails", invalidSafetyRecord, 1);
  expectExit("close decision without separate ledger action fails", invalidDecisionRecord, 1);
  expectExit("secret-like values fail", invalidSecretRecord, 1);

  console.log("residual closure review validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, recordPath: string, expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/residual-closure-review-validate.ts", recordPath], {
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
    "recordId: residual-review-AF-RISK-SC-001-20260713",
    "reviewedAt: 2026-07-13T12:00:00+08:00",
    "reviewer: AreaForge maintainer",
    "residualRiskId: AF-RISK-SC-001",
    "currentResidualType: deferred-work",
    "reviewDecision: close",
    "decisionRationale: Signed release supply-chain evidence reached ready review state and maintainer recorded the decision boundary.",
    "evidenceUris: docs/development/release-supply-chain-v0.1.7.md, docs/development/release-v0.1.7-record.md",
    "validatorCommands: pnpm release:supply-chain:validate docs/development/release-supply-chain-v0.1.7.md <release-assets-dir>, AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-v0.1.7.md pnpm sc:sc-002:preflight",
    "validatorSummary: ready_for_sc001_sc002_review and release supply-chain validation pass; release evidence still has separate backup hash blockers",
    "reopenConditions: new release, stale evidence, workflow or signing policy change, validation failure, production version change",
    "doesNotProve: residual ledger closure, production health, updater apply, backup/restore, migration, rollback, secret disclosure absence beyond validator scan",
    "residualLedgerAction: requires-separate-ledger-update",
    "closesResidual: no",
    "result: ready-for-ledger-update",
    "safetyFacts:",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  updaterApplyAttempted: no",
    "  rollbackAttempted: no",
    "  releaseCreated: no",
    "  secretValuePrinted: no",
    "  residualLedgerUpdated: no",
    "",
  ].join("\n");
}
