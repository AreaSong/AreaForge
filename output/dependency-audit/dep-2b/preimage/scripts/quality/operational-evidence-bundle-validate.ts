import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";
import { buildOperationalEvidenceSourceSnapshot } from "./operational-evidence-source";

type BundleStatus = "ready" | "needs_attention" | "blocked";
type JsonRecord = Record<string, unknown>;
type BundleValidationOptions = {
  shapeOnly?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

const requiredSignalKeys = [
  "signal:health",
  "signal:releaseIdentity",
  "signal:updateAgent",
  "signal:authenticatedSmoke",
  "signal:backup",
  "signal:rollback",
  "signal:infrastructure",
];

const requiredFreshnessSignalKeys = [
  "health",
  "releaseIdentity",
  "updateAgent",
  "authenticatedSmoke",
  "backup",
  "rollback",
  "infrastructure",
];

const requiredSourceFileInputs: Record<string, string> = {
  updateStatus: "AREAFORGE_READINESS_UPDATE_STATUS_FILE",
  releaseManifest: "AREAFORGE_READINESS_RELEASE_MANIFEST_FILE",
  smokeResult: "AREAFORGE_READINESS_SMOKE_RESULT_FILE",
  backupRestorePreview: "AREAFORGE_READINESS_BACKUP_RESTORE_PREVIEW_FILE",
};

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
];

const requiredCapabilities = [
  "collect_read_only_operational_readiness_summary",
  "assemble_signal_evidence_index",
  "map_residual_risk_ids_to_required_evidence",
  "bind_current_source_inputs",
  "compute_bundle_hash",
];
const requiredDoesNotProve = [
  "current production health without all required live signals",
  "updater apply completion",
  "backup, restore, migration, or rollback execution",
  "GitHub Release creation",
  "residual risk closure",
  "production write smoke safety",
];

function main(): void {
  const bundlePath = process.argv[2];
  const shapeOnly = process.argv.slice(3).includes("--shape-only");
  if (!bundlePath) {
    console.error("Usage: pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json> [--shape-only]");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(bundlePath));
  const issues = validateBundle(raw, { shapeOnly });
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`operational evidence bundle validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log(`operational evidence bundle validation passed: ${shapeOnly ? "historical shape" : "current source binding"}, hash, signal inventory, freshness, doesNotProve, safety facts, forbidden actions, and redaction checks are present.`);
  console.log(`bindingStatus: ${shapeOnly ? "shape_only" : "current"}`);
  console.log(`operationalEvidenceBundleRecordHash: sha256:${sha256(extractJson(raw))}`);
  console.log("safetyFacts: readOnlyValidation=true serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false");
}

export function validateBundle(raw: string, options: BundleValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parseBundle(raw, issues);
  if (!body) return issues;

  const schemaVersion = body.schemaVersion ?? 1;
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    issues.push({ field: "schemaVersion", message: "must be 1 or 2" });
  }
  if (schemaVersion === 1 && !options.shapeOnly) {
    issues.push({ field: "schemaVersion", message: "historical schema v1 requires --shape-only" });
  }
  if (schemaVersion === 2) {
    validateSourceSnapshot(body.sourceSnapshot, issues);
    if (!options.shapeOnly) validateCurrentBinding(body, options, issues);
  }
  requireOneOfValue(body.status, "status", ["ready", "needs_attention", "blocked"], issues);
  requireValue(body.mode, "mode", "read_only_operational_evidence_bundle", issues);
  requireIso(body.generatedAt, "generatedAt", issues);
  requireSha256Value(body.bundleHash, "bundleHash", issues);
  validateHash(body, issues);
  validateSummary(body.summary, issues);
  validateFreshness(body.freshness, "freshness", issues);
  validateFreshnessConsistency(body, issues);
  validateReadyGate(body, issues);
  validateItems(body.items, issues);
  validateStringArray(
    body.capabilities,
    "capabilities",
    schemaVersion === 1 ? requiredCapabilities.filter((item) => item !== "bind_current_source_inputs") : requiredCapabilities,
    issues,
  );
  validateStringArray(body.doesNotProve, "doesNotProve", requiredDoesNotProve, issues);
  validateStringArray(body.forbiddenActions, "forbiddenActions", requiredForbiddenActions, issues);
  validateSafetyFacts(body.safetyFacts, issues);
  if (!options.shapeOnly && schemaVersion === 2) validateCurrentFreshness(body, options.now ?? new Date(), issues);

  return issues;
}

function validateSourceSnapshot(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "sourceSnapshot", message: "must be an object for schema v2" });
    return;
  }
  if (value.schemaVersion !== 1) issues.push({ field: "sourceSnapshot.schemaVersion", message: "must be 1" });
  if (typeof value.packageVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(value.packageVersion)) {
    issues.push({ field: "sourceSnapshot.packageVersion", message: "must be semver" });
  }
  for (const field of ["packageJsonHash", "implementationHash", "configHash", "sourceSetHash"]) {
    requireSha256Value(value[field], `sourceSnapshot.${field}`, issues);
  }
  if (!Array.isArray(value.fileInputs)) {
    issues.push({ field: "sourceSnapshot.fileInputs", message: "must be an array" });
    return;
  }
  const requiredKeys = Object.keys(requiredSourceFileInputs);
  const actualKeys: string[] = [];
  for (const [index, input] of value.fileInputs.entries()) {
    if (!isRecord(input)) {
      issues.push({ field: `sourceSnapshot.fileInputs[${index}]`, message: "must be an object" });
      continue;
    }
    requireString(input.key, `sourceSnapshot.fileInputs[${index}].key`, issues);
    requireString(input.envKey, `sourceSnapshot.fileInputs[${index}].envKey`, issues);
    if (typeof input.key === "string") actualKeys.push(input.key);
    if (typeof input.key === "string" && requiredSourceFileInputs[input.key] !== input.envKey) {
      issues.push({ field: `sourceSnapshot.fileInputs[${index}].envKey`, message: `must match ${requiredSourceFileInputs[input.key] ?? "a known source key"}` });
    }
    if (typeof input.configured !== "boolean") issues.push({ field: `sourceSnapshot.fileInputs[${index}].configured`, message: "must be boolean" });
    requireOneOfValue(input.fileKind, `sourceSnapshot.fileInputs[${index}].fileKind`, ["missing", "regular", "symlink", "other"], issues);
    if (input.pathLabel !== null && (typeof input.pathLabel !== "string" || path.basename(input.pathLabel) !== input.pathLabel)) {
      issues.push({ field: `sourceSnapshot.fileInputs[${index}].pathLabel`, message: "must be null or a basename" });
    }
    if (input.fileKind === "regular") requireSha256Value(input.sha256, `sourceSnapshot.fileInputs[${index}].sha256`, issues);
    else if (input.sha256 !== null) issues.push({ field: `sourceSnapshot.fileInputs[${index}].sha256`, message: "must be null unless fileKind=regular" });
    if (input.fileKind === "symlink" || input.fileKind === "other") {
      issues.push({ field: `sourceSnapshot.fileInputs[${index}].fileKind`, message: "configured evidence input must be a regular file or missing" });
    }
    if (input.configured === false && (input.pathLabel !== null || input.fileKind !== "missing" || input.sha256 !== null)) {
      issues.push({ field: `sourceSnapshot.fileInputs[${index}]`, message: "unconfigured input must be missing with null path/hash" });
    }
    if (input.configured === true && input.pathLabel === null) {
      issues.push({ field: `sourceSnapshot.fileInputs[${index}].pathLabel`, message: "configured input requires a basename" });
    }
  }
  const missing = requiredKeys.filter((key) => !actualKeys.includes(key));
  if (missing.length > 0) issues.push({ field: "sourceSnapshot.fileInputs", message: `missing ${missing.join(", ")}` });
  if (new Set(actualKeys).size !== actualKeys.length || actualKeys.length !== requiredKeys.length) {
    issues.push({ field: "sourceSnapshot.fileInputs", message: "must contain each required source input exactly once" });
  }
}

function validateCurrentBinding(body: JsonRecord, options: BundleValidationOptions, issues: ValidationIssue[]): void {
  if (!isRecord(body.sourceSnapshot)) return;
  try {
    const current = buildOperationalEvidenceSourceSnapshot({ cwd: options.cwd, env: options.env });
    if (stableStringify(body.sourceSnapshot) !== stableStringify(current)) {
      issues.push({ field: "bindingStatus", message: "stale: current source inputs do not match sourceSnapshot" });
    }
  } catch (error) {
    issues.push({ field: "bindingStatus", message: `unavailable: ${error instanceof Error ? error.message : "cannot rebuild source snapshot"}` });
  }
}

function validateCurrentFreshness(body: JsonRecord, now: Date, issues: ValidationIssue[]): void {
  if (!isRecord(body.freshness) || typeof body.freshness.maxAgeSeconds !== "number") return;
  const maxAgeSeconds = body.freshness.maxAgeSeconds;
  const generatedAt = typeof body.generatedAt === "string" ? Date.parse(body.generatedAt) : Number.NaN;
  if (Number.isFinite(generatedAt) && Math.max(0, (now.getTime() - generatedAt) / 1000) > maxAgeSeconds) {
    issues.push({ field: "bindingStatus", message: "stale: bundle generation time exceeds the freshness window" });
  }
  if (!isRecord(body.freshness.signals)) return;
  for (const key of requiredFreshnessSignalKeys) {
    const signal = body.freshness.signals[key];
    if (!isRecord(signal) || signal.status !== "fresh" || typeof signal.checkedAt !== "string") continue;
    const checkedAt = Date.parse(signal.checkedAt);
    if (Number.isFinite(checkedAt) && Math.max(0, (now.getTime() - checkedAt) / 1000) > maxAgeSeconds) {
      issues.push({ field: `bindingStatus.${key}`, message: "stale: signal no longer fits the freshness window" });
    }
  }
}

function parseBundle(raw: string, issues: ValidationIssue[]): JsonRecord | null {
  try {
    const parsed = JSON.parse(extractJson(raw));
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
  if (typeof body.bundleHash !== "string") return;
  const expected = hashBundle(body);
  if (body.bundleHash !== expected) {
    issues.push({ field: "bundleHash", message: "does not match canonical bundle content" });
  }
}

function validateSummary(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "summary", message: "must be an object" });
    return;
  }
  requireIso(value.checkedAt, "summary.checkedAt", issues);
  requireOneOfValue(value.overall, "summary.overall", ["pass", "warn", "fail", "blocked", "unknown"], issues);
  requireRecord(value.safetyFacts, "summary.safetyFacts", issues);
  validateReadOnlySafety(value.safetyFacts, "summary.safetyFacts", issues);
  if (!isRecord(value.signals)) {
    issues.push({ field: "summary.signals", message: "must be an object" });
  }
  validateFreshness(value.freshness, "summary.freshness", issues);
  if (!Array.isArray(value.residualRiskIds)) {
    issues.push({ field: "summary.residualRiskIds", message: "must be an array" });
  }
}

function validateFreshness(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  if (typeof value.maxAgeSeconds !== "number" || value.maxAgeSeconds <= 0) {
    issues.push({ field: `${field}.maxAgeSeconds`, message: "must be a positive number" });
  }
  requireOneOfValue(value.latestEvidenceFreshnessStatus, `${field}.latestEvidenceFreshnessStatus`, [
    "fresh",
    "stale",
    "unknown",
  ], issues);
  if (!isRecord(value.signals)) {
    issues.push({ field: `${field}.signals`, message: "must be an object" });
    return;
  }
  const missing = requiredFreshnessSignalKeys.filter((key) => !isRecord((value.signals as JsonRecord)[key]));
  if (missing.length > 0) {
    issues.push({ field: `${field}.signals`, message: `missing ${missing.join(", ")}` });
  }
  for (const key of requiredFreshnessSignalKeys) {
    validateFreshnessSignal((value.signals as JsonRecord)[key], `${field}.signals.${key}`, issues);
  }
  const statuses = requiredFreshnessSignalKeys
    .map((key) => (value.signals as JsonRecord)[key])
    .filter(isRecord)
    .map((signal) => signal.status);
  const expected = aggregateFreshness(statuses);
  if (expected && value.latestEvidenceFreshnessStatus !== expected) {
    issues.push({
      field: `${field}.latestEvidenceFreshnessStatus`,
      message: `must match signal freshness aggregate ${expected}`,
    });
  }
}

function validateFreshnessSignal(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) return;
  requireOneOfValue(value.status, `${field}.status`, ["fresh", "stale", "unknown"], issues);
  const status = typeof value.status === "string" ? value.status : "";
  if (value.checkedAt !== null && (typeof value.checkedAt !== "string" || Number.isNaN(Date.parse(value.checkedAt)))) {
    issues.push({ field: `${field}.checkedAt`, message: "must be null or an ISO-8601 timestamp" });
  }
  if (value.ageSeconds !== null && (typeof value.ageSeconds !== "number" || value.ageSeconds < 0)) {
    issues.push({ field: `${field}.ageSeconds`, message: "must be null or a non-negative number" });
  }
  if ((status === "fresh" || status === "stale") && typeof value.checkedAt !== "string") {
    issues.push({ field: `${field}.checkedAt`, message: `must be an ISO-8601 timestamp when status is ${status}` });
  }
  if ((status === "fresh" || status === "stale") && typeof value.ageSeconds !== "number") {
    issues.push({ field: `${field}.ageSeconds`, message: `must be a non-negative number when status is ${status}` });
  }
}

function validateFreshnessConsistency(body: JsonRecord, issues: ValidationIssue[]): void {
  const summary = isRecord(body.summary) ? body.summary : null;
  if (!summary || !isRecord(summary.freshness) || !isRecord(body.freshness)) return;
  if (stableStringify(body.freshness) !== stableStringify(summary.freshness)) {
    issues.push({ field: "freshness", message: "must match summary.freshness exactly" });
  }
}

function validateReadyGate(body: JsonRecord, issues: ValidationIssue[]): void {
  if (body.status !== "ready") return;
  const summary = isRecord(body.summary) ? body.summary : {};
  if (summary.overall !== "pass") {
    issues.push({ field: "status", message: "ready bundle requires summary.overall=pass" });
  }
  const freshness = isRecord(body.freshness) ? body.freshness : {};
  if (freshness.latestEvidenceFreshnessStatus !== "fresh") {
    issues.push({ field: "status", message: "ready bundle requires freshness.latestEvidenceFreshnessStatus=fresh" });
  }
}

function aggregateFreshness(values: unknown[]): "fresh" | "stale" | "unknown" | null {
  if (values.length === 0) return null;
  if (values.includes("stale")) return "stale";
  if (values.includes("unknown")) return "unknown";
  if (values.every((value) => value === "fresh")) return "fresh";
  return null;
}

function validateItems(value: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "items", message: "must be an array" });
    return;
  }
  const byKey = new Map<string, JsonRecord>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `items[${index}]`, message: "must be an object" });
      continue;
    }
    validateItem(item, index, issues);
    if (typeof item.key === "string") byKey.set(item.key, item);
  }
  const missing = requiredSignalKeys.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    issues.push({ field: "items", message: `missing required signals: ${missing.join(", ")}` });
  }
}

function validateItem(item: JsonRecord, index: number, issues: ValidationIssue[]): void {
  const prefix = `items[${index}]`;
  requireString(item.key, `${prefix}.key`, issues);
  requireString(item.category, `${prefix}.category`, issues);
  requireOneOfValue(item.status, `${prefix}.status`, ["ready", "needs_attention", "blocked"], issues);
  requireString(item.source, `${prefix}.source`, issues);
  requireString(item.description, `${prefix}.description`, issues);
  requireString(item.evidence, `${prefix}.evidence`, issues);
  if (!Array.isArray(item.residualRiskIds)) {
    issues.push({ field: `${prefix}.residualRiskIds`, message: "must be an array" });
  }
  if (!Array.isArray(item.requiredEvidence) || item.requiredEvidence.length === 0) {
    issues.push({ field: `${prefix}.requiredEvidence`, message: "must be a non-empty array" });
  }
  if (!isRecord(item.metadata)) {
    issues.push({ field: `${prefix}.metadata`, message: "must be an object" });
  }
}

function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  validateReadOnlySafety(value, "safetyFacts", issues);
  requireFalse(value, "productionDeployAttempted", "safetyFacts", issues);
  requireFalse(value, "updaterApplyAttempted", "safetyFacts", issues);
  requireFalse(value, "rollbackAttempted", "safetyFacts", issues);
  requireFalse(value, "secretFileContentIncluded", "safetyFacts", issues);
}

function validateReadOnlySafety(value: unknown, prefix: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) return;
  for (const field of [
    "serverCommandAttempted",
    "backupRestoreAttempted",
    "migrationAttempted",
    "productionWriteAttempted",
    "secretValuePrinted",
  ]) {
    requireFalse(value, field, prefix, issues);
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

function requireRecord(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
  }
}

function requireString(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ field, message: "must be a non-empty string" });
  }
}

function requireValue(value: unknown, field: string, expected: string, issues: ValidationIssue[]): void {
  if (value !== expected) {
    issues.push({ field, message: `must be ${expected}` });
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

function requireFalse(record: JsonRecord, field: string, prefix: string, issues: ValidationIssue[]): void {
  if (record[field] !== false) {
    issues.push({ field: `${prefix}.${field}`, message: "must be false" });
  }
}

function hashBundle(bundle: JsonRecord): string {
  return sha256(stableStringify({ ...bundle, bundleHash: "" }));
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
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMain()) {
  main();
}
