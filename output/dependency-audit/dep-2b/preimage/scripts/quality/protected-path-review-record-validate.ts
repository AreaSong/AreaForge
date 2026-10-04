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

const requiredFields = [
  "recordId",
  "reviewedAt",
  "reviewer",
  "reviewScope",
  "sourceCommit",
  "worktreeState",
  "worktreeStatusHash",
  "protectedPathScope",
  "protectedPathFingerprint",
  "protectedPaths",
  "reviewCommand",
  "reviewDecision",
  "findings",
  "followUpRefs",
  "doesNotProve",
  "result",
] as const;

const requiredSafetyFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.rollbackAttempted",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.residualLedgerUpdated",
] as const;

const requiredDoesNotProveTerms = [
  "production health",
  "all repository paths were reviewed",
  "git worktree cleanliness after review",
  "updater apply",
  "backup/restore",
  "migration",
  "rollback",
  "residual ledger closure",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm governance:protected-path-review:validate <protected-path-review-record.md|txt>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(raw);
  const issues = validateRecord(raw, fields);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`protected path review record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("protected path review record validation passed: review scope, worktree/protected-path fingerprints, decision, claim boundary, and no-write safety facts are present.");
  console.log(`protectedPathReviewEvidenceHash: ${buildEvidenceHash(fields, [...requiredFields, ...requiredSafetyFields])}`);
  console.log("claimBoundary: this validates record shape only; it does not prove worktree cleanliness, complete repository review, production health, or any production action.");
}

export function validateRecord(raw: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of [...requiredFields, ...requiredSafetyFields]) {
    requireField(fields, field, issues);
  }
  requireIsoTimestamp(fields, "reviewedAt", issues);
  requireOneOf(fields, "worktreeState", ["clean", "dirty-reviewed"], issues);
  requireOneOf(fields, "protectedPathScope", ["read_only_side_effect_guard_inputs"], issues);
  requireOneOf(fields, "reviewDecision", ["pass", "follow-up-required", "block"], issues);
  requireOneOf(fields, "result", ["reviewed", "follow-up-required", "blocked"], issues);
  for (const field of requiredSafetyFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
    requireNo(fields, field, issues);
  }

  validateTextFields(fields, issues);
  validateSha256(fields, "worktreeStatusHash", issues);
  validateSha256(fields, "protectedPathFingerprint", issues);
  validateSourceCommit(fields, issues);
  validateProtectedPaths(fields, issues);
  validateReviewCommand(fields, issues);
  validateStateConsistency(fields, issues);
  validateDoesNotProve(fields, issues);
  scanForSecrets(raw, issues);
  return issues;
}

function validateTextFields(fields: Map<string, string>, issues: ValidationIssue[]): void {
  for (const field of ["reviewer", "reviewScope", "findings"] as const) {
    const value = fields.get(field)?.trim().toLowerCase() ?? "";
    if (value.length < 4) {
      issues.push({ field, message: "must be specific enough for a human review" });
    }
  }
}

function validateSha256(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field) ?? "";
  if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be a sha256 digest with an optional sha256: prefix" });
  }
}

function validateSourceCommit(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const value = fields.get("sourceCommit") ?? "";
  if (!/^[a-f0-9]{7,64}$/i.test(value)) {
    issues.push({ field: "sourceCommit", message: "must be a 7-64 character hexadecimal git commit" });
  }
}

function validateProtectedPaths(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const paths = parseList(fields.get("protectedPaths") ?? "").map((item) => item.toLowerCase());
  if (paths.length === 0) {
    issues.push({ field: "protectedPaths", message: "must include the protected path scope reviewed" });
    return;
  }
  if (!paths.includes("readme.md") || !paths.includes("package.json")) {
    issues.push({ field: "protectedPaths", message: "must include README.md and package.json from the protected path set" });
  }
  if (paths.some((item) => item.startsWith("/") || item.includes("..") || item.includes("\\"))) {
    issues.push({ field: "protectedPaths", message: "must use safe repo-relative paths" });
  }
}

function validateReviewCommand(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const command = fields.get("reviewCommand") ?? "";
  for (const required of ["git status --short", "pnpm ops:status", "pnpm governance:preflight"]) {
    if (!command.includes(required)) {
      issues.push({ field: "reviewCommand", message: `must include ${required}` });
    }
  }
}

function validateStateConsistency(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const worktreeState = fields.get("worktreeState");
  const findings = fields.get("findings")?.trim().toLowerCase();
  const followUpRefs = fields.get("followUpRefs")?.trim().toLowerCase();
  const decision = fields.get("reviewDecision");
  const result = fields.get("result");

  if (worktreeState === "dirty-reviewed" && (!findings || findings === "none")) {
    issues.push({ field: "findings", message: "must describe reviewed dirty worktree findings" });
  }
  if (worktreeState === "dirty-reviewed" && (!followUpRefs || followUpRefs === "none")) {
    issues.push({ field: "followUpRefs", message: "must retain a repo-relative docs/tasks/workflow follow-up reference" });
  }
  if (worktreeState === "clean" && findings === "none" && followUpRefs !== "none") {
    issues.push({ field: "followUpRefs", message: "must be none when a clean review has no findings" });
  }
  if (decision === "pass" && result !== "reviewed") {
    issues.push({ field: "result", message: "must be reviewed when reviewDecision is pass" });
  }
  if (decision === "follow-up-required" && result !== "follow-up-required") {
    issues.push({ field: "result", message: "must be follow-up-required when reviewDecision is follow-up-required" });
  }
  if (decision === "block" && result !== "blocked") {
    issues.push({ field: "result", message: "must be blocked when reviewDecision is block" });
  }
  if (decision !== "pass" && (!followUpRefs || followUpRefs === "none")) {
    issues.push({ field: "followUpRefs", message: "must be non-empty when the decision is not pass" });
  }
}

function validateDoesNotProve(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const value = fields.get("doesNotProve")?.toLowerCase() ?? "";
  for (const term of requiredDoesNotProveTerms) {
    if (!value.includes(term)) {
      issues.push({ field: "doesNotProve", message: `must mention ${term}` });
    }
  }
}

main();
