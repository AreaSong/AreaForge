import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-completion-evidence-"));
const headCommit = gitHead();

try {
  const validRecord = path.join(tempDir, "completion-evidence.txt");
  const invalidSecretRecord = path.join(tempDir, "completion-secret.txt");
  const invalidPassBlockerRecord = path.join(tempDir, "completion-pass-blocker.txt");
  const invalidHighRiskRecord = path.join(tempDir, "completion-high-risk.txt");
  const invalidProductionRecord = path.join(tempDir, "completion-production.txt");
  const invalidUnverifiedReasonRecord = path.join(tempDir, "completion-unverified-reason.txt");
  const invalidResidualListRecord = path.join(tempDir, "completion-residual-list.txt");
  const invalidHighRiskBoundaryRecord = path.join(tempDir, "completion-high-risk-boundary.txt");
  const invalidDocsOnlyReleaseRecord = path.join(tempDir, "completion-docs-only-release.txt");
  const invalidTimestampRecord = path.join(tempDir, "completion-timestamp.txt");
  const invalidEvidenceUriRecord = path.join(tempDir, "completion-evidence-uri.txt");
  const invalidClaimScopeRecord = path.join(tempDir, "completion-claim-scope.txt");
  const invalidDoesNotProveRecord = path.join(tempDir, "completion-does-not-prove.txt");
  const invalidMissingEvidenceRecord = path.join(tempDir, "completion-missing-evidence.txt");
  const invalidSourceCommitRecord = path.join(tempDir, "completion-source-commit.txt");

  writeFileSync(validRecord, createRecord(headCommit));
  writeFileSync(invalidSecretRecord, `${createRecord(headCommit)}\nleaked: DATABASE_URL=postgresql://user:pass@example/db\n`);
  writeFileSync(invalidPassBlockerRecord, createRecord(headCommit).replace("product: none", "product: unresolved dashboard blocker"));
  writeFileSync(invalidHighRiskRecord, createRecord(headCommit)
    .replace("highestRuntimeWriteBoundary: R0", "highestRuntimeWriteBoundary: R4")
    .replace("highRiskConfirmation: not-applicable", "highRiskConfirmation: no"));
  writeFileSync(invalidProductionRecord, createRecord(headCommit)
    .replace("evidenceClass: docs-only", "evidenceClass: production"));
  writeFileSync(invalidUnverifiedReasonRecord, createRecord(headCommit)
    .replace("  reason: not-applicable", "  reason: skipped production smoke"));
  writeFileSync(invalidResidualListRecord, createRecord(headCommit)
    .replace("residualRiskIds: none", "residualRiskIds: AF-RISK-OPS-001 plus more text"));
  writeFileSync(invalidHighRiskBoundaryRecord, createRecord(headCommit)
    .replace("  migrationAttempted: no", "  migrationAttempted: yes")
    .replace("highRiskConfirmation: not-applicable", "highRiskConfirmation: yes"));
  writeFileSync(invalidDocsOnlyReleaseRecord, createRecord(headCommit)
    .replace("  releaseCreated: no", "  releaseCreated: yes")
    .replace("highRiskConfirmation: not-applicable", "highRiskConfirmation: yes"));
  writeFileSync(invalidTimestampRecord, createRecord(headCommit)
    .replace("  checkedAt: 2026-07-11T06:30:00+08:00", "  checkedAt: 2026-07-11"));
  writeFileSync(invalidEvidenceUriRecord, createRecord(headCommit)
    .replace("evidenceUri: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md", "evidenceUri: /etc/areaforge/updater.env"));
  writeFileSync(invalidClaimScopeRecord, createRecord(headCommit)
    .replace("claimScope: source-only", "claimScope: production-live"));
  writeFileSync(invalidDoesNotProveRecord, createRecord(headCommit)
    .replace("doesNotProve: production health, runtime behavior, Release artifact trust, long-term live gates", "doesNotProve: none"));
  writeFileSync(invalidMissingEvidenceRecord, createRecord(headCommit)
    .replace("docs/development/validation-matrix.md", "docs/development/does-not-exist.md"));
  writeFileSync(invalidSourceCommitRecord, createRecord("ffffffffffffffffffffffffffffffffffffffff"));

  expectExit("valid completion evidence record passes", [validRecord], 0, "completionEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("PASS with blocker fails", [invalidPassBlockerRecord], 1);
  expectExit("R4 without confirmation fails", [invalidHighRiskRecord], 1);
  expectExit("production evidence without productionTouched fails", [invalidProductionRecord], 1);
  expectExit("PASS with unverified reason fails", [invalidUnverifiedReasonRecord], 1);
  expectExit("residual list with extra text fails", [invalidResidualListRecord], 1);
  expectExit("high-risk flag without R4 fails", [invalidHighRiskBoundaryRecord], 1);
  expectExit("docs-only with release action fails", [invalidDocsOnlyReleaseRecord], 1);
  expectExit("date-only checkedAt fails", [invalidTimestampRecord], 1);
  expectExit("unsafe evidence URI fails", [invalidEvidenceUriRecord], 1);
  expectExit("claim scope mismatch fails", [invalidClaimScopeRecord], 1);
  expectExit("empty does-not-prove boundary fails", [invalidDoesNotProveRecord], 1);
  expectExit("missing repository evidence fails", [invalidMissingEvidenceRecord], 1);
  expectExit("unknown source commit fails", [invalidSourceCommitRecord], 1);

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

function createRecord(sourceCommit: string): string {
  return [
    "scope: docs-only enterprise completion evidence validator",
    "summary: Completion evidence validator docs-only fixture with explicit claim boundary",
    "evidenceClass: docs-only",
    "claimScope: source-only",
    "evidenceUri: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md",
    "sourceBaseline:",
    "  sourceDocs: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md",
    `  sourceHashOrCommit: ${sourceCommit}`,
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
    "doesNotProve: production health, runtime behavior, Release artifact trust, long-term live gates",
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

function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("completion evidence selftest requires a Git checkout");
  return result.stdout.trim();
}
