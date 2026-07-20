import path from "node:path";
import {
  buildEvidenceHash,
  parseIndentedKeyValueRecord,
  readRequiredFile,
  requireField,
  requireIsoTimestamp,
  requireNo,
  requireOneOf,
  requireSha256,
  scanForSecrets,
  type ValidationIssue,
} from "./record-validator-common";

const requiredScalarFields = [
  "windowId",
  "startedAt",
  "finishedAt",
  "operator",
  "cadence",
  "environment",
  "commandsRun",
  "readinessOverall",
  "evidenceBundleStatus",
  "alertPreviewStatus",
  "healthStatus",
  "updateAgentStatus",
  "authenticatedSmokeStatus",
  "backupStatus",
  "infrastructureStatus",
  "readinessSummaryHash",
  "evidenceBundleHash",
  "alertPreviewHash",
  "residualReviewHash",
  "evidenceFreshnessStatus",
  "evidenceFreshnessMaxAgeSeconds",
  "latestEvidenceCheckedAt",
  "residualReviewStatus",
  "dueResidualRiskIds",
  "decisions",
  "followUpTasks",
  "result",
  "residualRiskIds",
] as const;

const requiredNestedFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.rollbackAttempted",
  "safetyFacts.secretValuePrinted",
] as const;

const requiredClaimBoundaryFields = [
  "claimBoundary.doesNotProve",
] as const;

const requiredClaimBoundaryTerms = [
  "production health",
  "live evidence",
  "updater apply",
  "backup/restore",
  "migration",
  "rollback",
  "residual risk closure",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm maintenance:window:validate <maintenance-window-record.md|txt>");
    process.exit(2);
  }

  const record = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(record);
  const issues = validateRecord(record, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`maintenance window record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("maintenance window record validation passed: cadence commands, residual review, evidence hashes, result, and safety facts are present.");
  console.log(`maintenanceWindowRecordEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredNestedFields, ...requiredClaimBoundaryFields])}`);
  console.log("safetyFacts: productionWriteAttempted=false serverCommandAttempted=false backupRestoreAttempted=false migrationAttempted=false updaterApplyAttempted=false rollbackAttempted=false secretValuePrinted=false");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredClaimBoundaryFields) {
    requireField(fields, field, issues);
  }

  requireIsoTimestamp(fields, "startedAt", issues);
  requireIsoTimestamp(fields, "finishedAt", issues);
  requireOneOf(fields, "cadence", ["daily", "weekly", "monthly", "release", "incident"], issues);
  requireOneOf(fields, "environment", ["production", "staging", "local", "ci"], issues);
  requireOneOf(fields, "readinessOverall", ["pass", "warn", "fail", "blocked", "unknown", "not-applicable"], issues);
  requireOneOf(fields, "evidenceBundleStatus", ["ready", "needs_attention", "blocked", "not-applicable"], issues);
  requireOneOf(fields, "alertPreviewStatus", ["ok", "watch", "warning", "critical", "not-applicable"], issues);
  for (const field of ["healthStatus", "updateAgentStatus", "authenticatedSmokeStatus", "backupStatus", "infrastructureStatus"] as const) {
    requireOneOf(fields, field, ["pass", "warn", "fail", "blocked", "unknown", "not-applicable"], issues);
  }
  requireOneOf(fields, "residualReviewStatus", ["pass", "warn", "fail"], issues);
  requireOneOf(fields, "evidenceFreshnessStatus", ["fresh", "stale", "unknown"], issues);
  requireOneOf(fields, "result", ["pass", "warn", "fail", "blocked"], issues);
  for (const field of requiredNestedFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
    requireNo(fields, field, issues);
  }

  for (const field of ["readinessSummaryHash", "evidenceBundleHash", "alertPreviewHash", "residualReviewHash"] as const) {
    const value = fields.get(field)?.toLowerCase();
    if (value && value !== "not-applicable") {
      requireSha256(fields, field, issues);
    }
  }

  const commands = fields.get("commandsRun") ?? "";
  for (const command of ["pnpm maintenance:cadence:preflight", "pnpm residuals:review-due"]) {
    if (!commands.includes(command)) {
      issues.push({ field: "commandsRun", message: `must include ${command}` });
    }
  }

  const result = fields.get("result")?.toLowerCase();
  if (result === "pass" && fields.get("residualReviewStatus")?.toLowerCase() === "fail") {
    issues.push({ field: "result", message: "cannot be pass when residualReviewStatus is fail" });
  }
  if (result === "pass" && fields.get("evidenceFreshnessStatus")?.toLowerCase() !== "fresh") {
    issues.push({ field: "result", message: "cannot be pass unless evidenceFreshnessStatus is fresh" });
  }

  const readinessOverall = fields.get("readinessOverall")?.toLowerCase();
  const evidenceBundleStatus = fields.get("evidenceBundleStatus")?.toLowerCase();
  const alertPreviewStatus = fields.get("alertPreviewStatus")?.toLowerCase();
  const signalStatuses = ["healthStatus", "updateAgentStatus", "authenticatedSmokeStatus", "backupStatus", "infrastructureStatus"]
    .map((field) => fields.get(field)?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const requiredResult = requiredResultForWindow({
    readinessOverall,
    evidenceBundleStatus,
    alertPreviewStatus,
    signalStatuses,
    residualReviewStatus: fields.get("residualReviewStatus")?.toLowerCase(),
    evidenceFreshnessStatus: fields.get("evidenceFreshnessStatus")?.toLowerCase(),
  });
  if (result && requiredResult && resultRank(result) < resultRank(requiredResult)) {
    issues.push({ field: "result", message: `must be at least ${requiredResult} for the recorded readiness, evidence, signal, residual, and freshness states` });
  }

  const freshnessMaxAge = Number(fields.get("evidenceFreshnessMaxAgeSeconds"));
  if (!Number.isInteger(freshnessMaxAge) || freshnessMaxAge <= 0) {
    issues.push({ field: "evidenceFreshnessMaxAgeSeconds", message: "must be a positive integer" });
  }

  const latestEvidenceCheckedAt = fields.get("latestEvidenceCheckedAt")?.trim() ?? "";
  if (latestEvidenceCheckedAt !== "unknown" && Number.isNaN(Date.parse(latestEvidenceCheckedAt))) {
    issues.push({ field: "latestEvidenceCheckedAt", message: "must be an ISO-8601 timestamp or unknown" });
  }

  const dueIds = fields.get("dueResidualRiskIds")?.trim().toLowerCase() ?? "";
  if (dueIds === "") {
    issues.push({ field: "dueResidualRiskIds", message: "must be none or a comma-separated AF-RISK list" });
  }
  if (dueIds !== "none" && !/AF-RISK-/i.test(dueIds)) {
    issues.push({ field: "dueResidualRiskIds", message: "must use AF-RISK-* IDs when not none" });
  }
  if (dueIds !== "none" && fields.get("residualReviewStatus")?.toLowerCase() === "pass") {
    issues.push({ field: "residualReviewStatus", message: "cannot be pass when dueResidualRiskIds is not none" });
  }

  const startedAt = fields.get("startedAt");
  const finishedAt = fields.get("finishedAt");
  if (startedAt && finishedAt && !Number.isNaN(Date.parse(startedAt)) && !Number.isNaN(Date.parse(finishedAt)) && Date.parse(finishedAt) < Date.parse(startedAt)) {
    issues.push({ field: "finishedAt", message: "must be at or after startedAt" });
  }

  const claimBoundary = fields.get("claimBoundary.doesNotProve")?.toLowerCase() ?? "";
  for (const term of requiredClaimBoundaryTerms) {
    if (!claimBoundary.includes(term.toLowerCase())) {
      issues.push({ field: "claimBoundary.doesNotProve", message: `must mention ${term}` });
    }
  }

  scanForSecrets(record, issues);
  return issues;
}

type WindowSignals = {
  readinessOverall?: string;
  evidenceBundleStatus?: string;
  alertPreviewStatus?: string;
  signalStatuses: string[];
  residualReviewStatus?: string;
  evidenceFreshnessStatus?: string;
};

function requiredResultForWindow(signals: WindowSignals): "pass" | "warn" | "fail" | "blocked" | null {
  const normalized = [
    normalizeReadiness(signals.readinessOverall),
    normalizeEvidence(signals.evidenceBundleStatus),
    normalizeAlert(signals.alertPreviewStatus),
    ...signals.signalStatuses.map(normalizeSignal),
    normalizeResidual(signals.residualReviewStatus),
    normalizeFreshness(signals.evidenceFreshnessStatus),
  ].filter((value): value is "pass" | "warn" | "fail" | "blocked" => Boolean(value));
  if (normalized.length === 0) return null;
  return normalized.sort((left, right) => resultRank(right) - resultRank(left))[0] ?? null;
}

function normalizeReadiness(value?: string): "pass" | "warn" | "fail" | "blocked" | null {
  if (value === "pass" || value === "warn" || value === "fail" || value === "blocked") return value;
  return value === "unknown" ? "warn" : null;
}

function normalizeEvidence(value?: string): "pass" | "warn" | "fail" | "blocked" | null {
  if (value === "ready") return "pass";
  if (value === "needs_attention") return "warn";
  if (value === "blocked") return "blocked";
  return null;
}

function normalizeAlert(value?: string): "pass" | "warn" | "fail" | "blocked" | null {
  if (value === "ok") return "pass";
  if (value === "watch" || value === "warning") return "warn";
  if (value === "critical") return "blocked";
  return null;
}

function normalizeSignal(value?: string): "pass" | "warn" | "fail" | "blocked" | null {
  if (value === "pass" || value === "warn" || value === "fail" || value === "blocked") return value;
  return value === "unknown" ? "warn" : null;
}

function normalizeResidual(value?: string): "pass" | "warn" | "fail" | null {
  if (value === "pass" || value === "warn" || value === "fail") return value;
  return null;
}

function normalizeFreshness(value?: string): "pass" | "warn" | null {
  if (value === "fresh") return "pass";
  return value === "stale" || value === "unknown" ? "warn" : null;
}

function resultRank(value: string): number {
  return { pass: 0, warn: 1, fail: 2, blocked: 3 }[value] ?? -1;
}

main();
