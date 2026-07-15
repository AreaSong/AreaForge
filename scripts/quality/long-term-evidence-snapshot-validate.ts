import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDataIntegritySnapshotCheck,
  collectEvidencePaths,
  type SnapshotCheck,
} from "../ops/long-term-evidence-snapshot";
import { buildOperabilityStatusProjection, protectedPathFiles } from "../ops/operability-status";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";

type JsonRecord = Record<string, unknown>;
type BindingMode = "current" | "shape-only";
type ValidationOptions = {
  bindingMode?: BindingMode;
  allowCurrentSchemaShapeOnlyForSelftest?: boolean;
};

const requiredCheckKeysV1 = [
  "controlPlane",
  "ops001",
  "ops004",
  "releaseEvidenceRecord",
  "supplyChain",
  "uxReview",
  "operationalEvidenceBundle",
];
const requiredCheckKeysV2 = [
  "controlPlane",
  "ops001",
  "ops004",
  "ops005",
  "releaseEvidenceRecord",
  "supplyChain",
  "uxReview",
  "operationalEvidenceBundle",
];
const requiredCheckKeysV3 = [
  "controlPlane",
  "ops001",
  "ops004",
  "ops005",
  "dataIntegrity",
  "releaseEvidenceRecord",
  "supplyChain",
  "uxReview",
  "operationalEvidenceBundle",
];

const requiredSignalKeys = [
  "health",
  "releaseIdentity",
  "updateAgent",
  "authenticatedSmoke",
  "backup",
  "rollback",
  "infrastructure",
];

const requiredForbiddenActions = [
  "execute_server_command",
  "apply_update",
  "run_migration",
  "perform_backup",
  "perform_restore",
  "rollback_release",
  "write_database",
  "write_upload_directory",
  "trigger_production_write_smoke",
  "read_or_print_secret_values",
  "create_github_release",
  "push_git_tag",
  "download_release_assets",
  "call_github_api",
  "update_residual_ledger",
  "send_notification",
  "call_external_alert_receiver",
];

const requiredDoesNotProve = [
  "current production health without post-version live smoke and update-agent evidence",
  "OPS-001 closure or residual ledger closure",
  "OPS-004 alert recovery drill completion or residual ledger closure",
  "release evidence record validation when backup hashes are root-only or missing",
  "backup freshness, restore execution, migration execution, or rollback execution",
  "GitHub Release creation or release asset download",
  "production write smoke safety",
];
const requiredDoesNotProveV2 = [
  ...requiredDoesNotProve,
  "OPS-005 expected-before V2 implementation, signed Release, production deployment, or residual ledger closure without ready_for_ops005_human_review evidence",
];
const requiredDoesNotProveV3 = [
  ...requiredDoesNotProveV2,
  "OPS-006 concurrency safety or residual closure from a passing data-integrity doctor record",
];

const requiredProtectedPathDoesNotProve = [
  "production health",
  "absence of changes outside protected paths",
  "git worktree cleanliness",
];

const falseSafetyFacts = [
  "networkRequested",
  "githubApiCalled",
  "serverCommandAttempted",
  "backupRestoreAttempted",
  "migrationAttempted",
  "productionWriteAttempted",
  "updaterApplyAttempted",
  "residualLedgerUpdated",
  "secretValuePrinted",
  "destructiveActionAttempted",
  "realStudyContentIncluded",
  "passwordValuePrinted",
  "writeSmokeAttempted",
  "releaseCreated",
  "tagPushed",
  "releaseAssetsDownloaded",
  "productionEnvIncluded",
  "backupIncluded",
  "notificationSent",
  "externalAlertReceiverCalled",
] as const;

function main(): void {
  const args = process.argv.slice(2);
  const shapeOnly = args.includes("--shape-only");
  const snapshotPath = args.find((arg) => arg !== "--shape-only" && arg !== "--");
  if (!snapshotPath) {
    console.error("Usage: pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json> [--shape-only]");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(snapshotPath));
  const options = { bindingMode: shapeOnly ? "shape-only" as const : "current" as const };
  const bindingStatus = longTermEvidenceSnapshotBindingStatus(raw, options);
  const issues = validateLongTermEvidenceSnapshot(raw, options);
  console.log(`bindingStatus: ${bindingStatus}`);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`long-term evidence snapshot validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("long-term evidence snapshot validation passed: hash, required checks, signal inventory, claim boundaries, forbidden actions, and safety facts are present.");
  console.log(`longTermEvidenceSnapshotRecordHash: sha256:${sha256(extractJson(raw))}`);
  console.log("safetyFacts: readOnly=true networkRequested=false serverCommandAttempted=false productionWriteAttempted=false residualLedgerUpdated=false secretValuePrinted=false");
}

export function validateLongTermEvidenceSnapshot(raw: string, options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parseSnapshot(raw, issues);
  if (!body) return issues;

  const schemaVersion = body.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
    issues.push({ field: "schemaVersion", message: "must be 1/2 for historical non-ready snapshots or 3 for current snapshots" });
  }
  requireValue(body.mode, "mode", "read_only_long_term_evidence_snapshot", issues);
  requireIso(body.generatedAt, "generatedAt", issues);
  requireSha256Value(body.snapshotHash, "snapshotHash", issues);
  validateHash(body, issues);
  requireVersion(body.expectedVersion, "expectedVersion", issues);
  requireVersion(body.packageVersion, "packageVersion", issues);
  if (body.expectedVersion !== body.packageVersion) {
    issues.push({ field: "packageVersion", message: "must match expectedVersion" });
  }
  if (body.releaseTag !== `v${String(body.packageVersion)}`) {
    issues.push({ field: "releaseTag", message: "must equal v + packageVersion" });
  }
  requireValue(body.scope, "scope", "long_term_operability_current_checkout", issues);
  requireOneOf(body.status, "status", [
    "ready_for_long_term_operability_review",
    "needs_live_evidence",
    "invalid",
  ], issues);
  if (schemaVersion === 3) requireString(body.nextCommand, "nextCommand", issues);
  if (schemaVersion === 1 && body.status === "ready_for_long_term_operability_review") {
    issues.push({ field: "status", message: "schemaVersion 1 cannot prove current long-term operability because it predates OPS-005" });
  }
  if (schemaVersion === 2 && body.status === "ready_for_long_term_operability_review") {
    issues.push({ field: "status", message: "schemaVersion 2 cannot prove current long-term operability because it predates the OPS-006 data-integrity binding" });
  }
  validateSourceSnapshot(body.sourceSnapshot, schemaVersion, issues);
  validateCurrentBinding(body, options, issues);
  validateChecks(body.checks, body.status, schemaVersion, issues);
  validateEvidenceBindings(body.sourceSnapshot, body.checks, schemaVersion, issues);
  if (schemaVersion === 3) validateNextCommand(body.nextCommand, body.status, body.checks, issues);
  const requiredNonProofs = schemaVersion === 3
    ? requiredDoesNotProveV3
    : schemaVersion === 2 ? requiredDoesNotProveV2 : requiredDoesNotProve;
  validateArray(body.doesNotProve, "doesNotProve", requiredNonProofs, issues);
  validateArray(body.forbiddenActions, "forbiddenActions", requiredForbiddenActions, issues);
  validateSafetyFacts(body.safetyFacts, issues);

  return issues;
}

export function longTermEvidenceSnapshotBindingStatus(
  raw: string,
  options: ValidationOptions = {},
): "current" | "stale" | "unavailable" {
  if ((options.bindingMode ?? "current") === "shape-only") return "unavailable";
  const issues: ValidationIssue[] = [];
  const body = parseSnapshot(raw, issues);
  if (!body || body.schemaVersion !== 3 || !isRecord(body.sourceSnapshot)) return "unavailable";
  try {
    return currentBindingIssues(body).length === 0 ? "current" : "stale";
  } catch {
    return "unavailable";
  }
}

function validateCurrentBinding(body: JsonRecord, options: ValidationOptions, issues: ValidationIssue[]): void {
  if ((options.bindingMode ?? "current") === "shape-only") {
    if (body.schemaVersion === 3 && options.allowCurrentSchemaShapeOnlyForSelftest !== true) {
      issues.push({ field: "sourceSnapshot.currentBinding", message: "schema v3 requires current binding; --shape-only is only for historical v1/v2 archives" });
    }
    return;
  }
  if (body.schemaVersion !== 3) {
    issues.push({ field: "sourceSnapshot.currentBinding", message: "historical schema requires --shape-only validation" });
    return;
  }
  try {
    for (const issue of currentBindingIssues(body)) {
      issues.push({ field: issue.field, message: issue.message });
    }
  } catch {
    issues.push({ field: "sourceSnapshot.currentBinding", message: "current binding is unavailable; use --shape-only only for historical archives" });
  }
}

function currentBindingIssues(body: JsonRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(body.sourceSnapshot)) return [{ field: "sourceSnapshot.currentBinding", message: "source snapshot is unavailable" }];
  const sourceSnapshot = body.sourceSnapshot;
  const projection = buildOperabilityStatusProjection();
  if (body.packageVersion !== projection.app.version || body.expectedVersion !== projection.app.version || body.releaseTag !== projection.app.releaseTag) {
    issues.push({ field: "packageVersion.currentBinding", message: "does not match the current package version and release tag" });
  }
  if (sourceSnapshot.controlPlaneSourceHash !== projection.sourceSnapshot.controlPlaneSourceHash) {
    issues.push({ field: "sourceSnapshot.controlPlaneSourceHash.currentBinding", message: "does not match the current checkout" });
  }
  if (!isRecord(sourceSnapshot.protectedPathFingerprint) ||
    sourceSnapshot.protectedPathFingerprint.hash !== projection.sourceSnapshot.protectedPathFingerprint.hash) {
    issues.push({ field: "sourceSnapshot.protectedPathFingerprint.hash.currentBinding", message: "does not match the current checkout" });
  }
  if (!Array.isArray(sourceSnapshot.evidencePaths)) {
    issues.push({ field: "sourceSnapshot.evidencePaths.currentBinding", message: "current evidence paths are unavailable" });
    return issues;
  }
  const currentPaths = collectEvidencePaths();
  const recorded = new Map<string, JsonRecord>();
  for (const item of sourceSnapshot.evidencePaths) {
    if (isRecord(item) && typeof item.key === "string") recorded.set(item.key, item);
  }
  const pathMismatch = recorded.size !== currentPaths.length || !currentPaths.every((current) => {
    const saved = recorded.get(current.key);
    return Boolean(saved) &&
      saved?.pathLabel === current.pathLabel &&
      saved?.configured === current.configured &&
      saved?.exists === current.exists &&
      saved?.sha256 === current.sha256;
  });
  if (pathMismatch) {
    issues.push({ field: "sourceSnapshot.evidencePaths.currentBinding", message: "does not match the currently configured evidence inputs" });
  }
  const savedDataCheck = Array.isArray(body.checks)
    ? body.checks.find((item) => isRecord(item) && item.key === "dataIntegrity")
    : undefined;
  const currentDataCheck = buildDataIntegritySnapshotCheck(currentPaths);
  if (!isRecord(savedDataCheck) || stableStringify(dataIntegrityBindingShape(savedDataCheck)) !== stableStringify(dataIntegrityBindingShape(currentDataCheck))) {
    issues.push({ field: "checks.dataIntegrity.currentBinding", message: "does not match the current doctor record semantics or freshness" });
  }
  return issues;
}

function dataIntegrityBindingShape(check: JsonRecord | SnapshotCheck): JsonRecord {
  const freshness = isRecord(check.freshness) ? check.freshness : {};
  return {
    status: check.status,
    actualStatus: check.actualStatus,
    expectedStatus: check.expectedStatus,
    evidenceHash: check.evidenceHash,
    residualRiskIds: check.residualRiskIds,
    freshness: {
      generatedAt: freshness.generatedAt ?? null,
      maxAgeHours: freshness.maxAgeHours ?? null,
      status: freshness.status ?? "unknown",
    },
    metadata: check.metadata,
  };
}

function parseSnapshot(raw: string, issues: ValidationIssue[]): JsonRecord | null {
  try {
    const parsed = JSON.parse(extractJson(raw)) as unknown;
    if (!isRecord(parsed)) {
      issues.push({ field: "json", message: "must be a JSON object" });
      return null;
    }
    return parsed;
  } catch (error) {
    issues.push({ field: "json", message: error instanceof Error ? error.message : "invalid JSON" });
    return null;
  }
}

function extractJson(raw: string): string {
  const firstBrace = raw.indexOf("{");
  if (firstBrace < 0) return raw;
  const lastBrace = raw.lastIndexOf("}");
  return lastBrace >= firstBrace ? raw.slice(firstBrace, lastBrace + 1).trim() : raw.slice(firstBrace).trim();
}

function validateHash(body: JsonRecord, issues: ValidationIssue[]): void {
  if (typeof body.snapshotHash !== "string") return;
  const expected = hashSnapshot(body);
  if (body.snapshotHash !== expected) {
    issues.push({ field: "snapshotHash", message: "does not match canonical snapshot content" });
  }
}

function validateSourceSnapshot(value: unknown, schemaVersion: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "sourceSnapshot", message: "must be an object" });
    return;
  }
  requireSha256Value(value.controlPlaneSourceHash, "sourceSnapshot.controlPlaneSourceHash", issues);
  validateProtectedPathFingerprint(value.protectedPathFingerprint, schemaVersion, issues);
  if (!Array.isArray(value.files) || value.files.length === 0) {
    issues.push({ field: "sourceSnapshot.files", message: "must be a non-empty array" });
  }
  if (!Array.isArray(value.missingFiles)) {
    issues.push({ field: "sourceSnapshot.missingFiles", message: "must be an array" });
  }
  validateEvidencePaths(value.evidencePaths, "sourceSnapshot.evidencePaths", schemaVersion, issues);
  validateInputHashes(value.inputHashes, issues);
}

function validateProtectedPathFingerprint(value: unknown, schemaVersion: unknown, issues: ValidationIssue[]): void {
  const field = "sourceSnapshot.protectedPathFingerprint";
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  requireValue(value.algorithm, `${field}.algorithm`, "sha256", issues);
  requireValue(value.scope, `${field}.scope`, "read_only_side_effect_guard_inputs", issues);
  if (schemaVersion === 1 || schemaVersion === 2) {
    validateHistoricalProtectedPaths(value.paths, `${field}.paths`, issues);
  } else {
    validateExactStringArray(value.paths, `${field}.paths`, [...protectedPathFiles], issues);
  }
  requireSha256Value(value.hash, `${field}.hash`, issues);
  validateArray(value.doesNotProve, `${field}.doesNotProve`, requiredProtectedPathDoesNotProve, issues);
}

function validateHistoricalProtectedPaths(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field, message: "must be a non-empty historical protected path array" });
    return;
  }
  const currentPaths = new Set<string>(protectedPathFiles);
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      issues.push({ field: `${field}[${index}]`, message: "must be a non-empty string" });
      continue;
    }
    if (item.startsWith("/") || item.split("/").includes("..")) {
      issues.push({ field: `${field}[${index}]`, message: "must be a safe repository-relative path" });
    }
    if (!currentPaths.has(item)) {
      issues.push({ field: `${field}[${index}]`, message: "must remain a member of the current protected path superset" });
    }
    if (seen.has(item)) {
      issues.push({ field: `${field}[${index}]`, message: "must not contain duplicates" });
    }
    seen.add(item);
  }
}

function validateEvidencePaths(value: unknown, field: string, schemaVersion: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array" });
    return;
  }
  const byKey = new Set<string>();
  for (const [index, item] of value.entries()) {
    const prefix = `${field}[${index}]`;
    if (!isRecord(item)) {
      issues.push({ field: prefix, message: "must be an object" });
      continue;
    }
    requireString(item.key, `${prefix}.key`, issues);
    if (typeof item.key === "string") byKey.add(item.key);
    if (!(typeof item.pathLabel === "string" || item.pathLabel === null)) {
      issues.push({ field: `${prefix}.pathLabel`, message: "must be string or null" });
    }
    requireBoolean(item.configured, `${prefix}.configured`, issues);
    requireBoolean(item.exists, `${prefix}.exists`, issues);
    if (!(typeof item.sha256 === "string" || item.sha256 === null)) {
      issues.push({ field: `${prefix}.sha256`, message: "must be sha256 string or null" });
    } else if (typeof item.sha256 === "string") {
      requirePrefixedSha256(item.sha256, `${prefix}.sha256`, issues);
    }
    if (typeof item.pathLabel === "string" && item.pathLabel.startsWith("/")) {
      issues.push({ field: `${prefix}.pathLabel`, message: "must not expose absolute paths" });
    }
  }
  const requiredPaths = ["releaseEvidenceRecord", "releaseSupplyChainRecord", "uxReviewRecord", "operationalEvidenceBundle", "ops004AlertPreview"];
  if (schemaVersion === 2 || schemaVersion === 3) requiredPaths.push("ops005ProductionEvidence");
  if (schemaVersion === 3) requiredPaths.push("dataIntegrityRecord");
  for (const key of requiredPaths) {
    if (!byKey.has(key)) {
      issues.push({ field, message: `missing evidence path ${key}` });
    }
  }
}

function validateInputHashes(value: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "sourceSnapshot.inputHashes", message: "must be an array" });
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `sourceSnapshot.inputHashes[${index}]`, message: "must be an object" });
      continue;
    }
    requireString(item.key, `sourceSnapshot.inputHashes[${index}].key`, issues);
    if (!(typeof item.pathLabel === "string" || item.pathLabel === null)) {
      issues.push({ field: `sourceSnapshot.inputHashes[${index}].pathLabel`, message: "must be string or null" });
    }
    requirePrefixedSha256(item.sha256, `sourceSnapshot.inputHashes[${index}].sha256`, issues);
  }
}

function validateEvidenceBindings(
  sourceValue: unknown,
  checksValue: unknown,
  schemaVersion: unknown,
  issues: ValidationIssue[],
): void {
  if (!isRecord(sourceValue) || !Array.isArray(sourceValue.evidencePaths) || !Array.isArray(sourceValue.inputHashes)) return;
  const paths = new Map<string, JsonRecord>();
  for (const item of sourceValue.evidencePaths) {
    if (!isRecord(item) || typeof item.key !== "string") continue;
    if (paths.has(item.key)) issues.push({ field: "sourceSnapshot.evidencePaths", message: `duplicate key ${item.key}` });
    paths.set(item.key, item);
  }
  const hashes = new Map<string, JsonRecord>();
  for (const item of sourceValue.inputHashes) {
    if (!isRecord(item) || typeof item.key !== "string") continue;
    if (hashes.has(item.key)) issues.push({ field: "sourceSnapshot.inputHashes", message: `duplicate key ${item.key}` });
    hashes.set(item.key, item);
  }
  for (const [key, evidencePath] of paths) {
    const inputHash = hashes.get(key);
    if (typeof evidencePath.sha256 === "string") {
      if (!inputHash || inputHash.sha256 !== evidencePath.sha256 || inputHash.pathLabel !== evidencePath.pathLabel) {
        issues.push({ field: "sourceSnapshot.inputHashes", message: `must bind evidence path ${key}` });
      }
    } else if (inputHash) {
      issues.push({ field: "sourceSnapshot.inputHashes", message: `must not contain unhashed evidence path ${key}` });
    }
  }
  for (const key of hashes.keys()) {
    if (!paths.has(key)) issues.push({ field: "sourceSnapshot.inputHashes", message: `unknown evidence path ${key}` });
  }
  if (schemaVersion !== 3 || !Array.isArray(checksValue)) return;
  const dataCheck = checksValue.find((item) => isRecord(item) && item.key === "dataIntegrity");
  const dataPath = paths.get("dataIntegrityRecord");
  if (!isRecord(dataCheck) || !dataPath) return;
  if (dataCheck.evidenceHash !== dataPath.sha256) {
    issues.push({ field: "checks.dataIntegrity.evidenceHash", message: "must match dataIntegrityRecord file sha256" });
  }
  if (dataCheck.status === "pass" && (dataPath.configured !== true || dataPath.exists !== true || typeof dataPath.sha256 !== "string")) {
    issues.push({ field: "sourceSnapshot.evidencePaths.dataIntegrityRecord", message: "must be configured, present, and hashed when data integrity passes" });
  }
}

function validateNextCommand(value: unknown, status: unknown, checksValue: unknown, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !Array.isArray(checksValue)) return;
  const nonPassKeys = checksValue
    .filter((item): item is JsonRecord => isRecord(item) && item.status !== "pass" && typeof item.key === "string")
    .map((item) => String(item.key));
  const expected = status === "ready_for_long_term_operability_review"
    ? "review residual close conditions without automatic closure"
    : status === "invalid"
      ? `fix invalid checks and rerun snapshot: ${nonPassKeys.join(",")}`
      : `collect or refresh evidence and rerun snapshot: ${nonPassKeys.join(",")}`;
  if (value !== expected) {
    issues.push({ field: "nextCommand", message: `must equal canonical command for ${String(status)}` });
  }
}

function validateChecks(value: unknown, snapshotStatus: unknown, schemaVersion: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "checks", message: "must be an array" });
    return;
  }
  const byKey = new Map<string, JsonRecord>();
  for (const [index, check] of value.entries()) {
    const prefix = `checks[${index}]`;
    if (!isRecord(check)) {
      issues.push({ field: prefix, message: "must be an object" });
      continue;
    }
    validateCheck(check, prefix, issues);
    if (typeof check.key === "string") byKey.set(check.key, check);
  }
  const requiredCheckKeys = schemaVersion === 3
    ? requiredCheckKeysV3
    : schemaVersion === 2 ? requiredCheckKeysV2 : requiredCheckKeysV1;
  const missing = requiredCheckKeys.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    issues.push({ field: "checks", message: `missing required checks: ${missing.join(", ")}` });
  }
  validateReleaseEvidenceRecordCheck(byKey.get("releaseEvidenceRecord"), issues);
  if (schemaVersion === 2 || schemaVersion === 3) validateOps005Check(byKey.get("ops005"), issues);
  if (schemaVersion === 3) validateDataIntegrityCheck(byKey.get("dataIntegrity"), issues);
  validateOperationalEvidenceBundleCheck(byKey.get("operationalEvidenceBundle"), issues);
  validateNoGreenwash(byKey, snapshotStatus, requiredCheckKeys, issues);
}

function validateCheck(check: JsonRecord, prefix: string, issues: ValidationIssue[]): void {
  requireString(check.key, `${prefix}.key`, issues);
  requireString(check.label, `${prefix}.label`, issues);
  requireOneOf(check.status, `${prefix}.status`, ["pass", "needs_live_evidence", "missing", "stale", "invalid"], issues);
  requireString(check.actualStatus, `${prefix}.actualStatus`, issues);
  requireString(check.expectedStatus, `${prefix}.expectedStatus`, issues);
  requireString(check.validatorCommand, `${prefix}.validatorCommand`, issues);
  if (!(typeof check.evidenceHash === "string" || check.evidenceHash === null)) {
    issues.push({ field: `${prefix}.evidenceHash`, message: "must be sha256 string or null" });
  } else if (typeof check.evidenceHash === "string") {
    requirePrefixedSha256(check.evidenceHash, `${prefix}.evidenceHash`, issues);
  }
  if (!Array.isArray(check.residualRiskIds)) {
    issues.push({ field: `${prefix}.residualRiskIds`, message: "must be an array" });
  }
  if (!isRecord(check.freshness)) {
    issues.push({ field: `${prefix}.freshness`, message: "must be an object" });
  }
  if (!(typeof check.versionMatch === "boolean" || check.versionMatch === "not_applicable")) {
    issues.push({ field: `${prefix}.versionMatch`, message: "must be boolean or not_applicable" });
  }
  if (!Array.isArray(check.doesNotProve) || check.doesNotProve.length === 0) {
    issues.push({ field: `${prefix}.doesNotProve`, message: "must be a non-empty array" });
  }
  if (!isRecord(check.metadata)) {
    issues.push({ field: `${prefix}.metadata`, message: "must be an object" });
  }
}

function validateReleaseEvidenceRecordCheck(check: JsonRecord | undefined, issues: ValidationIssue[]): void {
  if (!check) return;
  const metadata = isRecord(check.metadata) ? check.metadata : {};
  for (const key of [
    "releaseEvidenceBundleHashStatus",
    "databaseBackupSha256Status",
    "uploadsBackupSha256Status",
    "envBackupSha256Status",
  ]) {
    requireString(metadata[key], `checks.releaseEvidenceRecord.metadata.${key}`, issues);
  }
}

function validateOperationalEvidenceBundleCheck(check: JsonRecord | undefined, issues: ValidationIssue[]): void {
  if (!check) return;
  const metadata = isRecord(check.metadata) ? check.metadata : {};
  const signals = isRecord(metadata.signals) ? metadata.signals : {};
  const missingSignals = requiredSignalKeys.filter((key) => !isRecord(signals[key]));
  if (missingSignals.length > 0) {
    issues.push({ field: "checks.operationalEvidenceBundle.metadata.signals", message: `missing ${missingSignals.join(", ")}` });
  }
  for (const key of requiredSignalKeys) {
    const signal = isRecord(signals[key]) ? signals[key] : {};
    requireString(signal.status, `checks.operationalEvidenceBundle.metadata.signals.${key}.status`, issues);
    requireString(signal.freshnessStatus, `checks.operationalEvidenceBundle.metadata.signals.${key}.freshnessStatus`, issues);
  }
  requireString(metadata.bundleStatus, "checks.operationalEvidenceBundle.metadata.bundleStatus", issues);
  requireString(metadata.summaryOverall, "checks.operationalEvidenceBundle.metadata.summaryOverall", issues);
  requireString(metadata.latestEvidenceFreshnessStatus, "checks.operationalEvidenceBundle.metadata.latestEvidenceFreshnessStatus", issues);
}

function validateOps005Check(check: JsonRecord | undefined, issues: ValidationIssue[]): void {
  if (!check) return;
  const metadata = isRecord(check.metadata) ? check.metadata : {};
  for (const key of [
    "localImplementation",
    "signedRelease",
    "productionDeployment",
    "v2Check",
    "expectedBeforeRejection",
    "expectedBeforeRejectionExecutionAttempted",
    "sharedProductionStateLock",
    "processingReconciliation",
    "autoApply",
  ]) {
    requireString(metadata[key], `checks.ops005.metadata.${key}`, issues);
  }
  const freshness = isRecord(check.freshness) ? check.freshness : {};
  requireString(freshness.status, "checks.ops005.freshness.status", issues);
  if (check.status !== "pass") return;
  if (check.actualStatus !== "ready_for_ops005_human_review") {
    issues.push({ field: "checks.ops005.status", message: "can pass only when actualStatus is ready_for_ops005_human_review" });
  }
  if (check.versionMatch !== true) {
    issues.push({ field: "checks.ops005.versionMatch", message: "can pass only when production evidence matches current version and release" });
  }
  if (freshness.status !== "fresh") {
    issues.push({ field: "checks.ops005.freshness.status", message: "must be fresh when OPS-005 passes" });
  }
  const expected: Record<string, string> = {
    localImplementation: "pass",
    signedRelease: "pass",
    productionDeployment: "pass",
    v2Check: "pass",
    expectedBeforeRejection: "pass",
    expectedBeforeRejectionExecutionAttempted: "no",
    sharedProductionStateLock: "pass",
    processingReconciliation: "pass",
    autoApply: "none",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) issues.push({ field: `checks.ops005.metadata.${key}`, message: `must be ${value} when OPS-005 passes` });
  }
  if (typeof metadata.gitCommit !== "string" || !/^[a-f0-9]{40}$/i.test(metadata.gitCommit)) {
    issues.push({ field: "checks.ops005.metadata.gitCommit", message: "must be a 40-character commit when OPS-005 passes" });
  }
  if (typeof metadata.releaseTag !== "string" || !/^v\d+\.\d+\.\d+/.test(metadata.releaseTag)) {
    issues.push({ field: "checks.ops005.metadata.releaseTag", message: "must be a release tag when OPS-005 passes" });
  }
}

function validateDataIntegrityCheck(check: JsonRecord | undefined, issues: ValidationIssue[]): void {
  if (!check) return;
  const metadata = isRecord(check.metadata) ? check.metadata : {};
  for (const key of [
    "doctorMode",
    "overall",
    "native",
    "databaseSource",
    "attachmentStatus",
    "doctorHash",
  ]) {
    requireString(metadata[key], `checks.dataIntegrity.metadata.${key}`, issues);
  }
  requireBoolean(metadata.databaseReadAttempted, "checks.dataIntegrity.metadata.databaseReadAttempted", issues);
  const freshness = isRecord(check.freshness) ? check.freshness : {};
  requireString(freshness.status, "checks.dataIntegrity.freshness.status", issues);
  if (check.status !== "pass") return;
  if (check.actualStatus !== "pass") {
    issues.push({ field: "checks.dataIntegrity.status", message: "can pass only when doctor overall is pass" });
  }
  if (freshness.status !== "fresh") {
    issues.push({ field: "checks.dataIntegrity.freshness.status", message: "must be fresh when data integrity passes" });
  }
  const expected: Record<string, string | boolean> = {
    doctorMode: "read_only_data_integrity_doctor",
    overall: "pass",
    native: "integrity_clean",
    databaseSource: "configured_read_only_query",
    databaseReadAttempted: true,
    attachmentStatus: "pass",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) {
      issues.push({ field: `checks.dataIntegrity.metadata.${key}`, message: `must be ${String(value)} when data integrity passes` });
    }
  }
  requirePrefixedSha256(metadata.doctorHash, "checks.dataIntegrity.metadata.doctorHash", issues);
}

function validateNoGreenwash(
  byKey: Map<string, JsonRecord>,
  snapshotStatus: unknown,
  requiredCheckKeys: string[],
  issues: ValidationIssue[],
): void {
  const ops001 = byKey.get("ops001");
  if (ops001?.status === "pass" && ops001.actualStatus !== "ready_for_human_close") {
    issues.push({ field: "checks.ops001.status", message: "can pass only when actualStatus is ready_for_human_close" });
  }
  const ops004 = byKey.get("ops004");
  if (ops004?.status === "pass" && ops004.actualStatus !== "ready_for_human_close") {
    issues.push({ field: "checks.ops004.status", message: "can pass only when actualStatus is ready_for_human_close" });
  }
  const ops005 = byKey.get("ops005");
  if (ops005?.status === "pass" && ops005.actualStatus !== "ready_for_ops005_human_review") {
    issues.push({ field: "checks.ops005.status", message: "OPS-005 can pass only at ready_for_ops005_human_review" });
  }
  const dataIntegrity = byKey.get("dataIntegrity");
  if (dataIntegrity?.status === "pass" && dataIntegrity.actualStatus !== "pass") {
    issues.push({ field: "checks.dataIntegrity.status", message: "data integrity can pass only when doctor overall is pass" });
  }
  const supplyChain = byKey.get("supplyChain");
  if (supplyChain?.status === "pass" && supplyChain.actualStatus !== "ready_for_sc001_sc002_review") {
    issues.push({ field: "checks.supplyChain.status", message: "CI-only supply-chain evidence must not pass the long-term snapshot" });
  }
  const releaseEvidenceRecord = byKey.get("releaseEvidenceRecord");
  if (releaseEvidenceRecord?.status === "pass" && releaseEvidenceRecord.actualStatus !== "pass") {
    issues.push({ field: "checks.releaseEvidenceRecord.status", message: "release evidence record can pass only when release:evidence:validate passes" });
  }
  if (releaseEvidenceRecord?.status === "pass" && releaseEvidenceRecord.versionMatch !== true) {
    issues.push({ field: "checks.releaseEvidenceRecord.versionMatch", message: "release evidence record can pass only when releaseTag matches current package version" });
  }
  const uxReview = byKey.get("uxReview");
  if (uxReview?.status === "pass" && uxReview.versionMatch !== true) {
    issues.push({ field: "checks.uxReview.versionMatch", message: "UX review can pass only when appVersion matches current package version" });
  }
  const bundle = byKey.get("operationalEvidenceBundle");
  if (bundle?.status === "pass" && typeof bundle.actualStatus === "string") {
    const actual = bundle.actualStatus;
    if (!actual.includes("bundle.status=ready") || !actual.includes("summary.overall=pass") || !actual.includes("freshness=fresh")) {
      issues.push({ field: "checks.operationalEvidenceBundle.status", message: "operational evidence bundle can pass only when bundle, summary, and freshness are all ready/pass/fresh" });
    }
  }
  const checks = [...byKey.values()];
  const allPass = checks.length >= requiredCheckKeys.length && checks.every((check) => check.status === "pass");
  if (snapshotStatus === "ready_for_long_term_operability_review" && !allPass) {
    issues.push({ field: "status", message: "ready_for_long_term_operability_review requires every required check to pass" });
  }
}

function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  requireValue(value.readOnly, "safetyFacts.readOnly", true, issues);
  for (const field of falseSafetyFacts) {
    requireValue(value[field], `safetyFacts.${field}`, false, issues);
  }
}

function validateArray(value: unknown, field: string, required: string[], issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array" });
    return;
  }
  const actual = value.filter((item): item is string => typeof item === "string");
  const missing = required.filter((item) => !actual.includes(item));
  if (missing.length > 0) {
    issues.push({ field, message: `missing ${missing.join(", ")}` });
  }
}

function validateExactStringArray(value: unknown, field: string, expected: string[], issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array" });
    return;
  }
  const actual = value.filter((item): item is string => typeof item === "string");
  if (actual.length !== value.length) {
    issues.push({ field, message: "must be an array of strings" });
    return;
  }
  const duplicate = actual.find((item, index) => actual.indexOf(item) !== index);
  if (duplicate) {
    issues.push({ field, message: `contains duplicate ${duplicate}` });
    return;
  }
  const unexpected = actual.filter((item) => !expected.includes(item));
  const missing = expected.filter((item) => !actual.includes(item));
  if (unexpected.length > 0 || missing.length > 0 || actual.length !== expected.length) {
    issues.push({
      field,
      message: `must exactly match protected path set; missing=${missing.join(", ") || "none"} unexpected=${unexpected.join(", ") || "none"}`,
    });
  }
}

function requireString(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ field, message: "must be a non-empty string" });
  }
}

function requireBoolean(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "boolean") {
    issues.push({ field, message: "must be boolean" });
  }
}

function requireValue(value: unknown, field: string, expected: string | number | boolean, issues: ValidationIssue[]): void {
  if (value !== expected) {
    issues.push({ field, message: `must be ${String(expected)}` });
  }
}

function requireOneOf(value: unknown, field: string, allowed: string[], issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
  }
}

function requireIso(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push({ field, message: "must be an ISO-8601 timestamp" });
  }
}

function requireVersion(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    issues.push({ field, message: "must look like X.Y.Z" });
  }
}

function requireSha256Value(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be a 64-character sha256 hex digest" });
  }
}

function requirePrefixedSha256(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be sha256:<64-character hex digest>" });
  }
}

function hashSnapshot(snapshot: JsonRecord): string {
  return sha256(stableStringify({ ...snapshot, snapshotHash: "" }));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMain(): boolean {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMain()) {
  main();
}
