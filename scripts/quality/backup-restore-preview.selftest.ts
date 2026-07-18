import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildBackupRestorePreview } from "../ops/backup-restore-preview";
import { validateBackupRestorePreview } from "./backup-restore-preview-validate";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(root, ".tmp-areaforge-backup-restore-preview-"));

try {
  const previewPath = path.join(tempDir, "backup-restore-preview.json");
  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/backup-restore-preview.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("generate backup/restore preview", generated, 0);
  writeFileSync(previewPath, generated.stdout);

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/backup-restore-preview-validate.ts", previewPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate backup/restore preview", validation, 0);
  if (!validation.stdout.includes("backupRestorePreviewRecordHash: sha256:")) {
    fail("backup/restore preview validation hash missing");
  }
  if (!validation.stdout.includes("bindingStatus: current")) {
    fail("backup/restore preview current binding status missing");
  }
  const shapeOnlyValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/backup-restore-preview-validate.ts", previewPath, "--shape-only"], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("shape-only backup/restore preview validation", shapeOnlyValidation, 0);
  if (!shapeOnlyValidation.stdout.includes("bindingStatus: unavailable")) {
    fail("backup/restore preview shape-only binding status must be unavailable");
  }

  const parsed = JSON.parse(generated.stdout) as Record<string, unknown>;
  if (parsed.schemaVersion !== 2) {
    fail("backup/restore preview must generate schema v2");
  }
  const sourceInputs = parsed.sourceInputs as Record<string, unknown>;
  for (const field of ["packageVersion", "packageJsonHash", "implementationHash", "sourceSetHash"]) {
    if (typeof sourceInputs[field] !== "string") fail(`backup/restore preview source binding missing ${field}`);
  }
  const doesNotProve = parsed.doesNotProve as unknown[];
  if (!doesNotProve.includes("restore apply execution")) {
    fail("backup/restore preview restore non-proof boundary missing");
  }
  const blockingGaps = parsed.blockingGaps as Array<Record<string, unknown>>;
  const releaseEvidenceBundleGap = blockingGaps.find((item) => item.key === "releaseEvidenceBundleHash");
  if (!releaseEvidenceBundleGap) {
    fail("backup/restore preview blocking gap missing releaseEvidenceBundleHash");
  }
  if (
    releaseEvidenceBundleGap.gapType !== "release_evidence_bundle_hash" ||
    releaseEvidenceBundleGap.sourceInput !== "release_record" ||
    releaseEvidenceBundleGap.sourceField !== "releaseEvidenceBundleHash"
  ) {
    fail("backup/restore preview blocking gap metadata is wrong for releaseEvidenceBundleHash");
  }
  if (typeof releaseEvidenceBundleGap.safeEvidence !== "string" || !releaseEvidenceBundleGap.safeEvidence.includes("root-only")) {
    fail("backup/restore preview blocking gap safe evidence is wrong for releaseEvidenceBundleHash");
  }

  for (const key of ["databaseBackupSha256", "uploadsBackupSha256", "envBackupSha256"]) {
    const gap = blockingGaps.find((item) => item.key === key);
    if (!gap) {
      fail(`backup/restore preview blocking gap missing ${key}`);
    }
    if (gap.gapType !== "release_evidence_backup_hash" || gap.sourceInput !== "release_record" || gap.sourceField !== key) {
      fail(`backup/restore preview blocking gap metadata is wrong for ${key}`);
    }
    if (typeof gap.safeEvidence !== "string" || !gap.safeEvidence.includes("root-only")) {
      fail(`backup/restore preview blocking gap safe evidence is wrong for ${key}`);
    }
    const blocks = gap.blocks as unknown[];
    if (!blocks.includes("release_evidence_validator") || !blocks.includes("long_term_live_gate")) {
      fail(`backup/restore preview blocking gap for ${key} does not name release evidence and long-term gate blockers`);
    }
  }
  for (const key of ["attachmentReconciliationCsvPath", "attachmentReconciliationCsvSha256", "attachmentReconciliationSummaryPath", "attachmentReconciliationSummaryHash", "attachmentReconciliationStatus"]) {
    const gap = blockingGaps.find((item) => item.key === key);
    if (!gap || gap.gapType !== "attachment_integrity_result" || gap.sourceInput !== "release_record") {
      fail(`backup/restore preview attachment binding gap is missing or invalid for ${key}`);
    }
    const blocks = gap.blocks as unknown[];
    if (!blocks.includes("release_evidence_validator") || !blocks.includes("long_term_live_gate")) {
      fail(`backup/restore preview attachment binding gap does not block release evidence and long-term gate for ${key}`);
    }
  }
  const safetyFacts = parsed.safetyFacts as Record<string, unknown>;
  if (safetyFacts.backupRestoreAttempted !== false || safetyFacts.productionWriteAttempted !== false) {
    fail("backup/restore preview safety facts are not read-only");
  }

  const unsafePath = path.join(tempDir, "backup-restore-preview-unsafe.json");
  writeFileSync(unsafePath, JSON.stringify({
    ...parsed,
    safetyFacts: {
      ...safetyFacts,
      backupRestoreAttempted: true,
    },
  }, null, 2));
  const unsafeValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/backup-restore-preview-validate.ts", unsafePath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("unsafe backup/restore preview fails", unsafeValidation, 1);

  const tamperedStatusPath = path.join(tempDir, "backup-restore-preview-tampered-status.json");
  const tamperedStatus = {
    ...parsed,
    status: "ready",
    backupRestorePreviewHash: "",
  };
  tamperedStatus.backupRestorePreviewHash = hashPreview(tamperedStatus);
  writeFileSync(tamperedStatusPath, JSON.stringify(tamperedStatus, null, 2));
  const tamperedStatusValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/backup-restore-preview-validate.ts", tamperedStatusPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("tampered backup/restore preview status fails", tamperedStatusValidation, 1);
  if (!tamperedStatusValidation.stderr.includes("status")) {
    fail("tampered backup/restore preview status did not fail on derived status consistency");
  }

  const tamperedGapPath = path.join(tempDir, "backup-restore-preview-tampered-gap.json");
  const tamperedGap = {
    ...parsed,
    blockingGaps: blockingGaps.filter((item) => item.key !== "databaseBackupSha256"),
    backupRestorePreviewHash: "",
  };
  tamperedGap.backupRestorePreviewHash = hashPreview(tamperedGap);
  writeFileSync(tamperedGapPath, JSON.stringify(tamperedGap, null, 2));
  const tamperedGapValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/backup-restore-preview-validate.ts", tamperedGapPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("tampered backup/restore preview blocking gaps fail", tamperedGapValidation, 1);
  if (!tamperedGapValidation.stderr.includes("blockingGaps")) {
    fail("tampered backup/restore preview blocking gaps did not fail on derived gap consistency");
  }

  const validReleaseRecord = path.join(tempDir, "release-valid.txt");
  const validRestoreRecord = path.join(tempDir, "restore-valid.txt");
  const validReleaseContent = [
    "releaseTag: v0.1.7",
    `releaseEvidenceBundleHash: sha256:${"e".repeat(64)}`,
    "attachmentReconciliationCsvPath: reports/attachment-reconciliation.csv",
    `attachmentReconciliationCsvSha256: sha256:${"1".repeat(64)}`,
    "attachmentReconciliationSummaryPath: reports/attachment-reconciliation-summary.json",
    `attachmentReconciliationSummaryHash: sha256:${"2".repeat(64)}`,
    "attachmentReconciliationStatus: pass",
    `databaseBackupSha256: ${"a".repeat(64)}`,
    `uploadsBackupSha256: ${"b".repeat(64)}`,
    `envBackupSha256: ${"c".repeat(64)}`,
    "composeConfigBackupPath: redacted-compose-backup",
    "nginxConfigBackupPath: redacted-nginx-backup",
    "rollbackTargetVersion: 0.1.6",
    `rollbackTargetImage: ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"d".repeat(64)}`,
    "",
  ].join("\n");
  const validRestoreContent = [
    "databaseRestoreResult: pass",
    "uploadsRestoreResult: pass",
    "attachmentHashMatched: not-applicable",
    "",
  ].join("\n");
  writeFileSync(validReleaseRecord, validReleaseContent);
  writeFileSync(validRestoreRecord, validRestoreContent);
  const allPresentGeneration = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/backup-restore-preview.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD: validReleaseRecord,
      AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD: validRestoreRecord,
    },
  });
  expectStatus("all-present backup/restore preview generates", allPresentGeneration, 0);
  const allPresent = JSON.parse(allPresentGeneration.stdout) as Record<string, unknown>;
  if (allPresent.status !== "ready") {
    fail("all-present backup/restore preview should be ready");
  }
  if ((allPresent.blockingGaps as unknown[]).length !== 0) {
    fail("all-present backup/restore preview should have no blocking gaps");
  }

  const invalidReleaseRecord = path.join(tempDir, "release-invalid.txt");
  writeFileSync(invalidReleaseRecord, [
    "releaseTag: v0.1.7",
    `releaseEvidenceBundleHash: sha256:${"e".repeat(64)}`,
    "attachmentReconciliationCsvPath: reports/attachment-reconciliation.csv",
    `attachmentReconciliationCsvSha256: sha256:${"1".repeat(64)}`,
    "attachmentReconciliationSummaryPath: reports/attachment-reconciliation-summary.json",
    `attachmentReconciliationSummaryHash: sha256:${"2".repeat(64)}`,
    "attachmentReconciliationStatus: pass",
    "databaseBackupSha256: invalid-hash",
    `uploadsBackupSha256: ${"b".repeat(64)}`,
    `envBackupSha256: ${"c".repeat(64)}`,
    "composeConfigBackupPath: redacted-compose-backup",
    "nginxConfigBackupPath: redacted-nginx-backup",
    "rollbackTargetVersion: 0.1.6",
    `rollbackTargetImage: ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"d".repeat(64)}`,
    "",
  ].join("\n"));
  const invalidGeneration = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/backup-restore-preview.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD: invalidReleaseRecord,
      AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD: validRestoreRecord,
    },
  });
  expectStatus("invalid backup hash preview generates", invalidGeneration, 0);
  const invalidParsed = JSON.parse(invalidGeneration.stdout) as Record<string, unknown>;
  if (invalidParsed.status !== "blocked") {
    fail("invalid backup hash preview should be blocked");
  }
  const invalidGap = (invalidParsed.blockingGaps as Array<Record<string, unknown>>).find((item) => item.key === "databaseBackupSha256");
  if (!invalidGap || invalidGap.status !== "invalid" || invalidGap.gapType !== "release_evidence_backup_hash") {
    fail("invalid backup hash preview should expose an invalid release_evidence_backup_hash gap");
  }

  const missingReleaseRecord = path.join(tempDir, "release-missing.txt");
  writeFileSync(missingReleaseRecord, [
    "releaseTag: v0.1.7",
    `releaseEvidenceBundleHash: sha256:${"e".repeat(64)}`,
    "attachmentReconciliationCsvPath: reports/attachment-reconciliation.csv",
    `attachmentReconciliationCsvSha256: sha256:${"1".repeat(64)}`,
    "attachmentReconciliationSummaryPath: reports/attachment-reconciliation-summary.json",
    `attachmentReconciliationSummaryHash: sha256:${"2".repeat(64)}`,
    "attachmentReconciliationStatus: pass",
    `uploadsBackupSha256: ${"b".repeat(64)}`,
    `envBackupSha256: ${"c".repeat(64)}`,
    "composeConfigBackupPath: redacted-compose-backup",
    "nginxConfigBackupPath: redacted-nginx-backup",
    "rollbackTargetVersion: 0.1.6",
    `rollbackTargetImage: ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"d".repeat(64)}`,
    "",
  ].join("\n"));
  const missingGeneration = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/backup-restore-preview.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD: missingReleaseRecord,
      AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD: validRestoreRecord,
    },
  });
  expectStatus("missing backup hash preview generates", missingGeneration, 0);
  const missingParsed = JSON.parse(missingGeneration.stdout) as Record<string, unknown>;
  if (missingParsed.status !== "needs_evidence") {
    fail("missing backup hash preview should need evidence");
  }
  const missingGap = (missingParsed.blockingGaps as Array<Record<string, unknown>>).find((item) => item.key === "databaseBackupSha256");
  if (!missingGap || missingGap.status !== "missing" || missingGap.sourceField !== "databaseBackupSha256") {
    fail("missing backup hash preview should expose a missing databaseBackupSha256 gap");
  }

  const secretPath = path.join(tempDir, "backup-restore-preview-secret.json");
  writeFileSync(secretPath, `${generated.stdout}\nDATABASE_URL=postgresql://user:pass@localhost/db`);
  const secretValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/backup-restore-preview-validate.ts", secretPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("secret-bearing backup/restore preview fails", secretValidation, 1);

  const deniedEnvPath = path.join(tempDir, ".env");
  writeFileSync(deniedEnvPath, "DATABASE_URL=postgresql://user:pass@localhost/db");
  const deniedEnvGeneration = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/backup-restore-preview.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD: deniedEnvPath,
    },
  });
  expectStatus("secret-like release record path fails", deniedEnvGeneration, 1);
  if (`${deniedEnvGeneration.stdout}\n${deniedEnvGeneration.stderr}`.includes("postgresql://user:pass")) {
    fail("secret-like release record path printed secret content");
  }

  const missingRestoreGeneration = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/backup-restore-preview.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD: path.join(tempDir, "missing-restore-record.txt"),
    },
  });
  expectStatus("missing explicit restore drill record fails", missingRestoreGeneration, 1);

  testCurrentBindingFailureMatrix(tempDir);
  testGenerationInputRace(tempDir);

  console.log("backup/restore preview selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected exit ${expected}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function testCurrentBindingFailureMatrix(parent: string): void {
  const fixture = createBindingFixture(parent);
  const generated = buildBackupRestorePreview({ cwd: fixture.root, env: fixture.env });
  const raw = JSON.stringify(generated);
  expectNoIssues("current fixture preview", validateBackupRestorePreview(raw, fixture.validationOptions));

  const tampered = structuredClone(generated) as unknown as Record<string, unknown>;
  tampered.app = { ...(tampered.app as Record<string, unknown>), version: "9.9.9" };
  tampered.backupRestorePreviewHash = hashPreview(tampered);
  expectBindingFailure("source-derived preview tampering", validateBackupRestorePreview(JSON.stringify(tampered), fixture.validationOptions));

  writeFileSync(fixture.releaseRecord, `${fixture.releaseContent}databaseBackupSha256: ${"a".repeat(64)}\n`);
  expectBindingFailure("release record modification", validateBackupRestorePreview(raw, fixture.validationOptions));
  expectNoIssues("historical shape-only after release drift", validateBackupRestorePreview(raw, { ...fixture.validationOptions, shapeOnly: true }));
  writeFileSync(fixture.releaseRecord, fixture.releaseContent);

  rmSync(fixture.releaseRecord);
  expectBindingFailure("release record deletion", validateBackupRestorePreview(raw, fixture.validationOptions));
  writeFileSync(fixture.releaseRecord, fixture.releaseContent);

  writeFileSync(fixture.releaseTarget, fixture.releaseContent);
  rmSync(fixture.releaseRecord);
  symlinkSync(fixture.releaseTarget, fixture.releaseRecord);
  expectBindingFailure("release record symlink replacement", validateBackupRestorePreview(raw, fixture.validationOptions));
  expectThrow("symlink source generation", () => buildBackupRestorePreview({ cwd: fixture.root, env: fixture.env }), "must not be a symlink");
  rmSync(fixture.releaseRecord);
  writeFileSync(fixture.releaseRecord, fixture.releaseContent);

  writeFileSync(fixture.restoreRecord, `${fixture.restoreContent}databaseRestoreResult: fail\n`);
  expectBindingFailure("restore record modification", validateBackupRestorePreview(raw, fixture.validationOptions));
  writeFileSync(fixture.restoreRecord, fixture.restoreContent);

  writeFileSync(fixture.packageJson, JSON.stringify({ name: "fixture", version: "0.1.8" }, null, 2));
  expectBindingFailure("package version drift", validateBackupRestorePreview(raw, fixture.validationOptions));
  writeFileSync(fixture.packageJson, fixture.packageContent);

  writeFileSync(fixture.implementationFile, "fixture implementation drift\n");
  expectBindingFailure("implementation drift", validateBackupRestorePreview(raw, fixture.validationOptions));
  writeFileSync(fixture.implementationFile, fixture.implementationContent);

  expectNoIssues("restored current fixture preview", validateBackupRestorePreview(raw, fixture.validationOptions));
}

function testGenerationInputRace(parent: string): void {
  const fixture = createBindingFixture(path.join(parent, "generation-race"));
  expectThrow(
    "generation input race",
    () => buildBackupRestorePreview({
      cwd: fixture.root,
      env: fixture.env,
      beforeFinalize: () => writeFileSync(fixture.releaseRecord, `${fixture.releaseContent}databaseBackupSha256: ${"b".repeat(64)}\n`),
    }),
    "source inputs changed during generation",
  );
}

function createBindingFixture(parent: string): {
  root: string;
  env: NodeJS.ProcessEnv;
  validationOptions: { cwd: string; env: NodeJS.ProcessEnv };
  packageJson: string;
  packageContent: string;
  releaseRecord: string;
  releaseTarget: string;
  releaseContent: string;
  restoreRecord: string;
  restoreContent: string;
  implementationFile: string;
  implementationContent: string;
} {
  const fixtureRoot = path.join(parent, "binding-fixture");
  mkdirSync(path.join(fixtureRoot, "docs/development"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "scripts/ops"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "scripts/quality"), { recursive: true });
  const packageJson = path.join(fixtureRoot, "package.json");
  const packageContent = `${JSON.stringify({ name: "fixture", version: "0.1.7" }, null, 2)}\n`;
  const releaseRecord = path.join(fixtureRoot, "docs/development/release-v0.1.7-record.md");
  const releaseTarget = path.join(fixtureRoot, "docs/development/release-target.md");
  const releaseContent = "releaseTag: v0.1.7\n";
  const restoreRecord = path.join(fixtureRoot, "docs/development/restore-record.txt");
  const restoreContent = "databaseRestoreResult: pass\nuploadsRestoreResult: pass\nattachmentHashMatched: not-applicable\n";
  const implementationPaths = [
    "scripts/ops/backup-restore-preview.ts",
    "scripts/quality/backup-restore-preview-source.ts",
    "scripts/quality/backup-restore-preview-validate.ts",
  ];
  const implementationContent = "fixture implementation\n";
  writeFileSync(packageJson, packageContent);
  writeFileSync(releaseRecord, releaseContent);
  writeFileSync(restoreRecord, restoreContent);
  for (const relativePath of implementationPaths) {
    writeFileSync(path.join(fixtureRoot, relativePath), implementationContent);
  }
  const env = {
    ...process.env,
    AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD: releaseRecord,
    AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD: restoreRecord,
  };
  return {
    root: fixtureRoot,
    env,
    validationOptions: { cwd: fixtureRoot, env },
    packageJson,
    packageContent,
    releaseRecord,
    releaseTarget,
    releaseContent,
    restoreRecord,
    restoreContent,
    implementationFile: path.join(fixtureRoot, implementationPaths[0]),
    implementationContent,
  };
}

function expectNoIssues(label: string, issues: Array<{ field: string; message: string }>): void {
  if (issues.length > 0) {
    fail(`${label} unexpectedly failed: ${issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
  }
}

function expectBindingFailure(label: string, issues: Array<{ field: string }>): void {
  if (!issues.some((issue) => issue.field === "bindingStatus")) {
    fail(`${label} did not fail current source binding`);
  }
}

function expectThrow(label: string, action: () => unknown, expectedMessage: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) return;
    fail(`${label} failed with an unexpected error`);
  }
  fail(`${label} did not fail`);
}

function hashPreview(preview: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify({ ...preview, backupRestorePreviewHash: "" })).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
