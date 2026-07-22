import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildWorktreeValidationFingerprint } from "./worktree-validation-fingerprint";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-completion-evidence-"));
const headCommit = gitHead();
const validationCommands = "pnpm completion:evidence:selftest; pnpm docs:readiness";
const fingerprint = buildWorktreeValidationFingerprint(root, validationCommands, "docs-only");
const inRepoRecord = path.join(root, ".completion-evidence-selftest.tmp");

try {
  const validRecord = path.join(tempDir, "completion-evidence.txt");
  const invalidSecretRecord = path.join(tempDir, "completion-secret.txt");
  const invalidPassBlockerRecord = path.join(tempDir, "completion-pass-blocker.txt");
  const invalidHighRiskRecord = path.join(tempDir, "completion-high-risk.txt");
  const invalidProductionRecord = path.join(tempDir, "completion-production.txt");
  const invalidUnverifiedReasonRecord = path.join(tempDir, "completion-unverified-reason.txt");
  const invalidResidualListRecord = path.join(tempDir, "completion-residual-list.txt");
  const invalidHighRiskBoundaryRecord = path.join(tempDir, "completion-high-risk-boundary.txt");
  const validLocalMigrationRecord = path.join(tempDir, "completion-local-migration.txt");
  const invalidDocsOnlyReleaseRecord = path.join(tempDir, "completion-docs-only-release.txt");
  const invalidTimestampRecord = path.join(tempDir, "completion-timestamp.txt");
  const invalidEvidenceUriRecord = path.join(tempDir, "completion-evidence-uri.txt");
  const invalidClaimScopeRecord = path.join(tempDir, "completion-claim-scope.txt");
  const invalidDoesNotProveRecord = path.join(tempDir, "completion-does-not-prove.txt");
  const invalidMissingEvidenceRecord = path.join(tempDir, "completion-missing-evidence.txt");
  const invalidSourceCommitRecord = path.join(tempDir, "completion-source-commit.txt");
  const staleFingerprintRecord = path.join(tempDir, "completion-stale-fingerprint.txt");
  const invalidProfileRecord = path.join(tempDir, "completion-invalid-profile.txt");
  const changedCommandsRecord = path.join(tempDir, "completion-changed-commands.txt");
  const legacyRecord = path.join(tempDir, "completion-legacy.txt");
  const inRepoFingerprint = buildWorktreeValidationFingerprint(
    root,
    validationCommands,
    "docs-only",
    [path.basename(inRepoRecord)],
  );

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
  writeFileSync(validLocalMigrationRecord, createRecord(headCommit)
    .replace("evidenceClass: docs-only", "evidenceClass: local-smoke")
    .replace("claimScope: source-only", "claimScope: local-runtime")
    .replace("highestRuntimeWriteBoundary: R0", "highestRuntimeWriteBoundary: R1")
    .replace("highRiskConfirmation: not-applicable", "highRiskConfirmation: yes")
    .replace("  migrationAttempted: no", "  migrationAttempted: yes"));
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
  writeFileSync(staleFingerprintRecord, createRecord(headCommit).replace(fingerprint.worktreeHash, `sha256:${"0".repeat(64)}`));
  writeFileSync(invalidProfileRecord, createRecord(headCommit).replace("  profile: docs-only", "  profile: unknown"));
  writeFileSync(changedCommandsRecord, createRecord(headCommit).replace(validationCommands, `${validationCommands}; pnpm check`));
  writeFileSync(legacyRecord, createLegacyRecord(headCommit));

  expectExit("valid completion evidence record passes", [validRecord], 0, "bindingStatus: current");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("PASS with blocker fails", [invalidPassBlockerRecord], 1);
  expectExit("R4 without confirmation fails", [invalidHighRiskRecord], 1);
  expectExit("production evidence without productionTouched fails", [invalidProductionRecord], 1);
  expectExit("PASS with unverified reason fails", [invalidUnverifiedReasonRecord], 1);
  expectExit("residual list with extra text fails", [invalidResidualListRecord], 1);
  expectExit("high-risk flag without R4 fails", [invalidHighRiskBoundaryRecord], 1);
  expectExit("isolated local migration is allowed at R1 with confirmation", [validLocalMigrationRecord], 0);
  expectExit("docs-only with release action fails", [invalidDocsOnlyReleaseRecord], 1);
  expectExit("date-only checkedAt fails", [invalidTimestampRecord], 1);
  expectExit("unsafe evidence URI fails", [invalidEvidenceUriRecord], 1);
  expectExit("claim scope mismatch fails", [invalidClaimScopeRecord], 1);
  expectExit("empty does-not-prove boundary fails", [invalidDoesNotProveRecord], 1);
  expectExit("missing repository evidence fails", [invalidMissingEvidenceRecord], 1);
  expectExit("unknown source commit fails", [invalidSourceCommitRecord], 1);
  expectExit("stale worktree fingerprint fails", [staleFingerprintRecord], 1);
  expectExit("invalid validation profile fails", [invalidProfileRecord], 1);
  expectExit("changed commands invalidate fingerprint", [changedCommandsRecord], 1);
  expectExit("legacy record fails current-binding validation", [legacyRecord], 1);
  expectExit("legacy record remains available as historical shape", [legacyRecord, "--shape-only"], 0, "bindingStatus: unavailable");
  writeFileSync(inRepoRecord, createRecord(headCommit, inRepoFingerprint));
  expectExit("repository record excludes itself from the checkout fingerprint", [inRepoRecord], 0, "bindingStatus: current");
  verifyEvidenceOnlyDescendantBinding();

  console.log("completion evidence validator selftest passed.");
} finally {
  rmSync(inRepoRecord, { force: true });
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

function createRecord(sourceCommit: string, selectedFingerprint = fingerprint): string {
  return [
    "schemaVersion: 2",
    "scope: docs-only enterprise completion evidence validator",
    "summary: Completion evidence validator docs-only fixture with explicit claim boundary",
    "evidenceClass: docs-only",
    "claimScope: source-only",
    "evidenceUri: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md",
    "sourceBaseline:",
    "  sourceDocs: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md",
    `  sourceHashOrCommit: ${sourceCommit}`,
    "freshValidation:",
    "  profile: docs-only",
    `  commands: ${validationCommands}`,
    "  browserOrRuntimeEvidence: not-applicable",
    "  checkedAt: 2026-07-11T06:30:00+08:00",
    "validationFingerprint:",
    `  algorithm: ${selectedFingerprint.algorithm}`,
    `  gitHead: ${selectedFingerprint.gitHead}`,
    `  worktreeState: ${selectedFingerprint.worktreeState}`,
    `  worktreeHash: ${selectedFingerprint.worktreeHash}`,
    `  changedPaths: ${selectedFingerprint.changedPaths.join(",") || "none"}`,
    `  digest: ${selectedFingerprint.digest}`,
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

function createLegacyRecord(sourceCommit: string): string {
  return createRecord(sourceCommit)
    .replace(/^schemaVersion: 2\n/m, "")
    .replace(/^  profile: docs-only\n/m, "")
    .replace(/^validationFingerprint:\n(?:  .+\n){6}/m, "");
}

function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("completion evidence selftest requires a Git checkout");
  return result.stdout.trim();
}

function verifyEvidenceOnlyDescendantBinding(): void {
  const repository = mkdtempSync(path.join(tmpdir(), "areaforge-completion-descendant-"));
  const validator = path.join(root, "scripts/quality/completion-evidence-validate.ts");
  const tsx = path.join(root, "node_modules/.bin/tsx");
  const recordPath = path.join(repository, "completion.txt");
  const evidencePath = path.join(repository, "docs/development/evidence.md");
  try {
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, "fixture evidence\n");
    runGit(repository, ["init", "-q"]);
    runGit(repository, ["config", "user.email", "completion@example.invalid"]);
    runGit(repository, ["config", "user.name", "Completion Selftest"]);
    runGit(repository, ["add", "."]);
    runGit(repository, ["commit", "-qm", "source"]);
    const sourceCommit = runGit(repository, ["rev-parse", "HEAD"]);
    const descendantFingerprint = buildWorktreeValidationFingerprint(
      repository,
      validationCommands,
      "docs-only",
      ["completion.txt"],
    );
    writeFileSync(recordPath, createDescendantRecord(sourceCommit, descendantFingerprint));
    runGit(repository, ["add", "completion.txt"]);
    runGit(repository, ["commit", "-qm", "evidence closeout"]);

    expectDirectValidator(tsx, validator, repository, recordPath, 0);
    writeFileSync(evidencePath, "drifted evidence\n");
    runGit(repository, ["add", "."]);
    runGit(repository, ["commit", "-qm", "unrelated drift"]);
    expectDirectValidator(tsx, validator, repository, recordPath, 1);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
}

function createDescendantRecord(sourceCommit: string, selectedFingerprint: typeof fingerprint): string {
  return createRecord(sourceCommit, selectedFingerprint)
    .replace(
      "evidenceUri: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md",
      "evidenceUri: docs/development/evidence.md",
    )
    .replace(
      "  sourceDocs: docs/development/completion-evidence-checklist.md, docs/development/validation-matrix.md",
      "  sourceDocs: docs/development/evidence.md",
    );
}

function expectDirectValidator(tsx: string, validator: string, cwd: string, record: string, expectedStatus: number): void {
  const result = spawnSync(tsx, [validator, record], { cwd, encoding: "utf8" });
  if (result.status !== expectedStatus) {
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    console.error(`HEAD=${runGit(cwd, ["rev-parse", "HEAD"])}`);
    console.error(`parent=${runGit(cwd, ["show", "-s", "--format=%P", "HEAD"])}`);
    console.error(`changes=${runGit(cwd, ["diff", "--name-status", "HEAD^", "HEAD", "--"])}`);
    console.error(readFileSync(record, "utf8").match(/gitHead: .+/)?.[0] ?? "gitHead missing");
    throw new Error(`descendant validator expected ${expectedStatus}, got ${result.status}`);
  }
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}
