import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-completion-evidence-"));

try {
  const validRecord = path.join(tempDir, "completion-evidence.txt");
  const invalidSecretRecord = path.join(tempDir, "completion-secret.txt");
  const invalidPassBlockerRecord = path.join(tempDir, "completion-pass-blocker.txt");
  const invalidHighRiskRecord = path.join(tempDir, "completion-high-risk.txt");
  const invalidProductionRecord = path.join(tempDir, "completion-production.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: DATABASE_URL=postgresql://user:pass@example/db\n`);
  writeFileSync(invalidPassBlockerRecord, createRecord().replace("product: none", "product: unresolved dashboard blocker"));
  writeFileSync(invalidHighRiskRecord, createRecord()
    .replace("highestRuntimeWriteBoundary: R0", "highestRuntimeWriteBoundary: R4")
    .replace("highRiskConfirmation: not-applicable", "highRiskConfirmation: no"));
  writeFileSync(invalidProductionRecord, createRecord()
    .replace("evidenceClass: docs-only", "evidenceClass: production"));

  expectExit("valid completion evidence record passes", [validRecord], 0, "completionEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("PASS with blocker fails", [invalidPassBlockerRecord], 1);
  expectExit("R4 without confirmation fails", [invalidHighRiskRecord], 1);
  expectExit("production evidence without productionTouched fails", [invalidProductionRecord], 1);

  console.log("completion evidence validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/completion-evidence-validate.ts", ...args], {
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
    "scope: docs-only enterprise completion evidence validator",
    "evidenceClass: docs-only",
    "sourceBaseline:",
    "  sourceDocs: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md",
    "  sourceHashOrCommit: local-working-tree",
    "freshValidation:",
    "  commands: pnpm completion:evidence:selftest, pnpm docs:readiness",
    "  browserOrRuntimeEvidence: not-applicable",
    "  checkedAt: 2026-07-11T06:30:00+08:00",
    "unverified:",
    "  skippedChecks: none",
    "  reason: not-applicable",
    "blockers:",
    "  product: none",
    "  securityPrivacy: none",
    "  dependencySupplyChain: none",
    "  ciRelease: none",
    "  gitCheckpoint: none",
    "residualRiskIds: none",
    "releaseRequired: no",
    "highestRuntimeWriteBoundary: R0",
    "highRiskConfirmation: not-applicable",
    "result: PASS",
    "safetyFacts:",
    "  productionTouched: no",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  updaterApplyAttempted: no",
    "  releaseCreated: no",
    "  secretValuePrinted: no",
    "",
  ].join("\n");
}
