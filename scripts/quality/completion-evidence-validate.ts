import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import {
  buildEvidenceHash,
  parseIndentedKeyValueRecord,
  readRequiredFile,
  requireField,
  requireNo,
  requireOneOf,
  parseList,
  scanForSecrets,
  type ValidationIssue,
} from "./record-validator-common";

const requiredScalarFields = [
  "scope",
  "summary",
  "evidenceClass",
  "claimScope",
  "evidenceUri",
  "sourceBaseline.sourceDocs",
  "sourceBaseline.sourceHashOrCommit",
  "freshValidation.commands",
  "freshValidation.browserOrRuntimeEvidence",
  "freshValidation.checkedAt",
  "unverified.skippedChecks",
  "unverified.reason",
  "blockers.product",
  "blockers.securityPrivacy",
  "blockers.dependencySupplyChain",
  "blockers.ciRelease",
  "blockers.gitCheckpoint",
  "residualRiskIds",
  "releaseRequired",
  "highestRuntimeWriteBoundary",
  "highRiskConfirmation",
  "doesNotProve",
  "result",
] as const;

const requiredSafetyFields = [
  "safetyFacts.productionTouched",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.releaseCreated",
  "safetyFacts.secretValuePrinted",
] as const;

const blockerFields = [
  "blockers.product",
  "blockers.securityPrivacy",
  "blockers.dependencySupplyChain",
  "blockers.ciRelease",
  "blockers.gitCheckpoint",
] as const;

const highRiskSafetyFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.releaseCreated",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm completion:evidence:validate <completion-evidence-record.md|txt>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(raw);
  const issues = validateRecord(raw, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`completion evidence validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("completion evidence validation passed: summary, claim scope, evidence URI, evidence class, source baseline, validation, blockers, residuals, release need, write boundary, does-not-prove boundary, and safety facts are present.");
  console.log(`completionEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredSafetyFields])}`);
  console.log("claimBoundary: this validates the completion record shape only; it does not replace runtime, release, production, smoke, or long-term live gates.");
}

function validateRecord(raw: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredSafetyFields) {
    requireField(fields, field, issues);
    requireOneOf(fields, field, ["yes", "no"], issues);
  }

  requireStrictIsoTimestamp(fields, "freshValidation.checkedAt", issues);
  requireOneOf(fields, "evidenceClass", ["source", "runtime", "release", "production", "docs-only", "local-smoke", "browser-review"], issues);
  requireOneOf(fields, "claimScope", ["source-only", "local-runtime", "release-artifact", "production-live", "long-term-operability", "mixed"], issues);
  requireOneOf(fields, "releaseRequired", ["yes", "no", "not-applicable"], issues);
  requireOneOf(fields, "highestRuntimeWriteBoundary", ["r0", "r1", "r2", "r3", "r4"], issues);
  requireOneOf(fields, "highRiskConfirmation", ["yes", "no", "not-applicable"], issues);
  requireOneOf(fields, "result", ["pass", "fail", "blocked", "not-ready"], issues);
  requireNo(fields, "safetyFacts.secretValuePrinted", issues);
  requireMeaningfulClaimFields(fields, issues);
  validateSourceBaseline(fields.get("sourceBaseline.sourceHashOrCommit"), issues);

  const result = fields.get("result")?.toLowerCase();
  if (result === "pass") {
    for (const field of blockerFields) {
      if (!isClear(fields.get(field))) {
        issues.push({ field, message: "must be none or not-applicable when result is PASS" });
      }
    }
    if (!isClear(fields.get("unverified.skippedChecks"))) {
      issues.push({ field: "unverified.skippedChecks", message: "must be none or not-applicable when result is PASS" });
    }
    if (!isClear(fields.get("unverified.reason"))) {
      issues.push({ field: "unverified.reason", message: "must be none or not-applicable when result is PASS" });
    }
    const commands = fields.get("freshValidation.commands")?.toLowerCase() ?? "";
    if (commands === "none" || commands.includes("not-run") || commands.includes("not run")) {
      issues.push({ field: "freshValidation.commands", message: "must list fresh validation commands when result is PASS" });
    }
  }

  const residualRiskIds = fields.get("residualRiskIds")?.trim() ?? "";
  if (!residualRiskIds) {
    issues.push({ field: "residualRiskIds", message: "must be none or a comma-separated AF-RISK-* list" });
  }
  if (residualRiskIds.toLowerCase() !== "none" && !residualRiskIds.split(",").every((item) => /^AF-RISK-[A-Z]+-\d{3}$/.test(item.trim()))) {
    issues.push({ field: "residualRiskIds", message: "must use AF-RISK-* IDs when not none" });
  }

  const highRiskFlagged = highRiskSafetyFields.some((field) => fields.get(field)?.toLowerCase() === "yes");
  const highRiskAttempted = fields.get("highestRuntimeWriteBoundary")?.toLowerCase() === "r4"
    || highRiskFlagged;
  const confirmation = fields.get("highRiskConfirmation")?.toLowerCase();
  if (highRiskAttempted && confirmation !== "yes") {
    issues.push({ field: "highRiskConfirmation", message: "must be yes when R4 or high-risk release/production action is recorded" });
  }
  if (highRiskFlagged && fields.get("highestRuntimeWriteBoundary")?.toLowerCase() !== "r4") {
    issues.push({ field: "highestRuntimeWriteBoundary", message: "must be R4 when high-risk production, release, migration, backup/restore, server, or updater action is recorded" });
  }
  if (!highRiskAttempted && confirmation === "yes") {
    issues.push({ field: "highRiskConfirmation", message: "should be no or not-applicable when no high-risk action is recorded" });
  }

  const evidenceClass = fields.get("evidenceClass")?.toLowerCase();
  if (fields.get("safetyFacts.productionWriteAttempted")?.toLowerCase() === "yes" && fields.get("safetyFacts.productionTouched")?.toLowerCase() !== "yes") {
    issues.push({ field: "safetyFacts.productionTouched", message: "must be yes when productionWriteAttempted is yes" });
  }
  if (evidenceClass === "production" && fields.get("safetyFacts.productionTouched")?.toLowerCase() !== "yes") {
    issues.push({ field: "safetyFacts.productionTouched", message: "must be yes when evidenceClass is production" });
  }
  if (evidenceClass === "docs-only" && fields.get("safetyFacts.productionTouched")?.toLowerCase() === "yes") {
    issues.push({ field: "safetyFacts.productionTouched", message: "must be no when evidenceClass is docs-only" });
  }
  if (evidenceClass === "docs-only" && fields.get("highestRuntimeWriteBoundary")?.toLowerCase() !== "r0") {
    issues.push({ field: "highestRuntimeWriteBoundary", message: "must be R0 when evidenceClass is docs-only" });
  }
  if (evidenceClass === "docs-only" && highRiskFlagged) {
    issues.push({ field: "evidenceClass", message: "docs-only evidence cannot include release, production write, server, backup/restore, migration, or updater apply actions" });
  }
  if (fields.get("safetyFacts.releaseCreated")?.toLowerCase() === "yes" && !["release", "production"].includes(evidenceClass ?? "")) {
    issues.push({ field: "evidenceClass", message: "must be release or production when releaseCreated is yes" });
  }

  scanForSecrets(raw, issues);
  return issues;
}

function isClear(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "none" || normalized === "not-applicable";
}

function requireMeaningfulClaimFields(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const summary = fields.get("summary")?.trim() ?? "";
  if (summary.length > 0 && summary.length < 16) {
    issues.push({ field: "summary", message: "must be a meaningful completion or non-completion summary" });
  }
  if (isClear(summary)) {
    issues.push({ field: "summary", message: "must not be none or not-applicable" });
  }

  validateClaimScope(fields, issues);
  validateEvidenceUri(fields.get("evidenceUri"), issues);
  validateDoesNotProve(fields, issues);
}

function validateClaimScope(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const claimScope = fields.get("claimScope")?.toLowerCase();
  const evidenceClass = fields.get("evidenceClass")?.toLowerCase();
  const result = fields.get("result")?.toLowerCase();

  const allowedEvidenceByScope: Record<string, string[]> = {
    "source-only": ["source", "docs-only"],
    "local-runtime": ["runtime", "local-smoke", "browser-review"],
    "release-artifact": ["release", "production"],
    "production-live": ["production"],
  };

  if (claimScope && evidenceClass && allowedEvidenceByScope[claimScope] && !allowedEvidenceByScope[claimScope].includes(evidenceClass)) {
    issues.push({ field: "claimScope", message: `does not match evidenceClass ${evidenceClass}` });
  }
  if (claimScope === "long-term-operability" && result === "pass" && evidenceClass !== "production") {
    issues.push({ field: "claimScope", message: "long-term-operability PASS requires production evidenceClass" });
  }
}

function validateEvidenceUri(value: string | undefined, issues: ValidationIssue[]): void {
  if (!value) return;
  if (isClear(value)) return;

  const forbidden = /(?:secret|password|token|credential|private[-_ ]?key|id_ed25519|\.env|DATABASE_URL|AUTH_SESSION_SECRET|AI_API_KEY|COSIGN_PASSWORD)/i;
  for (const item of parseList(value)) {
    if (forbidden.test(item)) {
      issues.push({ field: "evidenceUri", message: "must not reference secret-bearing paths or names" });
    }
    if (item.startsWith("/") || item.startsWith("~") || item.includes("..") || item.includes("\\")) {
      issues.push({ field: "evidenceUri", message: "must use repo-relative paths, sha256 digests, or HTTPS URLs only" });
    }
    if (!/^(?:[A-Za-z0-9._/-]+|https:\/\/[^\s,]+|sha256:[a-f0-9]{64})$/i.test(item)) {
      issues.push({ field: "evidenceUri", message: "must be a safe repo-relative path, sha256 digest, or HTTPS URL" });
      continue;
    }
    if (/^(?:https:\/\/|sha256:)/i.test(item)) continue;

    const evidencePath = path.resolve(process.cwd(), item);
    const repositoryRoot = `${path.resolve(process.cwd())}${path.sep}`;
    if (!evidencePath.startsWith(repositoryRoot)) {
      issues.push({ field: "evidenceUri", message: `${item} must resolve inside the repository` });
      continue;
    }
    if (!existsSync(evidencePath)) {
      issues.push({ field: "evidenceUri", message: `${item} does not exist` });
      continue;
    }
    if (!lstatSync(evidencePath).isFile()) {
      issues.push({ field: "evidenceUri", message: `${item} must be a regular file` });
    }
  }
}

function validateSourceBaseline(value: string | undefined, issues: ValidationIssue[]): void {
  const normalized = value?.trim() ?? "";
  if (!/^[a-f0-9]{40}$/i.test(normalized)) return;

  const result = spawnSync("git", ["cat-file", "-e", `${normalized}^{commit}`], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    issues.push({
      field: "sourceBaseline.sourceHashOrCommit",
      message: "40-character commit baseline must resolve to a commit in the current repository",
    });
  }
}

function validateDoesNotProve(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const value = fields.get("doesNotProve")?.trim() ?? "";
  const lower = value.toLowerCase();
  if (isClear(value) || value.length < 16) {
    issues.push({ field: "doesNotProve", message: "must list concrete claim boundaries" });
    return;
  }

  const evidenceClass = fields.get("evidenceClass")?.toLowerCase();
  const claimScope = fields.get("claimScope")?.toLowerCase();
  const result = fields.get("result")?.toLowerCase();
  const releaseRequired = fields.get("releaseRequired")?.toLowerCase();

  if (evidenceClass !== "production" && !lower.includes("production health")) {
    issues.push({ field: "doesNotProve", message: "must mention production health when evidence is not production live evidence" });
  }
  if (releaseRequired === "yes" && !lower.includes("release")) {
    issues.push({ field: "doesNotProve", message: "must mention release when releaseRequired is yes" });
  }
  if (claimScope === "long-term-operability" && !lower.includes("long-term operability")) {
    issues.push({ field: "doesNotProve", message: "must mention long-term operability for long-term-operability claims" });
  }
  if (result !== "pass" && !lower.includes("residual") && !lower.includes("blocker")) {
    issues.push({ field: "doesNotProve", message: "must mention residual or blocker when result is not PASS" });
  }
}

function requireStrictIsoTimestamp(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field);
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push({ field, message: "must be a full ISO-8601 timestamp with time and timezone" });
  }
}

main();
