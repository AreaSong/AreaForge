import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  canonicalSha256,
  computeProductExperienceSourceHash,
  currentGitCommit,
} from "./product-experience-source";
import { createDevelopmentRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-development";
import { getRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity";
import { buildReleaseEvidenceBundleHash } from "./release-evidence-validate";
import { computeAttachmentReconciliationSummaryHash } from "./attachment-reconciliation-summary";
import type { AttachmentReconciliationSummary } from "./attachment-reconciliation-summary";
import { buildDataIntegrityDoctor } from "../ops/data-integrity-doctor";
import { parseIndentedKeyValueRecord } from "./record-validator-common";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const developmentRuntimeIdentity = createDevelopmentRuntimeIdentity(root);
mkdirSync(path.join(root, "output"), { recursive: true });
const tempDir = mkdtempSync(path.join(root, "output/.tmp-long-term-gate-"));
const defaultOps004AlertPreview = "docs/development/ops-004-alert-preview-v0.1.7-20260712.json";
const defaultOps004AlertDrillRecord = "docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt";

try {
  const desktopScreenshot = path.join(tempDir, "desktop-dashboard.png");
  const mobileScreenshot = path.join(tempDir, "mobile-dashboard.png");
  writeFileSync(desktopScreenshot, "synthetic desktop screenshot evidence");
  writeFileSync(mobileScreenshot, "synthetic mobile screenshot evidence");
  const runtimeIdentityEvidence = path.join(tempDir, "runtime-identity.json");
  writeRuntimeIdentityEvidence(runtimeIdentityEvidence, "2026-07-10T00:00:00.000Z");
  const uxRecord = path.join(tempDir, "product-experience-review.txt");
  writeUxRecord(uxRecord, createUxRecord("2026-07-10T00:00:00.000Z", "0.1.7", desktopScreenshot, mobileScreenshot, runtimeIdentityEvidence));
  const releaseRecord = path.join(tempDir, "release-record.txt");
  const reconciliationCsv = path.join(tempDir, "attachment-reconciliation.csv");
  const reconciliationSummary = path.join(tempDir, "attachment-reconciliation-summary.json");
  const attachmentEvidence = createAttachmentEvidence();
  writeFileSync(reconciliationCsv, attachmentEvidence.csv);
  writeFileSync(reconciliationSummary, `${JSON.stringify(attachmentEvidence.summary, null, 2)}\n`);
  writeFileSync(releaseRecord, createReleaseRecord(attachmentEvidence.csv, attachmentEvidence.summary.summaryHash));
  const dataIntegrityRecord = path.join(tempDir, "data-integrity-doctor.json");
  writeFileSync(dataIntegrityRecord, `${JSON.stringify(createDataIntegrityRecord(attachmentEvidence.summary), null, 2)}\n`);
  const baseEnv = {
    AREAFORGE_LONG_TERM_UX_RECORD: uxRecord,
    AREAFORGE_LONG_TERM_GATE_NOW: "2026-07-11T00:00:00.000Z",
    AREAFORGE_LONG_TERM_RELEASE_RECORD: releaseRecord,
    AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD: dataIntegrityRecord,
  };

  const noOps004Evidence = runGate(baseEnv, 1);
  const noOps004EvidenceJson = parseGateJson(noOps004Evidence.stdout);
  assert(
    noOps004EvidenceJson.status === "needs_live_evidence",
    `missing OPS-004 evidence should block the gate, got ${String(noOps004EvidenceJson.status)}: ${JSON.stringify(
      (noOps004EvidenceJson.checks as JsonRecord[] | undefined)?.filter((check) => check.status === "invalid"),
    )}`,
  );
  assertCheckStatus(noOps004EvidenceJson, "ops004", "missing");
  assertCheckStatus(noOps004EvidenceJson, "ops005", "missing");
  assertCheckStatus(noOps004EvidenceJson, "dataIntegrity", "pass");

  const missingDataIntegrity = runGate({ ...baseEnv, AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD: "" }, 1);
  const missingDataIntegrityJson = parseGateJson(missingDataIntegrity.stdout);
  assertCheckStatus(missingDataIntegrityJson, "dataIntegrity", "missing");

  const currentOps004Evidence = runGate(baseEnv, 1, {
    clearOps004: false,
  });
  const currentOps004EvidenceJson = parseGateJson(currentOps004Evidence.stdout);
  assert(currentOps004EvidenceJson.status === "needs_live_evidence", "OPS-001 should still block even when OPS-004 passes");
  assertCheckStatus(currentOps004EvidenceJson, "ops004", "pass");
  const nextCommand = typeof currentOps004EvidenceJson.nextCommand === "string" ? currentOps004EvidenceJson.nextCommand : "";
  assert(nextCommand.includes("OPS-001"), "nextCommand should mention the remaining OPS-001 gap");
  assert(nextCommand.includes("OPS-005"), "nextCommand should mention the remaining OPS-005 gap");
  assert(!nextCommand.includes("OPS-004"), "nextCommand should not mention OPS-004 when it passes");

  const missingReleaseEvidence = runGate({
    ...baseEnv,
    AREAFORGE_LONG_TERM_RELEASE_RECORD: path.join(tempDir, "missing-release-record.txt"),
  }, 1, {
    clearOps004: false,
  });
  const missingReleaseEvidenceJson = parseGateJson(missingReleaseEvidence.stdout);
  assert(missingReleaseEvidenceJson.status === "needs_live_evidence", "missing release evidence should block the gate");
  assertCheckStatus(missingReleaseEvidenceJson, "releaseEvidence", "missing");
  const missingReleaseNextCommand = typeof missingReleaseEvidenceJson.nextCommand === "string"
    ? missingReleaseEvidenceJson.nextCommand
    : "";
  assert(
    missingReleaseNextCommand.includes("release:evidence:redacted-export:validate"),
    "missing release evidence nextCommand should mention the no-secret redacted export validator",
  );

  const missingEvidence = runGate(baseEnv, 1);
  const missingJson = parseGateJson(missingEvidence.stdout);
  assert(missingJson.status === "needs_live_evidence", "missing evidence should keep the live gate at needs_live_evidence");
  assertCheckStatus(missingJson, "uxReview", "pass");
  assertCheckStatus(missingJson, "ops001", "missing");
  assertCheckStatus(missingJson, "releaseEvidence", "pass");
  assertSafetyFacts(missingJson);

  const staleUx = runGate({
    ...baseEnv,
    AREAFORGE_LONG_TERM_GATE_NOW: "2026-08-10T00:00:00.000Z",
  }, 1);
  const staleJson = parseGateJson(staleUx.stdout);
  assert(staleJson.status === "needs_live_evidence", "stale UX should require fresh evidence");
  assertCheckStatus(staleJson, "uxReview", "stale");

  const invalidEvidence = runGate({
    ...baseEnv,
    AREAFORGE_OPS001_SMOKE_RECORD: path.join(tempDir, "missing-smoke-record.txt"),
  }, 1);
  const invalidJson = parseGateJson(invalidEvidence.stdout);
  assert(invalidJson.status === "invalid", "invalid child preflight should make the live gate invalid");
  assertCheckStatus(invalidJson, "ops001", "invalid");

  const oldVersionUxRecord = path.join(tempDir, "product-experience-review-old-version.txt");
  writeUxRecord(oldVersionUxRecord, createUxRecord("2026-07-10T00:00:00.000Z", "0.1.5", desktopScreenshot, mobileScreenshot, runtimeIdentityEvidence));
  const oldVersionUx = runGate({
    ...baseEnv,
    AREAFORGE_LONG_TERM_UX_RECORD: oldVersionUxRecord,
  }, 1);
  const oldVersionUxJson = parseGateJson(oldVersionUx.stdout);
  assert(oldVersionUxJson.status === "invalid", "old appVersion UX record should not satisfy the current-version gate");
  assertCheckStatus(oldVersionUxJson, "uxReview", "invalid");

  const mismatchedExpectedVersion = runGate({
    ...baseEnv,
    AREAFORGE_LONG_TERM_EXPECTED_VERSION: "9.9.9",
  }, 1);
  const mismatchedExpectedVersionJson = parseGateJson(mismatchedExpectedVersion.stdout);
  assertCheckStatus(mismatchedExpectedVersionJson, "uxReview", "invalid");

  console.log("long-term operability live gate selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function runGate(env: Record<string, string>, expectedStatus: number, options: { clearOps004?: boolean } = {}): SpawnSyncReturns<string> {
  const clearOps004 = options.clearOps004 ?? true;
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    AREAFORGE_OPS001_SMOKE_RECORD: "",
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: "",
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: "",
    AREAFORGE_OPS001_CLOSURE_PACKET: "",
    AREAFORGE_SC002_CI_RECORD: "",
    AREAFORGE_SC002_RELEASE_RECORD: "",
    AREAFORGE_OPS005_RELEASE_RECORD: "",
    AREAFORGE_OPS005_RELEASE_ASSETS_DIR: "",
    AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD: "",
    AREAFORGE_OPS005_GIT_COMMIT: "",
    AREAFORGE_LONG_TERM_UX_RECORD: "",
    AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD: "",
    ...env,
  };
  if (clearOps004) {
    childEnv.AREAFORGE_OPS004_ALERT_PREVIEW = "";
    childEnv.AREAFORGE_OPS004_ALERT_DRILL_RECORD = "";
  } else {
    childEnv.AREAFORGE_OPS004_ALERT_PREVIEW = process.env.AREAFORGE_OPS004_ALERT_PREVIEW ?? defaultOps004AlertPreview;
    childEnv.AREAFORGE_OPS004_ALERT_DRILL_RECORD = process.env.AREAFORGE_OPS004_ALERT_DRILL_RECORD ??
      (existsSync(path.resolve(defaultOps004AlertDrillRecord)) ? defaultOps004AlertDrillRecord : "");
  }

  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/long-term-operability-live-gate.ts"], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
  if (result.status !== expectedStatus) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`expected exit ${expectedStatus}, got ${String(result.status)}`);
  }
  return result;
}

function createUxRecord(
  reviewedAt: string,
  appVersion: string,
  desktopScreenshot: string,
  mobileScreenshot: string,
  runtimeIdentityEvidence: string,
): string {
  return [
    "recordId: product-experience-review-selftest",
    `reviewedAt: ${reviewedAt}`,
    "reviewer: AreaForge selftest",
    "environment: local",
    "baseUrl: http://127.0.0.1:3102",
    `appVersion: ${appVersion}`,
    `gitCommit: ${currentGitCommit(root)}`,
    `sourceFingerprintSchema: ${PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA}`,
    `productExperienceSourceHash: ${computeProductExperienceSourceHash(root)}`,
    `runtimeIdentityEvidence: ${path.relative(root, runtimeIdentityEvidence)}`,
    `runtimeIdentityEvidenceHash: sha256:${"0".repeat(64)}`,
    `runtimeIdentityHash: sha256:${"0".repeat(64)}`,
    "source: local UX smoke plus browser review",
    "reviewCommand: pnpm smoke:local-ux and playwright desktop/mobile browser review",
    "reviewStatus: pass",
    `reviewResultHash: sha256:${"0".repeat(64)}`,
    "viewports: desktop,mobile",
    "journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center",
    `screenshotEvidence: desktop=${path.relative(root, desktopScreenshot)}; mobile=${path.relative(root, mobileScreenshot)}`,
    `screenshotEvidenceHash: sha256:${"0".repeat(64)}`,
    "nextActionWithin5s: yes",
    "recommendationsExplainWhy: yes",
    "confirmOnlyBoundariesVisible: yes",
    "recoveryPathVisible: yes",
    "mobileReadable: yes",
    "emptyUnauthorizedErrorStatesChecked: yes",
    "residualRiskIds: AF-RISK-UX-001",
    "followUpTasks: none",
    "safetyFacts:",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  destructiveActionAttempted: no",
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "",
  ].join("\n");
}

function writeUxRecord(recordPath: string, draft: string): void {
  writeFileSync(recordPath, draft);
  const hashes = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/quality/product-experience-review-validate.ts", recordPath, "--print-record-hashes"],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    },
  );
  if (hashes.status !== 0) {
    throw new Error(`failed to generate UX record hashes: ${hashes.stderr || hashes.stdout}`);
  }
  const screenshotHash = hashes.stdout.match(/^screenshotEvidenceHash:\s*(sha256:[a-f0-9]{64})$/m)?.[1];
  const runtimeEvidenceHash = hashes.stdout.match(/^runtimeIdentityEvidenceHash:\s*(sha256:[a-f0-9]{64})$/m)?.[1];
  const runtimeIdentityHash = hashes.stdout.match(/^runtimeIdentityHash:\s*(sha256:[a-f0-9]{64})$/m)?.[1];
  const reviewHash = hashes.stdout.match(/^reviewResultHash:\s*(sha256:[a-f0-9]{64})$/m)?.[1];
  if (!runtimeEvidenceHash || !runtimeIdentityHash || !screenshotHash || !reviewHash) throw new Error("UX record hash output is incomplete");
  writeFileSync(
    recordPath,
    draft
      .replace(`runtimeIdentityEvidenceHash: sha256:${"0".repeat(64)}`, `runtimeIdentityEvidenceHash: ${runtimeEvidenceHash}`)
      .replace(`runtimeIdentityHash: sha256:${"0".repeat(64)}`, `runtimeIdentityHash: ${runtimeIdentityHash}`)
      .replace(`screenshotEvidenceHash: sha256:${"0".repeat(64)}`, `screenshotEvidenceHash: ${screenshotHash}`)
      .replace(`reviewResultHash: sha256:${"0".repeat(64)}`, `reviewResultHash: ${reviewHash}`),
  );
}

function writeRuntimeIdentityEvidence(file: string, observedAt: string): void {
  const runtimeIdentity = getRuntimeIdentity(new Date(observedAt), developmentRuntimeIdentity);
  const body = {
    schemaVersion: 1,
    baseUrl: "http://127.0.0.1:3102",
    observedAt,
    responseHash: canonicalSha256({
      ok: true,
      service: "AreaForge",
      version: runtimeIdentity.appVersion,
      runtimeIdentity,
    }),
    runtimeIdentity,
    safetyFacts: {
      requestMethod: "GET",
      productionWriteAttempted: false,
      serverCommandAttempted: false,
      secretValueIncluded: false,
    },
  };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
}

function createReleaseRecord(csv: string, summaryHash: string): string {
  let record = readFileSync(path.resolve("docs/development/release-v0.1.7-record.md"), "utf8")
    .replace(/^databaseBackupSha256: .+$/m, `databaseBackupSha256: ${"b".repeat(64)}`)
    .replace(/^uploadsBackupSha256: .+$/m, `uploadsBackupSha256: ${"c".repeat(64)}`)
    .replace(/^envBackupSha256: .+$/m, `envBackupSha256: ${"d".repeat(64)}`);
  const fields = [
    "attachmentReconciliationCsvPath: attachment-reconciliation.csv",
    `attachmentReconciliationCsvSha256: sha256:${createHash("sha256").update(csv).digest("hex")}`,
    "attachmentReconciliationSummaryPath: attachment-reconciliation-summary.json",
    `attachmentReconciliationSummaryHash: ${summaryHash}`,
    "attachmentReconciliationStatus: pass",
  ].join("\n");
  record = record.replace(/^preflight:\s*$/m, `${fields}\npreflight:`);
  const hash = buildReleaseEvidenceBundleHash(parseIndentedKeyValueRecord(record));
  return record.replace(/^releaseEvidenceBundleHash: .+$/m, `releaseEvidenceBundleHash: ${hash}`);
}

function createAttachmentEvidence(): { csv: string; summary: Record<string, unknown> & { summaryHash: string } } {
  const csv = "attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action\n";
  const withoutHash = {
    schemaVersion: 1,
    mode: "read_only_attachment_reconciliation_summary",
    generatedAt: "2026-07-11T00:00:00.000Z",
    status: "pass",
    action: "report_only",
    source: { reconciliationCsvSha256: `sha256:${createHash("sha256").update(csv).digest("hex")}`, uploadDirectory: "configured_private_upload_directory" },
    counts: { databaseRecordCount: 0, uploadFileCount: 0, dbOnlyCount: 0, fileOnlyCount: 0, hashMismatchCount: 0, sizeMismatchCount: 0, invalidUriCount: 0, duplicateReferenceCount: 0, unsafeEntryCount: 0, unexpectedEntryCount: 0 },
    fileOnlyEntryHashes: [],
    unsafeEntryHashes: [],
    doesNotProve: ["automatic orphan cleanup", "attachment metadata repair", "backup restore success outside the scanned directory", "production health"],
    safetyFacts: { readOnly: true, databaseWriteAttempted: false, uploadWriteAttempted: false, fileDeleted: false, fileMoved: false, metadataRepaired: false, fileContentIncluded: false, absolutePathIncluded: false, secretValuePrinted: false },
  };
  return { csv, summary: { ...withoutHash, summaryHash: computeAttachmentReconciliationSummaryHash(withoutHash) } };
}

function createDataIntegrityRecord(summary: Record<string, unknown>): Record<string, unknown> {
  return buildDataIntegrityDoctor({
    snapshot: {
      activeSessionCount: 1,
      staleActiveSessionCount: 0,
      runningWithPausedAtCount: 0,
      pausedWithoutPausedAtCount: 0,
      activeWithEndedAtCount: 0,
      terminalWithoutEndedAtCount: 0,
      terminalWithPausedAtCount: 0,
      negativeSessionMetricsCount: 0,
      doneWithoutCompletedAtCount: 0,
      nonDoneWithCompletedAtCount: 0,
      doneWithDebtCount: 0,
      negativeTaskMinutesCount: 0,
    },
    attachmentSummary: summary as unknown as AttachmentReconciliationSummary,
    generatedAt: "2026-07-10T12:00:00.000Z",
    databaseReadAttempted: true,
  }) as unknown as Record<string, unknown>;
}

function parseGateJson(raw: string): JsonRecord {
  const parsed = JSON.parse(raw) as JsonRecord;
  assert(parsed.mode === "read_only_long_term_operability_live_gate", "gate mode missing");
  assert(parsed.schemaVersion === 2, "gate schemaVersion must be 2 after OPS-005 admission");
  return parsed;
}

function assertCheckStatus(parsed: JsonRecord, key: string, status: string): void {
  const checks = parsed.checks as JsonRecord[] | undefined;
  const check = checks?.find((item) => item.key === key);
  assert(Boolean(check), `missing check ${key}`);
  assert(check?.status === status, `expected ${key} status ${status}, got ${String(check?.status)}`);
}

function assertSafetyFacts(parsed: JsonRecord): void {
  const safety = parsed.safetyFacts as JsonRecord | undefined;
  assert(Boolean(safety), "safetyFacts missing");
  for (const key of [
    "githubApiCalled",
    "serverCommandAttempted",
    "backupRestoreAttempted",
    "migrationAttempted",
    "productionWriteAttempted",
    "updaterApplyAttempted",
    "residualLedgerUpdated",
    "secretValuePrinted",
  ]) {
    assert(safety?.[key] === false, `safetyFacts.${key} should be false`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
