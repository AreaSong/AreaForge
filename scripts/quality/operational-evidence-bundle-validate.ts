import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";

type BundleStatus = "ready" | "needs_attention" | "blocked";
type JsonRecord = Record<string, unknown>;

const requiredSignalKeys = [
  "signal:health",
  "signal:releaseIdentity",
  "signal:updateAgent",
  "signal:authenticatedSmoke",
  "signal:backup",
  "signal:rollback",
  "signal:infrastructure",
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
];

const requiredCapabilities = [
  "collect_read_only_operational_readiness_summary",
  "assemble_signal_evidence_index",
  "map_residual_risk_ids_to_required_evidence",
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
  if (!bundlePath) {
    console.error("Usage: pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(bundlePath));
  const issues = validateBundle(raw);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`operational evidence bundle validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("operational evidence bundle validation passed: hash, signal inventory, freshness, doesNotProve, safety facts, forbidden actions, and redaction checks are present.");
  console.log(`operationalEvidenceBundleRecordHash: sha256:${sha256(extractJson(raw))}`);
  console.log("safetyFacts: readOnlyValidation=true serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false");
}

export function validateBundle(raw: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parseBundle(raw, issues);
  if (!body) return issues;

  requireOneOfValue(body.status, "status", ["ready", "needs_attention", "blocked"], issues);
  requireValue(body.mode, "mode", "read_only_operational_evidence_bundle", issues);
  requireIso(body.generatedAt, "generatedAt", issues);
  requireSha256Value(body.bundleHash, "bundleHash", issues);
  validateHash(body, issues);
  validateSummary(body.summary, issues);
  validateFreshness(body.freshness, "freshness", issues);
  validateItems(body.items, issues);
  validateStringArray(body.capabilities, "capabilities", requiredCapabilities, issues);
  validateStringArray(body.doesNotProve, "doesNotProve", requiredDoesNotProve, issues);
  validateStringArray(body.forbiddenActions, "forbiddenActions", requiredForbiddenActions, issues);
  validateSafetyFacts(body.safetyFacts, issues);

  return issues;
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
  }
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
