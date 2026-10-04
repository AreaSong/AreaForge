import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hashAudit, type ReleaseCloseoutAudit } from "../ops/release-closeout-audit";

type ValidationIssue = { field: string; message: string };

const requiredChecks = [
  "releaseRecord",
  "supplyChainRecord",
  "identityConsistency",
  "residualLedger",
  "residualConsistency",
  "operationalEvidence",
  "postReleaseObservation",
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
  requireOneOf(body.status, "status", ["blocked", "needs_attention", "pending_observation", "ready_for_human_review"], issues);
  validateSource(body, issues);
  validateChecks(body, issues);
  validateIdentity(body.identity, issues);
  validateResiduals(body.residuals, issues);
  validateStringArray(body.blockedBy, "blockedBy", issues);
  validateStringArray(body.attentionBy, "attentionBy", issues);
  validateStringArray(body.pendingBy, "pendingBy", issues);
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
    : statuses.includes("needs_attention")
      ? "needs_attention"
      : statuses.includes("pending_observation") ? "pending_observation" : "ready_for_human_review";
  if (body.status !== expectedStatus) issues.push({ field: "status", message: `must be derived as ${expectedStatus}` });
  validateReasonProjection(body, issues);
  if (body.status === "pending_observation" && body.checks?.postReleaseObservation?.status !== "pending_observation") {
    issues.push({ field: "status", message: "pending_observation must be derived from the postReleaseObservation check" });
  }
  if (["pending_observation", "pass"].includes(body.checks?.postReleaseObservation?.status)) {
    if (body.checks.postReleaseObservation.validator.status !== "pass") {
      issues.push({ field: "checks.postReleaseObservation.validator.status", message: "must pass for a valid observation state" });
    }
    if (body.source.postReleaseObservation === null) {
      issues.push({ field: "source.postReleaseObservation", message: "is required for a valid observation state" });
    }
  }
  if (body.checks?.residualLedger?.status === "blocked" && body.checks?.residualConsistency?.status !== "blocked") {
    issues.push({ field: "checks.residualConsistency.status", message: "must block when the residual ledger check is blocked" });
  }

  return issues;
}

function validateReasonProjection(body: ReleaseCloseoutAudit, issues: ValidationIssue[]): void {
  const expectedBlocked = checkReasons(body, "blocked");
  const expectedAttention = checkReasons(body, "needs_attention");
  const expectedPending = checkReasons(body, "pending_observation");
  requireExactStringArray(body.blockedBy, expectedBlocked, "blockedBy", issues);
  requireExactStringArray(body.attentionBy, expectedAttention, "attentionBy", issues);
  requireExactStringArray(body.pendingBy, expectedPending, "pendingBy", issues);
}

function checkReasons(body: ReleaseCloseoutAudit, status: string): string[] {
  return requiredChecks.flatMap((key) => {
    const check = body.checks?.[key];
    return check?.status === status ? [`${key}: ${check.detail}`] : [];
  });
}

function requireExactStringArray(value: unknown, expected: string[], field: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return;
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    issues.push({ field, message: `must exactly project ${expected.join(" | ") || "an empty list"}` });
  }
}

function validateSource(body: ReleaseCloseoutAudit, issues: ValidationIssue[]): void {
  const source = body.source;
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
  if (source.postReleaseObservation !== null) {
    validateSafePath(source.postReleaseObservation, "source.postReleaseObservation", issues);
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
      requireString(item.key, `source.inputHashes[${index}].key`, issues);
      requirePattern(item.sha256, `source.inputHashes[${index}].sha256`, /^sha256:[a-f0-9]{64}$/i, issues);
    }
    validateSourceHashBinding(
      source,
      body.checks?.postReleaseObservation?.validator?.status,
      body.checks?.residualLedger?.status,
      issues,
    );
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
    const allowed = key === "postReleaseObservation"
      ? ["pass", "pending_observation", "needs_attention", "blocked"]
      : key === "residualLedger"
        ? ["pass", "blocked"]
        : ["pass", "needs_attention", "blocked"];
    requireOneOf(check.status, `checks.${key}.status`, allowed, issues);
    requireString(check.detail, `checks.${key}.detail`, issues);
  }
  for (const key of ["releaseRecord", "supplyChainRecord", "postReleaseObservation"] as const) {
    const validator = body.checks[key]?.validator;
    if (!isRecord(validator)) {
      issues.push({ field: `checks.${key}.validator`, message: "must be an object" });
      continue;
    }
    requireOneOf(validator.status, `checks.${key}.validator.status`, ["pass", "fail", "missing"], issues);
    requireString(validator.command, `checks.${key}.validator.command`, issues);
    validateStringArray(validator.issueFields, `checks.${key}.validator.issueFields`, issues);
  }
  const ledgerIssues = body.checks.residualLedger?.issues;
  if (!Array.isArray(ledgerIssues)) {
    issues.push({ field: "checks.residualLedger.issues", message: "must be an array" });
  } else {
    for (const [index, issue] of ledgerIssues.entries()) {
      if (!isRecord(issue)) {
        issues.push({ field: `checks.residualLedger.issues[${index}]`, message: "must be an object" });
        continue;
      }
      requireString(issue.field, `checks.residualLedger.issues[${index}].field`, issues);
      requireString(issue.message, `checks.residualLedger.issues[${index}].message`, issues);
    }
    if (body.checks.residualLedger.status === "pass" && ledgerIssues.length !== 0) {
      issues.push({ field: "checks.residualLedger.issues", message: "must be empty when the strict V2 reader passes" });
    }
    if (body.checks.residualLedger.status === "blocked" && ledgerIssues.length === 0) {
      issues.push({ field: "checks.residualLedger.issues", message: "must explain why the strict V2 reader blocked" });
    }
  }
}

function validateSourceHashBinding(
  source: ReleaseCloseoutAudit["source"],
  observationValidatorStatus: unknown,
  residualLedgerStatus: unknown,
  issues: ValidationIssue[],
): void {
  const expected = [
    ["releaseRecord", source.releaseRecord],
    ["supplyChainRecord", source.supplyChainRecord],
    ["residualLedger", source.residualLedger],
    ["operationalEvidenceBundle", source.operationalEvidenceBundle],
    ["postReleaseObservation", source.postReleaseObservation],
  ] as const;
  for (const [key, sourcePath] of expected) {
    if (sourcePath === null) continue;
    const matches = source.inputHashes.filter((item) => item.key === key && item.path === sourcePath);
    if (matches.length > 1) issues.push({ field: "source.inputHashes", message: `must not bind ${key} more than once` });
    if (key === "postReleaseObservation" && observationValidatorStatus !== "missing" && matches.length !== 1) {
      issues.push({ field: "source.inputHashes", message: "must bind postReleaseObservation exactly once when its source exists" });
    }
    if (key === "residualLedger" && residualLedgerStatus === "pass" && matches.length !== 1) {
      issues.push({ field: "source.inputHashes", message: "must bind residualLedger exactly once when the strict V2 reader passes" });
    }
  }
  for (const item of source.inputHashes) {
    const expectedPath = expected.find(([key]) => key === item.key)?.[1];
    if (expectedPath === undefined || expectedPath === null || item.path !== expectedPath) {
      issues.push({ field: "source.inputHashes", message: `contains an unbound source hash for ${item.key}` });
    }
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
    "blockedAcceptedExceptionIds",
  ] as const) {
    validateStringArray(value[field], `residuals.${field}`, issues);
  }
  validateAcceptedExceptions(value.acceptedExceptions, value.blockedAcceptedExceptionIds, issues);
  if (!Array.isArray(value.records)) {
    issues.push({ field: "residuals.records", message: "must be an array" });
  } else {
    for (const [index, record] of value.records.entries()) {
      if (!isRecord(record)) {
        issues.push({ field: `residuals.records[${index}]`, message: "must be an object" });
        continue;
      }
      requireString(record.id, `residuals.records[${index}].id`, issues);
      requireString(record.type, `residuals.records[${index}].type`, issues);
      requireString(record.reviewAt, `residuals.records[${index}].reviewAt`, issues);
      validateStringArray(record.ownerSkills, `residuals.records[${index}].ownerSkills`, issues);
    }
  }
}

function validateAcceptedExceptions(
  value: unknown,
  blockedIds: unknown,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "residuals.acceptedExceptions", message: "must be an array" });
    return;
  }
  const expectedBlocked: string[] = [];
  for (const [index, exception] of value.entries()) {
    const field = `residuals.acceptedExceptions[${index}]`;
    if (!isRecord(exception)) {
      issues.push({ field, message: "must be an object" });
      continue;
    }
    requireString(exception.id, `${field}.id`, issues);
    requireOneOf(exception.status, `${field}.status`, ["approved", "revoked", "expired", "superseded"], issues);
    if (typeof exception.effective !== "boolean") {
      issues.push({ field: `${field}.effective`, message: "must be a boolean" });
      continue;
    }
    if (exception.effective !== (exception.status === "approved")) {
      issues.push({ field: `${field}.effective`, message: "must be true only for a current approved accepted exception" });
    }
    if (!exception.effective && typeof exception.id === "string") expectedBlocked.push(exception.id);
  }
  requireExactStringArray(blockedIds, expectedBlocked, "residuals.blockedAcceptedExceptionIds", issues);
}

function validateIdentity(value: ReleaseCloseoutAudit["identity"] | undefined, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "identity", message: "must be an object" });
    return;
  }
  requireNullablePattern(value.releaseGitCommit, "identity.releaseGitCommit", /^[a-f0-9]{40}$/i, issues);
  requireNullableIso(value.releasedAt, "identity.releasedAt", issues);
  requireNullablePattern(value.supplyChainGitCommit, "identity.supplyChainGitCommit", /^[a-f0-9]{40}$/i, issues);
  requireNullablePattern(value.webImageDigest, "identity.webImageDigest", /@sha256:[a-f0-9]{64}$/i, issues);
  requireNullablePattern(value.migrationImageDigest, "identity.migrationImageDigest", /@sha256:[a-f0-9]{64}$/i, issues);
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
  for (const [field, expectedValue] of Object.entries(expected) as Array<[keyof typeof expected, boolean]>) {
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

function requireNullableIso(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (value !== null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
    issues.push({ field, message: "must be null or an ISO timestamp" });
  }
}

function requireNullablePattern(value: unknown, field: string, pattern: RegExp, issues: ValidationIssue[]): void {
  if (value !== null && (typeof value !== "string" || !pattern.test(value))) {
    issues.push({ field, message: `must be null or match ${pattern}` });
  }
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
