import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeDataIntegrityDoctorHash } from "../ops/data-integrity-doctor";
import {
  attachmentReconciliationHeader,
  computeAttachmentReconciliationSummaryHash,
} from "./attachment-reconciliation-summary";
import { readBoundJsonEvidence } from "./bound-json-evidence";
import { parseIndentedKeyValueRecord, sha256 } from "./record-validator-common";
import { buildReleaseEvidenceBundleHash } from "./release-evidence-validate";
import { buildReleaseSupplyChainEvidenceHash } from "./release-supply-chain-validate";
import {
  buildOps006ExpectedIdentity,
  calculateOps006ConfirmationScopeHash,
  calculateOps006ConfirmationScopes,
  calculateOps006ProductionEvidenceHash,
  calculateOps006RolloutHash,
  canonicalIndexDefinitionHash,
  validateOps006ProductionEvidence,
  validateOps006ProductionEvidenceBundle,
} from "./ops006-production-evidence-validate";

type JsonRecord = Record<string, unknown>;

const now = new Date("2026-07-18T12:00:00.000Z");
const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops006-production-"));
const evidenceDir = path.join(root, "evidence");
const assetsDir = path.join(root, "assets");
const publicKey = path.join(root, "cosign.pub");
const commit = "a".repeat(40);
const webDigest = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;
const migrationDigest = `ghcr.io/areasong/areaforge-migration:v0.1.8@sha256:${"c".repeat(64)}`;
const rollbackImage = `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"d".repeat(64)}`;
const databaseBackupSha256 = "e".repeat(64);
const migrationVersion = "20260718010000_add_active_session_unique_index";
const sourceAtCommit = (_gitCommit: string, file: string) => file.endsWith("migration.sql") ? "CREATE UNIQUE INDEX fixture;\n" : `source:${file}\n`;
const reconciliationCsv = `${attachmentReconciliationHeader.join(",")}\n`;
const reconciliationSummary = createReconciliationSummary(reconciliationCsv);

try {
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(publicKey, "fixture public key\n");
  const release = createReleaseFixture();
  const identity = buildOps006ExpectedIdentity(release.record, root, sourceAtCommit);
  writeEvidenceFiles(identity);
  const releaseEvidence = createReleaseEvidence(release.record);
  const validRecord = createProductionRecord(identity, release.record, releaseEvidence);
  const scopes = calculateOps006ConfirmationScopes(validRecord);
  if (scopes.rolloutConfirmationScopeSha256 === scopes.controlledProbeConfirmationScopeSha256) {
    throw new Error("confirmation scopes must be domain separated");
  }

  expectPass(validRecord, identity);
  expectBundlePass(validRecord, release.record, releaseEvidence);
  expectFail(`${validRecord}business-title: leaked private note\n`, "record.line");
  try {
    calculateOps006ConfirmationScopes(`${validRecord}releaseTag: v9.9.9\n`);
    throw new Error("duplicate confirmation-scope fields should fail");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate")) throw error;
  }
  try {
    calculateOps006ConfirmationScopes(validRecord.replace(rollbackImage, migrationDigest));
    throw new Error("migration image must not be accepted as a rollback target");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Web rollback target")) throw error;
  }
  expectFail(`${validRecord}recordId: duplicate\n`, "duplicate field");
  expectFail(validRecord.replace("  secretValuePrinted: no", "\tsecretValuePrinted: no"), "tabs are not allowed");
  expectFail(validRecord.replace(/recordHash: sha256:[a-f0-9]{64}/, `recordHash: sha256:${"0".repeat(64)}`), "recordHash");
  expectFail(validRecord.replace(identity.migrationSha256, `sha256:${"1".repeat(64)}`), "migrationSha256", identity);
  expectFail(validRecord.replace("before-doctor.json", "../before-doctor.json"), "beforeDoctorFile");
  expectFail(validRecord.replace(fileHash("before-doctor.json"), `sha256:${"2".repeat(64)}`), "beforeDoctorFileSha256");
  expectFail(validRecord.replace("controlledProbeConfirmationId: confirm-ops006-probe-20260718", "controlledProbeConfirmationId: confirm-ops006-rollout-20260718"), "independent from the base rollout");
  expectFailWithOptions(validRecord, "now", { now: new Date("invalid") });
  expectFailWithOptions(validRecord, "maxAgeHours", { maxAgeHours: 1_000_000 });
  expectFail(rehashProductionRecord(validRecord.replace("evidenceFreshnessMaxAgeHours: 24", "evidenceFreshnessMaxAgeHours: 168")), "evidenceFreshnessMaxAgeHours");
  expectFail(validRecord.replace(`rollbackTargetImage: ${rollbackImage}`, `rollbackTargetImage: ${webDigest}`), "must differ from the deployed Web image");
  expectFail(validRecord.replace(rollbackImage, rollbackImage.toUpperCase()), "canonical lowercase");

  mutateRollout((rollout) => { asRecord(asRecord(rollout.controlledProbe).start).reasonCode = "WRONG"; });
  expectFail(createProductionRecord(identity, release.record, releaseEvidence), "rolloutEvidenceFile.controlledProbe.start");
  mutateRollout((rollout) => { asRecord(asRecord(rollout.controlledProbe).sideEffects).auditEventDelta = 2; });
  expectFail(createProductionRecord(identity, release.record, releaseEvidence), "auditEventDelta");
  mutateRollout((rollout) => { asRecord(rollout.safetyFacts).realUserBusinessDataWritten = true; });
  expectFail(createProductionRecord(identity, release.record, releaseEvidence), "realUserBusinessDataWritten");
  mutateRollout((rollout) => { asRecord(asRecord(rollout.deployment).canonicalIndex).definitionHash = `sha256:${"3".repeat(64)}`; });
  expectFail(createProductionRecord(identity, release.record, releaseEvidence), "canonicalIndex");
  mutateRollout((rollout) => { asRecord(rollout.deployment).startedAt = "2026-07-18T10:00:00.000Z"; });
  expectFail(createProductionRecord(identity, release.record, releaseEvidence), "strictly follow");

  writeEvidenceFiles(identity);
  const staleDoctor = doctor("2026-07-16T09:00:00.000Z");
  writeJson("before-doctor.json", staleDoctor);
  expectFail(createProductionRecord(identity, release.record, releaseEvidence), "beforeDoctorFile");
  writeEvidenceFiles(identity);
  const fixtureDoctor = doctor("2026-07-18T10:00:00.000Z");
  asRecord(fixtureDoctor.source).database = "fixture";
  asRecord(fixtureDoctor.safetyFacts).networkRequested = false;
  asRecord(fixtureDoctor.safetyFacts).databaseReadAttempted = false;
  fixtureDoctor.doctorHash = computeDataIntegrityDoctorHash(fixtureDoctor);
  writeJson("before-doctor.json", fixtureDoctor);
  expectFail(createProductionRecord(identity, release.record, releaseEvidence), "configured production read-only query");

  writeEvidenceFiles(identity);
  const badReleaseEvidence = releaseEvidence.replace(/releaseEvidenceBundleHash: sha256:[a-f0-9]{64}/, `releaseEvidenceBundleHash: sha256:${"4".repeat(64)}`);
  expectBundleFail(createProductionRecord(identity, release.record, badReleaseEvidence), release.record, badReleaseEvidence, "releaseEvidence.releaseEvidenceBundleHash");
  expectBundleFail(validRecord, release.record, releaseEvidence, "release.assetDir", { releaseAssetsDir: "" });
  expectBundleFail(validRecord, release.record, releaseEvidence, "releaseEvidence.attachmentReconciliation", { releaseEvidenceCsv: undefined });
  const incompleteReleaseEvidence = releaseEvidence.replace(/uploadsBackupPath:.*\n/, "");
  expectBundleFail(createProductionRecord(identity, release.record, incompleteReleaseEvidence), release.record, incompleteReleaseEvidence, "releaseEvidence.uploadsBackupPath");
  const secretReleaseEvidence = `${releaseEvidence}DATABASE_URL=postgresql://user:password@example.invalid/db\n`;
  expectBundleFail(createProductionRecord(identity, release.record, secretReleaseEvidence), release.record, secretReleaseEvidence, "releaseEvidence.record");
  const mismatchedSupplyHashEvidence = rehashReleaseEvidence(releaseEvidence.replace(
    /releaseSupplyChainEvidenceHash: sha256:[a-f0-9]{64}/,
    `releaseSupplyChainEvidenceHash: sha256:${"8".repeat(64)}`,
  ));
  expectBundleFail(
    createProductionRecord(identity, release.record, mismatchedSupplyHashEvidence),
    release.record,
    mismatchedSupplyHashEvidence,
    "releaseEvidence.releaseSupplyChainEvidenceHash",
  );
  expectBundleFail(validRecord, release.record, releaseEvidence, "release.sourceAtCommit", { sourceAtCommit: () => "" });

  exerciseBoundJsonNegativeCases();

  console.log("OPS-006 production evidence validator selftest passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function expectPass(raw: string, identity = buildOps006ExpectedIdentity(createReleaseFixture().record, root, sourceAtCommit)): void {
  const issues = validateOps006ProductionEvidence(raw, { now, expectedIdentity: identity, evidenceBaseDir: evidenceDir });
  if (issues.length > 0) throw new Error(`expected pass, got ${JSON.stringify(issues)}`);
}

function expectFail(raw: string, field: string, identity?: ReturnType<typeof buildOps006ExpectedIdentity>): void {
  const issues = validateOps006ProductionEvidence(raw, { now, expectedIdentity: identity, evidenceBaseDir: evidenceDir });
  if (!issues.some((issue) => issue.field.includes(field) || issue.message.includes(field))) {
    throw new Error(`expected ${field} failure, got ${JSON.stringify(issues)}`);
  }
}

function expectFailWithOptions(
  raw: string,
  field: string,
  overrides: { now?: Date; maxAgeHours?: number },
): void {
  const identity = buildOps006ExpectedIdentity(createReleaseFixture().record, root, sourceAtCommit);
  const issues = validateOps006ProductionEvidence(raw, {
    now,
    expectedIdentity: identity,
    evidenceBaseDir: evidenceDir,
    ...overrides,
  });
  if (!issues.some((issue) => issue.field.includes(field) || issue.message.includes(field))) {
    throw new Error(`expected ${field} failure, got ${JSON.stringify(issues)}`);
  }
}

function expectBundlePass(raw: string, release: string, releaseEvidence: string): void {
  const issues = validateOps006ProductionEvidenceBundle(raw, release, releaseEvidence, bundleOptions());
  if (issues.length > 0) throw new Error(`expected bundle pass, got ${JSON.stringify(issues)}`);
}

function expectBundleFail(
  raw: string,
  release: string,
  releaseEvidence: string,
  field: string,
  overrides: Record<string, unknown> = {},
): void {
  const issues = validateOps006ProductionEvidenceBundle(raw, release, releaseEvidence, { ...bundleOptions(), ...overrides });
  if (!issues.some((issue) => issue.field.includes(field))) {
    throw new Error(`expected bundle ${field} failure, got ${JSON.stringify(issues)}`);
  }
}

function bundleOptions() {
  return {
    root,
    now,
    evidenceBaseDir: evidenceDir,
    releaseAssetsDir: assetsDir,
    cosignPublicKey: publicKey,
    releaseSignatureVerifier: () => undefined,
    sourceAtCommit,
    releaseEvidenceCsv: reconciliationCsv,
    releaseEvidenceSummary: reconciliationSummary,
  };
}

function createProductionRecord(
  identity: ReturnType<typeof buildOps006ExpectedIdentity>,
  releaseRecord: string,
  releaseEvidence: string,
): string {
  const before = readJson("before-doctor.json");
  const after = readJson("after-doctor.json");
  const rollout = readJson("rollout.json");
  const supplyHash = buildReleaseSupplyChainEvidenceHash(parseIndentedKeyValueRecord(releaseRecord));
  const releaseHash = buildReleaseEvidenceBundleHash(parseIndentedKeyValueRecord(releaseEvidence));
  const lines = [
    "recordId: ops006-production-selftest", "recordedAt: 2026-07-18T10:50:00.000Z", "environment: production",
    `releaseTag: ${identity.releaseTag}`, `packageVersion: ${identity.packageVersion}`, `gitCommit: ${identity.gitCommit}`,
    `webImageDigest: ${identity.webImageDigest}`, `migrationImageDigest: ${identity.migrationImageDigest}`,
    `migrationPath: ${identity.migrationPath}`, `migrationSha256: ${identity.migrationSha256}`, `implementationSha256: ${identity.implementationSha256}`,
    "maintenanceWindowId: mw-20260718-ops006",
    "rolloutConfirmationId: confirm-ops006-rollout-20260718",
    "rolloutConfirmationScopeSha256:",
    "controlledProbeConfirmationId: confirm-ops006-probe-20260718",
    "controlledProbeConfirmationScopeSha256:",
    `rollbackTargetImage: ${rollbackImage}`,
    `databaseBackupSha256: ${databaseBackupSha256}`,
    `releaseSupplyChainRecordSha256: sha256:${sha256(releaseRecord)}`,
    `releaseEvidenceRecordSha256: sha256:${sha256(releaseEvidence)}`,
    "localVerificationStatus: pass", "signedReleaseStatus: pass", "rolloutConfirmationStatus: pass", "controlledProbeConfirmationStatus: pass",
    "productionMigrationStatus: pass", "productionDeploymentStatus: pass", "canonicalIndexVerificationStatus: pass",
    "authenticatedSmokeStatus: pass", "controlledConcurrencyProbeStatus: pass", "rollbackTargetStatus: pass",
    "migrationVersion: 20260718010000_add_active_session_unique_index", "migrationRunner: one_off_migration_job", "indexRollbackPolicy: retain",
    "beforeDoctorFile: before-doctor.json", `beforeDoctorFileSha256: ${fileHash("before-doctor.json")}`, `beforeDoctorHash: ${String(before.doctorHash)}`,
    "afterDoctorFile: after-doctor.json", `afterDoctorFileSha256: ${fileHash("after-doctor.json")}`, `afterDoctorHash: ${String(after.doctorHash)}`,
    "rolloutEvidenceFile: rollout.json", `rolloutEvidenceFileSha256: ${fileHash("rollout.json")}`, `rolloutEvidenceHash: ${String(rollout.rolloutHash)}`,
    `releaseSupplyChainEvidenceHash: ${supplyHash}`, `releaseEvidenceBundleHash: ${releaseHash}`,
    "evidenceFreshnessMaxAgeHours: 24", "residualRiskIds: AF-RISK-OPS-006",
    "doesNotProve: AF-RISK-OPS-006 residual closure,historical production data repair,future concurrency safety after this evidence window,database or uploads restore execution,secrets absence beyond validator scan",
    "safetyFacts:", "  secretValuePrinted: no", "  realUserBusinessDataWritten: no", "  syntheticProbeWriteAttempted: yes",
    "  historicalRepairAttempted: no", "  destructiveMigrationAttempted: no", "  destructiveRollbackAttempted: no",
    "  businessTextIncluded: no", "  objectIdentifiersIncluded: no", "  databaseUrlIncluded: no",
    "  residualLedgerUpdated: no", "  webRuntimeServerCommandAttempted: no", "",
  ];
  const scopeFields = parseIndentedKeyValueRecord(lines.join("\n"));
  replaceLine(lines, "rolloutConfirmationScopeSha256", calculateOps006ConfirmationScopeHash("rollout", scopeFields));
  replaceLine(lines, "controlledProbeConfirmationScopeSha256", calculateOps006ConfirmationScopeHash("controlled_probe", scopeFields));
  const withoutHash = lines.join("\n");
  const hash = calculateOps006ProductionEvidenceHash(parseIndentedKeyValueRecord(withoutHash));
  return withoutHash.replace("safetyFacts:", `recordHash: ${hash}\nsafetyFacts:`);
}

function writeEvidenceFiles(identity: ReturnType<typeof buildOps006ExpectedIdentity>): void {
  writeJson("before-doctor.json", doctor("2026-07-18T10:00:00.000Z"));
  writeJson("after-doctor.json", doctor("2026-07-18T10:40:00.000Z"));
  const rollout = rolloutRecord(identity);
  rollout.rolloutHash = calculateOps006RolloutHash(rollout);
  writeJson("rollout.json", rollout);
}

function rolloutRecord(identity: ReturnType<typeof buildOps006ExpectedIdentity>): JsonRecord {
  const scopeFields = new Map<string, string>([
    ["releaseTag", identity.releaseTag], ["gitCommit", identity.gitCommit],
    ["webImageDigest", identity.webImageDigest], ["migrationImageDigest", identity.migrationImageDigest],
    ["rollbackTargetImage", rollbackImage],
  ]);
  const rolloutScope = calculateOps006ConfirmationScopeHash("rollout", scopeFields);
  const probeScope = calculateOps006ConfirmationScopeHash("controlled_probe", scopeFields);
  return {
    schemaVersion: 1, mode: "redacted_ops006_production_rollout", recordedAt: "2026-07-18T10:45:00.000Z", environment: "production",
    identity: { ...identity, migrationVersion, maintenanceWindowId: "mw-20260718-ops006" },
    deployment: {
      startedAt: "2026-07-18T10:10:00.000Z", finishedAt: "2026-07-18T10:20:00.000Z",
      confirmationId: "confirm-ops006-rollout-20260718", confirmationScopeSha256: rolloutScope,
      backupStatus: "pass", databaseBackupSha256, agentUpdaterMatchStatus: "pass",
      migrationRunner: "one_off_migration_job", migrationApplied: true, applicationDeploymentStatus: "pass",
      canonicalIndex: { name: "StudySession_one_active_idx", unique: true, expression: "(1)", statuses: ["RUNNING", "PAUSED"], verificationStatus: "pass", definitionHash: canonicalIndexDefinitionHash() },
    },
    controlledProbe: {
      recordedAt: "2026-07-18T10:30:00.000Z",
      confirmationId: "confirm-ops006-probe-20260718", confirmationScopeSha256: probeScope,
      syntheticScope: true,
      start: { successCount: 1, conflictCount: 1, httpStatus: 409, reasonCode: "ACTIVE_SESSION_EXISTS", activeSessionCountAfter: 1 },
      end: { successCount: 1, conflictCount: 1, httpStatus: 409, reasonCode: "SESSION_STATE_CONFLICT" },
      taskCas: { successCount: 1, conflictCount: 1, httpStatus: 409, reasonCode: "TASK_STATE_CONFLICT", eventOrChildDuplicateCount: 0 },
      sideEffects: { effectiveMinutes: 25, taskMinutesDelta: 25, syllabusMinutesDelta: 25, auditEventDelta: 1, taskDebtEventDelta: 1, checkInSessionDelta: 1 },
      checkIn: { concurrentWrites: 2, committedWrites: 2, aggregateMatchesCommittedTaskState: true }, cleanupStatus: "pass",
    },
    healthSmoke: { recordedAt: "2026-07-18T10:25:00.000Z", health: "pass", authenticatedReadOnlySmoke: "pass" },
    doctorBinding: { beforeDoctorHash: doctorHash("before-doctor.json"), afterDoctorHash: doctorHash("after-doctor.json") },
    rollback: { targetImage: rollbackImage, applicationRollbackReady: true, indexPolicy: "retain", databaseRestoreAttempted: false, uploadsRestoreAttempted: false },
    safetyFacts: { secretValuePrinted: false, realUserBusinessDataWritten: false, syntheticProbeWriteAttempted: true, historicalRepairAttempted: false, destructiveMigrationAttempted: false, destructiveRollbackAttempted: false, businessTextIncluded: false, objectIdentifiersIncluded: false, databaseUrlIncluded: false, residualLedgerUpdated: false, webRuntimeServerCommandAttempted: false },
    rolloutHash: "",
  };
}

function doctor(generatedAt: string): JsonRecord {
  const checks = [
    { id: "study_sessions.active_cardinality", status: "pass", message: "active session cardinality is valid", details: { activeSessionCount: 0, allowedMaximum: 1 } },
    { id: "study_sessions.state_consistency", status: "pass", message: "study session state fields are consistent", details: { runningWithPausedAtCount: 0, pausedWithoutPausedAtCount: 0, activeWithEndedAtCount: 0, terminalWithoutEndedAtCount: 0, terminalWithPausedAtCount: 0, negativeSessionMetricsCount: 0 } },
    { id: "study_sessions.stale_active", status: "pass", message: "no stale active sessions detected", details: { staleActiveSessionCount: 0 } },
    { id: "study_tasks.state_consistency", status: "pass", message: "study task state fields are consistent", details: { doneWithoutCompletedAtCount: 0, nonDoneWithCompletedAtCount: 0, doneWithDebtCount: 0, negativeTaskMinutesCount: 0 } },
    { id: "attachments.reconciliation", status: "pass", message: "attachment reconciliation summary is clean", details: { databaseRecordCount: 0, uploadFileCount: 0, mismatchCount: 0 } },
  ];
  const value: JsonRecord = {
    schemaVersion: 1, mode: "read_only_data_integrity_doctor", generatedAt,
    status: { overall: "pass", native: "integrity_clean" }, counts: { total: 5, pass: 5, warn: 0, fail: 0, skipped: 0 },
    thresholds: { staleActiveSessionHours: 24 }, checks,
    source: { database: "configured_read_only_query", attachmentSummarySha256: `sha256:${"9".repeat(64)}` },
    doesNotProve: ["automatic data repair or deletion", "future concurrency safety after this snapshot", "attachment integrity unless a validated reconciliation summary is supplied", "production health, backup freshness, updater apply, migration, or rollback execution"],
    safetyFacts: { readOnly: true, networkRequested: true, databaseReadAttempted: true, databaseWriteAttempted: false, uploadDirectoryReadAttempted: false, fileWriteAttempted: false, attachmentContentIncluded: false, objectIdentifiersIncluded: false, absolutePathIncluded: false, secretValuePrinted: false },
    doctorHash: "",
  };
  value.doctorHash = computeDataIntegrityDoctorHash(value);
  return value;
}

function createReleaseFixture(): { record: string } {
  const releaseUrl = "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.8";
  const manifest = JSON.stringify({ schemaVersion: 1, app: "AreaForge", version: "0.1.8", channel: "stable", gitCommit: commit, webImageDigest: webDigest, migrationImageDigest: migrationDigest, releaseNotesUrl: releaseUrl }, null, 2) + "\n";
  const assets: Record<string, string> = { "areaforge-release-manifest.json": manifest, "areaforge-sbom.spdx.json": "{}\n", "areaforge-provenance.json": "{}\n", "docker-compose.prod.yml": "services: {}\n" };
  for (const [name, content] of Object.entries(assets)) writeFileSync(path.join(assetsDir, name), content);
  const sums = Object.entries(assets).map(([name, content]) => `${hash(content)}  ${name}`).join("\n") + "\n";
  writeFileSync(path.join(assetsDir, "SHA256SUMS"), sums);
  writeFileSync(path.join(assetsDir, "SHA256SUMS.sig"), "fixture signature\n");
  const record = [
    "recordId: release-supply-chain-v0.1.8", "recordedAt: 2026-07-18T09:00:00.000Z", "releaseTag: v0.1.8", `releaseUrl: ${releaseUrl}`,
    "workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/123", "workflowRunConclusion: success", `gitCommit: ${commit}`,
    "channel: stable", "packageVersion: 0.1.8", "validateJobStatus: pass", "auditProdStatus: pass", "governancePreflightStatus: pass", "actionsPinningStatus: pass", "releaseWorkflowStatus: pass",
    `webImageDigest: ${webDigest}`, `migrationImageDigest: ${migrationDigest}`, "manifestAsset: areaforge-release-manifest.json", "sbomAsset: areaforge-sbom.spdx.json", "provenanceAsset: areaforge-provenance.json", "sha256SumsAsset: SHA256SUMS", "signatureAsset: SHA256SUMS.sig",
    "sha256SumsCovers: areaforge-release-manifest.json,areaforge-sbom.spdx.json,areaforge-provenance.json,docker-compose.prod.yml",
    "checksumVerification: pass", "signatureVerification: pass", `manifestSha256: ${hash(manifest)}`, `sbomSha256: ${hash("{}\n")}`, `provenanceSha256: ${hash("{}\n")}`, `composeSha256: ${hash("services: {}\n")}`,
    "stableSigningRequired: yes", "unsignedPlaceholderPresent: no", "residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002", "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:", "  secretsPrinted: no", "  productionEnvIncluded: no", "  backupIncluded: no", "  promptOrRawAiResponseIncluded: no", "  attachmentContentIncluded: no", "  productionWriteAttempted: no", "",
  ].join("\n");
  return { record };
}

function createReleaseEvidence(releaseRecord: string): string {
  const supplyHash = buildReleaseSupplyChainEvidenceHash(parseIndentedKeyValueRecord(releaseRecord));
  const body = [
    "releaseId: rel-v0.1.8", "releasedAt: 2026-07-18T10:20:00.000Z", "operator: areasong", `gitCommit: ${commit}`, "releaseTag: v0.1.8",
    "AREAFORGE_IMAGE: ghcr.io/areasong/areaforge-web:v0.1.8", `imageDigest: sha256:${"b".repeat(64)}`, `webImageDigest: ${webDigest}`, `migrationImageDigest: ${migrationDigest}`,
    `composeHash: ${"1".repeat(64)}`, `nginxConfigHash: ${"2".repeat(64)}`, "previousImage: ghcr.io/areasong/areaforge-web:v0.1.7", "previousAppVersion: 0.1.7",
    "databaseBackupPath: redacted-root-only", `databaseBackupSha256: ${databaseBackupSha256}`, "uploadsBackupPath: redacted-root-only", `uploadsBackupSha256: ${"3".repeat(64)}`, "envBackupPath: redacted-root-only", `envBackupSha256: ${"4".repeat(64)}`,
    "composeConfigBackupPath: redacted-root-only", "nginxConfigBackupPath: redacted-root-only", `migrationVersion: ${migrationVersion}`, "migrationApplied: yes", "migrationRunner: one_off_migration_job",
    "preflight:", "  pnpmCheck: PASS", "  composeConfig: PASS", "  prodComposeConfig: PASS", "restoreDrill:", "  databaseImported: no", "  uploadsRestored: no", "  attachmentHashMatched: not-applicable",
    "postReleaseSmoke:", "  health: PASS", "  login: PASS", "  dashboard: PASS", "  taskTimerReview: PASS", "  syllabusNotesAnalyticsReports: PASS", "  attachmentSmoke: PASS", "  aiFallbackOrProvider: PASS",
    "rollbackDecision: application-only if required", "rollbackPlan: restore the previous immutable Web image and matching agent", "rollbackDrillResult: ready", "rollbackDurationMinutes: 0", "databaseRestoreRequired: no", "uploadsRestoreRequired: no", "rollbackFailureReason: none",
    `rollbackTargetImage: ${rollbackImage}`, `releaseSupplyChainEvidenceHash: ${supplyHash}`,
    "attachmentReconciliationCsvPath: attachment.csv", `attachmentReconciliationCsvSha256: sha256:${sha256(reconciliationCsv)}`,
    "attachmentReconciliationSummaryPath: attachment-summary.json",
    `attachmentReconciliationSummaryHash: ${String((JSON.parse(reconciliationSummary) as JsonRecord).summaryHash)}`,
    "attachmentReconciliationStatus: pass",
    "residualRisk: AF-RISK-OPS-001,AF-RISK-OPS-005,AF-RISK-OPS-006", "residualRiskIds: AF-RISK-OPS-001,AF-RISK-OPS-005,AF-RISK-OPS-006", "followUpTasks: tasks/indexes/residuals.md",
    "expectedFailureOrStopConditions:", "  migrationFailed: stop", "  smokeFailed: rollback", "  logLeakDetected: stop", "  attachmentHashMismatch: stop", "  backupMissing: stop", "",
  ].join("\n");
  const bundleHash = buildReleaseEvidenceBundleHash(parseIndentedKeyValueRecord(body));
  return body.replace("followUpTasks:", `releaseEvidenceBundleHash: ${bundleHash}\nfollowUpTasks:`);
}

function mutateRollout(mutator: (value: JsonRecord) => void): void {
  const value = readJson("rollout.json");
  mutator(value);
  value.rolloutHash = calculateOps006RolloutHash(value);
  writeJson("rollout.json", value);
}

function writeJson(file: string, value: JsonRecord): void {
  writeFileSync(path.join(evidenceDir, file), `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file: string): JsonRecord {
  return JSON.parse(readFileSync(path.join(evidenceDir, file), "utf8")) as JsonRecord;
}

function doctorHash(file: string): string {
  return String(readJson(file).doctorHash);
}

function fileHash(file: string): string {
  return `sha256:${sha256(readFileSync(path.join(evidenceDir, file), "utf8"))}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function replaceLine(lines: string[], key: string, value: string): void {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) throw new Error(`missing fixture field ${key}`);
  lines[index] = `${key}: ${value}`;
}

function rehashProductionRecord(record: string): string {
  const hash = calculateOps006ProductionEvidenceHash(parseIndentedKeyValueRecord(record));
  return record.replace(/recordHash: sha256:[a-f0-9]{64}/, `recordHash: ${hash}`);
}

function rehashReleaseEvidence(record: string): string {
  const hash = buildReleaseEvidenceBundleHash(parseIndentedKeyValueRecord(record));
  return record.replace(/releaseEvidenceBundleHash: sha256:[a-f0-9]{64}/, `releaseEvidenceBundleHash: ${hash}`);
}

function createReconciliationSummary(csv: string): string {
  const withoutHash = {
    schemaVersion: 1,
    mode: "read_only_attachment_reconciliation_summary",
    generatedAt: "2026-07-18T10:20:00.000Z",
    status: "pass",
    action: "report_only",
    source: {
      reconciliationCsvSha256: `sha256:${sha256(csv)}`,
      uploadDirectory: "configured_private_upload_directory",
    },
    counts: {
      databaseRecordCount: 0,
      uploadFileCount: 0,
      dbOnlyCount: 0,
      fileOnlyCount: 0,
      hashMismatchCount: 0,
      sizeMismatchCount: 0,
      invalidUriCount: 0,
      duplicateReferenceCount: 0,
      unsafeEntryCount: 0,
      unexpectedEntryCount: 0,
    },
    fileOnlyEntryHashes: [],
    unsafeEntryHashes: [],
    doesNotProve: [
      "automatic orphan cleanup",
      "attachment metadata repair",
      "backup restore success outside the scanned directory",
      "production health",
    ],
    safetyFacts: {
      readOnly: true,
      databaseWriteAttempted: false,
      uploadWriteAttempted: false,
      fileDeleted: false,
      fileMoved: false,
      metadataRepaired: false,
      fileContentIncluded: false,
      absolutePathIncluded: false,
      secretValuePrinted: false,
    },
  };
  return `${JSON.stringify({
    ...withoutHash,
    summaryHash: computeAttachmentReconciliationSummaryHash(withoutHash),
  }, null, 2)}\n`;
}

function exerciseBoundJsonNegativeCases(): void {
  const issues: Array<{ field: string; message: string }> = [];
  writeFileSync(path.join(evidenceDir, "invalid.json"), "not-json\n");
  readBoundJsonEvidence({
    baseDir: evidenceDir,
    relativeFile: "invalid.json",
    recordedHash: byteHash(path.join(evidenceDir, "invalid.json")),
    field: "invalidJson",
    issues,
  });
  assertBoundIssue(issues, "valid JSON");

  issues.length = 0;
  writeFileSync(path.join(evidenceDir, "duplicate.json"), '{"outer":{"mode":"invalid","mode":"valid"}}\n');
  readBoundJsonEvidence({
    baseDir: evidenceDir,
    relativeFile: "duplicate.json",
    recordedHash: byteHash(path.join(evidenceDir, "duplicate.json")),
    field: "duplicateJson",
    issues,
  });
  assertBoundIssue(issues, "duplicate JSON key");

  issues.length = 0;
  writeFileSync(path.join(evidenceDir, "invalid-utf8.json"), Buffer.from([0xff, 0xfe, 0xfd]));
  readBoundJsonEvidence({
    baseDir: evidenceDir,
    relativeFile: "invalid-utf8.json",
    recordedHash: byteHash(path.join(evidenceDir, "invalid-utf8.json")),
    field: "invalidUtf8",
    issues,
  });
  assertBoundIssue(issues, "valid UTF-8");

  issues.length = 0;
  writeFileSync(path.join(evidenceDir, "oversized.json"), JSON.stringify({ padding: "x".repeat(1024 * 1024) }));
  readBoundJsonEvidence({
    baseDir: evidenceDir,
    relativeFile: "oversized.json",
    recordedHash: byteHash(path.join(evidenceDir, "oversized.json")),
    field: "oversized",
    issues,
  });
  assertBoundIssue(issues, "must not exceed");

  issues.length = 0;
  symlinkSync("before-doctor.json", path.join(evidenceDir, "doctor-link.json"));
  readBoundJsonEvidence({
    baseDir: evidenceDir,
    relativeFile: "doctor-link.json",
    recordedHash: fileHash("before-doctor.json"),
    field: "symlink",
    issues,
  });
  assertBoundIssue(issues, "non-symlink");
}

function assertBoundIssue(issues: Array<{ field: string; message: string }>, message: string): void {
  if (!issues.some((issue) => issue.message.includes(message))) {
    throw new Error(`expected bound JSON issue ${message}, got ${JSON.stringify(issues)}`);
  }
}

function byteHash(file: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}
