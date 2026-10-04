import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";
import {
  collectBackupRestorePreviewSources,
  type BackupRestorePreviewSourceInputs,
} from "./backup-restore-preview-source";
import { buildBackupRestorePreview } from "../ops/backup-restore-preview";

type JsonRecord = Record<string, unknown>;

const requiredEvidenceKeys = [
  "releaseEvidenceBundleHash",
  "attachmentReconciliationCsvPath",
  "attachmentReconciliationCsvSha256",
  "attachmentReconciliationSummaryPath",
  "attachmentReconciliationSummaryHash",
  "attachmentReconciliationStatus",
  "databaseBackupSha256",
  "uploadsBackupSha256",
  "envBackupSha256",
  "composeConfigBackupPath",
  "nginxConfigBackupPath",
  "databaseRestoreResult",
  "uploadsRestoreResult",
  "attachmentHashMatched",
  "rollbackTarget",
];

const requiredCapabilities = [
  "inspect_release_backup_metadata",
  "classify_root_only_backup_hash_gaps",
  "classify_release_evidence_bundle_hash_gap",
  "inspect_attachment_reconciliation_binding",
  "derive_machine_readable_blocking_gaps",
  "summarize_restore_dry_run_record_presence",
  "bind_current_source_set",
  "compute_preview_hash",
];

export type BackupRestorePreviewValidationOptions = {
  shapeOnly?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

const requiredDoesNotProve = [
  "backup archive exists",
  "database dump integrity beyond supplied metadata",
  "upload archive integrity beyond supplied metadata",
  "release evidence bundle integrity beyond supplied metadata",
  "production restore authorization",
  "restore apply execution",
  "migration execution",
  "rollback execution",
  "release evidence validator success",
  "residual risk closure",
];

const requiredForbiddenActions = [
  "execute_server_command",
  "perform_backup",
  "perform_restore",
  "run_migration",
  "rollback_release",
  "write_database",
  "write_upload_directory",
  "read_or_print_secret_values",
  "copy_backup_archive",
  "read_database_dump",
  "read_upload_archive",
  "read_private_env",
  "update_residual_ledger",
];

const falseSafetyFacts = [
  "networkRequested",
  "serverCommandAttempted",
  "backupRestoreAttempted",
  "migrationAttempted",
  "productionWriteAttempted",
  "secretValuePrinted",
  "secretValueIncluded",
  "privateEnvIncluded",
  "databaseDumpIncluded",
  "backupArchiveIncluded",
  "uploadFileContentIncluded",
  "attachmentContentIncluded",
  "rawLogIncluded",
  "residualLedgerUpdated",
] as const;

function main(): void {
  const args = process.argv.slice(2);
  const shapeOnly = args.includes("--shape-only");
  const previewPath = args.find((arg) => arg !== "--shape-only");
  if (!previewPath) {
    console.error("Usage: pnpm ops:backup-restore:preview:validate <backup-restore-preview.json> [--shape-only]");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(previewPath));
  const issues = validateBackupRestorePreview(raw, { shapeOnly, cwd: process.cwd(), env: process.env });
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`backup/restore preview validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("backup/restore preview validation passed: metadata-only scope, hash, evidence inventory, forbidden actions, and safety facts are present.");
  console.log(`bindingStatus: ${shapeOnly ? "unavailable" : "current"}`);
  console.log(`backupRestorePreviewRecordHash: sha256:${sha256(extractJson(raw))}`);
  console.log("safetyFacts: readOnly=true metadataOnly=true backupRestoreAttempted=false productionWriteAttempted=false secretValuePrinted=false");
}

export function validateBackupRestorePreview(
  raw: string,
  options: BackupRestorePreviewValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parsePreview(raw, issues);
  if (!body) return issues;

  const schemaVersion = body.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    issues.push({ field: "schemaVersion", message: "must be 1 or 2" });
  } else if (schemaVersion === 1 && !options.shapeOnly) {
    issues.push({ field: "schemaVersion", message: "historical schema v1 requires --shape-only" });
  }
  requireIso(body.generatedAt, "generatedAt", issues);
  requireValue(body.mode, "mode", "metadata_only_backup_restore_preview", issues);
  requireOneOfValue(body.status, "status", ["ready", "needs_evidence", "blocked"], issues);
  requireSha256Value(body.backupRestorePreviewHash, "backupRestorePreviewHash", issues);
  validateHash(body, issues);
  validateApp(body.app, issues);
  if (schemaVersion === 2) {
    validateSourceInputsV2(body.sourceInputs, issues);
    validateStringArray(body.capabilities, "capabilities", requiredCapabilities, issues);
  } else {
    validateSourceInputsV1(body.sourceInputs, issues);
    validateStringArray(body.capabilities, "capabilities", requiredCapabilities.filter((item) => item !== "bind_current_source_set"), issues);
  }
  validateEvidenceInventory(body.evidenceInventory, issues);
  validateBlockingGaps(body.blockingGaps, body.evidenceInventory, issues);
  validateRestoreDryRun(body.restoreDryRun, issues);
  validateDerivedStatuses(body, issues);
  validateClaimBoundary(body.claimBoundary, issues);
  validateStringArray(body.doesNotProve, "doesNotProve", requiredDoesNotProve, issues);
  validateStringArray(body.forbiddenActions, "forbiddenActions", requiredForbiddenActions, issues);
  validateSafetyFacts(body.safetyFacts, issues);
  if (schemaVersion === 2 && !options.shapeOnly) {
    validateCurrentSourceBinding(body, options, issues);
  }

  return issues;
}

function validateApp(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "app", message: "must be an object" });
    return;
  }
  requireString(value.name, "app.name", issues);
  requireString(value.version, "app.version", issues);
  requireString(value.releaseTag, "app.releaseTag", issues);
}

function validateSourceInputsV1(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "sourceInputs", message: "must be an object" });
    return;
  }
  requireString(value.releaseRecordPath, "sourceInputs.releaseRecordPath", issues);
  requirePrefixedSha256(value.releaseRecordHash, "sourceInputs.releaseRecordHash", issues);
  if (value.restoreDrillRecordPath !== null) requireString(value.restoreDrillRecordPath, "sourceInputs.restoreDrillRecordPath", issues);
  if (value.restoreDrillRecordHash !== null) requirePrefixedSha256(value.restoreDrillRecordHash, "sourceInputs.restoreDrillRecordHash", issues);
}

function validateSourceInputsV2(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "sourceInputs", message: "must be an object" });
    return;
  }
  requireExactKeys(value, [
    "schemaVersion",
    "packageVersion",
    "packageJsonHash",
    "implementationHash",
    "releaseRecordPath",
    "releaseRecordHash",
    "restoreDrillRecordPath",
    "restoreDrillRecordHash",
    "sourceSetHash",
  ], "sourceInputs", issues);
  requireValue(value.schemaVersion, "sourceInputs.schemaVersion", 1, issues);
  if (typeof value.packageVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(value.packageVersion)) {
    issues.push({ field: "sourceInputs.packageVersion", message: "must be semver" });
  }
  requirePrefixedSha256(value.packageJsonHash, "sourceInputs.packageJsonHash", issues);
  requirePrefixedSha256(value.implementationHash, "sourceInputs.implementationHash", issues);
  validateDisplayPath(value.releaseRecordPath, "sourceInputs.releaseRecordPath", issues);
  requirePrefixedSha256(value.releaseRecordHash, "sourceInputs.releaseRecordHash", issues);
  if (value.restoreDrillRecordPath !== null) validateDisplayPath(value.restoreDrillRecordPath, "sourceInputs.restoreDrillRecordPath", issues);
  if (value.restoreDrillRecordHash !== null) requirePrefixedSha256(value.restoreDrillRecordHash, "sourceInputs.restoreDrillRecordHash", issues);
  if ((value.restoreDrillRecordPath === null) !== (value.restoreDrillRecordHash === null)) {
    issues.push({ field: "sourceInputs.restoreDrillRecordPath", message: "restore path and hash must both be null or both be present" });
  }
  requirePrefixedSha256(value.sourceSetHash, "sourceInputs.sourceSetHash", issues);
  if (isBackupRestorePreviewSourceInputs(value)) {
    const expected = computeSourceSetHash(value);
    if (value.sourceSetHash !== expected) {
      issues.push({ field: "sourceInputs.sourceSetHash", message: "does not match canonical source inputs" });
    }
  }
}

function validateCurrentSourceBinding(
  body: JsonRecord,
  options: BackupRestorePreviewValidationOptions,
  issues: ValidationIssue[],
): void {
  const value = body.sourceInputs;
  if (!isBackupRestorePreviewSourceInputs(value)) return;
  try {
    const env = sourceBindingEnv(value, options.env ?? process.env);
    const current = collectBackupRestorePreviewSources({ cwd: options.cwd ?? process.cwd(), env });
    if (stableStringify(current.sourceInputs) !== stableStringify(value)) {
      issues.push({ field: "bindingStatus", message: "source inputs do not match the current package, implementation, or records" });
      return;
    }
    const expected = buildBackupRestorePreview({
      cwd: options.cwd ?? process.cwd(),
      env,
      generatedAt: new Date(String(body.generatedAt)),
    });
    if (stableStringify(expected) !== stableStringify(body)) {
      issues.push({ field: "bindingStatus", message: "preview content does not match the current source-derived preview" });
    }
  } catch (error) {
    issues.push({ field: "bindingStatus", message: error instanceof Error ? error.message : "current source binding failed" });
  }
}

function validateEvidenceInventory(value: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "evidenceInventory", message: "must be an array" });
    return;
  }
  const byKey = new Map<string, JsonRecord>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `evidenceInventory[${index}]`, message: "must be an object" });
      continue;
    }
    validateEvidenceItem(item, index, issues);
    if (typeof item.key === "string") byKey.set(item.key, item);
  }
  const missing = requiredEvidenceKeys.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    issues.push({ field: "evidenceInventory", message: `missing ${missing.join(", ")}` });
  }
}

function validateEvidenceItem(item: JsonRecord, index: number, issues: ValidationIssue[]): void {
  const prefix = `evidenceInventory[${index}]`;
  requireString(item.key, `${prefix}.key`, issues);
  requireOneOfValue(item.category, `${prefix}.category`, [
    "backup_manifest",
    "release_evidence_bundle",
    "restore_dry_run",
    "attachment_integrity",
    "rollback",
  ], issues);
  requireOneOfValue(item.status, `${prefix}.status`, [
    "present",
    "root_only",
    "missing",
    "invalid",
    "not_applicable",
  ], issues);
  requireString(item.evidence, `${prefix}.evidence`, issues);
  if (!Array.isArray(item.requiredEvidence) || item.requiredEvidence.length === 0) {
    issues.push({ field: `${prefix}.requiredEvidence`, message: "must be a non-empty array" });
  }
  if (!Array.isArray(item.residualRiskIds)) {
    issues.push({ field: `${prefix}.residualRiskIds`, message: "must be an array" });
  }
  if (!isRecord(item.metadata)) {
    issues.push({ field: `${prefix}.metadata`, message: "must be an object" });
  }
}

function validateBlockingGaps(gaps: unknown, inventory: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(gaps)) {
    issues.push({ field: "blockingGaps", message: "must be an array" });
    return;
  }
  if (!Array.isArray(inventory)) return;

  const inventoryByKey = new Map<string, JsonRecord>();
  for (const item of inventory) {
    if (isRecord(item) && typeof item.key === "string") {
      inventoryByKey.set(item.key, item);
    }
  }

  const expectedKeys = [...inventoryByKey.values()]
    .filter((item) => item.status !== "present" && item.status !== "not_applicable")
    .map((item) => String(item.key))
    .sort();
  const actualKeys: string[] = [];

  for (const [index, gap] of gaps.entries()) {
    if (!isRecord(gap)) {
      issues.push({ field: `blockingGaps[${index}]`, message: "must be an object" });
      continue;
    }
    const prefix = `blockingGaps[${index}]`;
    requireString(gap.key, `${prefix}.key`, issues);
    requireOneOfValue(gap.category, `${prefix}.category`, [
      "backup_manifest",
      "release_evidence_bundle",
      "restore_dry_run",
      "attachment_integrity",
      "rollback",
    ], issues);
    requireOneOfValue(gap.gapType, `${prefix}.gapType`, [
      "release_evidence_backup_hash",
      "release_evidence_bundle_hash",
      "backup_config_reference",
      "restore_dry_run_result",
      "attachment_integrity_result",
      "rollback_target",
    ], issues);
    requireOneOfValue(gap.status, `${prefix}.status`, [
      "root_only",
      "missing",
      "invalid",
    ], issues);
    requireOneOfValue(gap.sourceInput, `${prefix}.sourceInput`, [
      "release_record",
      "restore_drill_record",
    ], issues);
    requireString(gap.sourceField, `${prefix}.sourceField`, issues);
    requireString(gap.safeEvidence, `${prefix}.safeEvidence`, issues);
    if (!Array.isArray(gap.requiredEvidence) || gap.requiredEvidence.length === 0) {
      issues.push({ field: `${prefix}.requiredEvidence`, message: "must be a non-empty array" });
    }
    if (!Array.isArray(gap.residualRiskIds)) {
      issues.push({ field: `${prefix}.residualRiskIds`, message: "must be an array" });
    }
    const allowedBlocks = [
      "release_evidence_validator",
      "long_term_live_gate",
      "backup_restore_preview_ready",
      "restore_dry_run_claim",
      "rollback_readiness",
      "maintenance_handoff",
    ];
    if (!Array.isArray(gap.blocks) || gap.blocks.length === 0 || !gap.blocks.every((item) => typeof item === "string" && allowedBlocks.includes(item))) {
      issues.push({ field: `${prefix}.blocks`, message: `must be a non-empty array of ${allowedBlocks.join(", ")}` });
    }

    if (typeof gap.key !== "string") continue;
    actualKeys.push(gap.key);
    const source = inventoryByKey.get(gap.key);
    if (!source) {
      issues.push({ field: `${prefix}.key`, message: "must reference an evidenceInventory item" });
      continue;
    }
    if (source.status === "present" || source.status === "not_applicable") {
      issues.push({ field: `${prefix}.status`, message: "must not include present or not_applicable inventory items" });
    }
    if (gap.status !== source.status) {
      issues.push({ field: `${prefix}.status`, message: "must match evidenceInventory status" });
    }
    if (gap.category !== source.category) {
      issues.push({ field: `${prefix}.category`, message: "must match evidenceInventory category" });
    }
    if (gap.gapType !== expectedGapType(source)) {
      issues.push({ field: `${prefix}.gapType`, message: "must match evidenceInventory-derived gap type" });
    }
    if (gap.sourceInput !== expectedSourceInput(source)) {
      issues.push({ field: `${prefix}.sourceInput`, message: "must match evidenceInventory-derived source input" });
    }
    if (gap.sourceField !== source.key) {
      issues.push({ field: `${prefix}.sourceField`, message: "must match evidenceInventory key" });
    }
    if (gap.safeEvidence !== source.evidence) {
      issues.push({ field: `${prefix}.safeEvidence`, message: "must match evidenceInventory evidence text" });
    }
  }

  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const extra = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length > 0) {
    issues.push({ field: "blockingGaps", message: `missing ${missing.join(", ")}` });
  }
  if (extra.length > 0) {
    issues.push({ field: "blockingGaps", message: `unexpected ${extra.join(", ")}` });
  }
}

function expectedGapType(item: JsonRecord): string {
  if (item.key === "releaseEvidenceBundleHash") {
    return "release_evidence_bundle_hash";
  }
  if (item.key === "databaseBackupSha256" || item.key === "uploadsBackupSha256" || item.key === "envBackupSha256") {
    return "release_evidence_backup_hash";
  }
  if (item.key === "composeConfigBackupPath" || item.key === "nginxConfigBackupPath") {
    return "backup_config_reference";
  }
  if (item.category === "attachment_integrity") {
    return "attachment_integrity_result";
  }
  if (item.category === "restore_dry_run") {
    return "restore_dry_run_result";
  }
  return "rollback_target";
}

function expectedSourceInput(item: JsonRecord): string {
  return item.category === "restore_dry_run" || item.key === "attachmentHashMatched"
    ? "restore_drill_record"
    : "release_record";
}

function validateRestoreDryRun(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "restoreDryRun", message: "must be an object" });
    return;
  }
  requireOneOfValue(value.status, "restoreDryRun.status", ["present", "root_only", "missing", "invalid", "not_applicable"], issues);
  requireString(value.evidence, "restoreDryRun.evidence", issues);
  requireValue(value.doesNotApplyRestore, "restoreDryRun.doesNotApplyRestore", true, issues);
}

function validateDerivedStatuses(body: JsonRecord, issues: ValidationIssue[]): void {
  if (!Array.isArray(body.evidenceInventory)) return;
  const expectedStatus = derivePreviewStatus(body.evidenceInventory);
  if (expectedStatus && body.status !== expectedStatus) {
    issues.push({ field: "status", message: `must match evidenceInventory-derived status ${expectedStatus}` });
  }
  if (!isRecord(body.restoreDryRun)) return;
  const expectedRestoreDryRunStatus = deriveRestoreDryRunStatus(body.evidenceInventory);
  if (expectedRestoreDryRunStatus && body.restoreDryRun.status !== expectedRestoreDryRunStatus) {
    issues.push({
      field: "restoreDryRun.status",
      message: `must match evidenceInventory-derived status ${expectedRestoreDryRunStatus}`,
    });
  }
}

function derivePreviewStatus(items: unknown[]): "ready" | "needs_evidence" | "blocked" | null {
  const statuses = items
    .filter(isRecord)
    .map((item) => item.status)
    .filter((status): status is string => typeof status === "string");
  if (statuses.length !== items.length) return null;
  if (statuses.some((status) => status === "invalid")) return "blocked";
  if (statuses.some((status) => status !== "present" && status !== "not_applicable")) return "needs_evidence";
  return "ready";
}

function deriveRestoreDryRunStatus(items: unknown[]): "present" | "missing" | null {
  const restoreItems = items
    .filter(isRecord)
    .filter((item) => item.category === "restore_dry_run" || item.key === "attachmentHashMatched");
  if (restoreItems.length === 0) return null;
  return restoreItems.every((item) => item.status === "present") ? "present" : "missing";
}

function validateClaimBoundary(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "claimBoundary", message: "must be an object" });
    return;
  }
  validateStringArray(value.canClaim, "claimBoundary.canClaim", [
    "backup and restore evidence metadata has been inventoried",
    "root-only backup hash gaps are explicit",
  ], issues);
  validateStringArray(value.cannotClaim, "claimBoundary.cannotClaim", [
    "restore apply was executed",
    "production restore is authorized",
    "database dump or upload archive was read",
  ], issues);
}

function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  requireValue(value.readOnly, "safetyFacts.readOnly", true, issues);
  requireValue(value.metadataOnly, "safetyFacts.metadataOnly", true, issues);
  requireValue(value.previewOnly, "safetyFacts.previewOnly", true, issues);
  for (const field of falseSafetyFacts) {
    requireValue(value[field], `safetyFacts.${field}`, false, issues);
  }
}

function parsePreview(raw: string, issues: ValidationIssue[]): JsonRecord | null {
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
  return raw.slice(firstBrace).trim();
}

function validateHash(body: JsonRecord, issues: ValidationIssue[]): void {
  if (typeof body.backupRestorePreviewHash !== "string") return;
  const expected = hashPreview(body);
  if (body.backupRestorePreviewHash !== expected) {
    issues.push({ field: "backupRestorePreviewHash", message: "does not match canonical preview content" });
  }
}

function validateStringArray(value: unknown, field: string, required: string[], issues: ValidationIssue[]): void {
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

function requireExactKeys(value: JsonRecord, expected: string[], field: string, issues: ValidationIssue[]): void {
  const actual = Object.keys(value).sort();
  const normalized = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(normalized)) {
    issues.push({ field, message: `must contain exact keys ${normalized.join(", ")}` });
  }
}

function validateDisplayPath(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ field, message: "must be a non-empty redacted path" });
    return;
  }
  const normalized = value.replaceAll("\\", "/");
  const relative = normalized.startsWith("<tmp>/") ? normalized.slice("<tmp>/".length) : normalized;
  if (path.isAbsolute(value) || relative === "" || relative === ".." || relative.startsWith("../") || relative.includes("/../")) {
    issues.push({ field, message: "must be a workspace-relative path or <tmp> redacted path without traversal" });
  }
}

function isBackupRestorePreviewSourceInputs(value: unknown): value is BackupRestorePreviewSourceInputs {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && typeof value.packageVersion === "string"
    && typeof value.packageJsonHash === "string"
    && typeof value.implementationHash === "string"
    && typeof value.releaseRecordPath === "string"
    && typeof value.releaseRecordHash === "string"
    && (value.restoreDrillRecordPath === null || typeof value.restoreDrillRecordPath === "string")
    && (value.restoreDrillRecordHash === null || typeof value.restoreDrillRecordHash === "string")
    && typeof value.sourceSetHash === "string";
}

function computeSourceSetHash(value: BackupRestorePreviewSourceInputs): string {
  const { sourceSetHash: _sourceSetHash, ...base } = value;
  return `sha256:${sha256(stableStringify({ domain: "areaforge.backup-restore-preview.sources.v1", ...base }))}`;
}

function sourceBindingEnv(
  value: BackupRestorePreviewSourceInputs,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  env.AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD = bindSourcePath(
    value.releaseRecordPath,
    baseEnv.AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD,
    "AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD",
  );
  if (value.restoreDrillRecordPath === null) {
    delete env.AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD;
  } else {
    env.AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD = bindSourcePath(
      value.restoreDrillRecordPath,
      baseEnv.AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD,
      "AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD",
    );
  }
  return env;
}

function bindSourcePath(displayPath: string, configuredPath: string | undefined, key: string): string {
  if (!displayPath.startsWith("<tmp>/")) return displayPath;
  if (!configuredPath?.trim()) {
    throw new Error(`${key} is required to validate a <tmp> source binding`);
  }
  return configuredPath;
}

function requireString(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ field, message: "must be a non-empty string" });
  }
}

function requireValue(value: unknown, field: string, expected: string | number | boolean, issues: ValidationIssue[]): void {
  if (value !== expected) {
    issues.push({ field, message: `must be ${String(expected)}` });
  }
}

function requireOneOfValue(value: unknown, field: string, allowed: string[], issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
  }
}

function requireIso(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push({ field, message: "must be an ISO-8601 timestamp" });
  }
}

function requireSha256Value(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be a 64-character sha256 hex digest" });
  }
}

function requirePrefixedSha256(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be sha256:<64 hex>" });
  }
}

function hashPreview(preview: JsonRecord): string {
  return sha256(stableStringify({ ...preview, backupRestorePreviewHash: "" }));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
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
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isMain()) {
  main();
}
