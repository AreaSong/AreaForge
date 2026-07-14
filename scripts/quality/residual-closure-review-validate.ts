import path from "node:path";
import {
  buildEvidenceHash,
  parseIndentedKeyValueRecord,
  parseList,
  readRequiredFile,
  requireField,
  requireIsoTimestamp,
  requireNo,
  requireOneOf,
  scanForSecrets,
  type ValidationIssue,
} from "./record-validator-common";

const allowedResidualTypes = [
  "current-blocker",
  "deferred-work",
  "accepted-exception",
  "monitoring-gap",
  "release-follow-up",
  "historical-reference",
  "template-marker",
  "closed-evidence",
] as const;

const requiredScalarFields = [
  "recordId",
  "reviewedAt",
  "reviewer",
  "residualRiskId",
  "currentResidualType",
  "reviewDecision",
  "decisionRationale",
  "evidenceUris",
  "validatorCommands",
  "validatorSummary",
  "reopenConditions",
  "doesNotProve",
  "residualLedgerAction",
  "closesResidual",
  "result",
] as const;

const requiredSafetyFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.rollbackAttempted",
  "safetyFacts.releaseCreated",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.residualLedgerUpdated",
] as const;

const requiredDoesNotProveTerms = [
  "residual ledger closure",
  "production health",
  "updater apply",
  "backup/restore",
  "migration",
  "rollback",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm residuals:closure:validate <residual-closure-review-record.md|txt>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(raw);
  const issues = validateRecord(raw, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`residual closure review validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("residual closure review validation passed: reviewer decision, evidence URIs, validator summary, reopen conditions, claim boundary, and no-ledger-update safety facts are present.");
  console.log(`residualClosureReviewEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredSafetyFields])}`);
  console.log("claimBoundary: this validates the review record shape only; it does not update or close the residual ledger.");
}

export function validateRecord(raw: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredSafetyFields) {
    requireField(fields, field, issues);
    requireOneOf(fields, field, ["yes", "no"], issues);
  }

  requireIsoTimestamp(fields, "reviewedAt", issues);
  requireOneOf(fields, "currentResidualType", [...allowedResidualTypes], issues);
  requireOneOf(fields, "reviewDecision", ["close", "keep-open", "downgrade", "reopen"], issues);
  requireOneOf(fields, "residualLedgerAction", ["none", "requires-separate-ledger-update"], issues);
  requireOneOf(fields, "closesResidual", ["no"], issues);
  requireOneOf(fields, "result", ["ready-for-ledger-update", "keep-open", "blocked", "invalid"], issues);
  for (const field of requiredSafetyFields) {
    requireNo(fields, field, issues);
  }

  validateResidualId(fields.get("residualRiskId"), issues);
  validateTextField(fields, "reviewer", issues);
  validateTextField(fields, "decisionRationale", issues);
  validateEvidenceUris(fields.get("evidenceUris"), issues);
  validateValidatorCommands(fields, issues);
  validateReopenConditions(fields, issues);
  validateDoesNotProve(fields, issues);
  validateDecisionConsistency(fields, issues);

  scanForSecrets(raw, issues);
  return issues;
}

function validateResidualId(value: string | undefined, issues: ValidationIssue[]): void {
  if (!value) return;
  if (!/^AF-RISK-(OPS|REL|SC|UX|AI)-\d{3}$/.test(value)) {
    issues.push({ field: "residualRiskId", message: "must match AF-RISK-(OPS|REL|SC|UX|AI)-NNN" });
  }
}

function validateTextField(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field)?.trim() ?? "";
  if (value && value.length < 8) {
    issues.push({ field, message: "must be specific enough for human review" });
  }
  if (["none", "not-applicable", "n/a"].includes(value.toLowerCase())) {
    issues.push({ field, message: "must not be none or not-applicable" });
  }
}

function validateEvidenceUris(value: string | undefined, issues: ValidationIssue[]): void {
  if (!value) return;
  const forbidden = /(?:secret|password|token|credential|private[-_ ]?key|id_ed25519|\.env|DATABASE_URL|AUTH_SESSION_SECRET|AI_API_KEY|COSIGN_PASSWORD)/i;
  const items = parseList(value);
  if (items.length === 0) {
    issues.push({ field: "evidenceUris", message: "must include at least one evidence URI" });
    return;
  }

  for (const item of items) {
    if (forbidden.test(item)) {
      issues.push({ field: "evidenceUris", message: "must not reference secret-bearing paths or names" });
    }
    if (item.startsWith("/") || item.startsWith("~") || item.includes("..") || item.includes("\\")) {
      issues.push({ field: "evidenceUris", message: "must use repo-relative paths, sha256 digests, or HTTPS URLs only" });
    }
    if (!/^(?:[A-Za-z0-9._/-]+|https:\/\/[^\s,]+|sha256:[a-f0-9]{64})$/i.test(item)) {
      issues.push({ field: "evidenceUris", message: "must be a safe repo-relative path, sha256 digest, or HTTPS URL" });
    }
  }
}

function validateValidatorCommands(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const commands = fields.get("validatorCommands") ?? "";
  if (!commands.includes("pnpm ")) {
    issues.push({ field: "validatorCommands", message: "must list the pnpm validator commands used for the review" });
  }
  const summary = fields.get("validatorSummary")?.toLowerCase() ?? "";
  if (!/(pass|ready_for_human_close|ready_for_sc001_sc002_review|keep-open|blocked|fail|invalid)/.test(summary)) {
    issues.push({ field: "validatorSummary", message: "must summarize concrete validator status" });
  }
}

function validateReopenConditions(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const value = fields.get("reopenConditions")?.toLowerCase() ?? "";
  for (const term of ["new release", "stale", "failure"]) {
    if (!value.includes(term)) {
      issues.push({ field: "reopenConditions", message: `must mention ${term}` });
    }
  }
}

function validateDoesNotProve(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const value = fields.get("doesNotProve")?.toLowerCase() ?? "";
  for (const term of requiredDoesNotProveTerms) {
    if (!value.includes(term.toLowerCase())) {
      issues.push({ field: "doesNotProve", message: `must mention ${term}` });
    }
  }
}

function validateDecisionConsistency(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const decision = fields.get("reviewDecision")?.toLowerCase();
  const action = fields.get("residualLedgerAction")?.toLowerCase();
  const result = fields.get("result")?.toLowerCase();

  if (decision === "close" && action !== "requires-separate-ledger-update") {
    issues.push({ field: "residualLedgerAction", message: "must be requires-separate-ledger-update when reviewDecision is close" });
  }
  if (decision === "close" && result !== "ready-for-ledger-update") {
    issues.push({ field: "result", message: "must be ready-for-ledger-update when reviewDecision is close" });
  }
  if (decision === "keep-open" && result !== "keep-open") {
    issues.push({ field: "result", message: "must be keep-open when reviewDecision is keep-open" });
  }
}

main();
