import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hashAudit, type ReleaseCloseoutAudit } from "../ops/release-closeout-audit";

type ValidationIssue = { field: string; message: string };

const requiredChecks = [
  "releaseRecord",
  "supplyChainRecord",
  "identityConsistency",
  "residualConsistency",
  "operationalEvidence",
  "rollbackTarget",
] as const;

const secretPatterns = [
  /postgres(?:ql)?:\/\/[^\s]+/i,
  /\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/,
  /AUTH_SESSION_SECRET\s*=\s*\S+/i,
  /AI_API_KEY\s*=\s*\S+/i,
  /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/i,
];

export function validateReleaseCloseoutAudit(raw: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const pattern of secretPatterns) {
    if (pattern.test(raw)) issues.push({ field: "record", message: "must not contain secret-like values" });
  }

  const body = parseAudit(raw, issues);
  if (!body) return issues;
  requireValue(body.schemaVersion, "schemaVersion", 1, issues);
  requireValue(body.mode, "mode", "read_only_release_closeout_audit", issues);
  requireIso(body.generatedAt, "generatedAt", issues);
  requirePattern(body.version, "version", /^\d+\.\d+\.\d+$/, issues);
  if (body.releaseTag !== `v${body.version}`) issues.push({ field: "releaseTag", message: "must equal v + version" });
  requireOneOf(body.status, "status", ["blocked", "needs_attention", "ready_for_human_review"], issues);
  validateSource(body.source, issues);
  validateChecks(body, issues);
  validateResiduals(body.residuals, issues);
  validateStringArray(body.blockedBy, "blockedBy", issues);
  validateStringArray(body.doesNotProve, "doesNotProve", issues);
  validateStringArray(body.forbiddenActions, "forbiddenActions", issues);
  validateSafetyFacts(body.safetyFacts, issues);
  requirePattern(body.auditHash, "auditHash", /^sha256:[a-f0-9]{64}$/i, issues);

  const { auditHash: _auditHash, ...withoutHash } = body;
  if (body.auditHash !== hashAudit(withoutHash)) {
    issues.push({ field: "auditHash", message: "does not match canonical audit content" });
  }

  const statuses = requiredChecks.map((key) => body.checks?.[key]?.status);
  const expectedStatus = statuses.includes("blocked")
    ? "blocked"
    : statuses.includes("needs_attention") ? "needs_attention" : "ready_for_human_review";
  if (body.status !== expectedStatus) issues.push({ field: "status", message: `must be derived as ${expectedStatus}` });
  if (body.status === "ready_for_human_review" && body.blockedBy.length > 0) {
    issues.push({ field: "blockedBy", message: "must be empty when ready_for_human_review" });
  }
  if (body.status !== "ready_for_human_review" && body.blockedBy.length === 0) {
    issues.push({ field: "blockedBy", message: "must explain non-ready status" });
  }

  return issues;
}

function validateSource(source: ReleaseCloseoutAudit["source"] | undefined, issues: ValidationIssue[]): void {
  if (!isRecord(source)) {
    issues.push({ field: "source", message: "must be an object" });
    return;
  }
  for (const field of ["releaseRecord", "supplyChainRecord", "residualLedger"] as const) {
    validateSafePath(source[field], `source.${field}`, issues);
  }
  if (source.operationalEvidenceBundle !== null) {
    validateSafePath(source.operationalEvidenceBundle, "source.operationalEvidenceBundle", issues);
  }
  if (!Array.isArray(source.inputHashes) || source.inputHashes.length === 0) {
    issues.push({ field: "source.inputHashes", message: "must contain at least one input hash" });
  } else {
    for (const [index, item] of source.inputHashes.entries()) {
      if (!isRecord(item)) {
        issues.push({ field: `source.inputHashes[${index}]`, message: "must be an object" });
        continue;
      }
      validateSafePath(item.path, `source.inputHashes[${index}].path`, issues);
      requirePattern(item.sha256, `source.inputHashes[${index}].sha256`, /^sha256:[a-f0-9]{64}$/i, issues);
    }
  }
}

function validateChecks(body: ReleaseCloseoutAudit, issues: ValidationIssue[]): void {
  if (!isRecord(body.checks)) {
    issues.push({ field: "checks", message: "must be an object" });
    return;
  }
  for (const key of requiredChecks) {
    const check = body.checks[key];
    if (!isRecord(check)) {
      issues.push({ field: `checks.${key}`, message: "must be an object" });
      continue;
    }
    requireOneOf(check.status, `checks.${key}.status`, ["pass", "needs_attention", "blocked"], issues);
    requireString(check.detail, `checks.${key}.detail`, issues);
  }
  for (const key of ["releaseRecord", "supplyChainRecord"] as const) {
    const validator = body.checks[key]?.validator;
    if (!isRecord(validator)) {
      issues.push({ field: `checks.${key}.validator`, message: "must be an object" });
      continue;
    }
    requireOneOf(validator.status, `checks.${key}.validator.status`, ["pass", "fail", "missing"], issues);
    requireString(validator.command, `checks.${key}.validator.command`, issues);
    validateStringArray(validator.issueFields, `checks.${key}.validator.issueFields`, issues);
  }
}

function validateResiduals(value: ReleaseCloseoutAudit["residuals"] | undefined, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "residuals", message: "must be an object" });
    return;
  }
  for (const field of [
    "releaseRecordIds",
    "supplyChainRecordIds",
    "missingLedgerIds",
    "releaseOnlyIds",
    "supplyChainOnlyIds",
    "currentBlockerIds",
    "needsAttentionIds",
  ] as const) {
    validateStringArray(value[field], `residuals.${field}`, issues);
  }
  if (!Array.isArray(value.records)) issues.push({ field: "residuals.records", message: "must be an array" });
}

function validateSafetyFacts(value: ReleaseCloseoutAudit["safetyFacts"] | undefined, issues: ValidationIssue[]): void {
  const expected = {
    readOnly: true,
    networkRequested: false,
    serverCommandAttempted: false,
    productionWriteAttempted: false,
    updaterApplyAttempted: false,
    releaseCreated: false,
    residualLedgerUpdated: false,
    residualClosed: false,
    secretValuePrinted: false,
  } as const;
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) issues.push({ field: `safetyFacts.${field}`, message: `must be ${expectedValue}` });
  }
}

function parseAudit(raw: string, issues: ValidationIssue[]): ReleaseCloseoutAudit | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      issues.push({ field: "json", message: "must be an object" });
      return null;
    }
    return parsed as unknown as ReleaseCloseoutAudit;
  } catch (error) {
    issues.push({ field: "json", message: error instanceof Error ? error.message : "invalid JSON" });
    return null;
  }
}

function validateSafePath(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ field, message: "must be a repository-relative path" });
    return;
  }
  if (path.isAbsolute(value) || value.split("/").includes("..")) {
    issues.push({ field, message: "must be a safe repository-relative path" });
  }
}

function validateStringArray(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({ field, message: "must be a string array" });
  }
}

function requireValue(value: unknown, field: string, expected: unknown, issues: ValidationIssue[]): void {
  if (value !== expected) issues.push({ field, message: `must be ${String(expected)}` });
}

function requireOneOf(value: unknown, field: string, allowed: string[], issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
}

function requireString(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.length === 0) issues.push({ field, message: "must be a non-empty string" });
}

function requirePattern(value: unknown, field: string, pattern: RegExp, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !pattern.test(value)) issues.push({ field, message: `must match ${pattern}` });
}

function requireIso(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) issues.push({ field, message: "must be an ISO timestamp" });
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: pnpm release:closeout:audit:validate <release-closeout-audit.json>");
    process.exit(2);
  }
  const raw = readFileSync(path.resolve(file), "utf8");
  const issues = validateReleaseCloseoutAudit(raw);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`release closeout audit validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("release closeout audit validation passed: cross-record identity, residual, operational evidence, rollback, hash, and safety contracts are present.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
